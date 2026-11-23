// Weekly planner: decide which DAY each task belongs on (the daily planner then picks times).
//
// Draft rules
//   • Already-dated tasks in the week stay where they are (repeating ones are locked).
//   • Every overdue task gets a home: a day next week, or Someday if it's 60+ days stale.
//   • Each milestone's next step (if it has no date yet) gets a day; each quiet area gets one task.
//   • Capacity per day = free time (planning window − work − calendar events − timed tasks),
//     minus the slack you keep free, minus what's already on that day.
//   • @deep tasks go to the roomiest days (overdue ones: earliest), at most 1 per work day and 2 per day off.
//   • Overdue tasks go to the earliest day with room (spread so no day passes 60%); everything else to the lightest day.
//   • Three of your oldest @someday tasks resurface as suggestions.
import { addDays, ceilTo, daysOverdue, fromYmd, minOfDay, parseDue, startOfToday, toMin, ymd } from "../lib/dates";
import { SOMEDAY_LABEL, blockMinutes, hasLabel, isMilestone, willpower } from "../lib/tasks";
import type { Area, CalEvent, PlannerSettings, Task } from "../lib/types";
import { computeArea } from "./areas";
import { allDayEventsOn, eventSpanOn } from "./layout";
import { subtractBusy, workBand } from "./planner";

export const STALE_DAYS = 60;

export type Source = "fixed" | "overdue" | "stale" | "milestone" | "quiet" | "someday";
export type Lane = "unplaced" | "someday" | "resurfaced";
export interface WeekCard {
  task: Task;
  day: string | null;        // ymd, or null when in a lane
  lane: Lane | null;         // where it sits when not on a day
  origDay: string | null;    // where it was before planning (null = no date / not in the week)
  origLane: Lane | null;
  source: Source;
  locked: boolean;           // repeating tasks keep their schedule
  dur: number;
  wp: number;
  note?: string;
}
export interface WeekDay { date: Date; key: string; capacity: number; work: [number, number] | null; events: CalEvent[]; allDay: CalEvent[] }

/** The days to plan: next Mon–Sun from Friday on, otherwise the rest of this week. */
export function targetWeek(now = new Date()): Date[] {
  const today = startOfToday();
  const dow = now.getDay(); // 0 Sun … 6 Sat
  const start = [5, 6, 0].includes(dow) ? addDays(today, ((8 - dow) % 7) || 7) : today;
  const end = addDays(start, start.getDay() === 1 ? 7 : (7 - start.getDay()) % 7 + 1); // through Sunday
  const days: Date[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) days.push(d);
  return days;
}
export const weekKey = (days: Date[]) => ymd(days[0]);
export const isNextWeek = (days: Date[]) => days[0] > startOfToday();

/** Minutes you can plan on a day (after keeping some free). */
export function dayCapacity(cfg: PlannerSettings, day: Date, events: CalEvent[], timedTasks: Task[]): number {
  const isToday = ymd(day) === ymd(new Date());
  const from = isToday ? Math.max(toMin(cfg.dayStart), ceilTo(minOfDay(new Date()) + 5, 15)) : toMin(cfg.dayStart);
  const busy: [number, number][] = [];
  const work = workBand(cfg, day);
  if (work) busy.push([work[0], work[1] + cfg.afterWork]);
  for (const e of events) {
    if (e.transparent || e.allDay) continue;
    const span = eventSpanOn(e, day);
    if (span) busy.push([span[0] - cfg.gap, span[1] + cfg.gap]);
  }
  for (const t of timedTasks) {
    const d = parseDue(t.due)!;
    const s = minOfDay(d.d);
    busy.push([s - cfg.gap, s + blockMinutes(t) + cfg.gap]);
  }
  const free = subtractBusy(from, toMin(cfg.dayEnd), busy).reduce((s, [a, z]) => s + (z - a), 0);
  return Math.floor(free * (1 - cfg.keepFree / 100));
}

export interface DraftInput {
  cfg: PlannerSettings;
  days: Date[];
  active: Task[];
  completed: Task[];
  events: CalEvent[];
  areas: Area[];
}
export interface Draft { days: WeekDay[]; cards: WeekCard[] }

export function draftWeek({ cfg, days, active, completed, events, areas }: DraftInput): Draft {
  const keys = new Set(days.map(ymd));
  const today = ymd(new Date());
  const cards: WeekCard[] = [];
  const has = (id: string) => cards.some((c) => c.task.id === id);
  const card = (task: Task, source: Source, day: string | null, lane: Lane | null, origDay: string | null, note?: string): WeekCard =>
    ({ task, source, day, lane, origDay, origLane: lane && source === "someday" ? "resurfaced" : null, locked: false, dur: blockMinutes(task), wp: willpower(task, cfg), note });

  // 1. What's already on the week's days.
  for (const t of active) {
    const d = parseDue(t.due);
    if (!d || !keys.has(ymd(d.d))) continue;
    const c = card(t, "fixed", ymd(d.d), null, ymd(d.d));
    c.locked = !!(t.due && t.due.is_recurring);
    cards.push(c);
  }

  // 2. Overdue (relative to the first planned day) and stale.
  // Overdue = due before today. (When planning next week on a Friday, tasks due this weekend aren't overdue.)
  const overdue = active.filter((t) => {
    const d = parseDue(t.due);
    return d && ymd(d.d) < today && !hasLabel(t, SOMEDAY_LABEL);
  });
  const toPlace: { c: WeekCard; rank: number }[] = [];
  for (const t of overdue) {
    if (has(t.id)) continue;
    const age = daysOverdue(t);
    if (age >= STALE_DAYS && !(t.due && t.due.is_recurring)) {
      cards.push(card(t, "stale", null, "someday", ymd(parseDue(t.due)!.d), `${age} days overdue`));
    } else {
      toPlace.push({ c: card(t, "overdue", null, null, ymd(parseDue(t.due)!.d), age > 0 ? `${age}d overdue` : "due today"), rank: 3000 + age });
    }
  }

  // 3. Next step of each milestone (nearest target first).
  const milestones = active.filter(isMilestone).map((m) => ({
    m, target: (m.deadline && m.deadline.date) || (m.due && m.due.date) || "9999",
    next: active.filter((t) => t.parent_id === m.id).sort((a, b) => (a.child_order ?? 0) - (b.child_order ?? 0))[0],
  })).filter((x) => x.next && !x.next.due && !has(x.next.id) && !toPlace.some((p) => p.c.task.id === x.next.id)) // undated steps only
    .sort((a, b) => a.target.localeCompare(b.target)).slice(0, 5);
  milestones.forEach((x, i) => toPlace.push({ c: card(x.next, "milestone", null, null, null, `◆ ${x.m.content}`), rank: 2000 - i }));

  // 4. One task for each area that has gone quiet.
  for (const a of areas) {
    const stats = computeArea(a, active, completed);
    if (!stats.quiet) continue;
    const pick = stats.upNext.find((t) => !t.due && !has(t.id) && !toPlace.some((p) => p.c.task.id === t.id) && !hasLabel(t, SOMEDAY_LABEL)); // undated only
    if (pick) { toPlace.push({ c: card(pick, "quiet", null, null, null, `${a.name} has been quiet`), rank: 1000 }); }
  }

  // 5. Resurface the oldest @someday tasks as suggestions.
  active.filter((t) => hasLabel(t, SOMEDAY_LABEL) && !t.due && !has(t.id))
    .sort((a, b) => (a.added_at || "").localeCompare(b.added_at || "")).slice(0, 3)
    .forEach((t) => cards.push({ ...card(t, "someday", null, "resurfaced", null, "from Someday"), origLane: "resurfaced" }));

  // Capacity per day.
  const weekDays: WeekDay[] = days.map((date) => {
    const key = ymd(date);
    const dayEvents = events.filter((e) => !e.allDay && eventSpanOn(e, date));
    const timed = cards.filter((c) => c.day === key && parseDue(c.task.due)?.hasTime).map((c) => c.task);
    return { date, key, capacity: dayCapacity(cfg, date, dayEvents, timed), work: workBand(cfg, date), events: dayEvents, allDay: allDayEventsOn(events, key) };
  });

  // Place: deep tasks to the roomiest days (with a per-day limit), overdue to the earliest day with room, the rest to the lightest day.
  const remaining = new Map(weekDays.map((d) => [d.key, d.capacity - cards.filter((c) => c.day === d.key && !parseDue(c.task.due)?.hasTime).reduce((s, c) => s + c.dur, 0)]));
  const deepCount = new Map(weekDays.map((d) => [d.key, cards.filter((c) => c.day === d.key && c.wp === 3).length]));
  const deepLimit = (d: WeekDay) => (d.work ? 1 : 2);
  toPlace.sort((a, b) => b.rank - a.rank || b.c.wp - a.c.wp);
  for (const { c } of toPlace) {
    let options = weekDays.filter((d) => remaining.get(d.key)! >= c.dur);
    if (c.wp === 3) options = options.filter((d) => deepCount.get(d.key)! < deepLimit(d));
    let pick: WeekDay | undefined;
    // Overdue: the earliest day that stays under 60% full (so they don't all pile onto Monday), else the earliest with room.
    if (c.source === "overdue") pick = options.find((d) => d.capacity - remaining.get(d.key)! + c.dur <= d.capacity * 0.6) || options[0];
    else if (c.wp === 3) pick = [...options].sort((a, b) => remaining.get(b.key)! - remaining.get(a.key)!)[0];
    else pick = [...options].sort((a, b) => (1 - remaining.get(a.key)! / Math.max(1, a.capacity)) - (1 - remaining.get(b.key)! / Math.max(1, b.capacity)))[0];
    if (!pick) { cards.push({ ...c, lane: "unplaced" }); continue; }
    remaining.set(pick.key, remaining.get(pick.key)! - c.dur);
    if (c.wp === 3) deepCount.set(pick.key, deepCount.get(pick.key)! + 1);
    cards.push({ ...c, day: pick.key });
  }
  return { days: weekDays, cards };
}

/** Minutes planned on a day (untimed cards; timed ones are already outside capacity). */
export const dayLoad = (cards: WeekCard[], key: string) => cards.filter((c) => c.day === key && !parseDue(c.task.due)?.hasTime).reduce((s, c) => s + c.dur, 0);

/** The new due for a card moved to a day (keeps a task's time of day and its repeat rule). */
export function dueOnDay(task: Task, key: string) {
  const d = parseDue(task.due);
  const date = d && d.hasTime ? `${key}T${(task.due!.date.split("T")[1] || "09:00:00").slice(0, 8)}` : key;
  const due: { date: string; string?: string; is_recurring?: boolean; lang?: string } = { date };
  if (task.due && task.due.is_recurring) { due.string = task.due.string; due.is_recurring = true; if (task.due.lang) due.lang = task.due.lang; }
  return due;
}

/** Does accepting the plan need to change this task in Todoist? */
export function changed(c: WeekCard) {
  if (c.lane === "someday") return c.source !== "someday";   // parking it in Someday
  if (c.lane) return false;                                   // didn't fit / suggestions: leave as is
  return c.day !== c.origDay || c.source === "someday";       // a new day (or out of Someday)
}
export const dayLabel = (key: string) => fromYmd(key).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
