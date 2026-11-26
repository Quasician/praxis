// 4.0 The record: what you planned against what happened, in hours and by time of day, and what it says.
// Pure functions over the plan history (config.history) and Todoist's completed tasks. Nothing here changes anything;
// the planner (domain/planner.ts) and the weekly review (domain/review.ts) read it.
import { addDays, fmtSpan, startOfToday, ymd } from "../lib/dates";
import { DEFAULT_BLOCK } from "../lib/tasks";
import type { Config, PlannedItem, PlannerSettings, Task } from "../lib/types";
import { actualMinutes } from "./actuals";

const key = (id: string, day: string) => `${id}@${day}`;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const minutesOfTask = (t?: Task) => { const d = t?.duration; if (!d) return null; const m = d.unit === "day" ? d.amount * 1440 : d.amount; return m > 0 && m < 1440 ? m : null; };

export interface RecordDay { day: string; weekday: number; planned: number; done: number; plannedMin: number; doneMin: number; committed: number; committedDone: number }

/**
 * One line per day that had a plan, oldest first. A block's length is what the plan recorded; for plans made before 4.0
 * (no length recorded) it is the task's duration in Todoist, else the default block. 4.6: when you said how long a block
 * really took (the check-in when it ends), the hours done use that, and a block you partly did counts the minutes you put in.
 */
export function recordDays(config: Config | undefined, completed: Task[], active: Task[] = [], days = 56, includeToday = false): RecordDay[] {
  const history = config?.history || {};
  const done = new Set<string>(), byId = new Map<string, Task>();
  for (const t of active) byId.set(t.id, t);
  for (const t of completed) { if (t.completed_at) done.add(key(t.id, ymd(new Date(t.completed_at)))); if (!byId.has(t.id)) byId.set(t.id, t); }
  const out: RecordDay[] = [];
  for (let i = days; i >= (includeToday ? 0 : 1); i--) {
    const d = addDays(startOfToday(), -i), day = ymd(d);
    const rec = history[day];
    if (!rec?.planned?.length) continue;
    const tiny = new Set(rec.tinyDone || []);
    const r: RecordDay = { day, weekday: d.getDay(), planned: 0, done: 0, plannedMin: 0, doneMin: 0, committed: 0, committedDone: 0 };
    for (const p of rec.planned) {
      const min = p.min ?? minutesOfTask(byId.get(p.id)) ?? DEFAULT_BLOCK;
      const ok = done.has(key(p.id, day)) || tiny.has(p.id), real = actualMinutes(rec, p.id);
      r.planned++; r.plannedMin += min;
      if (ok) { r.done++; r.doneMin += real ?? min; }
      else if (real != null) r.doneMin += Math.min(real, min);   // partly done: the time you put in
      if (p.committed) { r.committed++; if (ok) r.committedDone++; }
    }
    out.push(r);
  }
  return out;
}

export const CAPACITY_DAYS = 5;   // planned days needed before Praxis says what you usually finish

/** What you usually finish on a day like `forDay` (a work day or a day off): the median of the planned minutes that got done. */
export function capacity(days: RecordDay[], cfg: Pick<PlannerSettings, "workDays">, forDay = new Date()): { min: number; days: number; kind: "work" | "off" | "any" } | null {
  const isWork = cfg.workDays.includes(forDay.getDay());
  const same = days.filter((d) => cfg.workDays.includes(d.weekday) === isWork).slice(-20);
  const pool = same.length >= CAPACITY_DAYS ? same : days.slice(-20);
  if (pool.length < CAPACITY_DAYS) return null;
  // Never below 45 minutes: a run of bad days shouldn't shrink the plan to nothing.
  return { min: Math.max(45, Math.round(median(pool.map((d) => d.doneMin)) / 5) * 5), days: pool.length, kind: same.length >= CAPACITY_DAYS ? (isWork ? "work" : "off") : "any" };
}

export interface Band { from: number; planned: number; done: number }
/** Planned blocks by the hour they were due to start (two-hour bands), with how many got done. Only plans made since 4.0 know their start. */
export function bands(config: Config | undefined, completed: Task[], days = 56): Band[] {
  const history = config?.history || {};
  const done = new Set(completed.filter((t) => t.completed_at).map((t) => key(t.id, ymd(new Date(t.completed_at!)))));
  const out: Band[] = Array.from({ length: 12 }, (_, i) => ({ from: i * 120, planned: 0, done: 0 }));
  for (let i = 1; i <= days; i++) {
    const day = ymd(addDays(startOfToday(), -i)), rec = history[day];
    if (!rec) continue;
    const tiny = new Set(rec.tinyDone || []);
    for (const p of rec.planned || []) {
      if (typeof p.start !== "number") continue;
      const b = out[Math.max(0, Math.min(11, Math.floor(p.start / 120)))];
      b.planned++;
      if (done.has(key(p.id, day)) || tiny.has(p.id)) b.done++;
    }
  }
  return out;
}

export const WEAK_MIN_BLOCKS = 8;   // blocks needed on each side of the line before Praxis believes it
export interface Weak { from: number; rate: number; n: number; before: number; nBefore: number }
/**
 * The hour after which planned blocks rarely get done, if there is one: the line (noon or later) where the done rate after it
 * is at most 60% of the rate before it and at least 20 points lower, with enough blocks on both sides to mean something.
 */
export function weakHours(bs: Band[]): Weak | null {
  let best: Weak | null = null;
  for (let from = 12 * 60; from <= 20 * 60; from += 120) {
    const late = bs.filter((b) => b.from >= from), early = bs.filter((b) => b.from < from);
    const n = late.reduce((s, b) => s + b.planned, 0), nb = early.reduce((s, b) => s + b.planned, 0);
    if (n < WEAK_MIN_BLOCKS || nb < WEAK_MIN_BLOCKS) continue;
    const rate = late.reduce((s, b) => s + b.done, 0) / n, before = early.reduce((s, b) => s + b.done, 0) / nb;
    if (rate > before * .6 || before - rate < .2) continue;
    if (!best || before - rate > best.before - best.rate) best = { from, rate, n, before, nBefore: nb };
  }
  return best;
}
/** How many blocks with a known start the record holds (so the screen can say how far it is from knowing). */
export const timedBlocks = (bs: Band[]) => bs.reduce((s, b) => s + b.planned, 0);

const WEEKDAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
export const span = (min: number) => fmtSpan(Math.round(min));
const clock = (min: number) => { const h = Math.floor(min / 60) % 24; return `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`; };
const pct = (x: number) => `${Math.round(x * 100)}%`;

export interface Insight { id: "load" | "late" | "weekday" | "commit" | "slips"; text: string; detail: string }
/** What the record says, most useful first. Each line needs enough days behind it; with too few it isn't said at all. */
export function insights(days: RecordDay[], weak: Weak | null, config: Config | undefined): Insight[] {
  const out: Insight[] = [];
  const recent = days.slice(-28);
  if (recent.length >= CAPACITY_DAYS) {
    const p = median(recent.map((d) => d.plannedMin)), f = median(recent.map((d) => d.doneMin));
    if (p >= 30) out.push({ id: "load",
      text: f >= p * .9 ? `You plan about ${span(p)} a day and finish nearly all of it.` : `You plan about ${span(p)} a day and finish about ${span(f)}.`,
      detail: `Typical day over your last ${recent.length} planned days.` });
  }
  if (weak) out.push({ id: "late",
    text: `Blocks that start after ${clock(weak.from)} get done ${pct(weak.rate)} of the time; earlier ones, ${pct(weak.before)}.`,
    detail: `${Math.round(weak.rate * weak.n)} of ${weak.n} later blocks, ${Math.round(weak.before * weak.nBefore)} of ${weak.nBefore} earlier ones.` });
  // Weekdays: only ones seen at least three times, and only when the best and worst are far apart.
  const by = new Map<number, [number, number, number]>();
  for (const d of days) { const x = by.get(d.weekday) || [0, 0, 0]; by.set(d.weekday, [x[0] + d.done, x[1] + d.planned, x[2] + 1]); }
  const wd = [...by.entries()].filter(([, x]) => x[2] >= 3 && x[1] >= 6).map(([k, x]) => ({ k, r: x[0] / x[1], n: x[2] })).sort((a, b) => a.r - b.r);
  if (wd.length >= 2 && wd[wd.length - 1].r - wd[0].r >= .25) {
    const lo = wd[0], hi = wd[wd.length - 1];
    out.push({ id: "weekday", text: `${WEEKDAYS[lo.k]} are your hardest day: ${pct(lo.r)} of the plan gets done. ${WEEKDAYS[hi.k]} are your best, at ${pct(hi.r)}.`, detail: `${lo.n} ${WEEKDAYS[lo.k]} and ${hi.n} ${WEEKDAYS[hi.k]} on record.` });
  }
  const com = recent.filter((d) => d.committed > 0);
  if (com.length >= CAPACITY_DAYS) {
    const kept = com.filter((d) => d.committedDone >= d.committed).length;
    out.push({ id: "commit", text: `You kept every commitment on ${kept} of ${com.length} days.`, detail: `${com.reduce((s, d) => s + d.committedDone, 0)} of ${com.reduce((s, d) => s + d.committed, 0)} commitments done.` });
  }
  const slipped = Object.values(config?.taskMemory || {}).filter((m) => (m.moves || 0) >= 3).length;
  if (slipped >= 2) out.push({ id: "slips", text: `${slipped} open tasks have been moved to a later day three or more times.`, detail: "They are in Needs a decision." });
  return out;
}

/** One change worth trying next week, from the record (or nothing). */
export interface Adjustment { id: "fewer" | "more"; text: string; why: string; commitCount: number }
export function adjustment(days: RecordDay[], cfg: Pick<PlannerSettings, "commitCount">): Adjustment | null {
  const com = days.slice(-14).filter((d) => d.committed > 0);
  if (com.length < CAPACITY_DAYS) return null;
  const kept = com.filter((d) => d.committedDone >= d.committed).length / com.length;
  const typical = median(com.map((d) => d.committedDone));
  if (kept < .4 && cfg.commitCount > 1) {
    const to = Math.max(1, Math.min(cfg.commitCount - 1, Math.round(typical) || 1));
    return { id: "fewer", commitCount: to, text: `Commit to ${to} a day instead of ${cfg.commitCount}.`, why: `You kept every commitment on ${Math.round(kept * com.length)} of the last ${com.length} days, and a typical day finishes ${Math.round(typical)}.` };
  }
  if (kept >= .9 && cfg.commitCount < 5) return { id: "more", commitCount: cfg.commitCount + 1, text: `Commit to ${cfg.commitCount + 1} a day instead of ${cfg.commitCount}.`, why: `You kept every commitment on ${Math.round(kept * com.length)} of the last ${com.length} days.` };
  return null;
}
export type { PlannedItem };
