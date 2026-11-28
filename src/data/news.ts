// 5.0 What's new, in a few plain lines per version, shown once in the app after an update (instead of a link out).
// Newest first. Keep each line short: what you'll notice, not how it was built.

export interface News { v: string; title: string; lines: string[] }

export const NEWS: News[] = [
  { v: "5.1.0", title: "The living sky", lines: [
    "Your wallpaper is now a living sky: the real sun, moon and stars over Milpitas, the real weather, and the motto fitted in between.",
    "Your projects shine as gold constellations, and everything you finished this year glows along the horizon.",
    "Switching windows no longer lags: the moving wallpaper draws one picture a minute instead of redrawing all the time.",
  ] },
  { v: "5.0.1", title: "The block gate holds", lines: [
    "When a block's full-screen card is up, Alt+Tab (or clicking anywhere else) can't send it away: it comes straight back until you start, move or skip.",
    "If it ever gets stuck, the tray menu's “Close the block gate” still closes it.",
    "Quitting Praxis, or restarting for an update, now works even while the gate or the lock card is up.",
  ] },
  { v: "5.0.0", title: "Your day, as it happened", lines: [
    "Finished blocks stay on the day, ticked; a block you moved after its time leaves a faint outline pointing to its new time.",
    "One thing asks at a time: check-ins, notes and reminders take turns, and several ended blocks are asked about in one card.",
    "Press / (or Ctrl+K) and type what you want: “move groceries to 4”, “skip the report, too tired”, “focus on taxes for 45 min”.",
    "All settings in one place (⋯ → Settings), with a search box.",
  ] },
  { v: "4.7.0", title: "The block gate and the focus lock", lines: [
    "When a block starts, a full-screen card asks you to start, move or skip it.",
    "While you focus, Firefox, Steam and Reddit are out of reach; unlocking early takes a minute and is noted.",
  ] },
  { v: "4.6.0", title: "In step with Todoist", lines: [
    "Ticks made on your phone or the web show up within a minute; what you finished today is listed under Today.",
    "When a block ends, Praxis asks how it went and how long it really took.",
  ] },
  { v: "4.5.0", title: "Overlapping blocks", lines: ["Blocks at the same time sit side by side everywhere, the top strip included."] },
];

const parts = (v: string) => v.split(/[.-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0);
export function newer(a: string, b: string): boolean {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/** What's new since the version you last saw (up to `current`), newest first, at most three versions. */
export function newsSince(seen: string | undefined, current: string): News[] {
  if (!seen) return [];
  return NEWS.filter((n) => newer(n.v, seen) && !newer(n.v, current)).slice(0, 3);
}
