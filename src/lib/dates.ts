import type { Due, Task } from "./types";

export const pad2 = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
export const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
export const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const minOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();
export const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const fromYmd = (s: string) => new Date(s.slice(0, 10) + "T00:00:00");

export const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export function fmtMin(min: number) { const d = new Date(); d.setHours(0, min, 0, 0); return fmtTime(d); }
export function fmtSpan(min: number) {
  const h = Math.floor(min / 60), m = min % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}
export function fmtDuration(min: number | null) {
  if (!min) return "";
  if (min >= 1440) return `${Math.round(min / 1440)}d`;
  return fmtSpan(min);
}
export function fmtDayShort(d: Date) {
  const days = Math.round((+startOfToday() - +new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 864e5);
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export interface ParsedDue { d: Date; hasTime: boolean; recurring: boolean }
export function parseDue(due: Due | null | undefined): ParsedDue | null {
  if (!due) return null;
  const raw = due.datetime || due.date;
  if (!raw) return null;
  const hasTime = raw.length > 10;
  return { d: hasTime ? new Date(raw) : new Date(raw + "T00:00:00"), hasTime, recurring: !!due.is_recurring };
}

export function durationMinutes(t: Task): number | null {
  if (!t.duration) return null;
  return t.duration.unit === "day" ? t.duration.amount * 1440 : t.duration.amount;
}

/** Days a task is overdue (0 = due today or later). */
export function daysOverdue(t: Task) {
  const d = parseDue(t.due);
  if (!d) return 0;
  return Math.round((+startOfToday() - +new Date(d.d.getFullYear(), d.d.getMonth(), d.d.getDate())) / 864e5);
}

export const toMin = (hhmm: string) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + (m || 0); };
export const ceilTo = (m: number, step: number) => Math.ceil(m / step) * step;

/** Floating local "YYYY-MM-DDTHH:MM:00" for a minute-of-day on a given date. */
export function localStamp(day: Date, minutes: number) {
  const d = new Date(day); d.setHours(0, minutes, 0, 0);
  return `${ymd(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`;
}
