// Praxis — Areas: the bigger picture.
// Groups Todoist projects into life areas, shows how much time each got this
// week, nudges you about areas that have gone quiet, and tracks milestones:
// any Todoist task labelled @milestone, with its sub-tasks as the steps.

const MILESTONE_LABEL = "milestone";
const QUIET_DAYS = 7;
const HISTORY_DAYS = 89; // Todoist serves completed tasks in windows of up to ~3 months
const AREA_COLORS = ["blue", "green", "violet", "sky_blue", "orange", "red", "teal", "magenta", "olive_green", "charcoal"];

// First-run guess at areas, from project names. You can change it all in "Edit areas".
const SEED_AREAS = [
  { name: "Career", color: "blue", match: /career|work|job|resume|interview|portfolio/i },
  { name: "Health", color: "green", match: /rowing|workout|exercise|fitness|health|gym|run|supplement|sleep/i },
  { name: "Hobbies", color: "violet", match: /hobb|book|read|piano|music|photo|camera|hik|game|art|draw|writing/i },
  { name: "Home", color: "sky_blue", match: /daily|weekly|shopping|grocer|meal|home|chore|errand|clean|apartment/i },
  { name: "Money", color: "olive_green", match: /financ|money|budget|tax|invest/i },
  { name: "Travel", color: "orange", match: /trip|travel|vacation/i },
];

const areasState = {
  view: "plan",
  config: null,
  active: [],      // all open tasks
  completed: [],   // completed in the last HISTORY_DAYS
  loadedAt: 0,
  loading: false,
  error: null,
};

// ---------- helpers ----------
const hasLabel = (t, name) => (t.labels || []).some((l) => l.toLowerCase() === name);
const isMilestone = (t) => hasLabel(t, MILESTONE_LABEL);
const startOfWeek = () => { const d = startOfToday(); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return d; };
const daysAgo = (n) => { const d = startOfToday(); d.setDate(d.getDate() - n); return d; };
const completedAt = (t) => new Date(t.completed_at || t.completed_date || t.updated_at || 0);
const effortMin = (t) => { const m = durationMinutes(t); return m && m < 1440 ? m : 0; };
const colorOf = (name) => COLORS[name] || COLORS.charcoal;
function relDays(d) {
  const n = Math.round((startOfToday() - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  if (n <= 0) return "today";
  if (n === 1) return "yesterday";
  return `${n} days ago`;
}
function fmtTarget(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr.slice(0, 10) + "T00:00:00");
  const days = Math.round((d - startOfToday()) / 864e5);
  const label = d.toLocaleDateString([], { month: "short", day: "numeric", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) });
  if (days < 0) return `<span class="ms-target late">was due ${esc(label)}</span>`;
  if (days === 0) return `<span class="ms-target soon">due today</span>`;
  return `<span class="ms-target ${days <= 7 ? "soon" : ""}">by ${esc(label)}${days <= 7 ? ` · ${days}d left` : ""}</span>`;
}
const newId = () => "a" + Math.random().toString(36).slice(2, 9);

// ---------- config ----------
function seedAreas() {
  const areas = [];
  for (const p of state.projects.values()) {
    if (p.inbox_project || p.is_inbox_project || p.is_archived) continue;
    const seed = SEED_AREAS.find((s) => s.match.test(p.name));
    if (!seed) continue;
    let area = areas.find((a) => a.name === seed.name);
    if (!area) { area = { id: newId(), name: seed.name, color: seed.color, projects: [] }; areas.push(area); }
    area.projects.push(p.id);
  }
  const order = SEED_AREAS.map((s) => s.name);
  return areas.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
}

async function ensureConfig() {
  if (areasState.config) return areasState.config;
  const cfg = (await api("/api/config")) || {};
  if (!Array.isArray(cfg.areas)) {
    if (!state.projects.size) await loadAll({ quiet: true });
    cfg.areas = seedAreas();
    await api("/api/config", { method: "POST", body: cfg });
  }
  areasState.config = cfg;
  return cfg;
}

async function saveConfig(cfg) {
  areasState.config = await api("/api/config", { method: "POST", body: cfg });
}

// ---------- loading ----------
async function loadAreas({ force = false } = {}) {
  if (areasState.loading) return;
  if (!force && Date.now() - areasState.loadedAt < 30000) return renderAreas();
  areasState.loading = true;
  if (!areasState.loadedAt) renderAreas();
  try {
    await ensureConfig();
    if (!state.projects.size) await loadAll({ quiet: true });
    const since = daysAgo(HISTORY_DAYS).toISOString();
    const until = new Date(Date.now() + 60000).toISOString();
    const [active, completed] = await Promise.all([
      fetchAll("/tasks"),
      fetchAll(`/tasks/completed/by_completion_date?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`).catch((e) => {
        console.warn("Completed tasks unavailable", e);
        return [];
      }),
    ]);
    areasState.active = active.filter((t) => !t.checked && !t.is_deleted);
    areasState.completed = completed;
    areasState.loadedAt = Date.now();
    areasState.error = null;
  } catch (e) {
    areasState.error = e.message;
  } finally {
    areasState.loading = false;
    renderAreas();
  }
}

// ---------- computing each area ----------
function computeArea(area) {
  const projects = new Set(area.projects);
  const inArea = (t) => projects.has(t.project_id);
  const open = areasState.active.filter(inArea);
  const done = areasState.completed.filter(inArea);
  const weekStart = startOfWeek();
  const doneWeek = done.filter((t) => completedAt(t) >= weekStart);

  // Last 7 days of activity, oldest first. Effort = task duration, or 15m for tasks without one.
  const spark = [];
  for (let i = 6; i >= 0; i--) {
    const from = daysAgo(i), to = daysAgo(i - 1);
    const items = done.filter((t) => { const c = completedAt(t); return c >= from && c < to; });
    spark.push({ day: from, n: items.length, min: items.reduce((s, t) => s + (effortMin(t) || 15), 0) });
  }

  const last = done.reduce((m, t) => { const c = completedAt(t); return c > m ? c : m; }, new Date(0));
  const quietFor = last.getTime() ? Math.round((startOfToday() - new Date(last.getFullYear(), last.getMonth(), last.getDate())) / 864e5) : null;

  const milestones = open.filter(isMilestone).map((m) => {
    const steps = areasState.active.filter((t) => t.parent_id === m.id).sort((a, b) => (a.child_order ?? 0) - (b.child_order ?? 0));
    const doneSteps = areasState.completed.filter((t) => t.parent_id === m.id).length;
    const total = steps.length + doneSteps;
    return { m, steps, doneSteps, total, pct: total ? Math.round((doneSteps / total) * 100) : 0, next: steps[0] || null,
             target: (m.deadline && m.deadline.date) || (m.due && m.due.date) || null };
  }).sort((a, b) => (a.target || "9999").localeCompare(b.target || "9999"));

  const milestoneIds = new Set(milestones.map((x) => x.m.id));
  const upNext = open
    .filter((t) => !isMilestone(t) && !milestoneIds.has(t.parent_id))
    .sort((a, b) => {
      const da = parseDue(a.due), db = parseDue(b.due);
      if (!!da !== !!db) return da ? -1 : 1;
      if (da && db && +da.d !== +db.d) return da.d - db.d;
      return b.priority - a.priority;
    })
    .slice(0, 3);

  return {
    area, open, milestones, upNext, spark,
    weekMin: doneWeek.reduce((s, t) => s + effortMin(t), 0),
    weekDone: doneWeek.length,
    quietFor, everActive: !!last.getTime(),
  };
}

// ---------- rendering ----------
function sparkHTML(spark, color) {
  const max = Math.max(30, ...spark.map((s) => s.min));
  return `<div class="spark" style="--c:${color}" aria-label="Activity over the last 7 days">${spark.map((s) => {
    const h = s.n ? Math.max(8, Math.round((s.min / max) * 100)) : 0;
    const day = s.day.toLocaleDateString([], { weekday: "short" });
    return `<span title="${esc(day)}: ${s.n} done${s.n ? ` (~${fmtSpan(s.min)})` : ""}"><i style="height:${h}%"></i><b>${esc(day[0])}</b></span>`;
  }).join("")}</div>`;
}

function stepIsToday(t) {
  const d = parseDue(t.due);
  return d && sameDay(d.d, new Date());
}

function milestoneHTML(x) {
  const { m, steps, doneSteps, total, pct, next, target } = x;
  const nextHTML = next
    ? `<div class="ms-next"><span class="ms-next-label">Next</span><span class="ms-next-title">${renderInline(next.content)}</span>
        ${stepIsToday(next)
          ? `<span class="ms-on-today">On today ✓</span>`
          : `<button class="mini" data-act="today" data-id="${esc(next.id)}">Do today</button>`}</div>`
    : `<div class="ms-next ms-none">${total ? "All steps done. Tick the milestone when it's finished." : "No steps yet. Add the first one below."}</div>`;
  return `
    <div class="ms" data-id="${esc(m.id)}">
      <div class="ms-top">
        <button class="ms-check" data-act="complete" data-id="${esc(m.id)}" title="Mark milestone done" aria-label="Mark milestone done">
          <svg viewBox="0 0 24 24" width="11" height="11"><path fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" d="M5 12.5l4.5 4.5L19 7.5"/></svg>
        </button>
        <span class="ms-title">${renderInline(m.content)}</span>
        <a class="open-link" href="https://app.todoist.com/app/task/${encodeURIComponent(m.id)}" target="_blank" rel="noopener" title="Open in Todoist">↗</a>
      </div>
      <div class="ms-bar"><i style="width:${pct}%"></i></div>
      <div class="ms-meta"><span>${total ? `${doneSteps} of ${total} steps` : "No steps"}</span>${fmtTarget(target)}</div>
      ${nextHTML}
      ${steps.length > 1 ? `<details class="ms-steps"><summary>${steps.length - 1} more step${steps.length > 2 ? "s" : ""}</summary><ul>${steps.slice(1).map((s) =>
        `<li><span>${renderInline(s.content)}</span>${stepIsToday(s) ? `<span class="ms-on-today">today</span>` : `<button class="mini ghost" data-act="today" data-id="${esc(s.id)}">Do today</button>`}</li>`).join("")}</ul></details>` : ""}
      <form class="inline-add" data-act="add-step" data-id="${esc(m.id)}" autocomplete="off">
        <input type="text" placeholder="+ Add a step" aria-label="Add a step to ${esc(plain(m.content))}" />
      </form>
    </div>`;
}

function areaCardHTML(x) {
  const { area, open, milestones, upNext, spark, weekMin, weekDone, quietFor, everActive } = x;
  const color = colorOf(area.color);
  const quiet = area.projects.length && (quietFor === null || quietFor >= QUIET_DAYS);
  const nudge = !area.projects.length
    ? `<div class="nudge">No projects yet. Use “Edit areas” to add some.</div>`
    : quiet
      ? `<div class="nudge">${everActive ? `Quiet for ${quietFor} days.` : "Nothing finished here in the last 3 months."} ${upNext.length || milestones.some((ms) => ms.next) ? "Maybe plan one small thing today?" : "Add a milestone or a task to get it moving."}</div>`
      : "";
  const projNames = area.projects.map((id) => state.projects.get(id)).filter(Boolean).map((p) => p.name);

  return `
    <article class="area-card ${quiet ? "is-quiet" : ""}" style="--c:${color}" data-area="${esc(area.id)}">
      <header class="area-top">
        <span class="area-dot"></span>
        <h3>${esc(area.name)}</h3>
        <span class="area-open" title="${esc(projNames.join(", "))}">${open.length} open</span>
      </header>
      <div class="area-stats">
        <div class="stat"><b>${weekMin ? esc(fmtSpan(weekMin)) : "—"}</b><span>timed this week</span></div>
        <div class="stat"><b>${weekDone}</b><span>done this week</span></div>
        ${sparkHTML(spark, color)}
      </div>
      ${nudge}
      ${milestones.length ? `<section class="area-sec"><h4>Milestones</h4>${milestones.map(milestoneHTML).join("")}</section>` : ""}
      ${upNext.length ? `<section class="area-sec"><h4>Up next</h4><ul class="upnext">${upNext.map((t) => {
        const d = parseDue(t.due);
        return `<li class="p${t.priority || 1}"><span class="dot"></span><span class="t">${renderInline(t.content)}</span>
          ${d ? `<span class="when">${sameDay(d.d, new Date()) ? "today" : esc(d.d.toLocaleDateString([], { month: "short", day: "numeric" }))}</span>` : ""}
          ${stepIsToday(t) ? "" : `<button class="mini ghost" data-act="today" data-id="${esc(t.id)}">Do today</button>`}</li>`;
      }).join("")}</ul></section>` : ""}
      ${area.projects.length ? `
      <form class="inline-add ms-new" data-act="add-milestone" data-area="${esc(area.id)}" autocomplete="off">
        <input type="text" name="title" placeholder="+ New milestone, e.g. “Finish the rowing program”" aria-label="New milestone in ${esc(area.name)}" />
        <div class="ms-new-extra">
          <label>Target <input type="date" name="target" /></label>
          <button class="mini" type="submit">Add</button>
        </div>
      </form>` : ""}
    </article>`;
}

function renderAreas() {
  const grid = $("#areas-grid");
  if (!grid || areasState.view !== "areas") return;
  const cfg = areasState.config;
  if (areasState.error && !areasState.loadedAt) {
    grid.innerHTML = `<div class="empty"><div class="big">Couldn't load your areas.</div>${esc(areasState.error)}</div>`;
    return;
  }
  if (!cfg || !areasState.loadedAt) {
    grid.innerHTML = Array.from({ length: 4 }, () => `<div class="area-card skeleton-card"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>`).join("");
    $("#areas-sub").textContent = "";
    return;
  }
  // Keep typed-but-unsent text in the add boxes across re-renders.
  const drafts = {};
  grid.querySelectorAll("form.inline-add").forEach((f) => {
    const v = f.querySelector("input[type=text]").value;
    if (v) drafts[f.dataset.act + ":" + (f.dataset.id || f.dataset.area)] = v;
  });
  const focused = document.activeElement && document.activeElement.closest && document.activeElement.closest("form.inline-add");
  const focusKey = focused && focused.dataset.act + ":" + (focused.dataset.id || focused.dataset.area);

  const computed = cfg.areas.map(computeArea);
  grid.innerHTML = computed.length
    ? computed.map(areaCardHTML).join("")
    : `<div class="empty"><div class="big">No areas yet.</div>Click “Edit areas” to group your projects into areas of your life.</div>`;

  grid.querySelectorAll("form.inline-add").forEach((f) => {
    const key = f.dataset.act + ":" + (f.dataset.id || f.dataset.area);
    const input = f.querySelector("input[type=text]");
    if (drafts[key]) { input.value = drafts[key]; f.classList.add("open"); }
    if (key === focusKey) input.focus();
  });

  const totalMin = computed.reduce((s, c) => s + c.weekMin, 0);
  const totalDone = computed.reduce((s, c) => s + c.weekDone, 0);
  const quiet = computed.filter((c) => c.area.projects.length && (c.quietFor === null || c.quietFor >= QUIET_DAYS)).map((c) => c.area.name);
  const msCount = computed.reduce((s, c) => s + c.milestones.length, 0);
  $("#areas-sub").innerHTML = [
    `This week: <b>${totalDone}</b> done${totalMin ? ` · <b>${esc(fmtSpan(totalMin))}</b> timed` : ""}`,
    `<b>${msCount}</b> active milestone${msCount === 1 ? "" : "s"}`,
    quiet.length ? `<span class="quiet-note">Gone quiet: ${esc(quiet.join(", "))}</span>` : `Every area got attention recently`,
  ].join(" · ");
}

// ---------- actions ----------
async function refreshEverything() {
  await Promise.all([loadAreas({ force: true }), loadAll({ quiet: true })]);
}

async function doToday(id) {
  const t = areasState.active.find((x) => x.id === id);
  if (t && t.due && t.due.is_recurring) { toast("That one repeats, so it already has its own schedule."); return; }
  try {
    await api(`/api/todoist/tasks/${encodeURIComponent(id)}`, { method: "POST", body: { due_string: "today" } });
    toast(`Added to today: “${plain(t ? t.content : "task").slice(0, 50)}”`, { label: "Plan it", run: () => setView("plan") });
    refreshEverything();
  } catch (e) { toast(`Couldn't add it to today: ${e.message}`); }
}

async function addStep(parentId, text) {
  await api("/api/todoist/tasks", { method: "POST", body: { content: text, parent_id: parentId } });
  await loadAreas({ force: true });
}

async function addMilestone(areaId, title, target) {
  const area = areasState.config.areas.find((a) => a.id === areaId);
  if (!area || !area.projects.length) return;
  const body = { content: title, project_id: area.projects[0], labels: [MILESTONE_LABEL] };
  try {
    await api("/api/todoist/tasks", { method: "POST", body: target ? { ...body, deadline_date: target } : body });
  } catch (e) {
    if (!target) throw e;
    // Older accounts may not support deadlines; fall back to a due date.
    await api("/api/todoist/tasks", { method: "POST", body: { ...body, due_date: target } });
    toast("Saved the target as a due date (deadlines weren't available).");
  }
  await loadAreas({ force: true });
}

async function completeMilestone(id, el) {
  const x = areasState.active.find((t) => t.id === id);
  const openSteps = areasState.active.filter((t) => t.parent_id === id).length;
  if (openSteps && !confirm(`This milestone still has ${openSteps} open step${openSteps > 1 ? "s" : ""}. Mark it done anyway?`)) return;
  el.classList.add("done");
  try {
    await api(`/api/todoist/tasks/${encodeURIComponent(id)}/close`, { method: "POST" });
    toast(`Milestone done: “${plain(x ? x.content : "").slice(0, 50)}” 🎉`, {
      label: "Undo",
      run: async () => { await api(`/api/todoist/tasks/${encodeURIComponent(id)}/reopen`, { method: "POST" }); loadAreas({ force: true }); },
    });
  } catch (e) { toast(`Couldn't complete it: ${e.message}`); }
  loadAreas({ force: true });
}

$("#areas-grid").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  e.preventDefault();
  if (btn.dataset.act === "today") doToday(btn.dataset.id);
  if (btn.dataset.act === "complete") completeMilestone(btn.dataset.id, btn.closest(".ms"));
});

$("#areas-grid").addEventListener("focusin", (e) => {
  const f = e.target.closest("form.ms-new");
  if (f) f.classList.add("open");
});
$("#areas-grid").addEventListener("focusout", (e) => {
  const f = e.target.closest("form.ms-new");
  if (f) setTimeout(() => { if (!f.contains(document.activeElement) && !f.querySelector("input[type=text]").value) f.classList.remove("open"); }, 100);
});

$("#areas-grid").addEventListener("submit", async (e) => {
  const f = e.target.closest("form.inline-add");
  if (!f) return;
  e.preventDefault();
  const input = f.querySelector("input[type=text]");
  const text = input.value.trim();
  if (!text) return;
  const dateInput = f.querySelector("input[type=date]");
  const target = dateInput ? dateInput.value : "";
  // Clear first, so the re-render that follows doesn't keep the text as an unsent draft.
  input.value = "";
  if (dateInput) dateInput.value = "";
  f.classList.remove("open");
  try {
    if (f.dataset.act === "add-step") await addStep(f.dataset.id, text);
    if (f.dataset.act === "add-milestone") await addMilestone(f.dataset.area, text, target);
    toast(f.dataset.act === "add-step" ? "Step added" : "Milestone added");
  } catch (err) {
    toast(`Couldn't save: ${err.message}`);
    // Put the text back (the form may have been redrawn in the meantime).
    const key = `form.inline-add[data-act="${f.dataset.act}"][data-${f.dataset.id ? "id" : "area"}="${f.dataset.id || f.dataset.area}"]`;
    const again = document.querySelector(key) || f;
    again.querySelector("input[type=text]").value = text;
  }
});

// ---------- area editor ----------
function editorRowHTML(a) {
  const projects = [...state.projects.values()].filter((p) => !(p.inbox_project || p.is_inbox_project) && !p.is_archived);
  const owner = new Map();
  for (const other of areasState.editing) for (const pid of other.projects) owner.set(pid, other);
  return `
    <fieldset class="area-edit" data-id="${esc(a.id)}" style="--c:${colorOf(a.color)}">
      <div class="area-edit-top">
        <span class="area-dot"></span>
        <input class="area-name" value="${esc(a.name)}" aria-label="Area name" />
        <select class="area-color" aria-label="Color">${AREA_COLORS.map((c) => `<option value="${c}" ${c === a.color ? "selected" : ""}>${c.replace("_", " ")}</option>`).join("")}</select>
        <button type="button" class="ghost-btn danger" data-remove="${esc(a.id)}">Remove</button>
      </div>
      <div class="proj-picks">${projects.map((p) => {
        const o = owner.get(p.id);
        const mine = o && o.id === a.id;
        return `<label class="proj-pick ${mine ? "on" : ""} ${o && !mine ? "taken" : ""}" title="${o && !mine ? `Currently in ${esc(o.name)}; picking it here moves it` : ""}">
          <input type="checkbox" value="${esc(p.id)}" ${mine ? "checked" : ""} />
          <i style="background:${COLORS[p.color] || "#b8b8b8"}"></i>${esc(p.name)}${o && !mine ? ` <small>(${esc(o.name)})</small>` : ""}</label>`;
      }).join("")}</div>
    </fieldset>`;
}

function renderEditor() {
  $("#areas-editor").innerHTML = areasState.editing.map(editorRowHTML).join("") ||
    `<p class="dialog-sub">No areas. Add one below.</p>`;
}

function readEditor() {
  // Pull names/colors back from the form before re-rendering.
  document.querySelectorAll(".area-edit").forEach((fs) => {
    const a = areasState.editing.find((x) => x.id === fs.dataset.id);
    if (!a) return;
    a.name = fs.querySelector(".area-name").value.trim() || "Untitled";
    a.color = fs.querySelector(".area-color").value;
  });
}

$("#edit-areas-btn").addEventListener("click", async () => {
  await ensureConfig();
  areasState.editing = JSON.parse(JSON.stringify(areasState.config.areas));
  renderEditor();
  $("#areas-dialog").showModal();
});

$("#areas-editor").addEventListener("change", (e) => {
  readEditor();
  // Typing a name needs no redraw (and redrawing would swallow the click that ended the edit).
  if (e.target.classList.contains("area-name")) return;
  const fs = e.target.closest(".area-edit");
  if (e.target.type === "checkbox") {
    const pid = e.target.value;
    for (const a of areasState.editing) a.projects = a.projects.filter((x) => x !== pid);
    if (e.target.checked) areasState.editing.find((a) => a.id === fs.dataset.id).projects.push(pid);
  }
  renderEditor();
});
$("#areas-editor").addEventListener("click", (e) => {
  const rm = e.target.closest("[data-remove]");
  if (!rm) return;
  readEditor();
  areasState.editing = areasState.editing.filter((a) => a.id !== rm.dataset.remove);
  renderEditor();
});
$("#add-area-btn").addEventListener("click", () => {
  readEditor();
  const used = new Set(areasState.editing.map((a) => a.color));
  areasState.editing.push({ id: newId(), name: "New area", color: AREA_COLORS.find((c) => !used.has(c)) || "charcoal", projects: [] });
  renderEditor();
  const inputs = document.querySelectorAll(".area-name");
  const last = inputs[inputs.length - 1];
  last.focus(); last.select();
});
$("#areas-form").addEventListener("submit", async (e) => {
  if (e.submitter && e.submitter.value !== "save") return;
  readEditor();
  try {
    await saveConfig({ ...areasState.config, areas: areasState.editing });
    toast("Areas saved");
    renderAreas();
  } catch (err) { e.preventDefault(); toast(`Couldn't save: ${err.message}`); }
});

// ---------- switching views ----------
function setView(view) {
  areasState.view = view;
  document.querySelectorAll(".view-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $(".layout").hidden = view !== "plan";
  $("#areas-view").hidden = view !== "areas";
  $("#summary").hidden = view !== "plan";
  if (view === "areas") loadAreas();
  else render();
}
document.querySelectorAll(".view-btn").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
window.addEventListener("focus", () => { if (areasState.view === "areas" && !$("#app").hidden) loadAreas(); });
