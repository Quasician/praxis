// Auto-planner: fills free time hardest work first.
//   1. Free time = planning window − work hours (work days) − existing blocks and events, with gaps.
//   2. Candidates = today's/overdue tasks without a time + the next step of the nearest milestones.
//   3. Rank by willpower (@deep > unlabelled > @light) + a boost for tasks that slipped before,
//      then priority and overdue age; the hardest work gets the earliest slots.
import { ceilTo, minOfDay, parseDue, sameDay, startOfToday, toMin } from "../lib/dates";
import { blockMinutes, isMilestone, willpower } from "../lib/tasks";
import type { CalEvent, Config, PlannerSettings, Task } from "../lib/types";
import { layoutBlocks, visibleEvents } from "./layout";

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
export interface PlanItem extends Candidate { start: number; dur: number }
export interface Plan { items: PlanItem[]; unplaced: Candidate[]; freeMin: number }

export interface PlanInput {
  cfg: PlannerSettings;
  today: Task[];              // today | overdue
  events: CalEvent[];
  active: Task[];             // all open tasks (for milestones)
  tray: Set<string>;          // tasks that need a decision first
  slips: (id: string) => number;
  seed?: number;              // non-zero = reshuffle within willpower levels
}

export function candidates({ cfg, today, active, tray }: PlanInput): Candidate[] {
  const now = new Date(), t0 = startOfToday();
  const list: Candidate[] = [];
  for (const t of today) {
    const d = parseDue(t.due);
    if (!d || tray.has(t.id)) continue;
    if (d.hasTime && sameDay(d.d, now)) continue; // already has a slot
    list.push({ task: t, source: "today", overdueDays: d.d < t0 ? Math.round((+t0 - +d.d) / 864e5) : 0 });
  }
  if (cfg.milestoneSteps > 0) {
    const milestones = active.filter(isMilestone).map((m) => ({
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

export function buildPlan(input: PlanInput): Plan {
  const { cfg, slips } = input;
  const cands = candidates(input);
  const rand = rng(input.seed || 0);
  const jitter = new Map(cands.map((c) => [c.task.id, input.seed ? rand() : 0]));
  // Tasks that slipped before rank higher so they stop sinking.
  const rank = (c: Candidate) => willpower(c.task, cfg) + Math.min(1.5, 0.5 * slips(c.task.id)) + (c.overdueDays > 0 ? 0.25 : 0);
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
  const budget = Math.floor(freeMin * (1 - cfg.keepFree / 100));
  let used = 0;
  const items: PlanItem[] = [], unplaced: Candidate[] = [];
  for (const c of cands) {
    const dur = blockMinutes(c.task);
    const slot = used + dur <= budget ? free.findIndex(([a, z]) => z - a >= dur) : -1;
    if (slot === -1) { unplaced.push(c); continue; }
    const [a, z] = free[slot];
    items.push({ ...c, start: a, dur });
    used += dur;
    const rest: [number, number][] = z - (a + dur + cfg.gap) >= 15 ? [[ceilTo(a + dur + cfg.gap, 5), z]] : [];
    free.splice(slot, 1, ...rest);
  }
  items.sort((x, y) => x.start - y.start);
  return { items, unplaced, freeMin };
}
