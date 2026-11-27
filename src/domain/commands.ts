// 5.0 The command bar: what you type, in plain words, turned into one action. Most sentences are read right here, with no
// network: "move groceries to 4", "push the report 30 min", "skip gym, too tired", "done laundry", "focus on taxes for 45 min",
// "add call mom tomorrow", "plan my day", "shutdown". Anything this can't read goes to Claude (when you've added a key),
// which answers in the same shape. Pure functions.
import type { Task } from "../lib/types";

export type Command =
  | { kind: "move"; q: string; at?: number; by?: number; day?: number }   // at: minutes from midnight; by: minutes later; day: days from today
  | { kind: "unschedule"; q: string }
  | { kind: "done"; q: string }
  | { kind: "skip"; q: string; why?: string }
  | { kind: "focus"; q: string; minutes?: number }
  | { kind: "stop" }
  | { kind: "add"; text: string }
  | { kind: "open"; what: "plan" | "morning" | "shutdown" | "review" | "settings" | "dump" | "day" | "week" | "sky" | "help" };

const NUM_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, "forty-five": 45, half: 30 };
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** "45 min", "1h", "1.5 hours", "an hour", "half an hour", "90" → minutes. */
export function parseSpan(s: string): number | null {
  const t = s.trim().toLowerCase();
  if (/^half an? hour$/.test(t)) return 30;
  const m = t.match(/^(\d+(?:\.\d+)?|[a-z-]+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)?$/);
  if (!m) return null;
  const n = /^\d/.test(m[1]) ? parseFloat(m[1]) : NUM_WORDS[m[1]];
  if (n == null || !Number.isFinite(n)) return null;
  const unit = m[2] || (n <= 4 && !/^\d/.test(m[1]) ? "h" : "min");
  const mins = /^h/.test(unit) ? n * 60 : n;
  return mins > 0 && mins <= 12 * 60 ? Math.round(mins) : null;
}

/**
 * "4", "4pm", "4:30", "16:30", "noon", "9 am", "tonight", "this evening" → minutes from midnight. A bare hour means the next
 * time it comes round today (at 2 PM, "4" is 4 PM; at 9 AM, "10" is 10 AM).
 */
export function parseClock(s: string, nowMin: number): number | null {
  const t = s.trim().toLowerCase().replace(/\./g, "");
  if (t === "noon" || t === "midday") return 12 * 60;
  if (t === "tonight" || t === "this evening") return Math.max(20 * 60, Math.ceil((nowMin + 15) / 15) * 15);
  if (t === "this afternoon") return Math.max(14 * 60, Math.ceil((nowMin + 15) / 15) * 15);
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (h > 23 || min > 59) return null;
  const ap = m[3]?.[0];
  if (ap === "p" && h < 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  if (!ap && h <= 12 && !(m[1].length === 2 && m[1].startsWith("0"))) {
    // No am/pm: the next time it comes round, from now on, within waking hours.
    const am = (h % 12) * 60 + min, pm = am + 12 * 60;
    h = am >= nowMin - 30 && am >= 6 * 60 ? Math.floor(am / 60) : pm < 24 * 60 ? Math.floor(pm / 60) : Math.floor(am / 60);
    return h * 60 + min;
  }
  return h * 60 + min;
}

/** "today", "tomorrow", "monday", "next friday" → days from today (0–7); null when it isn't a day. */
export function parseDay(s: string, todayDow: number): number | null {
  const t = s.trim().toLowerCase().replace(/^next\s+/, "");
  if (t === "today") return 0;
  if (t === "tomorrow" || t === "tmrw" || t === "tmr") return 1;
  const i = DAYS.findIndex((d) => d === t || d.slice(0, 3) === t);
  if (i < 0) return null;
  const d = (i - todayDow + 7) % 7;
  return d === 0 ? 7 : d;
}

/** "tomorrow at 9", "friday", "4pm", "tonight", "in 30 min" → where to move a block. */
export function parseWhen(s: string, nowMin: number, todayDow: number): { at?: number; by?: number; day?: number } | null {
  const t = s.trim().toLowerCase().replace(/[.!]+$/, "");
  const inM = t.match(/^in\s+(.+)$/);
  if (inM) { const by = parseSpan(inM[1]); return by ? { by } : null; }
  const clock = parseClock(t, nowMin);
  if (clock != null) return { at: clock };
  const parts = t.match(/^(.+?)(?:\s+at\s+|\s+@\s*|\s+)(.+)$/);
  if (parts) {
    const day = parseDay(parts[1], todayDow), at = parseClock(parts[2], day ? 0 : nowMin);
    if (day != null && at != null) return { day, at };
    const day2 = parseDay(parts[2], todayDow), at2 = parseClock(parts[1], 0);
    if (day2 != null && at2 != null) return { day: day2, at: at2 };
  }
  const day = parseDay(t, todayDow);
  return day != null ? { day } : null;
}

const OPEN: [RegExp, Extract<Command, { kind: "open" }>["what"]][] = [
  [/^(plan( my| the)? day|plan today|fill (my )?day)$/, "plan"], [/^(morning|commit|morning commit|start (my|the) day)$/, "morning"],
  [/^(shut ?down|end (my|the) day|wrap up|evening)$/, "shutdown"], [/^((weekly )?review|review (my|the) week)$/, "review"],
  [/^(settings|preferences|options)$/, "settings"], [/^(brain ?dump|dump)$/, "dump"], [/^(help|shortcuts|keys)$/, "help"],
  [/^(show )?(the )?(day|today)$/, "day"], [/^(show )?(the )?week$/, "week"], [/^(show )?(the )?sky$/, "sky"],
];

/** Reads a sentence; null when it isn't one of the shapes above (then Claude gets a go). */
export function parseCommand(input: string, nowMin: number, todayDow: number): Command | null {
  const raw = input.trim().replace(/\s+/g, " ");
  const t = raw.toLowerCase().replace(/[.!?]+$/, "");
  if (!t) return null;
  for (const [re, what] of OPEN) if (re.test(t)) return { kind: "open", what };
  if (/^(stop|stop (the )?(timer|focus(ing)?)|end focus|cancel (the )?timer)$/.test(t)) return { kind: "stop" };

  let m = t.match(/^(?:add|new task|todo|remind me to|capture)\s*:?\s+(.+)$/);
  if (m) return { kind: "add", text: raw.slice(raw.length - m[1].length) };

  m = t.match(/^(?:done|finish(?:ed)?|complete(?:d)?|tick(?: off)?|check(?: off)?|mark)\s+(.+?)(?:\s+(?:as\s+)?(?:done|complete|finished))?$/) || t.match(/^(.+?)\s+(?:is\s+)?(?:done|finished)$/);
  if (m) return { kind: "done", q: m[1] };

  m = t.match(/^(?:skip|drop|not doing|won'?t do|cancel)\s+(.+?)(?:\s*[,;:–—-]\s*|\s+because\s+|\s+(?:cause|cuz|since)\s+)(.+)$/);
  if (m) return { kind: "skip", q: m[1], why: raw.slice(raw.length - m[2].length).replace(/[.!]+$/, "") };
  m = t.match(/^(?:skip|drop|not doing|won'?t do)\s+(.+)$/);
  if (m) return { kind: "skip", q: m[1] };

  m = t.match(/^(?:focus(?: on)?|start|work on|begin|let'?s do)\s+(.+?)(?:\s+for\s+(.+))?$/);
  if (m) { const minutes = m[2] ? parseSpan(m[2]) ?? undefined : undefined; if (!m[2] || minutes) return { kind: "focus", q: m[1], ...(minutes ? { minutes } : {}) }; }

  m = t.match(/^(?:unschedule|clear (?:the )?time (?:for|on)|take (.+?) off (?:the|my) day)\s*(.*)$/);
  if (m) { const q = (m[1] || m[2] || "").trim(); if (q) return { kind: "unschedule", q }; }

  m = t.match(/^(?:push|delay|bump|postpone|move)\s+(.+?)\s+(?:back\s+|by\s+|later\s+by\s+)?((?:\d+(?:\.\d+)?|an?|half an?|one|two|three|ten|fifteen|twenty|thirty|forty-five)\s*(?:m|min|mins|minutes?|h|hrs?|hours?))(?:\s+later)?$/);
  if (m) { const by = parseSpan(m[2]); if (by) return { kind: "move", q: m[1], by }; }

  m = t.match(/^(?:move|put|shift|reschedule|schedule|push|do|plan|set)\s+(.+?)\s+(?:to|at|for|until|on|@)\s+(.+)$/) || t.match(/^(?:move|push|reschedule|do|put)\s+(.+?)\s+((?:to)?(?:morrow|tomorrow|tonight|today|next \w+|(?:mon|tues|wednes|thurs|fri|satur|sun)day))$/);
  if (m) { const w = parseWhen(m[2], nowMin, todayDow); if (w) return { kind: "move", q: m[1], ...w }; }
  m = t.match(/^(.+?)\s+(?:at|@)\s+(.+)$/);
  if (m) { const w = parseWhen(m[2], nowMin, todayDow); if (w && w.at != null) return { kind: "move", q: m[1], ...w }; }
  return null;
}

// ---------- finding the task you meant ----------
const STOP = new Set(["the", "a", "an", "my", "to", "for", "of", "on", "in", "and", "with", "task", "block", "it", "this", "that"]);
const words = (s: string) => s.toLowerCase().replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
const stem = (w: string) => w.replace(/(ies|es|s|ing|ed)$/, "");

/** How well a task's title matches what you typed (0–1): the share of your words found in it, prefix matches counting. */
export function matchScore(q: string, title: string): number {
  const qw = words(q).map(stem), tw = words(title).map(stem);
  if (!qw.length || !tw.length) return 0;
  let hit = 0;
  for (const w of qw) if (tw.some((x) => x === w || (w.length >= 3 && x.startsWith(w)) || (x.length >= 4 && w.startsWith(x)))) hit++;
  return hit / qw.length;
}

/**
 * The task you meant: today's list first (a block happening now or soon wins a tie), then the rest of your open tasks.
 * Returns one task, several to choose from (when it's a close call), or none.
 */
export function findTask(q: string, today: Task[], others: Task[], nowMin: number, startOf: (t: Task) => number | null): { task?: Task; choices: Task[] } {
  const seen = new Set<string>();
  const scored: { t: Task; s: number }[] = [];
  for (const [list, bonus] of [[today, 0.15], [others, 0]] as const) {
    for (const t of list) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      const s = matchScore(q, t.content);
      if (s < 0.5) continue;
      const st = startOf(t);
      const near = st == null ? 0 : Math.max(0, 0.1 - Math.abs(st - nowMin) / 3000);
      scored.push({ t, s: s + bonus + near });
    }
  }
  scored.sort((a, b) => b.s - a.s);
  if (!scored.length) return { choices: [] };
  const close = scored.filter((x) => scored[0].s - x.s < 0.08).slice(0, 4);
  return close.length === 1 ? { task: close[0].t, choices: [] } : { choices: close.map((x) => x.t) };
}
