// Praxis — Todoist-backed planner: Today / Overdue / Inbox, and a drag-to-schedule timeline.

const $ = (s) => document.querySelector(s);

const COLORS = {
  berry_red: "#b8256f", red: "#db4035", orange: "#ff9933", yellow: "#fad000",
  olive_green: "#afb83b", lime_green: "#7ecc49", green: "#299438", mint_green: "#6accbc",
  teal: "#158fad", sky_blue: "#14aaf5", light_blue: "#96c3eb", blue: "#4073ff",
  grape: "#884dff", violet: "#af38eb", lavender: "#eb96eb", magenta: "#e05194",
  salmon: "#ff8d85", charcoal: "#808080", grey: "#b8b8b8", taupe: "#ccac93",
};
const TL_START = 6;  // timeline starts at 6am
const TL_END = 24;   // ...and ends at midnight

const state = {
  tab: "today",
  project: null,          // project filter (id) or null for all
  projects: new Map(),    // id -> project
  inboxId: null,
  today: [],              // tasks from "today | overdue"
  inbox: [],
  loading: true,
  lastSync: null,
};

// ---------- API ----------
async function api(path, opts = {}) {
  const r = await fetch(path, {
    method: opts.method || "GET",
    headers: { "X-Planner": "1", ...(opts.body ? { "Content-Type": "application/json" } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) {
    const err = new Error((data && data.error) || (typeof data === "string" && data) || `Request failed (${r.status})`);
    err.status = r.status;
    throw err;
  }
  return data;
}

// Todoist v1 list endpoints are paginated with next_cursor.
async function fetchAll(path) {
  const out = [];
  let cursor = null;
  do {
    const sep = path.includes("?") ? "&" : "?";
    const url = `/api/todoist${path}${sep}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const data = await api(url);
    if (Array.isArray(data)) { out.push(...data); break; }
    out.push(...(data.results || data.items || []));
    cursor = data.next_cursor || null;
  } while (cursor);
  return out;
}

// ---------- dates ----------
function parseDue(due) {
  if (!due) return null;
  const raw = due.datetime || due.date;
  if (!raw) return null;
  const hasTime = raw.length > 10;
  const d = hasTime ? new Date(raw) : new Date(raw + "T00:00:00");
  return { d, hasTime, recurring: !!due.is_recurring };
}
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const fmtTime = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function fmtDayShort(d) {
  const days = Math.round((startOfToday() - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function durationMinutes(t) {
  if (!t.duration) return null;
  return t.duration.unit === "day" ? t.duration.amount * 1440 : t.duration.amount;
}
function fmtDuration(min) {
  if (!min) return "";
  if (min >= 1440) return `${Math.round(min / 1440)}d`;
  const h = Math.floor(min / 60), m = min % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

// ---------- text ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function renderInline(s) {
  // Todoist allows a little markdown: [text](url), **bold**, *italic*
  let h = esc(s);
  h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  h = h.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*]+)\*/g, "$1<i>$2</i>");
  return h;
}
const plain = (s) => String(s ?? "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\*+/g, "");

// ---------- loading ----------
async function loadAll({ quiet = false } = {}) {
  const btn = $("#refresh-btn");
  btn.classList.add("spinning");
  if (!quiet) setSync("Syncing…");
  try {
    const projects = await fetchAll("/projects");
    state.projects = new Map(projects.map((p) => [p.id, p]));
    const inbox = projects.find((p) => p.inbox_project || p.is_inbox_project) || projects.find((p) => p.name === "Inbox");
    state.inboxId = inbox ? inbox.id : null;

    const [today, inboxTasks] = await Promise.all([
      fetchAll(`/tasks/filter?query=${encodeURIComponent("today | overdue")}`),
      state.inboxId ? fetchAll(`/tasks?project_id=${encodeURIComponent(state.inboxId)}`) : Promise.resolve([]),
    ]);
    state.today = today.filter((t) => !t.checked && !t.is_deleted);
    state.inbox = inboxTasks.filter((t) => !t.checked && !t.is_deleted);
    state.loading = false;
    state.lastSync = new Date();
    setSync("");
    render();
    document.dispatchEvent(new Event("praxis:synced"));
  } catch (e) {
    if (e.status === 401) return showSetup("Your Todoist connection expired. Paste your token again.");
    setSync("Couldn't sync — retrying soon");
    console.error(e);
    if (state.loading) { state.loading = false; render(); }
  } finally {
    btn.classList.remove("spinning");
  }
}
function setSync(msg) {
  const el = $("#sync-status");
  if (msg) { el.textContent = msg; return; }
  el.textContent = state.lastSync ? `Synced ${fmtTime(state.lastSync)}` : "";
}

// ---------- rendering ----------
function sortTasks(list, mode) {
  return [...list].sort((a, b) => {
    const da = parseDue(a.due), db = parseDue(b.due);
    if (mode === "overdue" && da && db && +da.d !== +db.d) return da.d - db.d;
    if (mode === "today") {
      const ta = da && da.hasTime, tb = db && db.hasTime;
      if (ta && tb && +da.d !== +db.d) return da.d - db.d;
      if (ta !== tb) return ta ? -1 : 1;
    }
    if (a.priority !== b.priority) return b.priority - a.priority;
    return (a.child_order ?? 0) - (b.child_order ?? 0);
  });
}

function splitToday(tasks) {
  const t0 = startOfToday();
  const overdue = [], today = [];
  for (const t of tasks) {
    const due = parseDue(t.due);
    if (due && due.d < t0) overdue.push(t);
    else today.push(t);
  }
  return { overdue: sortTasks(overdue, "overdue"), today: sortTasks(today, "today") };
}

function taskHTML(t, ctx) {
  const due = parseDue(t.due);
  const proj = state.projects.get(t.project_id);
  const meta = [];
  if (due) {
    const now = new Date();
    if (ctx === "overdue") {
      meta.push(`<span class="late">${esc(fmtDayShort(due.d))}${due.hasTime ? " " + esc(fmtTime(due.d)) : ""}</span>`);
    } else if (due.hasTime) {
      const late = sameDay(due.d, now) && due.d < now;
      meta.push(`<span class="time ${late ? "late" : ""}">${esc(fmtTime(due.d))}</span>`);
    } else if (ctx === "inbox") {
      meta.push(`<span>${sameDay(due.d, now) ? "Today" : esc(due.d.toLocaleDateString([], { month: "short", day: "numeric" }))}</span>`);
    }
    if (due.recurring) meta.push(`<span title="Repeats">↻</span>`);
  }
  const dur = durationMinutes(t);
  if (dur) meta.push(`<span>${esc(fmtDuration(dur))}</span>`);
  if (proj && ctx !== "inbox") {
    meta.push(`<span class="proj"><i style="background:${COLORS[proj.color] || "#b8b8b8"}"></i>${esc(proj.name)}</span>`);
  }
  for (const l of t.labels || []) meta.push(`<span>@${esc(l)}</span>`);

  const desc = t.description ? `<div class="desc">${esc(plain(t.description.split("\n")[0]))}</div>` : "";
  return `
    <li class="task p${t.priority || 1} ${t.parent_id ? "sub" : ""}" data-id="${esc(t.id)}">
      <button class="check" title="Complete" aria-label="Complete task">
        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5"/></svg>
      </button>
      <div class="body">
        <div class="content">${renderInline(t.content)}</div>
        ${desc}
        ${meta.length ? `<div class="meta">${meta.join("")}</div>` : ""}
      </div>
      <a class="open-link" href="https://app.todoist.com/app/task/${encodeURIComponent(t.id)}" target="_blank" rel="noopener" title="Open in Todoist">↗</a>
    </li>`;
}

function groupHTML(title, tasks, ctx) {
  if (!tasks.length) return "";
  return `
    <div class="group-title ${ctx === "overdue" ? "overdue" : ""}">${esc(title)} <span class="n">${tasks.length}</span></div>
    <ul class="tasks">${tasks.map((t) => taskHTML(t, ctx)).join("")}</ul>`;
}

function renderChips(tasks) {
  const counts = new Map();
  for (const t of tasks) counts.set(t.project_id, (counts.get(t.project_id) || 0) + 1);
  if (state.project && !counts.has(state.project)) state.project = null;
  if (counts.size < 2) { $("#chips").innerHTML = ""; return; }
  const chips = [`<button class="chip ${state.project ? "" : "active"}" data-project="">All <span class="n">${tasks.length}</span></button>`];
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [id, n] of sorted) {
    const p = state.projects.get(id);
    if (!p) continue;
    chips.push(`<button class="chip ${state.project === id ? "active" : ""}" data-project="${esc(id)}"><span class="dot" style="background:${COLORS[p.color] || "#b8b8b8"}"></span>${esc(p.name)} <span class="n">${n}</span></button>`);
  }
  $("#chips").innerHTML = chips.join("");
}

function render() {
  // Don't rebuild the screen under the pointer mid-drag; catch up when it ends.
  if (drag && drag.started) { renderPending = true; return; }
  // header
  const now = new Date();
  $("#weekday").textContent = now.toLocaleDateString([], { weekday: "long" });
  $("#fulldate").textContent = now.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });

  const { overdue, today } = splitToday(state.today);
  $("#count-today").textContent = state.loading ? "" : state.today.length || "";
  $("#count-inbox").textContent = state.loading ? "" : state.inbox.length || "";

  const timedLeft = today.filter((t) => { const d = parseDue(t.due); return d && d.hasTime && d.d > now; }).length;
  $("#summary").innerHTML = state.loading ? "" : [
    `<span><b>${today.length}</b> today</span>`,
    overdue.length ? `<span class="overdue"><b>${overdue.length}</b> overdue</span>` : "",
    timedLeft ? `<span><b>${timedLeft}</b> still scheduled</span>` : "",
  ].join("");

  $("#quick-input").placeholder = state.tab === "today"
    ? "Add a task for today — e.g. “Call landlord 3pm”"
    : "Add to Inbox — e.g. “Return boots friday”";

  const list = $("#list");
  if (state.loading) {
    $("#chips").innerHTML = "";
    list.innerHTML = Array.from({ length: 6 }, () => `<div class="skeleton"></div>`).join("");
    renderTimeline([]);
    return;
  }

  const source = state.tab === "today" ? state.today : state.inbox;
  renderChips(source);
  const keep = (t) => !state.project || t.project_id === state.project;

  if (state.tab === "today") {
    const o = overdue.filter(keep), t = today.filter(keep);
    list.innerHTML = (groupHTML("Overdue", o, "overdue") + groupHTML("Today", t, "today")) ||
      `<div class="empty"><div class="big">All clear.</div>Nothing due today. Enjoy it, or pull something from your Inbox.</div>`;
  } else {
    const items = sortTasks(state.inbox.filter(keep), "inbox");
    list.innerHTML = items.length
      ? `<ul class="tasks" style="margin-top:6px">${items.map((t) => taskHTML(t, "inbox")).join("")}</ul>`
      : `<div class="empty"><div class="big">Inbox zero.</div>Anything you capture on your phone lands here.</div>`;
  }

  renderTimeline(today);
}

// ---------- timeline ----------
const SNAP = 15;            // minutes
const DEFAULT_BLOCK = 30;   // minutes, for tasks with no duration yet
const hourPx = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hour")) || 56;
const minToY = (min) => ((min / 60) - TL_START) * hourPx();
const pad2 = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const minOfDay = (d) => d.getHours() * 60 + d.getMinutes();
function fmtMin(min) {
  const d = new Date(); d.setHours(0, min, 0, 0);
  return fmtTime(d);
}
function fmtSpan(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}
function blockMinutes(t) {
  const d = durationMinutes(t);
  return d && d < 1440 ? d : DEFAULT_BLOCK;
}

// Today's timed tasks as blocks: {task, start, dur}, with side-by-side columns for overlaps.
function layoutBlocks(todayTasks) {
  const now = new Date();
  const items = [];
  for (const t of todayTasks) {
    const due = parseDue(t.due);
    if (!due || !due.hasTime || !sameDay(due.d, now)) continue;
    const start = minOfDay(due.d);
    if (start < TL_START * 60) continue;
    const dur = Math.min(blockMinutes(t), TL_END * 60 - start);
    items.push({ task: t, start, dur, end: start + dur });
  }
  items.sort((a, b) => a.start - b.start || b.dur - a.dur);
  // Group overlapping blocks into clusters, then give each a column.
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const cols = [];
    for (const it of cluster) {
      let c = cols.findIndex((end) => end <= it.start);
      if (c === -1) { c = cols.length; cols.push(0); }
      cols[c] = it.end;
      it.col = c;
    }
    for (const it of cluster) it.cols = cols.length;
    cluster = [];
  };
  for (const it of items) {
    if (it.start >= clusterEnd && cluster.length) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) flush();
  return items;
}

function blockHTML({ task, start, dur, col = 0, cols = 1 }) {
  const now = minOfDay(new Date());
  const proj = state.projects.get(task.project_id);
  const color = (proj && COLORS[proj.color]) || "var(--accent)";
  const h = Math.max((dur / 60) * hourPx() - 2, 20);
  const compact = dur < 45;
  const rec = task.due && task.due.is_recurring;
  return `
    <div class="tl-block ${start + dur <= now ? "past" : ""} ${compact ? "compact" : ""}" data-id="${esc(task.id)}"
         style="top:${minToY(start)}px;height:${h}px;--c:${color};left:calc(${(col / cols) * 100}% + 4px);width:calc(${100 / cols}% - 8px)"
         title="${esc(plain(task.content))} · ${esc(fmtMin(start))}–${esc(fmtMin(start + dur))}">
      <button class="blk-check" title="Complete" aria-label="Complete task">
        <svg viewBox="0 0 24 24" width="10" height="10"><path fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5"/></svg>
      </button>
      <div class="blk-body">
        <div class="blk-title">${esc(plain(task.content))}${rec ? ' <span class="rec" title="Repeats">↻</span>' : ""}</div>
        <div class="blk-time">${esc(fmtMin(start))} – ${esc(fmtMin(start + dur))}${compact ? "" : ` · ${esc(fmtSpan(dur))}`}</div>
      </div>
      <div class="tl-resize" title="Drag to change length"></div>
    </div>`;
}

let scrolledTimeline = false;
function renderTimeline(todayTasks) {
  const now = new Date();
  const hours = [];
  for (let h = TL_START; h < TL_END; h++) {
    const label = new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: "numeric" });
    hours.push(`<div class="tl-hour"><span>${esc(label)}</span></div>`);
  }
  const blocks = layoutBlocks(todayTasks);
  const nowY = minToY(minOfDay(now));
  const nowLine = now.getHours() >= TL_START ? `<div class="tl-now" style="top:${nowY}px"></div>` : "";

  const tl = $("#timeline");
  const overlay = typeof plannerTimelineHTML === "function" ? plannerTimelineHTML() : "";
  tl.innerHTML = `<div class="tl-grid">${hours.join("")}${overlay}${blocks.map(blockHTML).join("")}${nowLine}</div>`;

  // Header summary: what's still planned for the rest of today.
  const nowMin = minOfDay(now);
  const ahead = blocks.filter((b) => b.end > nowMin);
  const mins = ahead.reduce((s, b) => s + (b.end - Math.max(b.start, nowMin)), 0);
  $("#tl-summary").textContent = state.loading ? "" :
    ahead.length ? `${ahead.length} block${ahead.length > 1 ? "s" : ""} ahead · ${fmtSpan(mins)} planned` : "Nothing planned yet";

  if (!scrolledTimeline && !state.loading) {
    tl.scrollTop = Math.max(0, nowY - hourPx() * 1.5);
    scrolledTimeline = true;
  }
}

// ---------- drag to schedule ----------
// Three gestures, all with the pointer (mouse or pen):
//   • drag a task from the list onto the timeline → schedule it
//   • drag a block → move it; drag its bottom edge → change its length
//   • drag a block back onto the list → take its time off (stays due today)
let drag = null;
let renderPending = false;

const findTask = (id) => state.today.find((t) => t.id === id) || state.inbox.find((t) => t.id === id);
const gridEl = () => document.querySelector(".tl-grid");
const inside = (el, e) => { if (!el) return false; const r = el.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom; };
function pointerMin(e) {
  const r = gridEl().getBoundingClientRect();
  return TL_START * 60 + ((e.clientY - r.top) / hourPx()) * 60;
}
const snap = (m) => Math.round(m / SNAP) * SNAP;
const clampStart = (start, dur) => Math.max(TL_START * 60, Math.min(start, TL_END * 60 - dur));

function startPending(e, info) {
  drag = { ...info, x0: e.clientX, y0: e.clientY, started: false };
  document.addEventListener("pointermove", onDragMove);
  document.addEventListener("pointerup", onDragEnd);
  document.addEventListener("pointercancel", cancelDrag);
}

$("#list").addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || e.target.closest(".check, a, button")) return;
  const li = e.target.closest(".task");
  const task = li && findTask(li.dataset.id);
  if (!task) return;
  e.preventDefault(); // no text selection while dragging
  startPending(e, { kind: "new", task, source: li, dur: blockMinutes(task) });
});

$("#timeline").addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || e.target.closest(".blk-check")) return;
  const el = e.target.closest(".tl-block");
  // Proposed (not yet accepted) blocks from the auto-planner move locally only.
  if (el && el.classList.contains("proposed")) {
    const item = plannerState.items[Number(el.dataset.idx)];
    if (!item) return;
    e.preventDefault();
    return startPending(e, {
      kind: e.target.closest(".tl-resize") ? "resize" : "move",
      task: item.task, source: el, start: item.start, dur: item.dur,
      grab: pointerMin(e) - item.start, proposalIdx: Number(el.dataset.idx),
    });
  }
  const task = el && findTask(el.dataset.id);
  if (!task) return;
  e.preventDefault();
  const due = parseDue(task.due);
  const start = minOfDay(due.d);
  startPending(e, {
    kind: e.target.closest(".tl-resize") ? "resize" : "move",
    task, source: el, start, dur: blockMinutes(task),
    grab: pointerMin(e) - start,
  });
});

function beginDrag() {
  drag.started = true;
  document.body.classList.add("dragging", drag.kind === "resize" ? "resizing" : "moving");
  drag.source.classList.add("lifting");
  if (drag.kind === "new") {
    drag.ghost = document.createElement("div");
    drag.ghost.className = "drag-ghost";
    drag.ghost.textContent = plain(drag.task.content);
    document.body.appendChild(drag.ghost);
  }
  drag.preview = document.createElement("div");
  drag.preview.className = "tl-block preview";
  drag.preview.innerHTML = `<div class="blk-body"><div class="blk-title"></div><div class="blk-time"></div></div>`;
  drag.preview.querySelector(".blk-title").textContent = plain(drag.task.content);
  drag.preview.hidden = true;
  gridEl().appendChild(drag.preview);
  autoScroll();
}

function onDragMove(e) {
  if (!drag) return;
  drag.lastEvent = e;
  if (!drag.started) {
    if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
    beginDrag();
  }
  updateDrag(e);
}

function updateDrag(e) {
  const overTimeline = inside($("#timeline"), e);
  const overList = !overTimeline && inside($(".tasks-pane"), e);
  if (drag.ghost) {
    drag.ghost.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 10}px)`;
    drag.ghost.classList.toggle("faint", overTimeline);
  }

  drag.target = null;
  if (drag.kind === "resize") {
    const end = Math.min(TL_END * 60, Math.max(drag.start + SNAP, snap(pointerMin(e))));
    drag.target = { start: drag.start, dur: end - drag.start };
  } else if (overTimeline) {
    const raw = drag.kind === "move" ? pointerMin(e) - drag.grab : pointerMin(e) - SNAP / 2;
    drag.target = { start: clampStart(snap(raw), drag.dur), dur: drag.dur };
  }

  const p = drag.preview;
  if (drag.target) {
    p.hidden = false;
    p.style.top = `${minToY(drag.target.start)}px`;
    p.style.height = `${Math.max((drag.target.dur / 60) * hourPx() - 2, 20)}px`;
    const compact = drag.target.dur < 45;
    p.classList.toggle("compact", compact);
    p.querySelector(".blk-time").textContent = `${fmtMin(drag.target.start)} – ${fmtMin(drag.target.start + drag.target.dur)}${compact ? "" : ` · ${fmtSpan(drag.target.dur)}`}`;
  } else {
    p.hidden = true;
  }

  // Dropping a block back on the list takes its time off.
  const canUnschedule = drag.kind === "move" && overList;
  $(".tasks-pane").classList.toggle("drop-unschedule", canUnschedule);
  drag.unschedule = canUnschedule;
}

// Scroll the timeline while dragging near its top or bottom edge.
function autoScroll() {
  if (!drag || !drag.started) return;
  const e = drag.lastEvent;
  const tl = $("#timeline");
  if (e && (inside(tl, e) || drag.kind === "resize")) {
    const r = tl.getBoundingClientRect();
    const edge = 48;
    let dy = 0;
    if (e.clientY < r.top + edge) dy = -Math.ceil((r.top + edge - e.clientY) / 4);
    else if (e.clientY > r.bottom - edge) dy = Math.ceil((e.clientY - (r.bottom - edge)) / 4);
    if (dy) { tl.scrollTop += dy; updateDrag(e); }
  }
  requestAnimationFrame(autoScroll);
}

function endDragUI() {
  document.removeEventListener("pointermove", onDragMove);
  document.removeEventListener("pointerup", onDragEnd);
  document.removeEventListener("pointercancel", cancelDrag);
  if (drag) {
    drag.ghost && drag.ghost.remove();
    drag.preview && drag.preview.remove();
    drag.source && drag.source.classList.remove("lifting");
  }
  document.body.classList.remove("dragging", "resizing", "moving");
  $(".tasks-pane").classList.remove("drop-unschedule");
  drag = null;
}

function cancelDrag() {
  endDragUI();
  if (renderPending) { renderPending = false; render(); }
}

function onDragEnd() {
  const d = drag;
  if (!d || !d.started) return cancelDrag();
  endDragUI();
  if (d.proposalIdx !== undefined) {
    plannerMoveItem(d.proposalIdx, d.target, d.unschedule && !d.target);
    renderPending = false;
    return render();
  }
  if (d.target && !(d.kind !== "new" && d.target.start === d.start && d.target.dur === d.dur)) {
    scheduleTask(d.task, d.target.start, d.target.dur);
  } else if (d.unschedule) {
    unscheduleTask(d.task);
  }
  renderPending = false;
  render();
}

// ---------- writing times back to Todoist ----------
// Uses Todoist's sync endpoint ("item_update") the way Todoist's own tools do:
// a repeating task gets its new date *and* its original repeat text back, so
// "every day at 8am" keeps repeating after you move today's occurrence.
async function syncUpdate(args) {
  const uuid = crypto.randomUUID();
  const res = await api("/api/todoist/sync", { method: "POST", body: { commands: [{ type: "item_update", uuid, args }] } });
  const status = res && res.sync_status && res.sync_status[uuid];
  if (status !== "ok") throw new Error((status && (status.error || status.error_extra && JSON.stringify(status.error_extra))) || "Todoist didn't accept the change");
}

function dueFor(task, date) {
  const old = task.due;
  const due = { date };
  if (old && old.is_recurring) {
    due.string = old.string;
    due.is_recurring = true;
    if (old.lang) due.lang = old.lang;
  }
  return due;
}

// Apply a change locally right away, and put it back if Todoist says no.
function patchLocal(id, patch) {
  const copies = [...state.today, ...state.inbox].filter((t) => t.id === id);
  const before = copies.map((t) => ({ t, due: t.due, duration: t.duration }));
  for (const t of copies) Object.assign(t, typeof patch === "function" ? patch(t) : patch);
  // A task scheduled for today belongs in the Today list even if it came from the Inbox.
  const t0 = copies[0];
  const due = t0 && parseDue(t0.due);
  let added = null;
  if (t0 && due && sameDay(due.d, new Date()) && !state.today.some((t) => t.id === id)) {
    added = { ...t0 };
    state.today.push(added);
  }
  return () => {
    for (const b of before) { b.t.due = b.due; b.t.duration = b.duration; }
    if (added) state.today = state.today.filter((t) => t !== added);
  };
}

let reconcileTimer = null;
const reconcileSoon = () => { clearTimeout(reconcileTimer); reconcileTimer = setTimeout(() => loadAll({ quiet: true }), 4000); };

async function scheduleTask(task, startMin, dur) {
  const start = new Date(); start.setHours(0, startMin, 0, 0);
  const hasTz = task.due && task.due.timezone;
  // Floating local time ("2026-11-22T19:00:00") unless the task is pinned to a time zone.
  const date = hasTz ? start.toISOString().replace(/\.\d{3}Z$/, "Z") : `${ymd(start)}T${pad2(start.getHours())}:${pad2(start.getMinutes())}:00`;
  const due = dueFor(task, date);
  if (hasTz) due.timezone = task.due.timezone;

  const undo = patchLocal(task.id, (t) => ({
    due: { ...(t.due || {}), ...due, date, datetime: undefined },
    duration: { amount: dur, unit: "minute" },
  }));
  render();
  try {
    await syncUpdate({ id: task.id, due, duration: { amount: dur, unit: "minute" } });
    reconcileSoon();
  } catch (e) {
    undo(); render();
    toast(`Couldn't schedule that: ${e.message}`);
  }
}

async function unscheduleTask(task) {
  if (task.due && task.due.is_recurring) {
    toast("Repeating tasks keep a time. Drag the block to move it instead.");
    return;
  }
  const date = ymd(new Date());
  const undo = patchLocal(task.id, (t) => ({ due: { ...(t.due || {}), date, datetime: undefined }, duration: null }));
  render();
  try {
    await syncUpdate({ id: task.id, due: { date }, duration: null });
    toast(`Unscheduled “${plain(task.content).slice(0, 50)}”. Still due today.`);
    reconcileSoon();
  } catch (e) {
    undo(); render();
    toast(`Couldn't unschedule that: ${e.message}`);
  }
}

// ---------- actions ----------
let toastTimer = null;
function toast(msg, action) {
  const el = $("#toast");
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ""}`;
  el.hidden = false;
  if (action) el.querySelector("button").onclick = () => { el.hidden = true; action.run(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 5000);
}

async function completeTask(id, li) {
  const all = [...state.today, ...state.inbox];
  const task = all.find((t) => t.id === id);
  li.classList.add("done");
  setTimeout(() => {
    state.today = state.today.filter((t) => t.id !== id);
    state.inbox = state.inbox.filter((t) => t.id !== id);
    render();
  }, 260);
  try {
    await api(`/api/todoist/tasks/${encodeURIComponent(id)}/close`, { method: "POST" });
    toast(`Completed “${plain(task ? task.content : "task").slice(0, 60)}”`, {
      label: "Undo",
      run: async () => {
        try {
          await api(`/api/todoist/tasks/${encodeURIComponent(id)}/reopen`, { method: "POST" });
        } catch (e) { toast("Couldn't undo — reopen it in Todoist."); }
        loadAll({ quiet: true });
      },
    });
    // Recurring tasks move to their next date, so refresh to reflect that.
    if (task && task.due && task.due.is_recurring) loadAll({ quiet: true });
  } catch (e) {
    toast("Couldn't complete that task. Try again.");
    loadAll({ quiet: true });
  }
}

async function quickAdd(text) {
  const input = $("#quick-input");
  input.disabled = true;
  try {
    let task;
    try {
      // Todoist's own natural-language parser ("tomorrow 3pm #Errands p1")
      task = await api("/api/todoist/tasks/quick", { method: "POST", body: { text } });
    } catch (e) {
      if (e.status !== 404 && e.status !== 405) throw e;
      task = await api("/api/todoist/tasks", { method: "POST", body: { content: text, ...(state.tab === "today" ? { due_string: "today" } : {}) } });
    }
    // On the Today tab, a task typed without a date still belongs to today.
    if (state.tab === "today" && task && task.id && !task.due) {
      await api(`/api/todoist/tasks/${encodeURIComponent(task.id)}`, { method: "POST", body: { due_string: "today" } });
    }
    input.value = "";
    toast("Added");
    await loadAll({ quiet: true });
  } catch (e) {
    toast(`Couldn't add task: ${e.message}`);
  } finally {
    input.disabled = false;
    input.focus();
  }
}

// ---------- setup ----------
function showSetup(msg = "") {
  $("#app").hidden = true;
  $("#setup").hidden = false;
  $("#setup-error").textContent = msg;
  $("#token-input").focus();
}
function showApp() {
  $("#setup").hidden = true;
  $("#app").hidden = false;
  state.loading = true;
  render();
  loadAll();
}

$("#setup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = e.target.querySelector("button");
  const token = $("#token-input").value.trim();
  if (!token) return;
  btn.disabled = true; btn.textContent = "Checking…";
  $("#setup-error").textContent = "";
  try {
    await api("/api/token", { method: "POST", body: { token } });
    $("#token-input").value = "";
    showApp();
  } catch (err) {
    $("#setup-error").textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = "Connect";
  }
});

// ---------- events ----------
$("#list").addEventListener("click", (e) => {
  const check = e.target.closest(".check");
  if (!check) return;
  const li = check.closest(".task");
  completeTask(li.dataset.id, li);
});
$("#timeline").addEventListener("click", (e) => {
  const check = e.target.closest(".blk-check");
  if (!check) return;
  const block = check.closest(".tl-block");
  completeTask(block.dataset.id, block);
});
$("#chips").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  state.project = chip.dataset.project || null;
  render();
});
document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
function setTab(tab) {
  state.tab = tab;
  state.project = null;
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  render();
}
$("#quick-add").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("#quick-input").value.trim();
  if (text) quickAdd(text);
});
$("#refresh-btn").addEventListener("click", () => refreshCurrent());
function refreshCurrent() {
  if (typeof areasState !== "undefined" && areasState.view === "areas") loadAreas({ force: true });
  loadAll();
}
$("#menu-btn").addEventListener("click", (e) => { e.stopPropagation(); $("#menu").hidden = !$("#menu").hidden; });
document.addEventListener("click", () => ($("#menu").hidden = true));
$("#disconnect-btn").addEventListener("click", async () => {
  if (!confirm("Disconnect Todoist? Your tasks stay in Todoist; this app just forgets the token.")) return;
  await api("/api/token", { method: "DELETE" });
  showSetup();
});

document.addEventListener("keydown", (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.querySelector("dialog[open]");
  if (e.key === "Escape") {
    if (drag) { cancelDrag(); return; }
    document.activeElement.blur(); $("#menu").hidden = true; return;
  }
  if (typing || e.ctrlKey || e.metaKey || e.altKey || $("#app").hidden) return;
  if (e.key === "q" || e.key === "/") { e.preventDefault(); if (areasState.view !== "plan") setView("plan"); $("#quick-input").focus(); }
  else if (e.key === "r") refreshCurrent();
  else if (e.key === "1") setTab("today");
  else if (e.key === "2") setTab("inbox");
  else if (e.key === "d") setView("plan");
  else if (e.key === "a") setView("areas");
  else if (e.key === "p") proposePlan();
  else if (e.key === "Enter" && plannerState.active && plannerState.items.length) acceptPlan();
});

// Stay fresh: re-sync when you come back to the window, and every 2 minutes.
window.addEventListener("focus", () => { if (!$("#app").hidden && Date.now() - (state.lastSync || 0) > 20000) loadAll({ quiet: true }); });
setInterval(() => { if (!$("#app").hidden) loadAll({ quiet: true }); }, 120000);
// Keep the "now" line moving.
setInterval(() => { if (!$("#app").hidden && !state.loading) render(); }, 60000);

// ---------- start ----------
(async function init() {
  try {
    const { connected } = await api("/api/status");
    connected ? showApp() : showSetup();
  } catch {
    showSetup("Can't reach the local server. Is the Praxis window still open?");
  }
})();
