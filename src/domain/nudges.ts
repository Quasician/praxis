// When Praxis should interrupt you. Pure logic: the desktop app calls this every ~20 seconds
// and shows whatever comes back on top of everything (full-screen apps included).

export interface Reminders {
  blocks: boolean;          // when a planned block starts
  headsUp: number;          // minutes of warning before a block (0 = none)
  focusEnd: boolean;        // when a focus timer runs out
  shutdown: boolean;        // at the shut-down time
  windDown: boolean;        // at the end of your day
  timeChecks: number;       // minutes between "what time it is" checks when nothing is planned (0 = off)
  style: "overlay" | "windows";
  sound: boolean;
}

export const REMINDER_DEFAULTS: Reminders = {
  blocks: true, headsUp: 5, focusEnd: true, shutdown: true, windDown: true, timeChecks: 90, style: "overlay", sound: true,
};

export const reminderCfg = (r?: Partial<Reminders> | null): Reminders => ({ ...REMINDER_DEFAULTS, ...(r || {}) });

/** A timed task on today's timeline (epoch ms). */
export interface Slot { id: string; title: string; start: number; end: number }

export type NudgeKind = "start" | "heads-up" | "focus-end" | "shutdown" | "wind-down" | "time-check" | "test";

export interface Nudge {
  key: string;
  kind: NudgeKind;
  title: string;
  body: string;
  at: number;          // the moment it's about (block start, shut-down time…), epoch ms
  taskId?: string;
  sticky: boolean;     // stays (as a small pill) until you answer it
}

export interface NudgeInput {
  now: Date;
  slots: Slot[];
  r: Reminders;
  shutdownAt: string;          // "21:00"
  windDownAt: string;          // "21:30" (the end of your day)
  shutdownDone: boolean;       // already shut down today
  focus?: { taskId: string; content: string; startedAt: string; minutes: number } | null;
  lastNudgeAt: number;         // when anything was last shown
  activeSince: number;         // when you last came back to the computer
}

const MIN = 60_000;
const START_GRACE = 3 * MIN;    // a block-start reminder is only worth showing in its first 3 minutes
const EVENING_GRACE = 45 * MIN; // shut-down / wind-down still help if the computer was asleep at the time

const at = (now: Date, hhmm: string) => {
  const [h, m] = (hhmm || "0:0").split(":").map(Number);
  const d = new Date(now); d.setHours(h || 0, m || 0, 0, 0);
  return d.getTime();
};
const ymd = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
export const clockText = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const mins = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}h${n % 60 ? ` ${n % 60}m` : ""}` : `${n} min`);

/** Plain text for a task title (Todoist markdown links and bold stripped). */
export const plainTitle = (s: string) => s.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`]/g, "").trim();

export function dueNudges(input: NudgeInput, sent: Set<string>): Nudge[] {
  const { now, r } = input;
  const t = now.getTime(), day = ymd(now), out: Nudge[] = [];
  const push = (n: Nudge) => { if (!sent.has(n.key)) out.push(n); };
  const slots = [...input.slots].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);

  for (const s of slots) {
    const len = Math.round((s.end - s.start) / MIN);
    if (r.blocks && t >= s.start && t < s.start + START_GRACE) {
      push({ key: `start:${s.id}:${s.start}`, kind: "start", title: s.title, body: `Starts now · ${mins(len)}, until ${clockText(s.end)}`, at: s.start, taskId: s.id, sticky: true });
    }
    if (r.blocks && r.headsUp > 0 && t >= s.start - r.headsUp * MIN && t < s.start) {
      const left = Math.max(1, Math.ceil((s.start - t) / MIN));
      push({ key: `heads-up:${s.id}:${s.start}`, kind: "heads-up", title: s.title, body: `Starts in ${mins(left)}, at ${clockText(s.start)}. Time to find a stopping point.`, at: s.start, taskId: s.id, sticky: false });
    }
  }

  const f = input.focus;
  if (r.focusEnd && f) {
    const end = Date.parse(f.startedAt) + f.minutes * MIN;
    if (t >= end && t < end + 30 * MIN) {
      push({ key: `focus-end:${f.taskId}:${f.startedAt}:${f.minutes}`, kind: "focus-end", title: plainTitle(f.content), body: `Your ${mins(f.minutes)} are up. Done, a few more minutes, or move on?`, at: end, taskId: f.taskId, sticky: true });
    }
  }

  const shut = at(now, input.shutdownAt);
  if (r.shutdown && !input.shutdownDone && t >= shut && t < shut + EVENING_GRACE) {
    push({ key: `shutdown:${day}`, kind: "shutdown", title: "Time to shut down the day", body: "Two minutes: what got done, a home for the leftovers, a look at tomorrow.", at: shut, sticky: true });
  }
  const wind = at(now, input.windDownAt);
  if (r.windDown && t >= wind && t < wind + EVENING_GRACE) {
    push({ key: `wind-down:${day}`, kind: "wind-down", title: "Wind down", body: "Your day ends now. Save your work, dim the screen, and let tomorrow handle the rest.", at: wind, sticky: true });
  }

  // Time checks break up hyperfocus: only when nothing is planned right now and you've been at it a while.
  const busy = slots.some((s) => t >= s.start - 10 * MIN && t < s.end) || (f && t < Date.parse(f.startedAt) + f.minutes * MIN);
  const every = r.timeChecks * MIN;
  if (r.timeChecks > 0 && !busy && !out.length && t - input.lastNudgeAt >= every && t - input.activeSince >= every) {
    const next = slots.find((s) => s.start > t);
    const sinceH = Math.floor((t - input.activeSince) / MIN);
    push({
      key: `time-check:${Math.floor(t / every)}`, kind: "time-check", title: `It's ${clockText(t)}`,
      body: `You've been going for ${mins(sinceH)}.${next ? ` Next: ${next.title} at ${clockText(next.start)}.` : " Nothing else is planned today."} Stretch, drink some water?`,
      at: t, sticky: false,
    });
  }

  const order: NudgeKind[] = ["start", "focus-end", "shutdown", "wind-down", "heads-up", "time-check", "test"];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

export function testNudge(now = new Date()): Nudge {
  return { key: `test:${now.getTime()}`, kind: "test", title: "This is how reminders look", body: "They appear on top of everything, even full-screen apps, without stealing your keyboard.", at: now.getTime(), sticky: true };
}
