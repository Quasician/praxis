// Praxis — Auto-planner.
// Fills today's free time for you, hardest work first:
//   1. Free time = your planning window, minus work hours (weekdays), minus blocks
//      already on the timeline, with small gaps around everything.
//   2. Candidates = today's and overdue tasks without a time, plus the next step
//      of your nearest milestones.
//   3. Ranked by willpower (@deep > unlabelled > @light), then priority, then how
//      overdue, and placed into the earliest slot that fits — so the hardest work
//      lands when your willpower is freshest. Part of the day is kept free.
//   4. Shown as a proposal: Accept saves it all to Todoist in one request.

const PLANNER_DEFAULTS = {
  auto: true,               // propose a plan the first time you open Praxis each day
  dayStart: "07:00",
  dayEnd: "21:30",
  workDays: [1, 2, 3, 4, 5], // 0 = Sunday
  workStart: "07:00",
  workEnd: "15:00",
  afterWork: 30,            // minutes to decompress after work before planning anything
  gap: 10,                  // minutes between blocks
  keepFree: 20,             // % of free time left unplanned
  milestoneSteps: 2,        // how many milestone next-steps to pull in per day
  deepLabel: "deep",
  lightLabel: "light",
  lastAuto: null,
};

const plannerState = { items: [], unplaced: [], active: false, seed: 0 };

// ---------- small helpers ----------
const toMin = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + (m || 0); };
const ceilTo = (m, step) => Math.ceil(m / step) * step;
const plannerCfg = () => ({ ...PLANNER_DEFAULTS, ...((areasState.config && areasState.config.planner) || {}) });
function willpower(t, cfg = plannerCfg()) {
  if (hasLabel(t, cfg.deepLabel.toLowerCase())) return 3;
  if (hasLabel(t, cfg.lightLabel.toLowerCase())) return 1;
  return 2;
}
const WP_NAME = { 3: "Deep", 2: "", 1: "Light" };

// Seeded shuffle so "Reshuffle" gives a different but stable order.
function rng(seed) { let s = seed || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

// ---------- free time ----------
function workBand(cfg, day = new Date()) {
  if (!cfg.workDays.includes(day.getDay())) return null;
  return [toMin(cfg.workStart), toMin(cfg.workEnd)];
}

function freeIntervals(cfg) {
  const now = new Date();
  let start = Math.max(toMin(cfg.dayStart), ceilTo(minOfDay(now) + 5, 15));
  const end = toMin(cfg.dayEnd);
  const busy = [];
  const work = workBand(cfg);
  if (work) busy.push([work[0], work[1] + cfg.afterWork]);
  const todays = splitToday(state.today).today;
  // Existing task blocks and calendar events (except ones marked "free") are busy time.
  for (const b of layoutBlocks(todays, visibleEvents(todays).filter((e) => !e.transparent))) busy.push([b.start - cfg.gap, b.end + cfg.gap]);
  let free = start < end ? [[start, end]] : [];
  for (const [bs, be] of busy) {
    free = free.flatMap(([fs, fe]) => (be <= fs || bs >= fe) ? [[fs, fe]] : [[fs, bs], [be, fe]]);
  }
  return free.map(([a, z]) => [ceilTo(a, 5), z]).filter(([a, z]) => z - a >= 15);
}

// ---------- candidates ----------
async function plannerCandidates(cfg) {
  const now = new Date(), t0 = startOfToday();
  const list = [];
  const tray = typeof trayIds === "function" ? trayIds() : new Set();
  for (const t of state.today) {
    const d = parseDue(t.due);
    if (!d) continue;
    if (tray.has(t.id)) continue; // needs a decision first (see the tray)
    if (d.hasTime && sameDay(d.d, now)) continue; // already has a slot today
    list.push({ task: t, source: "today", overdueDays: d.d < t0 ? Math.round((t0 - d.d) / 864e5) : 0 });
  }
  if (cfg.milestoneSteps > 0) {
    try {
      if (!areasState.active.length || Date.now() - areasState.loadedAt > 5 * 60000) await loadAreas({ force: true });
    } catch { /* milestones are a bonus; plan without them */ }
    const milestones = areasState.active.filter(isMilestone).map((m) => ({
      m, target: (m.deadline && m.deadline.date) || (m.due && m.due.date) || "9999",
      next: areasState.active.filter((t) => t.parent_id === m.id).sort((a, b) => (a.child_order ?? 0) - (b.child_order ?? 0))[0],
    })).filter((x) => x.next).sort((a, b) => a.target.localeCompare(b.target));
    let added = 0;
    for (const x of milestones) {
      if (added >= cfg.milestoneSteps) break;
      if (list.some((c) => c.task.id === x.next.id) || state.today.some((t) => t.id === x.next.id)) continue;
      if (x.next.due && x.next.due.is_recurring) continue;
      list.push({ task: x.next, source: "milestone", milestone: x.m, overdueDays: 0, target: x.target });
      added++;
    }
  }
  return list;
}

// ---------- building a plan ----------
async function buildPlan({ reshuffle = false } = {}) {
  const cfg = plannerCfg();
  const cands = await plannerCandidates(cfg);
  if (reshuffle) plannerState.seed = (plannerState.seed || 7) * 31 + 17;
  const rand = rng(plannerState.seed);
  const jitter = new Map(cands.map((c) => [c.task.id, reshuffle ? rand() : 0]));
  // Tasks that slipped before rank higher, so they stop sinking: each slip is worth half a
  // willpower level (capped), and being overdue at all adds a little more.
  const rank = (c) => willpower(c.task, cfg) + Math.min(1.5, 0.5 * (typeof slipCount === "function" ? slipCount(c.task.id) : 0)) + (c.overdueDays > 0 ? 0.25 : 0);
  cands.sort((a, b) =>
    rank(b) - rank(a) ||
    willpower(b.task, cfg) - willpower(a.task, cfg) ||
    (reshuffle ? jitter.get(a.task.id) - jitter.get(b.task.id) : 0) ||
    (b.task.priority || 1) - (a.task.priority || 1) ||
    b.overdueDays - a.overdueDays ||
    (a.target || "9999").localeCompare(b.target || "9999") ||
    (a.task.child_order ?? 0) - (b.task.child_order ?? 0));

  let free = freeIntervals(cfg);
  const totalFree = free.reduce((s, [a, z]) => s + (z - a), 0);
  const budget = Math.floor(totalFree * (1 - cfg.keepFree / 100));
  let used = 0;
  const items = [], unplaced = [];
  for (const c of cands) {
    const dur = blockMinutes(c.task);
    const slot = used + dur <= budget ? free.findIndex(([a, z]) => z - a >= dur) : -1;
    if (slot === -1) { unplaced.push(c); continue; }
    const [a, z] = free[slot];
    items.push({ ...c, start: a, dur });
    used += dur;
    const rest = [];
    if (z - (a + dur + cfg.gap) >= 15) rest.push([ceilTo(a + dur + cfg.gap, 5), z]);
    free.splice(slot, 1, ...rest);
  }
  items.sort((x, y) => x.start - y.start);
  Object.assign(plannerState, { items, unplaced, active: items.length > 0 || unplaced.length > 0, freeMin: totalFree });
  return plannerState;
}

async function proposePlan(opts = {}) {
  if (areasState.view !== "plan") setView("plan");
  await ensureConfig();
  await buildPlan(opts);
  if (!plannerState.items.length && !plannerState.unplaced.length) {
    plannerState.active = false;
    toast(freeIntervals(plannerCfg()).length ? "Nothing left to plan today. Everything already has a time." : "No free time left in today's planning window.");
  }
  render();
  if (plannerState.items.length) {
    const tl = $("#timeline");
    tl.scrollTo({ top: Math.max(0, minToY(plannerState.items[0].start) - hourPx()), behavior: "smooth" });
  }
}

function discardPlan() {
  Object.assign(plannerState, { items: [], unplaced: [], active: false });
  render();
}

// Called by the drag code when you move/resize/remove a proposed block.
function plannerMoveItem(idx, target, remove) {
  const it = plannerState.items[idx];
  if (!it) return;
  if (remove) {
    plannerState.items.splice(idx, 1);
    plannerState.unplaced.unshift(it);
  } else if (target) {
    it.start = target.start; it.dur = target.dur;
    plannerState.items.sort((x, y) => x.start - y.start);
  }
}

async function acceptPlan() {
  const items = plannerState.items.slice();
  if (!items.length) return discardPlan();
  const btn = $("#plan-accept");
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  const commands = items.map((it) => {
    const start = new Date(); start.setHours(0, it.start, 0, 0);
    const hasTz = it.task.due && it.task.due.timezone;
    const date = hasTz ? start.toISOString().replace(/\.\d{3}Z$/, "Z") : `${ymd(start)}T${pad2(start.getHours())}:${pad2(start.getMinutes())}:00`;
    const due = dueFor(it.task, date);
    if (hasTz) due.timezone = it.task.due.timezone;
    return { type: "item_update", uuid: crypto.randomUUID(), args: { id: it.task.id, due, duration: { amount: it.dur, unit: "minute" } } };
  });
  try {
    const res = await api("/api/todoist/sync", { method: "POST", body: { commands } });
    const status = (res && res.sync_status) || {};
    const failed = commands.filter((c) => status[c.uuid] !== "ok");
    discardPlan();
    toast(failed.length
      ? `Planned ${commands.length - failed.length} of ${commands.length}. Todoist rejected ${failed.length}.`
      : `Planned ${commands.length} block${commands.length > 1 ? "s" : ""}. Your phone will remind you as each one starts.`);
  } catch (e) {
    toast(`Couldn't save the plan: ${e.message}`);
    if (btn) { btn.disabled = false; btn.textContent = "Accept"; }
    return;
  }
  await loadAll({ quiet: true });
  if (items.some((it) => it.source === "milestone")) loadAreas({ force: true });
}

// ---------- drawing (called from renderTimeline) ----------
function plannerTimelineHTML() {
  const cfg = plannerCfg();
  let html = "";
  // Work hours and wind-down, as quiet background bands.
  const work = workBand(cfg);
  if (work) html += `<div class="tl-band work" style="top:${minToY(work[0])}px;height:${((work[1] - work[0]) / 60) * hourPx()}px"><span>Work</span></div>`;
  const end = toMin(cfg.dayEnd);
  if (end < TL_END * 60) html += `<div class="tl-band off" style="top:${minToY(end)}px;height:${((TL_END * 60 - end) / 60) * hourPx()}px"><span>Wind down</span></div>`;

  if (plannerState.active) {
    html += plannerState.items.map((it, i) => {
      const wp = willpower(it.task, cfg);
      const proj = state.projects.get(it.task.project_id);
      const color = (proj && COLORS[proj.color]) || "var(--accent)";
      const compact = it.dur < 45;
      const badge = it.source === "milestone" ? `<span class="pbadge ms">◆ ${esc(plain(it.milestone.content).slice(0, 28))}</span>` : (WP_NAME[wp] ? `<span class="pbadge wp${wp}">${WP_NAME[wp]}</span>` : "");
      return `
        <div class="tl-block proposed ${compact ? "compact" : ""}" data-idx="${i}" style="top:${minToY(it.start)}px;height:${Math.max((it.dur / 60) * hourPx() - 2, 20)}px;--c:${color}">
          <div class="blk-body">
            <div class="blk-title">${esc(plain(it.task.content))}</div>
            <div class="blk-time">${esc(fmtMin(it.start))} – ${esc(fmtMin(it.start + it.dur))}${compact ? "" : ` · ${esc(fmtSpan(it.dur))}`} ${badge}</div>
          </div>
          <div class="tl-resize" title="Drag to change length"></div>
        </div>`;
    }).join("");
  }
  renderPlanBanner();
  return html;
}

function renderPlanBanner() {
  const el = $("#plan-banner");
  if (!el) return;
  if (!plannerState.active) { el.hidden = true; return; }
  const { items, unplaced } = plannerState;
  const mins = items.reduce((s, it) => s + it.dur, 0);
  const deep = items.filter((it) => willpower(it.task) === 3).length;
  el.hidden = false;
  el.innerHTML = `
    <div class="plan-line">
      <div class="plan-text"><b>Proposed plan</b> · ${items.length} block${items.length === 1 ? "" : "s"} · ${esc(fmtSpan(mins))}${deep ? ` · ${deep} deep-focus first` : " · hardest first"}</div>
      <div class="plan-actions">
        <button id="plan-discard" class="ghost-btn">Discard</button>
        <button id="plan-reshuffle" class="ghost-btn" title="Try a different order within each willpower level">Reshuffle</button>
        <button id="plan-accept" class="primary" ${items.length ? "" : "disabled"}>Accept</button>
      </div>
    </div>
    ${unplaced.length ? `<div class="plan-unplaced">Didn't fit today: ${unplaced.slice(0, 6).map((c) => `<span>${esc(plain(c.task.content))}</span>`).join("")}${unplaced.length > 6 ? ` <span>+${unplaced.length - 6} more</span>` : ""}</div>` : ""}
    <div class="plan-hint">Drag dashed blocks to adjust, or drag one onto the list to leave it out.</div>`;
  $("#plan-accept").onclick = acceptPlan;
  $("#plan-discard").onclick = discardPlan;
  $("#plan-reshuffle").onclick = () => proposePlan({ reshuffle: true });
}

// ---------- automatic daily plan ----------
let autoChecked = false;
document.addEventListener("praxis:synced", async () => {
  if (autoChecked) return;
  autoChecked = true;
  try {
    await ensureConfig();
    const cfg = plannerCfg();
    const today = ymd(new Date());
    if (!cfg.auto || cfg.lastAuto === today) return;
    if (minOfDay(new Date()) > toMin(cfg.dayEnd) - 30) return; // too late to bother
    await buildPlan();
    const cfgNow = areasState.config;
    cfgNow.planner = { ...(cfgNow.planner || {}), lastAuto: today };
    await saveConfig(cfgNow);
    if (plannerState.items.length) {
      render();
      $("#timeline").scrollTo({ top: Math.max(0, minToY(plannerState.items[0].start) - hourPx()), behavior: "smooth" });
      toast("Here's a plan for the rest of today. Accept it, adjust it, or discard it.");
    } else {
      plannerState.active = false;
    }
  } catch (e) { console.warn("Auto-plan skipped:", e); }
});

// ---------- settings dialog ----------
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function fillPlannerForm() {
  const c = plannerCfg();
  const f = $("#planner-form");
  f.auto.checked = c.auto;
  f.dayStart.value = c.dayStart; f.dayEnd.value = c.dayEnd;
  f.workStart.value = c.workStart; f.workEnd.value = c.workEnd;
  f.afterWork.value = c.afterWork; f.gap.value = c.gap; f.keepFree.value = c.keepFree;
  f.milestoneSteps.value = c.milestoneSteps;
  f.deepLabel.value = c.deepLabel; f.lightLabel.value = c.lightLabel;
  $("#work-days").innerHTML = DOW.map((d, i) => `<label class="day-pick ${c.workDays.includes(i) ? "on" : ""}"><input type="checkbox" value="${i}" ${c.workDays.includes(i) ? "checked" : ""}/>${d}</label>`).join("");
}
$("#work-days") && $("#work-days").addEventListener("change", (e) => e.target.closest(".day-pick").classList.toggle("on", e.target.checked));
$("#planner-settings-btn").addEventListener("click", async () => {
  $("#menu").hidden = true;
  await ensureConfig();
  fillPlannerForm();
  $("#planner-dialog").showModal();
});
$("#planner-form").addEventListener("submit", async (e) => {
  if (e.submitter && e.submitter.value !== "save") return;
  const f = e.target;
  const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };
  const next = {
    ...plannerCfg(),
    auto: f.auto.checked,
    dayStart: f.dayStart.value || PLANNER_DEFAULTS.dayStart,
    dayEnd: f.dayEnd.value || PLANNER_DEFAULTS.dayEnd,
    workStart: f.workStart.value || PLANNER_DEFAULTS.workStart,
    workEnd: f.workEnd.value || PLANNER_DEFAULTS.workEnd,
    workDays: [...document.querySelectorAll("#work-days input:checked")].map((i) => Number(i.value)),
    afterWork: num(f.afterWork.value, 0, 180, 30),
    gap: num(f.gap.value, 0, 60, 10),
    keepFree: num(f.keepFree.value, 0, 80, 20),
    milestoneSteps: num(f.milestoneSteps.value, 0, 10, 2),
    deepLabel: (f.deepLabel.value || "deep").replace(/^@/, "").trim(),
    lightLabel: (f.lightLabel.value || "light").replace(/^@/, "").trim(),
  };
  try {
    await saveConfig({ ...areasState.config, planner: next });
    toast("Planner settings saved");
    render();
  } catch (err) { e.preventDefault(); toast(`Couldn't save: ${err.message}`); }
});
$("#plan-btn").addEventListener("click", () => proposePlan());
