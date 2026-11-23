import { durationMinutes, parseDue, sameDay, startOfToday } from "./dates";
import type { Due, PlannerSettings, Task } from "./types";

export const DEFAULT_BLOCK = 30;
export const MILESTONE_LABEL = "milestone";
export const SOMEDAY_LABEL = "someday";
export const DROPPED_LABEL = "dropped";

export const hasLabel = (t: Task, name: string) => (t.labels || []).some((l) => l.toLowerCase() === name.toLowerCase());
export const isMilestone = (t: Task) => hasLabel(t, MILESTONE_LABEL);

export function blockMinutes(t: Task) {
  const d = durationMinutes(t);
  return d && d < 1440 ? d : DEFAULT_BLOCK;
}

/** 3 = needs real willpower (@deep), 2 = medium (unlabelled), 1 = easy (@light). */
export function willpower(t: Task, cfg?: Pick<PlannerSettings, "deepLabel" | "lightLabel">) {
  if (hasLabel(t, cfg?.deepLabel || "deep")) return 3;
  if (hasLabel(t, cfg?.lightLabel || "light")) return 1;
  return 2;
}

export function sortTasks(list: Task[], mode: "overdue" | "today" | "inbox") {
  return [...list].sort((a, b) => {
    const da = parseDue(a.due), db = parseDue(b.due);
    if (mode === "overdue" && da && db && +da.d !== +db.d) return +da.d - +db.d;
    if (mode === "today") {
      const ta = !!(da && da.hasTime), tb = !!(db && db.hasTime);
      if (ta && tb && +da!.d !== +db!.d) return +da!.d - +db!.d;
      if (ta !== tb) return ta ? -1 : 1;
    }
    if (a.priority !== b.priority) return b.priority - a.priority;
    return (a.child_order ?? 0) - (b.child_order ?? 0);
  });
}

export function splitToday(tasks: Task[]) {
  const t0 = startOfToday();
  const overdue: Task[] = [], today: Task[] = [];
  for (const t of tasks) {
    const due = parseDue(t.due);
    if (due && due.d < t0) overdue.push(t);
    else today.push(t);
  }
  return { overdue: sortTasks(overdue, "overdue"), today: sortTasks(today, "today") };
}

/** A due object for a new date that keeps a repeating task's repeat rule. */
export function dueFor(task: Task, date: string): Due {
  const old = task.due;
  const due: Due = { date };
  if (old && old.is_recurring) {
    due.string = old.string;
    due.is_recurring = true;
    if (old.lang) due.lang = old.lang;
  }
  return due;
}

/** Local wall-clock time, "2026-11-23T18:00:00", with no time zone attached. */
export function floatingDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

/**
 * Due for a time on a day, always as local ("floating") time. A time pinned to a time zone is stored in UTC,
 * and Todoist's "today" filter then files a 6 PM task under tomorrow's date, so Praxis never pins.
 */
export function timedDue(task: Task, day: Date, minutes: number): Due {
  const start = new Date(day); start.setHours(0, minutes, 0, 0);
  return dueFor(task, floatingDate(start));
}

/** A time pinned to a time zone ("…Z"), which can land on the wrong day in Todoist's filters. */
export const isPinned = (t: Task) => !!t.due && t.due.date.length > 10 && (/Z$|[+-]\d\d:?\d\d$/.test(t.due.date) || !!t.due.timezone);

export const isTimedToday = (t: Task) => { const d = parseDue(t.due); return !!(d && d.hasTime && sameDay(d.d, new Date())); };
