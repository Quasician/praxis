// 3.7: rewards. Small, rare, and earned: a shooting star, the aurora, a legend, a letter, a note.
import type { DayStat } from "./progress";

export interface Rewards {
  meteorAt?: string;                                  // when you last finished "the one" (the shooting star)
  aurora?: { earned: string; until: string; streak: number } | null; // a week of kept commitments
}
export interface Letter { week: string; at: string; paragraphs: string[]; suggestion?: string; byClaude: boolean; read?: boolean }

/** Days in a row (newest first) where you made commitments and kept every one. Days you committed to nothing don't count and don't break it. Today only counts once it's kept. */
export function keptStreak(stats: DayStat[], today: string) {
  let n = 0;
  for (let i = stats.length - 1; i >= 0; i--) {
    const d = stats[i];
    if (!d.committed) continue;
    const kept = d.committedDone >= d.committed;
    if (d.day === today) { if (kept) n++; continue; }   // today isn't over: it can add to the streak but not break it
    if (!kept) break;
    n++;
  }
  return n;
}

/** The aurora comes out on the evening a streak reaches 7 (and 14, 21…), and stays until the next morning. */
export function auroraEarned(streak: number, prev: Rewards | undefined, today: string, now = new Date()): Rewards["aurora"] | null {
  if (streak < 7 || streak % 7) return null;
  if (prev?.aurora && (prev.aurora.earned === today || prev.aurora.streak >= streak && Date.parse(prev.aurora.until) > now.getTime() - 3 * 864e5)) return null;
  const until = new Date(now); until.setDate(until.getDate() + 1); until.setHours(10, 0, 0, 0);
  return { earned: today, until: until.toISOString(), streak };
}

export const auroraOn = (r: Rewards | undefined, now = Date.now()) => !!r?.aurora && Date.parse(r.aurora.until) > now;
/** Seconds since the shooting star, while it's still worth showing (3 hours). */
export function meteorAge(r: Rewards | undefined, now = Date.now()) {
  if (!r?.meteorAt) return null;
  const s = (now - Date.parse(r.meteorAt)) / 1000;
  return s >= 0 && s < 3 * 3600 ? s : null;
}

// ---------- completion notes ----------
export type ScaleName = "off" | "pentatonic" | "major" | "minor" | "dorian" | "lydian";
export const SCALES: Record<Exclude<ScaleName, "off">, { label: string; steps: number[] }> = {
  pentatonic: { label: "Pentatonic (always pleasant)", steps: [0, 2, 4, 7, 9] },
  major: { label: "Major (bright)", steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { label: "Minor (calm)", steps: [0, 2, 3, 5, 7, 8, 10] },
  dorian: { label: "Dorian (lofi)", steps: [0, 2, 3, 5, 7, 9, 10] },
  lydian: { label: "Lydian (dreamy)", steps: [0, 2, 4, 6, 7, 9, 11] },
};
/** The n-th completion of the day climbs the scale from C4, two octaves, then starts again. */
export function noteFor(scale: ScaleName, n: number) {
  if (scale === "off") return null;
  const st = SCALES[scale].steps, span = st.length * 2;
  const k = ((n % span) + span) % span;
  const semis = st[k % st.length] + 12 * Math.floor(k / st.length);
  return 261.6256 * Math.pow(2, semis / 12);
}

// ---------- the Sunday letter ----------
/** The Sunday that starts the letter's week (letters are written on Sundays, about the 7 days before). */
export function letterWeek(now = new Date()) {
  const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - d.getDay());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export interface WeekSummary { done: string[]; kept: number; committedDays: number; projects: { name: string; lit: number; finished?: boolean }[]; busiest?: string; total: number }
/** A plain letter for when Claude isn't connected: just what happened, no advice. */
export function plainLetter(s: WeekSummary): Pick<Letter, "paragraphs" | "suggestion"> {
  const p: string[] = [];
  p.push(s.total ? `You finished ${s.total} ${s.total === 1 ? "thing" : "things"} this week${s.busiest ? `, most of them on ${s.busiest}` : ""}.` : "A quiet week. That happens; the sky keeps.");
  if (s.committedDays) p.push(`You kept your commitments on ${s.kept} of the ${s.committedDays} days you made them.`);
  const moved = s.projects.filter((x) => x.lit);
  if (moved.length) p.push(moved.map((x) => x.finished ? `${x.name} is finished.` : `${x.name}: ${x.lit} ${x.lit === 1 ? "star" : "stars"} lit.`).join(" "));
  return { paragraphs: p };
}
