// Laying out the day timeline: task blocks and calendar events, side by side when they overlap.
import { minOfDay, parseDue, sameDay } from "../lib/dates";
import { plain } from "../lib/text";
import { blockMinutes } from "../lib/tasks";
import type { CalEvent, Task } from "../lib/types";

export const TL_START = 6;   // timeline starts at 6am
export const TL_END = 24;    // …and ends at midnight

export interface Block { task?: Task; event?: CalEvent; start: number; dur: number; end: number; col: number; cols: number }

const normTitle = (s: string) => plain(s).toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();

/** Timed events today, minus copies of Todoist tasks at the same time (from Todoist's calendar sync). */
export function visibleEvents(events: CalEvent[], todayTasks: Task[]) {
  const timed = todayTasks.map((t) => ({ t, d: parseDue(t.due) })).filter((x) => x.d && x.d.hasTime);
  return events.filter((e) => {
    if (e.allDay) return false;
    const es = new Date(e.start), title = normTitle(e.title);
    return !timed.some(({ t, d }) => {
      const tt = normTitle(t.content);
      return Math.abs(+d!.d - +es) <= 10 * 60000 && tt.length >= 3 && title.length >= 3 && (tt.includes(title) || title.includes(tt));
    });
  });
}

/** All-day events are calendar dates (end exclusive), so compare dates, not instants. */
export const allDayEventsOn = (events: CalEvent[], day: string) => events.filter((e) => e.allDay && (e.date || "") <= day && day < (e.endDate || e.date || ""));

/** Minutes [start, end) an event covers on `day`, clipped to the day. */
export function eventSpanOn(e: CalEvent, day: Date): [number, number] | null {
  const s = new Date(e.start), en = new Date(e.end);
  const dayStart = new Date(day); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(+dayStart + 864e5);
  if (en <= dayStart || s >= dayEnd) return null;
  const start = s <= dayStart ? 0 : minOfDay(s);
  const end = en >= dayEnd ? 24 * 60 : minOfDay(en);
  return end > start ? [start, end] : null;
}

export function layoutBlocks(todayTasks: Task[], events: CalEvent[] = []): Block[] {
  const now = new Date();
  const items: Block[] = [];
  for (const e of events) {
    const span = eventSpanOn(e, now);
    if (!span) continue;
    const start = Math.max(span[0], TL_START * 60), end = Math.min(span[1], TL_END * 60);
    if (end - start < 5) continue;
    items.push({ event: e, start, dur: end - start, end, col: 0, cols: 1 });
  }
  for (const t of todayTasks) {
    const due = parseDue(t.due);
    if (!due || !due.hasTime || !sameDay(due.d, now)) continue;
    const start = minOfDay(due.d);
    if (start < TL_START * 60) continue;
    const dur = Math.min(blockMinutes(t), TL_END * 60 - start);
    items.push({ task: t, start, dur, end: start + dur, col: 0, cols: 1 });
  }
  items.sort((a, b) => a.start - b.start || b.dur - a.dur);
  // Group overlapping blocks into clusters, then give each a column.
  let cluster: Block[] = [], clusterEnd = -1;
  const flush = () => {
    const cols: number[] = [];
    for (const it of cluster) {
      let c = cols.findIndex((end) => end <= it.start);
      if (c === -1) { c = cols.length; cols.push(0); }
      cols[c] = it.end;
      it.col = c;
    }
    for (const it of cluster) it.cols = cols.length;
    cluster = [];
  };
  for (const it of items) {
    if (it.start >= clusterEnd && cluster.length) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.end);
  }
  if (cluster.length) flush();
  return items;
}
