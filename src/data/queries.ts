// Todoist, calendar and settings data, cached and kept fresh by TanStack Query.
import { QueryClient, useQuery } from "@tanstack/react-query";
import { api, fetchAll } from "../lib/api";
import { addDays, parseDue, startOfToday } from "../lib/dates";
import type { CalEvent, Config, Project, Task } from "../lib/types";
import { HISTORY_DAYS } from "../domain/areas";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 20_000, refetchOnWindowFocus: true, retry: 1 } },
});

export const qk = {
  status: ["status"] as const,
  projects: ["projects"] as const,
  today: ["today"] as const,
  inbox: ["inbox"] as const,
  events: (from: string, to: string) => ["events", from, to] as const,
  config: ["config"] as const,
  active: ["active"] as const,
  completed: ["completed"] as const,
};

const open = (ts: Task[]) => ts.filter((t) => !t.checked && !t.is_deleted);
// 4.6: the day keeps in step with Todoist on its own. Everything refreshes every two minutes, also while the window is
// hidden behind others or minimised (the desktop app shows the strip and reminders from it), and a cheap look at Todoist's
// activity log every 30 seconds catches a change made elsewhere (a tick on your phone or the web) and refreshes at once.
export const SYNC_EVERY = 120_000;
export const WATCH_EVERY = 30_000;
const bg = { refetchInterval: SYNC_EVERY, refetchIntervalInBackground: true } as const;

export const useStatus = () => useQuery({ queryKey: qk.status, queryFn: () => api<{ connected: boolean; claude?: boolean; via?: "api" | "cli" | null }>("/api/status"), staleTime: Infinity, refetchOnWindowFocus: false });

export const useProjects = (enabled: boolean) => useQuery({
  queryKey: qk.projects, enabled, ...bg,
  queryFn: () => fetchAll<Project>("/projects"),
});

export const useToday = (enabled: boolean) => useQuery({
  queryKey: qk.today, enabled, ...bg,
  // Also ask for tomorrow, then keep what's due by tonight in *your* time: a time pinned to a time zone is
  // stored in UTC, so Todoist can file this evening's 6 PM under tomorrow.
  queryFn: async () => {
    const tonight = +startOfToday() + 864e5;
    return open(await fetchAll<Task>(`/tasks/filter?query=${encodeURIComponent("today | overdue | tomorrow")}`))
      .filter((t) => { const d = parseDue(t.due); return !!d && +d.d < tonight; });
  },
});

export const useInbox = (inboxId: string | undefined) => useQuery({
  queryKey: qk.inbox, enabled: !!inboxId, ...bg,
  queryFn: async () => open(await fetchAll<Task>(`/tasks?project_id=${encodeURIComponent(inboxId!)}`)),
});

/** Set to true by a manual refresh, so the next calendar fetch skips the 5-minute cache. */
export const calendarRefresh = { force: false };
export interface EventsResult { events: CalEvent[]; errors: { name: string; error: string }[]; calendars: number }
export function useEvents(enabled: boolean, from = startOfToday(), to = addDays(startOfToday(), 1)) {
  const f = from.toISOString(), t = to.toISOString();
  return useQuery({
    queryKey: qk.events(f, t), enabled, ...bg,
    queryFn: async () => {
      const force = calendarRefresh.force; calendarRefresh.force = false;
      try {
        return await api<EventsResult>(`/api/calendar?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}${force ? "&refresh=1" : ""}`);
      } catch (e) {
        return { events: [], errors: [{ name: "Calendar", error: (e as Error).message }], calendars: 0 } as EventsResult;
      }
    },
  });
}

export const useConfig = (enabled: boolean) => useQuery({ queryKey: qk.config, enabled, queryFn: () => api<Config>("/api/config"), staleTime: Infinity, refetchOnWindowFocus: false });

export const useActive = (enabled: boolean) => useQuery({
  queryKey: qk.active, enabled, refetchInterval: 10 * 60_000, refetchIntervalInBackground: true, staleTime: 60_000,
  queryFn: async () => open(await fetchAll<Task>("/tasks")),
});

/** Everything finished in the last ~3 months (plus repeating-task ticks from the activity log). */
export async function fetchCompleted(): Promise<Task[]> {
    const since = addDays(startOfToday(), -HISTORY_DAYS).toISOString(), until = new Date(Date.now() + 60_000).toISOString();
    let done: Task[] = [];
    try { done = await fetchAll<Task>(`/tasks/completed/by_completion_date?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`); } catch { /* offline: show what we can */ }
    return [...done, ...(await recurringCompletions(done))];
  }

// What got done feeds "Done today", the record, the streak and the sky, so it keeps up too (a tick in Todoist shows here).
export const useCompleted = (enabled: boolean) => useQuery({ queryKey: qk.completed, enabled, staleTime: 60_000, ...bg, queryFn: fetchCompleted });

export const projectMap = (ps: Project[] | undefined) => new Map((ps || []).map((p) => [p.id, p]));
export const inboxOf = (ps: Project[] | undefined) => (ps || []).find((p) => p.inbox_project || p.is_inbox_project) || (ps || []).find((p) => p.name === "Inbox");

/** Refetch everything the Day view shows. */
export function refreshAll(force = false) {
  if (force) calendarRefresh.force = true;
  return Promise.all([qk.projects, qk.today, qk.inbox, ["events"]].map((k) => queryClient.invalidateQueries({ queryKey: k })));
}

/** Refetch what Todoist holds (not the calendars): the day, the Inbox, all open tasks and what got done. */
export const refreshTodoist = () =>
  Promise.all([qk.projects, qk.today, qk.inbox, qk.active, qk.completed].map((k) => queryClient.invalidateQueries({ queryKey: k })));

/** The newest entry in Todoist's activity log, as a short mark ("" when there's none or the plan has no log). */
export async function latestActivity(): Promise<string | null> {
  try {
    const r = await api<{ results?: { id?: string; event_date?: string; object_id?: string; event_type?: string }[] }>("/api/todoist/activities?limit=1");
    const e = r?.results?.[0];
    return e ? `${e.id ?? ""}:${e.event_date ?? ""}:${e.object_id ?? ""}:${e.event_type ?? ""}` : "";
  } catch { return null; }
}

/**
 * Keeps the day in step with Todoist (4.6): every 30 seconds, also in the background, it looks at the newest activity in
 * Todoist and refreshes when anything changed, wherever the change was made. It also refreshes when the computer wakes,
 * the network comes back or the window is shown again.
 */
export function startTodoistWatch(): () => void {
  let last: string | null | undefined, busy = false;
  const look = async () => {
    if (busy) return;
    busy = true;
    try {
      const mark = await latestActivity();
      if (mark === null) return;                     // couldn't ask: the 2-minute refresh still runs
      if (last !== undefined && mark !== last) await refreshTodoist();
      last = mark;
    } finally { busy = false; }
  };
  const now = () => { refreshTodoist(); look(); };
  const onVisible = () => { if (document.visibilityState === "visible") now(); };
  look();
  const id = window.setInterval(look, WATCH_EVERY);
  window.addEventListener("online", now);
  window.addEventListener("praxis:resume", now);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.clearInterval(id);
    window.removeEventListener("online", now);
    window.removeEventListener("praxis:resume", now);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

interface Activity { object_id: string; event_date: string; parent_project_id?: string; extra_data?: { content?: string } }
const ACTIVITY_DAYS = 14;

/**
 * Todoist's completed list leaves out repeating tasks (they never really finish), so
 * "Rowing" ticked off three times wouldn't count. The activity log has every tick:
 * add those for the last two weeks (enough for "today" and "this week").
 */
async function recurringCompletions(done: Task[]): Promise<Task[]> {
  const from = addDays(startOfToday(), -ACTIVITY_DAYS).toISOString();
  let events: Activity[];
  try { events = await fetchAll<Activity>(`/activities?object_type=item&event_type=completed&date_from=${encodeURIComponent(from)}`, 100); }
  catch { return []; } // older plans may not have the activity log
  const known = new Set(done.map((t) => t.id));
  const active = queryClient.getQueryData<Task[]>(qk.active) || [];
  const byId = new Map(active.map((t) => [t.id, t]));
  return events.filter((e) => e.object_id && !known.has(e.object_id)).map((e) => {
    const t = byId.get(e.object_id);
    return {
      id: e.object_id, content: e.extra_data?.content || t?.content || "", project_id: e.parent_project_id || t?.project_id || "",
      priority: t?.priority || 1, due: null, labels: t?.labels || [], duration: t?.duration || null, completed_at: e.event_date, recurring: true,
    } as Task;
  });
}
