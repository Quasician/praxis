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
}

export interface CalendarSetting { id: string; name: string; url: string; color: string; enabled?: boolean }
export interface TaskMemory { due: string; moves: number }

export interface Config {
  areas?: Area[];
  planner?: Partial<PlannerSettings>;
  calendars?: CalendarSetting[];
  taskMemory?: Record<string, TaskMemory>;
  [key: string]: unknown;
}

export interface SyncCommand { type: string; uuid: string; temp_id?: string; args: Record<string, unknown> }
