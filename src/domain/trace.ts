// 5.0 Plan next to what happened. Praxis keeps a light trace of today's blocks (where each one sat, and where it moved
// after its time had come), so the day can show what really happened: a finished block stays in its place, ticked; a block
// moved once its time had come leaves a faint ghost pointing to its new time; a block you skipped or only partly did says so.
// Pure functions; the app writes the trace into the day's record when a block appears, moves or goes.
import type { DayRecord } from "../lib/types";

/** Where a block sat: content, start (minutes from midnight), length, project. `gone`: when it left the day (ms). */
export interface Seen { c: string; s: number; m: number; p?: string; gone?: number }
/** A block moved after its time had come: from where, to where (null: off today). */
export interface Move { id: string; c: string; from: number; m: number; to: number | null; at: string; p?: string }

export interface OpenBlock { id: string; content: string; start: number; dur: number; project?: string }

const GRACE = 3 * 60_000;   // a block that leaves the day gets three minutes to show up as done before it counts as moved
const LATE = 5;             // moving a block within five minutes of its start (or after) counts as moving it

/**
 * The trace after looking at today's open timed blocks. Returns null when nothing changed (so nothing is written).
 * A block that changed time once its time had come (or left the day) becomes a Move; one moved earlier just updates.
 */
export function noteSeen(rec: Pick<DayRecord, "seen" | "moves"> | undefined, open: OpenBlock[], nowMin: number, done: Set<string>, nowMs = Date.now()):
  { seen: Record<string, Seen>; moves: Move[] } | null {
  const seen: Record<string, Seen> = { ...(rec?.seen || {}) };
  const moves: Move[] = [...(rec?.moves || [])];
  let changed = false;
  const here = new Set<string>();
  for (const b of open) {
    here.add(b.id);
    const prev = seen[b.id];
    if (!prev) { seen[b.id] = { c: b.content, s: b.start, m: b.dur, ...(b.project ? { p: b.project } : {}) }; changed = true; continue; }
    if (prev.s !== b.start || prev.m !== b.dur || prev.c !== b.content || prev.gone) {
      if (prev.s !== b.start && nowMin >= prev.s - LATE) moves.push({ id: b.id, c: prev.c, from: prev.s, m: prev.m, to: b.start, at: new Date(nowMs).toISOString(), ...(prev.p ? { p: prev.p } : {}) });
      seen[b.id] = { c: b.content, s: b.start, m: b.dur, ...(b.project ? { p: b.project } : {}) };
      changed = true;
    }
  }
  for (const [id, prev] of Object.entries(seen)) {
    if (here.has(id) || done.has(id)) continue;
    if (!prev.gone) { seen[id] = { ...prev, gone: nowMs }; changed = true; continue; }
    if (nowMs - prev.gone < GRACE) continue;
    const goneMin = minOf(prev.gone);
    if (goneMin >= prev.s - LATE) moves.push({ id, c: prev.c, from: prev.s, m: prev.m, to: null, at: new Date(prev.gone).toISOString(), ...(prev.p ? { p: prev.p } : {}) });
    delete seen[id];
    changed = true;
  }
  return changed ? { seen, moves: moves.slice(-60) } : null;
}
const minOf = (ms: number) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };

export interface DoneBlock { id: string; c: string; s: number; m: number; p?: string; took?: number }
export interface Ghost { id: string; c: string; s: number; m: number; p?: string; to: number | null }
export type Mark = "skipped" | "partly";

/**
 * What to draw besides the open blocks: finished blocks in their place (with how long they really took, when you said),
 * ghosts where moved blocks were, and a mark on open blocks you skipped or only partly did.
 */
export function traceOf(rec: DayRecord | undefined, openTimed: Set<string>, done: Set<string>): { done: DoneBlock[]; ghosts: Ghost[]; marks: Map<string, Mark> } {
  const out = { done: [] as DoneBlock[], ghosts: [] as Ghost[], marks: new Map<string, Mark>() };
  if (!rec) return out;
  for (const [id, s] of Object.entries(rec.seen || {})) {
    if (!done.has(id) || openTimed.has(id)) continue;
    const a = rec.actual?.[id];
    out.done.push({ id, c: s.c, s: s.s, m: s.m, p: s.p, ...(a?.o === "done" && a.min ? { took: a.min } : {}) });
  }
  // A ghost for each move, except where the block itself is still (or again) at that spot.
  const seenAt = new Map(Object.entries(rec.seen || {}).map(([id, s]) => [id, s.s]));
  const shown = new Set<string>();
  for (const mv of [...(rec.moves || [])].reverse()) {
    const k = `${mv.id}@${mv.from}`;
    if (shown.has(k) || (openTimed.has(mv.id) && seenAt.get(mv.id) === mv.from)) continue;
    if (out.done.some((d) => d.id === mv.id && d.s === mv.from)) continue;
    shown.add(k);
    out.ghosts.push({ id: mv.id, c: mv.c, s: mv.from, m: mv.m, p: mv.p, to: mv.to });
  }
  out.ghosts.reverse();
  for (const [id, a] of Object.entries(rec.actual || {})) {
    if (!openTimed.has(id)) continue;
    if (a.o === "skipped") out.marks.set(id, "skipped");
    else if (a.o === "partly") out.marks.set(id, "partly");
  }
  return out;
}
