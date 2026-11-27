// 5.0 One thing asking at a time. Praxis has several things that want your attention: the check-in when blocks end, the
// note about yesterday's leftovers, what's new after an update. In the app they take turns in one spot, most important
// first, and wait while a ritual (morning, shutdown, review…) is open. On the desktop, reminders take turns the same way
// (electron/main.ts): one at a time, gentle ones spaced out, nothing while the block gate is up.

export type AskKind = "check-in" | "heal-note" | "whats-new";
export const ASK_ORDER: AskKind[] = ["check-in", "heal-note", "whats-new"];

/** Which ask shows now (null: none, or held while a ritual is open), and how many wait behind it. */
export function pickAsk(due: Partial<Record<AskKind, boolean>>, hold = false): { now: AskKind | null; waiting: number } {
  const list = ASK_ORDER.filter((k) => due[k]);
  if (hold || !list.length) return { now: null, waiting: hold ? list.length : 0 };
  return { now: list[0], waiting: list.length - 1 };
}

/** Desktop reminders: the kinds that can wait their turn (the others are tied to a moment and go first). */
export const GENTLE = new Set(["heads-up", "time-check", "block-end", "wind-down"]);
export const GENTLE_GAP = 90_000;   // at least this long between two gentle reminders

/** Which reminder to show now, given what's due, whether you're looking at Praxis, and when the last one showed. */
export function pickNudge<T extends { kind: string }>(list: T[], o: { looking: boolean; gateOpen: boolean; sinceLast: number }): { show: T | null; settle: T[] } {
  // Looking at Praxis already: the gentle ones are answered in the app, so they're settled without showing.
  const settle = o.looking ? list.filter((n) => GENTLE.has(n.kind)) : [];
  if (o.gateOpen) return { show: null, settle };
  const rest = list.filter((n) => !settle.includes(n));
  const first = rest.find((n) => !GENTLE.has(n.kind)) || rest[0] || null;
  if (first && GENTLE.has(first.kind) && o.sinceLast < GENTLE_GAP) return { show: null, settle };
  return { show: first, settle };
}
