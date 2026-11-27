// 4.6 Better actuals: when a planned block ends, Praxis asks how it went (done, partly, didn't happen) and how long it took.
// Pure functions: which blocks to ask about, the length choices, and how an answer is written into the settings.
// The record (domain/record.ts) reads the answers, and a finished block's real length becomes a sample (how long this kind
// of task really takes), the same as a timed focus session.
import { parseDue, sameDay, ymd } from "../lib/dates";
import { blockMinutes } from "../lib/tasks";
import type { Config, DayRecord, Sample, Task } from "../lib/types";
import { SAMPLES_KEEP } from "./progress";

export type Outcome = "done" | "partly" | "skipped";
/** One answer: what happened and, for done or partly, the minutes it took. */
export interface Actual { o: Outcome; min?: number; at: string; why?: string }

export interface EndedBlock { id: string; title: string; start: number; end: number; min: number; task: Task }

const MIN = 60_000;
export const ASK_FOR = 4 * 60 * MIN;   // a block that ended more than four hours ago isn't asked about any more

/** Today's answers so far, by task id. */
export const actualsOf = (config: Config | undefined, day = ymd(new Date())): Record<string, Actual> =>
  (config?.history?.[day] as DayRecord | undefined)?.actual || {};

/**
 * Timed blocks that ended in the last four hours and are still open in Todoist (a block you ticked off, here or anywhere,
 * isn't asked about), without an answer yet, and not the one a focus timer is running on. Oldest first.
 */
export function endedBlocks(tasks: Task[], now: Date, answered: Record<string, Actual> = {}, focusId?: string | null): EndedBlock[] {
  const t = now.getTime(), out: EndedBlock[] = [];
  for (const task of tasks) {
    const d = parseDue(task.due);
    if (!d?.hasTime || !sameDay(d.d, now) || answered[task.id] || task.id === focusId) continue;
    const b = blockOf(task, now);
    if (b.end <= t && b.end > t - ASK_FOR) out.push(b);
  }
  return out.sort((a, b) => a.end - b.end);
}

/** A task as a block: its start today (now, when it has no time) and its planned length. */
export function blockOf(task: Task, now = new Date()): EndedBlock {
  const d = parseDue(task.due), min = blockMinutes(task);
  const start = d?.hasTime ? d.d.getTime() : now.getTime() - min * MIN;
  return { id: task.id, title: task.content, start, end: start + min * MIN, min, task };
}

const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);
/** "How long did it take?": half, as planned, half again, double (rounded to 5 minutes). For partly, shorter choices. */
export function lengthChoices(planned: number, outcome: Outcome): number[] {
  const f = outcome === "partly" ? [.25, .5, .75, 1] : [.5, 1, 1.5, 2];
  return [...new Set(f.map((x) => round5(planned * x)))];
}

/**
 * Writes an answer into the day's record (made if the day had no plan) and, for a finished block with a length, adds a
 * sample: estimate vs what it really took. `wp` is the task's willpower (1–3), as the planner counts it.
 */
export function withActual(c: Config, day: string, block: { id: string; min: number }, outcome: Outcome, minutes: number | undefined, wp: number, at = new Date(), why?: string): Config {
  const rec: DayRecord = (c.history?.[day] as DayRecord | undefined) || { planned: [] };
  const min = minutes != null && minutes > 0 ? Math.min(Math.round(minutes), 600) : undefined;
  const actual: Actual = { o: outcome, ...(min != null && outcome !== "skipped" ? { min } : {}), at: at.toISOString(), ...(why ? { why: why.slice(0, 300) } : {}) };
  const sample: Sample | null = outcome === "done" && min != null && min >= 3 ? { wp, est: block.min, actual: min, at: at.toISOString() } : null;
  return {
    ...c,
    history: { ...(c.history || {}), [day]: { ...rec, actual: { ...(rec.actual || {}), [block.id]: actual } } },
    samples: sample ? [...(c.samples || []), sample].slice(-SAMPLES_KEEP) : c.samples,
  };
}

/** 4.7: what you chose at a block's gate, kept in the day's record (start, move or skip). */
export function withGate(c: Config, day: string, id: string, choice: "start" | "move" | "skip", at = new Date()): Config {
  const rec: DayRecord = (c.history?.[day] as DayRecord | undefined) || { planned: [] };
  return { ...c, history: { ...(c.history || {}), [day]: { ...rec, gate: [...(rec.gate || []), { id, choice, at: at.toISOString() }].slice(-50) } } };
}

/** 4.7: a focus lock lifted early, kept in the day's record. */
export function withUnlock(c: Config, day: string, id: string, what: string, at = new Date()): Config {
  const rec: DayRecord = (c.history?.[day] as DayRecord | undefined) || { planned: [] };
  return {
    ...c,
    focus: c.focus ? { ...c.focus, unlockedAt: at.toISOString() } : c.focus,
    history: { ...(c.history || {}), [day]: { ...rec, unlocked: [...(rec.unlocked || []), { id, what, at: at.toISOString() }].slice(-50) } },
  };
}

/** The real minutes a planned block took, when you said (done or partly); null when you didn't say. */
export const actualMinutes = (rec: DayRecord | undefined, id: string): number | null => {
  const a = rec?.actual?.[id];
  return a && a.o !== "skipped" && typeof a.min === "number" ? a.min : null;
};
