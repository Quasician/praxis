// 4.0 The weekly review: which projects moved, which have gone quiet, and a decision for each stalled one.
// A project "moves" when one of its stars is lit. Its clock restarts when you light a star, when it's made, or when a review
// decides to keep going. Pure functions over the sky record; data/review.ts carries the decisions out.
import type { SkyConstellation, SkyRecord } from "./sky";

export const QUIET_DAYS = 10;     // no star for this long: starts to dim
export const STALLED_DAYS = 21;   // no star for three weeks: the review asks what to do
const DAY = 864e5;

export type Standing = "moving" | "quiet" | "stalled" | "resting" | "finished";

/** When the project last moved: its newest lit star, the day it was made, or the last time you chose to keep going. */
export function lastMoved(c: SkyConstellation): number {
  let t = Date.parse(c.since) || 0;
  for (const s of c.steps) if (s.done) t = Math.max(t, Date.parse(s.done) || 0);
  if (c.kept) t = Math.max(t, Date.parse(c.kept) || 0);
  return t;
}
export const quietDays = (c: SkyConstellation, now = Date.now()) => Math.max(0, Math.floor((now - lastMoved(c)) / DAY));
export function standing(c: SkyConstellation, now = Date.now()): Standing {
  if (c.finished) return "finished";
  if (c.rest) return "resting";
  const q = quietDays(c, now);
  return q >= STALLED_DAYS ? "stalled" : q >= QUIET_DAYS ? "quiet" : "moving";
}
/** How much a constellation fades (0 = full brightness): from the tenth quiet day to the twenty-first, then it holds. Resting ones are faintest. */
export function dimOf(c: SkyConstellation, now = Date.now()): number {
  if (c.finished) return 0;
  if (c.rest) return .62;
  const q = quietDays(c, now);
  return q < QUIET_DAYS ? 0 : Math.min(.55, .2 + .35 * (q - QUIET_DAYS) / (STALLED_DAYS - QUIET_DAYS));
}

export interface ReviewProject { id: string; name: string; standing: Standing; quiet: number; litWeek: number; lit: number; total: number; next: { id: string; title: string; min: number } | null; target: string | null }
export interface WeekReview { moved: ReviewProject[]; quiet: ReviewProject[]; stalled: ReviewProject[]; resting: ReviewProject[]; finished: ReviewProject[] }

/** The projects, sorted into what happened over the 7 days ending at `now`. */
export function reviewProjects(sky: SkyRecord | undefined, now = Date.now()): WeekReview {
  const out: WeekReview = { moved: [], quiet: [], stalled: [], resting: [], finished: [] };
  const weekAgo = now - 7 * DAY;
  for (const [id, c] of Object.entries(sky?.cons || {})) {
    if (!c.steps.length) continue;
    const litWeek = c.steps.filter((s) => s.done && Date.parse(s.done) > weekAgo && Date.parse(s.done) <= now).length;
    const next = c.steps.find((s) => !s.done);
    const p: ReviewProject = { id, name: c.name, standing: standing(c, now), quiet: quietDays(c, now), litWeek, lit: c.steps.filter((s) => s.done).length, total: c.steps.length,
      next: next ? { id: next.id, title: next.title, min: next.min } : null, target: c.target ?? null };
    if (c.finished) { if (Date.parse(c.finished) > weekAgo) out.finished.push(p); continue; }
    if (p.standing === "resting") out.resting.push(p);
    else if (litWeek) out.moved.push(p);
    else if (p.standing === "stalled") out.stalled.push(p);
    else out.quiet.push(p);           // nothing this week, but not three weeks yet
  }
  out.moved.sort((a, b) => b.litWeek - a.litWeek);
  out.stalled.sort((a, b) => b.quiet - a.quiet);
  out.quiet.sort((a, b) => b.quiet - a.quiet);
  return out;
}

/** keep: put the next step on a day. shrink: add a ten-minute first step. rest: set the project down. wake: pick it back up. */
export type Decision = "keep" | "shrink" | "rest" | "wake";
export interface Review { week: string; at: string; decisions: Record<string, Decision>; adjusted?: string }

/** The Sunday that names the review's week (the same week as the Sunday letter). */
export function reviewWeek(now = new Date()) {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  // Sunday reviews the week ending today; Monday to Saturday belong to the Sunday just gone.
  d.setDate(d.getDate() - d.getDay());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** The review is offered from Sunday morning (9:00) through Monday, until it's done for that week. */
export function reviewDue(reviews: Record<string, Review> | undefined, now = new Date()) {
  const dow = now.getDay();
  if (dow > 1 || (dow === 0 && now.getHours() < 9)) return false;
  return !reviews?.[reviewWeek(now)];
}
