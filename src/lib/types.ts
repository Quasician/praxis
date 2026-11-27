// Shapes of the data Praxis works with (Todoist API v1 + Praxis settings).

export interface Due {
  date: string;              // "2026-11-22" or "2026-11-22T19:00:00" (floating) or with Z
  datetime?: string;
  string?: string;           // e.g. "every day at 8am"
  is_recurring?: boolean;
  timezone?: string | null;
  lang?: string;
}
export interface Duration { amount: number; unit: "minute" | "day" }

export interface Task {
  id: string;
  content: string;
  description?: string;
  project_id: string;
  parent_id?: string | null;
  priority: number;          // 4 = p1 (urgent) … 1 = p4
  due: Due | null;
  deadline?: { date: string } | null;
  duration?: Duration | null;
  labels?: string[];
  child_order?: number;
  checked?: boolean;
  is_deleted?: boolean;
  completed_at?: string;
  added_at?: string;
  recurring?: boolean;       // a completion of a repeating task (from the activity log)
}

export interface Project {
  id: string;
  name: string;
  color: string;
  inbox_project?: boolean;
  is_inbox_project?: boolean;
  is_archived?: boolean;
}

export interface CalEvent {
  uid?: string;
  title: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  date?: string;
  endDate?: string;
  transparent: boolean;
  calendarId?: string;
  calendar?: string;
  color?: string;
}

export interface Area { id: string; name: string; color: string; projects: string[] }

export interface PlannerSettings {
  auto: boolean;
  dayStart: string;
  dayEnd: string;
  workDays: number[];
  workStart: string;
  workEnd: string;
  afterWork: number;
  gap: number;
  keepFree: number;
  milestoneSteps: number;
  deepLabel: string;
  lightLabel: string;
  lastAuto: string | null;
  weeklyAuto: boolean;
  weeklyDay: number;
  lastWeekPlan: string | null;
  lastWeekPrompt: string | null;
  shutdownAt: string;          // "21:00": when the shut-down reminder appears
  lastShutdown: string | null; // ymd of the last day closed
  fill: number;                // % of free time the daily plan fills (starting point; adapts)
  adaptive: boolean;           // nudge `fill` up or down with your recent completion rate
  commitCount: number;         // tasks you commit to each day (at most one Deep); the rest are bonus
  selfHeal?: boolean;          // 3.6: re-home leftovers by itself when a shutdown was skipped (asked once)
  healedOn?: string;
  healNote?: { day: string; moves: { id: string; title: string; from: Due | null; to: string }[]; undone?: boolean; seen?: boolean } | null;
  chime?: import("../domain/rewards").ScaleName; // 3.7: a note on each completion, in this scale ("off" by default)
  sundayLetter?: boolean;      // 3.7: a short weekly letter from Claude on Sundays (on unless switched off)
  morningCommit: boolean;      // open the one-minute morning commit instead of a bare plan
  learn: boolean;              // schedule Deep work in your best hours, scale durations to reality
}

export interface CalendarSetting { id: string; name: string; url: string; color: string; enabled?: boolean }
export interface TaskMemory { due: string; moves: number }

/** What the plan held on a day (for the Progress view and adaptive planning). */
/** min and start (4.0): the block's length and its start (minutes of the day), so the record can be read in hours and by time of day. */
export interface PlannedItem { id: string; content: string; wp: number; project: string; committed: boolean; star?: boolean; tiny?: string; min?: number; start?: number }
export type Energy = "full" | "low" | "slammed";
export interface DayRecord {
  planned: PlannedItem[];
  committedAt?: string;
  shutdown?: boolean;
  energy?: Energy;
  tinyDone?: string[];                      // tasks whose tiny version you did today (counts as done for the day)
  star?: { id: string; prevPriority: number }; // "the one" was raised to p1 in Todoist; put back the next morning
  actual?: Record<string, import("../domain/actuals").Actual>; // 4.6: how each block went when it ended, by task id
  unlocked?: { id: string; what: string; at: string }[];       // 4.7: focus locks you lifted early
  seen?: Record<string, import("../domain/trace").Seen>;       // 5.0: where today's blocks sat
  moves?: import("../domain/trace").Move[];                     // 5.0: blocks moved once their time had come
  gate?: { id: string; choice: "start" | "move" | "skip"; at: string }[];  // 4.7: what you chose at each block's gate
}
/** A finished focus session: how long a task really took vs. its estimate. */
export interface Sample { wp: number; est: number; actual: number; at: string; guess?: number }
export interface Focus { taskId: string; content: string; startedAt: string; minutes: number; guess?: number;
  lock?: boolean;              // 4.7: the focus lock is on for this timer (while the setting is on)
  unlockedAt?: string | null;  // you unlocked early
}

/** canvas: the one canvas instead of the four tabs (4.1 preview; the default since 4.4, false = the tabs). */
export interface Appearance { theme?: "auto" | "dark" | "light"; warmEvenings?: boolean; focus?: boolean; dayLayout?: "horizon" | "classic"; canvas?: boolean }

export interface Config {
  areas?: Area[];
  planner?: Partial<PlannerSettings>;
  calendars?: CalendarSetting[];
  taskMemory?: Record<string, TaskMemory>;
  history?: Record<string, DayRecord>;
  samples?: Sample[];
  focus?: Focus | null;
  focusLock?: Partial<import("../domain/focuslock").FocusLockCfg>;
  tiny?: Record<string, string>;            // task id → its 2-minute version
  lastOpen?: string;                        // ymd Praxis was last opened (for the fresh start)
  ui?: Appearance;
  reminders?: Partial<import("../domain/nudges").Reminders>;
  sky?: import("../domain/sky").SkyRecord;
  lastSeenVersion?: string;
  rewards?: import("../domain/rewards").Rewards;
  letters?: Record<string, import("../domain/rewards").Letter>;
  ideas?: import("../data/ideas").Idea[];
  reviews?: Record<string, import("../domain/review").Review>;   // 4.0: the weekly review's decisions, by the week's Sunday
  [key: string]: unknown;
}

export interface SyncCommand { type: string; uuid: string; temp_id?: string; args: Record<string, unknown> }
