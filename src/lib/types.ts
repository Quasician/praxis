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
  morningCommit: boolean;      // open the one-minute morning commit instead of a bare plan
  learn: boolean;              // schedule Deep work in your best hours, scale durations to reality
}

export interface CalendarSetting { id: string; name: string; url: string; color: string; enabled?: boolean }
export interface TaskMemory { due: string; moves: number }

/** What the plan held on a day (for the Progress view and adaptive planning). */
export interface PlannedItem { id: string; content: string; wp: number; project: string; committed: boolean; star?: boolean; tiny?: string }
export type Energy = "full" | "low" | "slammed";
export interface DayRecord {
  planned: PlannedItem[];
  committedAt?: string;
  shutdown?: boolean;
  energy?: Energy;
  tinyDone?: string[];                      // tasks whose tiny version you did today (counts as done for the day)
  star?: { id: string; prevPriority: number }; // "the one" was raised to p1 in Todoist; put back the next morning
}
/** A finished focus session: how long a task really took vs. its estimate. */
export interface Sample { wp: number; est: number; actual: number; at: string }
export interface Focus { taskId: string; content: string; startedAt: string; minutes: number }

export interface Appearance { theme?: "auto" | "dark" | "light"; warmEvenings?: boolean; focus?: boolean }

export interface Config {
  areas?: Area[];
  planner?: Partial<PlannerSettings>;
  calendars?: CalendarSetting[];
  taskMemory?: Record<string, TaskMemory>;
  history?: Record<string, DayRecord>;
  samples?: Sample[];
  focus?: Focus | null;
  tiny?: Record<string, string>;            // task id → its 2-minute version
  lastOpen?: string;                        // ymd Praxis was last opened (for the fresh start)
  ui?: Appearance;
  reminders?: Partial<import("../domain/nudges").Reminders>;
  lastSeenVersion?: string;
  [key: string]: unknown;
}

export interface SyncCommand { type: string; uuid: string; temp_id?: string; args: Record<string, unknown> }
