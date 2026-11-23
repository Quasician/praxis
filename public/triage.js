// Praxis — "Needs a decision": nothing sits overdue silently.
//
// A task lands in the tray when it's 2+ days overdue, or when it has slipped
// (been pushed to a later date while already due) 3+ times. Tray tasks leave the
// normal list and the auto-planner until you decide: Today, Pick a day, Someday,
// Break down (→ milestone with a first small step), Done, or Drop. Repeating
// tasks get "Skip to next" so stale occurrences don't pile up.
//
// Slips are tracked locally (praxis.config.json → taskMemory), which also catches
// postponements made from your phone, since Praxis checks every task's date.

const TRIAGE_DAYS = 2;
const SLIP_LIMIT = 3;
const SOMEDAY_LABEL = "someday";
const DROPPED_LABEL = "dropped";

// ---------- slip tracking ----------
let memDirty = false, memTimer = null, lastFullScan = 0;
const taskMemory = () => {
  const cfg = areasState.config || {};
  cfg.taskMemory = cfg.taskMemory || {};
  return cfg.taskMemory;
};
const slipCount = (id) => ((areasState.config && areasState.config.taskMemory && areasState.config.taskMemory[id]) || {}).moves || 0;

function observeTasks(tasks, { complete = false } = {}) {
  const mem = taskMemory();
  const today = ymd(new Date());
  const seen = new Set();
  for (const t of tasks) {
    seen.add(t.id);
    if (!t.due || t.due.is_recurring) continue; // a repeating task moving forward isn't a slip
    const due = (t.due.date || "").slice(0, 10);
    const m = mem[t.id];
    if (!m) { mem[t.id] = { due, moves: 0 }; memDirty = true; continue; }
    if (due !== m.due) {
      if (due > m.due && m.due <= today) m.moves = (m.moves || 0) + 1; // pushed later while already due
      m.due = due;
      memDirty = true;
    }
  }
  // Forget tasks that no longer exist (only when we've seen the full list).
  if (complete) for (const id of Object.keys(mem)) if (!seen.has(id)) { delete mem[id]; memDirty = true; }
  if (memDirty) {
    clearTimeout(memTimer);
    memTimer = setTimeout(async () => {
      if (!memDirty) return;
      memDirty = false;
      try { await saveConfig(areasState.config); } catch { memDirty = true; }
    }, 3000);
  }
}

document.addEventListener("praxis:synced", async () => {
  try {
    await ensureConfig();
    observeTasks(state.today);
    // Every 10 minutes, look at all tasks so postponements made elsewhere (e.g. your phone) count too.
    if (Date.now() - lastFullScan > 10 * 60000) {
      lastFullScan = Date.now();
      const all = await fetchAll("/tasks");
      areasState.active = all.filter((t) => !t.checked && !t.is_deleted);
      observeTasks(areasState.active, { complete: true });
    }
    render();
  } catch (e) { console.warn("Slip tracking skipped:", e); }
});

// ---------- which tasks need a decision ----------
function daysOverdue(t) {
  const d = parseDue(t.due);
  if (!d) return 0;
  return Math.round((startOfToday() - new Date(d.d.getFullYear(), d.d.getMonth(), d.d.getDate())) / 864e5);
}
function triageItems() {
  const out = [];
  for (const t of state.today) {
    if (!t.due) continue;
    const days = daysOverdue(t), moves = slipCount(t.id);
    if (days >= TRIAGE_DAYS || moves >= SLIP_LIMIT) out.push({ task: t, days, moves, recurring: !!t.due.is_recurring });
  }
  return out.sort((a, b) => b.days - a.days || b.moves - a.moves);
}
const trayIds = () => new Set(triageItems().map((x) => x.task.id));

// ---------- banner + header counter (called from render) ----------
function triageBannerHTML(n) {
  if (!n) return "";
  return `<button class="tray-banner" id="open-triage">
    <span class="tray-flag">⚑</span>
    <span><b>${n} task${n === 1 ? "" : "s"}</b> need${n === 1 ? "s" : ""} a decision</span>
    <span class="tray-go">Review →</span>
  </button>`;
}
document.addEventListener("click", (e) => { if (e.target.closest("#open-triage, #summary-triage")) openTriage(); });

// ---------- the triage dialog ----------
const GROUPS = [
  { key: "slip", title: "Keeps slipping", test: (x) => x.moves >= SLIP_LIMIT && x.days < TRIAGE_DAYS },
  { key: "week", title: "Overdue 2–7 days", test: (x) => x.days >= TRIAGE_DAYS && x.days <= 7 },
  { key: "month", title: "Overdue 1–4 weeks", test: (x) => x.days > 7 && x.days <= 31 },
  { key: "half", title: "Overdue 1–6 months", test: (x) => x.days > 31 && x.days <= 183 },
  { key: "old", title: "Overdue 6+ months", test: (x) => x.days > 183 },
];
const triageUndo = new Map();

function ageText(x) {
  if (x.days < TRIAGE_DAYS) return "due today";
  if (x.days < 14) return `${x.days} days overdue`;
  if (x.days < 60) return `${Math.round(x.days / 7)} weeks overdue`;
  if (x.days < 365) return `${Math.round(x.days / 30)} months overdue`;
  const y = (x.days / 365).toFixed(1).replace(/\.0$/, "");
  return `${y} year${y === "1" ? "" : "s"} overdue`;
}

function rowHTML(x) {
  const t = x.task;
  const proj = state.projects.get(t.project_id);
  const wp = typeof willpower === "function" ? willpower(t) : 2;
  const meta = [
    proj ? `<span class="proj"><i style="background:${COLORS[proj.color] || "#b8b8b8"}"></i>${esc(proj.name)}</span>` : "",
    `<span class="${x.days > 31 ? "late" : ""}">${esc(ageText(x))}</span>`,
    x.recurring ? `<span title="Repeats: ${esc(t.due.string || "")}">↻ ${esc(t.due.string || "repeats")}</span>` : "",
    x.moves ? `<span class="slips" title="Pushed back ${x.moves} times">moved ${x.moves}×</span>` : "",
    wp === 3 ? `<span class="pbadge wp3">Deep</span>` : "",
  ].filter(Boolean).join("");
  const actions = x.recurring ? `
      <button type="button" class="mini" data-act="today">Do today</button>
      <button type="button" class="mini ghost-on" data-act="skip" title="Mark this occurrence done and move to the next one">Skip to next</button>` : `
      <button type="button" class="mini" data-act="today">Today</button>
      <select class="tri-pick" data-act="pick" aria-label="Pick a day">
        <option value="">Pick a day…</option>
        <option value="tomorrow">Tomorrow</option>
        <option value="weekend">This weekend</option>
        <option value="nextweek">Next week (Mon)</option>
        <option value="custom">Choose a date…</option>
      </select>
      <button type="button" class="mini ghost-on" data-act="someday" title="Remove the date and tag @someday. Resurfaces in the Friday review.">Someday</button>
      <button type="button" class="mini ghost-on" data-act="breakdown" title="Turn it into a milestone with a first small step">Break down</button>
      <button type="button" class="mini ghost-on" data-act="done">Done</button>
      <button type="button" class="mini ghost-on danger" data-act="drop" title="Complete it tagged @dropped (recoverable in Todoist)">Drop</button>`;
  return `
    <li class="tri-row" data-id="${esc(t.id)}">
      <div class="tri-main">
        <div class="tri-title">${renderInline(t.content)}</div>
        <div class="meta">${meta}</div>
        ${x.moves >= SLIP_LIMIT && !x.recurring ? `<div class="tri-hint">This keeps slipping. It may be too big or unclear. Try <b>Break down</b> into one small first step.</div>` : ""}
      </div>
      <div class="tri-actions">${actions}</div>
    </li>`;
}

function renderTriage() {
  const items = triageItems();
  const body = $("#triage-body");
  $("#triage-count").textContent = items.length ? `${items.length} to decide` : "All clear";
  if (!items.length) {
    body.innerHTML = `<div class="empty"><div class="big">Nothing waiting on you.</div>Every overdue task has a decision. Nice.</div>`;
    return;
  }
  body.innerHTML = GROUPS.map((g) => {
    const xs = items.filter(g.test);
    if (!xs.length) return "";
    const bulkable = xs.filter((x) => !x.recurring).length;
    return `
      <section class="tri-group" data-group="${g.key}">
        <header><h3>${esc(g.title)} <span class="n">${xs.length}</span></h3>
          ${bulkable >= 3 ? `<button type="button" class="ghost-btn" data-bulk="someday" data-group="${g.key}">Move ${bulkable} to Someday</button>` : ""}
        </header>
        <ul>${xs.map(rowHTML).join("")}</ul>
      </section>`;
  }).join("");
}

function openTriage() {
  renderTriage();
  const dlg = $("#triage-dialog");
  if (!dlg.open) dlg.showModal();
}

// ---------- actions ----------
async function syncCmds(commands) {
  const res = await api("/api/todoist/sync", { method: "POST", body: { commands } });
  const st = (res && res.sync_status) || {};
  const bad = commands.filter((c) => st[c.uuid] !== "ok");
  if (bad.length) throw new Error(`Todoist rejected ${bad.length} change${bad.length > 1 ? "s" : ""}`);
}
const cmd = (args) => ({ type: "item_update", uuid: crypto.randomUUID(), args });

function nextDate(choice) {
  const d = startOfToday();
  if (choice === "tomorrow") d.setDate(d.getDate() + 1);
  if (choice === "weekend") { const dow = d.getDay(); d.setDate(d.getDate() + (dow === 6 ? 7 : (6 - dow))); }
  if (choice === "nextweek") { const dow = d.getDay(); d.setDate(d.getDate() + ((8 - dow) % 7 || 7)); }
  return ymd(d);
}

function removeLocal(id) {
  const before = { today: state.today.slice(), inbox: state.inbox.slice() };
  state.today = state.today.filter((t) => t.id !== id);
  return () => { state.today = before.today; state.inbox = before.inbox; };
}
function patchLocalDue(id, due) {
  const t = state.today.find((x) => x.id === id);
  const old = t && t.due;
  if (t) t.due = due;
  return () => { if (t) t.due = old; };
}

function afterAction(row, msg, undo) {
  row && row.classList.add("leaving");
  setTimeout(() => { renderTriage(); render(); }, 220);
  toast(msg, undo ? { label: "Undo", run: async () => { try { await undo(); } catch (e) { toast(`Couldn't undo: ${e.message}`); } loadAll({ quiet: true }); } } : null);
  clearTimeout(afterAction.t);
  afterAction.t = setTimeout(() => loadAll({ quiet: true }), 3000);
}

async function setDate(t, date, row, label) {
  const due = dueFor(t, date);
  const oldDue = t.due;
  const revert = patchLocalDue(t.id, { ...(t.due || {}), date, datetime: undefined });
  try {
    await syncCmds([cmd({ id: t.id, due })]);
    afterAction(row, `“${plain(t.content).slice(0, 40)}” → ${label}`, async () => {
      await syncCmds([cmd({ id: t.id, due: oldDue ? { date: oldDue.date, ...(oldDue.is_recurring ? { string: oldDue.string, is_recurring: true } : {}) } : null })]);
    });
  } catch (e) { revert(); toast(e.message); }
}

async function triageAction(act, id, row, value) {
  const t = state.today.find((x) => x.id === id);
  if (!t) return;
  const name = plain(t.content).slice(0, 40);
  try {
    if (act === "today") return setDate(t, ymd(new Date()), row, "today");
    if (act === "pick") {
      let date = value;
      if (value === "custom") {
        date = prompt("Which day? (YYYY-MM-DD)", nextDate("tomorrow"));
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      } else date = nextDate(value);
      const label = new Date(date + "T00:00:00").toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
      return setDate(t, date, row, label);
    }
    if (act === "someday") {
      const labels = [...new Set([...(t.labels || []), SOMEDAY_LABEL])];
      const old = { due: t.due, labels: t.labels || [] };
      const revert = removeLocal(id);
      try { await syncCmds([cmd({ id, due: null, labels })]); } catch (e) { revert(); throw e; }
      return afterAction(row, `“${name}” parked in Someday`, () => syncCmds([cmd({ id, due: { date: old.due.date }, labels: old.labels })]));
    }
    if (act === "done" || act === "skip" || act === "drop") {
      const revert = removeLocal(id);
      try {
        if (act === "drop") await syncCmds([cmd({ id, labels: [...new Set([...(t.labels || []), DROPPED_LABEL])] })]);
        await api(`/api/todoist/tasks/${encodeURIComponent(id)}/close`, { method: "POST" });
      } catch (e) { revert(); throw e; }
      const msg = act === "skip" ? `Skipped to the next “${name}”` : act === "drop" ? `Dropped “${name}” (still in Todoist's completed list)` : `Done: “${name}”`;
      return afterAction(row, msg, act === "skip" ? null : () => api(`/api/todoist/tasks/${encodeURIComponent(id)}/reopen`, { method: "POST" }));
    }
    if (act === "breakdown") {
      const actions = row.querySelector(".tri-actions");
      // (A plain div: forms can't be nested inside the dialog's form.)
      actions.innerHTML = `<div class="tri-break">
          <input type="text" placeholder="One small first step, e.g. “Find the login and check the balance”" aria-label="First step" />
          <button class="mini" type="button" data-act="create-step">Create</button>
          <button class="mini ghost-on" type="button" data-act="cancel-break">Cancel</button>
        </div>`;
      actions.querySelector("input").focus();
      return;
    }
  } catch (e) { toast(`Couldn't do that: ${e.message}`); }
}

async function breakDown(id, stepText, row) {
  const t = state.today.find((x) => x.id === id);
  if (!t) return;
  const labels = [...new Set([...(t.labels || []), MILESTONE_LABEL])];
  const revert = removeLocal(id);
  try {
    await syncCmds([cmd({ id, due: null, labels })]);
    await api("/api/todoist/tasks", { method: "POST", body: { content: stepText, parent_id: id, due_string: "today" } });
  } catch (e) { revert(); toast(`Couldn't break it down: ${e.message}`); return; }
  afterAction(row, `“${plain(t.content).slice(0, 36)}” is now a milestone. First step is on today.`);
  if (typeof loadAreas === "function") loadAreas({ force: true });
}

async function bulkSomeday(groupKey) {
  const g = GROUPS.find((x) => x.key === groupKey);
  const xs = triageItems().filter(g.test).filter((x) => !x.recurring);
  if (!xs.length || !confirm(`Move ${xs.length} tasks from “${g.title}” to Someday? They keep everything except the date, and get tagged @someday.`)) return;
  const commands = xs.map((x) => cmd({ id: x.task.id, due: null, labels: [...new Set([...(x.task.labels || []), SOMEDAY_LABEL])] }));
  const olds = xs.map((x) => ({ id: x.task.id, date: x.task.due.date, labels: x.task.labels || [] }));
  try {
    await syncCmds(commands);
    for (const x of xs) removeLocal(x.task.id);
    afterAction(null, `Moved ${xs.length} tasks to Someday`, () => syncCmds(olds.map((o) => cmd({ id: o.id, due: { date: o.date }, labels: o.labels }))));
  } catch (e) { toast(`Couldn't move them: ${e.message}`); loadAll({ quiet: true }); }
}

$("#triage-body").addEventListener("click", (e) => {
  const bulk = e.target.closest("[data-bulk]");
  if (bulk) { e.preventDefault(); return bulkSomeday(bulk.dataset.group); }
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  e.preventDefault();
  const row = btn.closest(".tri-row");
  if (btn.dataset.act === "cancel-break") return renderTriage();
  if (btn.dataset.act === "create-step") {
    const text = row.querySelector(".tri-break input").value.trim();
    if (text) breakDown(row.dataset.id, text, row);
    return;
  }
  triageAction(btn.dataset.act, row.dataset.id, row);
});
$("#triage-body").addEventListener("change", (e) => {
  const sel = e.target.closest("select[data-act=pick]");
  if (!sel || !sel.value) return;
  const row = sel.closest(".tri-row");
  triageAction("pick", row.dataset.id, row, sel.value);
});
$("#triage-body").addEventListener("keydown", (e) => {
  const input = e.target.closest(".tri-break input");
  if (!input) return;
  if (e.key === "Enter") {
    e.preventDefault(); // don't submit (and close) the dialog
    const row = input.closest(".tri-row");
    if (input.value.trim()) breakDown(row.dataset.id, input.value.trim(), row);
  } else if (e.key === "Escape") { e.preventDefault(); renderTriage(); }
});
