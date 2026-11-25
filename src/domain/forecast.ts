// 4.2 Forecasts: when a project will finish at the pace you're lighting its stars, against its deadline.
// Pace comes from the project's own recent stars (its last six), measured up to today, so a quiet spell slows the forecast.
// Pure functions over the sky record.
import type { SkyConstellation, SkyRecord } from "./sky";

const DAY = 864e5;
export const FORECAST_MIN_STARS = 2;   // lit stars needed before there is a pace to go on
export const BEHIND_DAYS = 7;
const STALLED = 21;                    // the weekly review's "stalled" (domain/review.ts STALLED_DAYS)          // finishing more than a week past the deadline counts as behind

export interface Forecast {
  date: Date | null;     // when it finishes at this pace (null: more than a year away)
  days: number;          // days from today
  perWeek: number;       // stars a week, lately
  late: number | null;   // days past the deadline it would finish (negative: early; null: no deadline, or no date)
}

const targetTime = (t: string) => Date.parse(t.length <= 10 ? `${t}T23:59:59` : t);

export function forecast(c: SkyConstellation, now = Date.now()): Forecast | null {
  if (c.finished || c.rest) return null;
  const lit = c.steps.filter((s) => s.done).map((s) => Date.parse(s.done!)).filter(Number.isFinite).sort((a, b) => a - b);
  const left = c.steps.length - lit.length;
  if (left <= 0 || lit.length < FORECAST_MIN_STARS) return null;
  const recent = lit.slice(-6);
  const perDay = recent.length / Math.max(7, (now - recent[0]) / DAY);
  const days = Math.ceil(left / perDay);
  if (days > 365) return { date: null, days, perWeek: perDay * 7, late: c.target ? Math.round((now + days * DAY - targetTime(c.target)) / DAY) : null };
  const date = new Date(now + days * DAY);
  return { date, days, perWeek: perDay * 7, late: c.target ? Math.round((date.getTime() - targetTime(c.target)) / DAY) : null };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "Dec 9" within three weeks; "mid-January" further out; "more than a year" past that. */
export function whenText(f: Forecast) {
  if (!f.date) return "more than a year";
  if (f.days <= 21) return f.date.toLocaleDateString([], { month: "short", day: "numeric" });
  const d = f.date.getDate(), part = d <= 10 ? "early" : d <= 20 ? "mid" : "late";
  return `${part}-${MONTHS[f.date.getMonth()]}`;
}
/** "2 weeks", "5 days": how far past its deadline. */
export const lateText = (days: number) => (days >= 14 ? `${Math.round(days / 7)} weeks` : `${days} ${days === 1 ? "day" : "days"}`);
export const isBehind = (f: Forecast | null) => !!f && f.late !== null && f.late > BEHIND_DAYS;

/** Projects that are moving but would finish well past their deadlines at this pace, most behind first. */
export function behindProjects(sky: SkyRecord | undefined, now = Date.now()) {
  const out: { id: string; name: string; late: number; text: string; detail: string }[] = [];
  for (const [id, c] of Object.entries(sky?.cons || {})) {
    const f = forecast(c, now);
    if (!f || !isBehind(f) || !c.target) continue;
    // A project with no star in three weeks is a stalled one (the weekly review asks about it as such), not a slow one.
    const moved = Math.max(Date.parse(c.since) || 0, Date.parse(c.kept || "") || 0, ...c.steps.map((s) => Date.parse(s.done || "") || 0));
    if (now - moved >= STALLED * DAY) continue;
    const due = new Date(targetTime(c.target)).toLocaleDateString([], { month: "short", day: "numeric" });
    out.push({ id, name: c.name, late: f.late!, text: `about ${lateText(f.late!)} behind its deadline at this pace`,
      detail: `Due ${due}; at ${f.perWeek < 1 ? `about one star every ${Math.round(7 / Math.max(f.perWeek, .01))} days` : `${f.perWeek.toFixed(1).replace(/\.0$/, "")} ${f.perWeek.toFixed(1) === "1.0" ? "star" : "stars"} a week`}, it finishes ${f.date ? `around ${whenText(f)}` : "in more than a year"}.` });
  }
  return out.sort((a, b) => b.late - a.late);
}
