// Auto-planner: fills free time hardest work first.
//   1. Free time = planning window − work hours (work days) − existing blocks and events, with gaps.
//   2. Candidates = today's/overdue tasks without a time + the next step of the nearest milestones.
//   3. Rank by willpower (@deep > unlabelled > @light) + a boost for tasks that slipped before,
//      then priority and overdue age; the hardest work gets the earliest slots.
import { ceilTo, minOfDay, parseDue, sameDay, startOfToday, toMin, ymd } from "../lib/dates";
import { isMilestone, willpower } from "../lib/tasks";
import type { CalEvent, Config, Energy, PlannerSettings, Task } from "../lib/types";
import { layoutBlocks, visibleEvents } from "./layout";
import { learnedMinutes, type Learned } from "./progress";

export const PLANNER_DEFAULTS: PlannerSettings = {
  auto: true,
  dayStart: "07:00",
  dayEnd: "21:30",
  workDays: [1, 2, 3, 4, 5],
  workStart: "07:00",
  workEnd: "15:00",
  afterWork: 30,
  gap: 10,
  keepFree: 20,
  milestoneSteps: 2,
  deepLabel: "deep",
  lightLabel: "light",
  lastAuto: null,
  weeklyAuto: true,
  weeklyDay: 5,
  lastWeekPlan: null,
  lastWeekPrompt: null,
  shutdownAt: "21:00",
  lastShutdown: null,
  fill: 60,
  adaptive: true,
  commitCount: 3,
  morningCommit: true,
  learn: true,
};
export const plannerCfg = (config?: Config | null): PlannerSettings => ({ ...PLANNER_DEFAULTS, ...((config && config.planner) || {}) });

export function workBand(cfg: PlannerSettings, day = new Date()): [number, number] | null {
  return cfg.workDays.includes(day.getDay()) ? [toMin(cfg.workStart), toMin(cfg.workEnd)] : null;
}

/** Free intervals (minutes of day) between `from` and the day's end, avoiding `busy` (already padded). */
export function subtractBusy(from: number, to: number, busy: [number, number][]): [number, number][] {
  let free: [number, number][] = from < to ? [[from, to]] : [];
  for (const [bs, be] of busy) {
    free = free.flatMap(([fs, fe]): [number, number][] => (be <= fs || bs >= fe) ? [[fs, fe]] : [[fs, bs], [be, fe]]);
  }
  return free.map(([a, z]): [number, number] => [ceilTo(a, 5), z]).filter(([a, z]) => z - a >= 15);
}

/** Today's free time for planning. */
export function freeIntervals(cfg: PlannerSettings, todayTasks: Task[], events: CalEvent[]) {
  const start = Math.max(toMin(cfg.dayStart), ceilTo(minOfDay(new Date()) + 5, 15));
  const busy: [number, number][] = [];
  const work = workBand(cfg);
  if (work) busy.push([work[0], work[1] + cfg.afterWork]);
  for (const b of layoutBlocks(todayTasks, visibleEvents(events, todayTasks).filter((e) => !e.transparent))) {
    busy.push([b.start - cfg.gap, b.end + cfg.gap]);
  }
  return subtractBusy(start, toMin(cfg.dayEnd), busy);
}

export interface Candidate { task: Task; source: "today" | "milestone"; overdueDays: number; milestone?: Task; target?: string }
/** late (4.0): it only fitted in the hours where your blocks rarely get done. */
export interface PlanItem extends Candidate { start: number; dur: number; committed?: boolean; star?: boolean; tiny?: string; late?: boolean }
/** weakAll (4.0): all of today's free time is in your weak hours, so nothing could be moved out of them. */
export interface Plan { items: PlanItem[]; unplaced: Candidate[]; freeMin: number; weakAll?: boolean }

export interface PlanInput {
  cfg: PlannerSettings;
  today: Task[];              // today | overdue
  events: CalEvent[];
  active: Task[];             // all open tasks (for milestones)
  tray: Set<string>;          // tasks that need a decision first
  slips: (id: string) => number;
  seed?: number;              // non-zero = reshuffle within willpower levels
  fill?: number;              // % of free time to fill (defaults to cfg.fill)
  learned?: Learned | null;   // best Deep hours + real durations
  energy?: Energy;            // low: light work + tiny versions; slammed: one tiny thing
  tiny?: Record<string, string>;
  // 4.0, from the record (domain/record.ts); all three are skipped when "learn" is off.
  capacityMin?: number | null; // what you usually finish on a day like today: commitments stop there, the rest is bonus
  weakFrom?: number | null;    // minutes of the day after which your blocks rarely get done: work goes before it when it can
  resting?: Set<string>;       // projects set down in a weekly review: their steps aren't pulled into the plan
}

export function candidates({ cfg, today, active, tray, resting }: PlanInput): Candidate[] {
  const now = new Date(), t0 = startOfToday();
  const list: Candidate[] = [];
  for (const t of today) {
    const d = parseDue(t.due);
    if (!d || tray.has(t.id)) continue;
    if (d.hasTime && sameDay(d.d, now)) continue; // already has a slot
    list.push({ task: t, source: "today", overdueDays: d.d < t0 ? Math.round((+t0 - +d.d) / 864e5) : 0 });
  }
  if (cfg.milestoneSteps > 0) {
    const milestones = active.filter((m) => isMilestone(m) && !resting?.has(m.id)).map((m) => ({
      m,
      target: (m.deadline && m.deadline.date) || (m.due && m.due.date) || "9999",
      next: active.filter((t) => t.parent_id === m.id).sort((a, b) => (a.child_order ?? 0) - (b.child_order ?? 0))[0],
    })).filter((x) => x.next).sort((a, b) => a.target.localeCompare(b.target));
    let added = 0;
    for (const x of milestones) {
      if (added >= cfg.milestoneSteps) break;
      if (list.some((c) => c.task.id === x.next.id) || today.some((t) => t.id === x.next.id)) continue;
      if (x.next.due && x.next.due.is_recurring) continue;
      list.push({ task: x.next, source: "milestone", milestone: x.m, overdueDays: 0, target: x.target });
      added++;
    }
  }
  return list;
}

function rng(seed: number) { let s = seed || 1; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

export const TINY_MIN = 10;

export function buildPlan(input: PlanInput): Plan {
  const { slips } = input;
  const energy = input.energy || "full";
  // Low energy: two commitments, Deep work only as its tiny version. Slammed: one tiny thing, nothing else.
  const cfg = energy === "full" ? input.cfg : { ...input.cfg, commitCount: energy === "low" ? Math.min(2, input.cfg.commitCount) : 1 };
  const tinyOf = (t: Task) => input.tiny?.[t.id] || "";
  let cands = candidates(input);
  if (energy !== "full") cands = cands.filter((c) => willpower(c.task, cfg) < 3 || tinyOf(c.task));
  const rand = rng(input.seed || 0);
  const jitter = new Map(cands.map((c) => [c.task.id, input.seed ? rand() : 0]));
  // Tasks that slipped before rank higher so they stop sinking.
  const rank = (c: Candidate) => energy === "slammed"
    ? (tinyOf(c.task) ? 2 : 0) + (c.task.priority || 1) * 0.3 + (c.overdueDays > 0 ? 0.25 : 0)   // the easiest meaningful thing
    : willpower(c.task, cfg) + Math.min(1.5, 0.5 * slips(c.task.id)) + (c.overdueDays > 0 ? 0.25 : 0);
  cands.sort((a, b) =>
    rank(b) - rank(a) ||
    willpower(b.task, cfg) - willpower(a.task, cfg) ||
    jitter.get(a.task.id)! - jitter.get(b.task.id)! ||
    (b.task.priority || 1) - (a.task.priority || 1) ||
    b.overdueDays - a.overdueDays ||
    (a.target || "9999").localeCompare(b.target || "9999") ||
    (a.task.child_order ?? 0) - (b.task.child_order ?? 0));

  const free = freeIntervals(cfg, input.today, input.events);
  const freeMin = free.reduce((s, [a, z]) => s + (z - a), 0);
  const budget = Math.floor(freeMin * ((input.fill ?? cfg.fill) / 100));
  const learned = cfg.learn ? input.learned : null;
  let weakFrom = cfg.learn && energy === "full" && input.weakFrom != null ? input.weakFrom : null;
  // With no free time before the weak hours there is nothing to choose between: say so once instead of marking every block.
  const weakAll = weakFrom !== null && free.length > 0 && free.every(([a]) => a >= weakFrom!);
  if (weakAll) weakFrom = null;
  const capacity = cfg.learn && energy === "full" && input.capacityMin != null ? input.capacityMin : null;
  let used = 0, committedMin = 0;
  const items: PlanItem[] = [], unplaced: Candidate[] = [];
  let committed = 0, deepCommitted = 0;
  for (const c of cands) {
    if (energy === "slammed" && items.length >= 1) { unplaced.push(c); continue; }
    const tiny = energy !== "full" && tinyOf(c.task) ? tinyOf(c.task) : "";
    const dur = tiny ? TINY_MIN : energy === "slammed" ? Math.min(15, learnedMinutes(c.task, cfg, learned)) : learnedMinutes(c.task, cfg, learned);
    if (used + dur > budget) { unplaced.push(c); continue; }
    const deep = willpower(c.task, cfg) === 3;
    // Deep work goes as close as possible to the hours you actually finish Deep work; the rest takes the earliest slot.
    const pref = deep && learned?.deepHour != null ? learned.deepHour : null;
    let slot = -1, start = 0;
    if (pref === null) {
      // The earliest slot that starts before your weak hours, if there is one; otherwise the earliest slot.
      if (weakFrom !== null) slot = free.findIndex(([a, z]) => a < weakFrom && z - a >= dur);
      if (slot === -1) slot = free.findIndex(([a, z]) => z - a >= dur);
      if (slot !== -1) start = free[slot][0];
    } else {
      let bestDist = Infinity;
      free.forEach(([a, z], i) => {
        if (z - a < dur) return;
        const s0 = Math.min(ceilTo(Math.min(Math.max(pref, a), z - dur), 5), z - dur);
        const dist = Math.abs(s0 - pref);
        if (dist < bestDist) { bestDist = dist; slot = i; start = s0; }
      });
    }
    if (slot === -1) { unplaced.push(c); continue; }
    const [a, z] = free[slot];
    // The first few you place are your commitments (at most one Deep); the rest are bonus.
    // 4.0: a commitment has to fit in what you usually finish, and not sit in your weak hours (the first one always counts).
    const late = weakFrom !== null && start >= weakFrom;
    const fits = committed === 0 || ((capacity === null || committedMin + dur <= capacity) && !late);
    const commit = committed < cfg.commitCount && (!deep || deepCommitted === 0) && fits;
    if (commit) { committed++; committedMin += dur; if (deep) deepCommitted++; }
    items.push({ ...c, start, dur, committed: commit, ...(tiny ? { tiny } : {}), ...(late ? { late } : {}) });
    used += dur;
    const pieces: [number, number][] = [];
    if (start - cfg.gap - a >= 15) pieces.push([a, start - cfg.gap]);
    if (z - (start + dur + cfg.gap) >= 15) pieces.push([ceilTo(start + dur + cfg.gap, 5), z]);
    free.splice(slot, 1, ...pieces);
  }
  items.sort((x, y) => x.start - y.start);
  return { items, unplaced, freeMin, ...(weakAll ? { weakAll } : {}) };
}

/**
 * 4.6: which planned blocks still make sense to save, given a fresh look at their tasks (null: couldn't look, keep them all).
 * Out: a task that's gone (finished or deleted), and one whose date changed to after today since the plan was drafted (a
 * repeating task ticked off elsewhere has moved to its next date; saving would pull that one back). The kept blocks carry the
 * fresh task, so the time is written onto what Todoist holds now.
 */
export function stillToPlan<T extends { task: Task }>(items: T[], fresh: Task[] | null, now: Date): { kept: T[]; dropped: T[] } {
  if (!fresh) return { kept: items, dropped: [] };
  const byId = new Map(fresh.filter((t) => !t.checked && !t.is_deleted).map((t) => [t.id, t]));
  const today = ymd(now), kept: T[] = [], dropped: T[] = [];
  for (const it of items) {
    const t = byId.get(it.task.id);
    const was = it.task.due?.date, d = t ? parseDue(t.due) : null;
    if (!t || (d && t.due?.date !== was && ymd(d.d) > today)) dropped.push(it);
    else kept.push({ ...it, task: t });
  }
  return { kept, dropped };
}
