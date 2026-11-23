// Completion tracking: what the plan held each day vs. what got done, and what Praxis learns from it.
import { addDays, startOfToday, ymd } from "../lib/dates";
import { blockMinutes, willpower } from "../lib/tasks";
import type { Area, Config, DayRecord, PlannedItem, PlannerSettings, Sample, Task } from "../lib/types";

export const HISTORY_KEEP = 70;   // days of plan history kept in settings
export const SAMPLES_KEEP = 200;

const doneKey = (id: string, day: string) => `${id}@${day}`;
/** "taskId@ymd" for every completion (repeating tasks complete under the same id each time). */
export const completionSet = (completed: Task[]) => new Set(completed.filter((t) => t.completed_at).map((t) => doneKey(t.id, ymd(new Date(t.completed_at!)))));

/** Add today's plan to the history (merging with an earlier plan the same day), trimming old days. */
export function recordPlan(history: Record<string, DayRecord> = {}, day: string, items: PlannedItem[], committed = false): Record<string, DayRecord> {
  const prev = history[day]?.planned || [];
  const byId = new Map(prev.map((p) => [p.id, p]));
  for (const it of items) byId.set(it.id, { ...byId.get(it.id), ...it });
  const next = { ...history, [day]: { ...history[day], planned: [...byId.values()], ...(committed ? { committedAt: new Date().toISOString() } : {}) } };
  const cutoff = ymd(addDays(startOfToday(), -HISTORY_KEEP));
  for (const k of Object.keys(next)) if (k < cutoff) delete next[k];
  return next;
}

export interface DayStat { day: string; planned: number; plannedDone: number; committed: number; committedDone: number; extra: number }

export function dayStats(config: Config | undefined, completed: Task[], days = 28): DayStat[] {
  const history = config?.history || {};
  const done = completionSet(completed);
  const out: DayStat[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = ymd(addDays(startOfToday(), -i));
    const planned = history[day]?.planned || [];
    const ids = new Set(planned.map((p) => p.id));
    const tiny = new Set(history[day]?.tinyDone || []);
    const isDone = (p: PlannedItem) => done.has(doneKey(p.id, day)) || tiny.has(p.id);
    out.push({
      day,
      planned: planned.length,
      plannedDone: planned.filter(isDone).length,
      committed: planned.filter((p) => p.committed).length,
      committedDone: planned.filter((p) => p.committed && isDone(p)).length,
      extra: completed.filter((t) => t.completed_at && ymd(new Date(t.completed_at)) === day && !ids.has(t.id)).length,
    });
  }
  return out;
}

export const rate = (done: number, of: number) => (of ? done / of : null);

/** Completion rate of planned tasks by effort level over the last `days`. */
export function rateByWillpower(config: Config | undefined, completed: Task[], days = 28) {
  const done = completionSet(completed);
  const acc: Record<number, [number, number]> = { 1: [0, 0], 2: [0, 0], 3: [0, 0] };
  for (let i = 0; i < days; i++) {
    const day = ymd(addDays(startOfToday(), -i));
    for (const p of config?.history?.[day]?.planned || []) {
      acc[p.wp][1]++;
      if (done.has(doneKey(p.id, day))) acc[p.wp][0]++;
    }
  }
  return acc;
}

/** Planned vs done per area over the last `days`. */
export function rateByArea(config: Config | undefined, completed: Task[], areas: Area[], days = 28) {
  const done = completionSet(completed);
  const areaOf = new Map<string, string>();
  for (const a of areas) for (const p of a.projects) areaOf.set(p, a.id);
  const acc = new Map<string, [number, number]>(areas.map((a) => [a.id, [0, 0]]));
  for (let i = 0; i < days; i++) {
    const day = ymd(addDays(startOfToday(), -i));
    for (const p of config?.history?.[day]?.planned || []) {
      const a = areaOf.get(p.project);
      if (!a) continue;
      acc.get(a)![1]++;
      if (done.has(doneKey(p.id, day))) acc.get(a)![0]++;
    }
  }
  return acc;
}

/** Committed-task completion over the last 7 days that had a plan (null if fewer than 3 such days). */
export function recentCommitRate(config: Config | undefined, completed: Task[]) {
  const stats = dayStats(config, completed, 8).slice(0, 7).filter((d) => d.committed > 0); // yesterday and the 6 days before
  if (stats.length < 3) return null;
  return stats.reduce((s, d) => s + d.committedDone, 0) / stats.reduce((s, d) => s + d.committed, 0);
}

/** How full to make today's plan: start from your setting, nudge by how the last week went. */
export function effectiveFill(cfg: PlannerSettings, config: Config | undefined, completed: Task[]) {
  if (!cfg.adaptive) return { fill: cfg.fill, why: "" };
  const r = recentCommitRate(config, completed);
  if (r === null) return { fill: cfg.fill, why: "" };
  if (r >= 0.8) return { fill: Math.min(85, cfg.fill + 10), why: `you finished ${Math.round(r * 100)}% of your commitments this week, so the plan is a bit fuller` };
  if (r < 0.5) return { fill: Math.max(45, cfg.fill - 10), why: `you finished ${Math.round(r * 100)}% of your commitments this week, so the plan is a bit lighter` };
  return { fill: cfg.fill, why: "" };
}

/**
 * "Never miss twice": a day counts if you did at least one committed thing (a tiny version counts) or closed the day.
 * One missed day doesn't break the streak; two in a row does. Today only counts once it's earned.
 */
export function habitStreak(config: Config | undefined, completed: Task[]) {
  const h = config?.history || {};
  const done = completionSet(completed);
  const counts = (day: string) => {
    const r = h[day];
    if (!r) return false;
    if (r.shutdown || (r.tinyDone || []).length) return true;
    return r.planned.some((p) => p.committed && done.has(doneKey(p.id, day)));
  };
  const today = ymd(startOfToday());
  let n = 0, misses = 0, d = startOfToday();
  if (!counts(today)) d = addDays(d, -1);
  for (let i = 0; i < 400; i++, d = addDays(d, -1)) {
    const key = ymd(d);
    if (!h[key] && !Object.keys(h).some((k) => k < key)) break; // before Praxis kept history
    if (counts(key)) { n++; misses = 0; }
    else if (++misses >= 2) break;
  }
  const todayDone = counts(today);
  const yesterdayMissed = !counts(ymd(addDays(startOfToday(), -1)));
  return { days: n, todayDone, atRisk: n > 0 && !todayDone && yesterdayMissed };
}

/** Days in a row (ending today or yesterday) that were closed with the shutdown, or committed in the morning. */
export function streak(config: Config | undefined, key: "shutdown" | "committedAt") {
  const h = config?.history || {};
  let n = 0;
  let d = startOfToday();
  if (!h[ymd(d)]?.[key]) d = addDays(d, -1);
  while (h[ymd(d)]?.[key]) { n++; d = addDays(d, -1); }
  return n;
}

// ---------- learning ----------
export interface Learned {
  factor: Record<number, number>;   // actual / estimated minutes per effort level (1 = as planned)
  samples: number;
  deepHour: number | null;          // start of your best 2-hour window for Deep work (minutes of day)
  deepEvents: number;
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 1; };

export function learn(cfg: PlannerSettings, samples: Sample[] = [], completed: Task[] = []): Learned {
  const factor: Record<number, number> = { 1: 1, 2: 1, 3: 1 };
  for (const wp of [1, 2, 3]) {
    const xs = samples.filter((s) => s.wp === wp && s.est > 0).map((s) => s.actual / s.est);
    if (xs.length >= 5) factor[wp] = Math.min(1.5, Math.max(0.75, Math.round(median(xs) * 20) / 20));
  }
  // When do Deep tasks actually get finished? Look at the last four weeks.
  const since = addDays(startOfToday(), -28);
  const hours = new Array(24).fill(0);
  let deepEvents = 0;
  for (const t of completed) {
    if (!t.completed_at || willpower(t, cfg) !== 3) continue;
    const at = new Date(t.completed_at);
    if (at < since) continue;
    hours[at.getHours()]++; deepEvents++;
  }
  let deepHour: number | null = null;
  if (deepEvents >= 5) {
    // Completion time ≈ end of the work, so the best window starts an hour or two before the peak.
    let best = -1, bestH = 0;
    for (let h = 0; h < 23; h++) { const v = hours[h] + hours[h + 1]; if (v > best) { best = v; bestH = h; } }
    deepHour = Math.max(0, bestH - 1) * 60;
  }
  return { factor, samples: samples.length, deepHour, deepEvents };
}

/** Planned minutes for a task, scaled by how long that kind of task really takes you. */
export const learnedMinutes = (t: Task, cfg: PlannerSettings, l?: Learned | null) =>
  !l ? blockMinutes(t) : Math.max(10, Math.round((blockMinutes(t) * (l.factor[willpower(t, cfg)] || 1)) / 5) * 5);

/** How good your time guesses are getting: typical miss and which way you lean, from recent guessed sessions. */
export function timeSense(samples: Sample[] | undefined, keep = 12) {
  const g = (samples || []).filter((s) => s.guess && s.actual >= 3).slice(-keep);
  if (!g.length) return null;
  const med = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  const err = g.map((s) => Math.abs(s.actual - s.guess!) / s.guess!);
  const lean = med(g.map((s) => (s.actual - s.guess!) / s.guess!));
  const half = Math.floor(err.length / 2);
  const improving = err.length >= 6 ? med(err.slice(half)) < med(err.slice(0, half)) - 0.05 : null;
  return { n: g.length, miss: med(err), lean, improving };
}
