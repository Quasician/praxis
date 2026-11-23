// Todoist, calendar and settings data, cached and kept fresh by TanStack Query.
import { QueryClient, useQuery } from "@tanstack/react-query";
import { api, fetchAll } from "../lib/api";
import { addDays, startOfToday } from "../lib/dates";
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
const SYNC_EVERY = 120_000;

export const useStatus = () => useQuery({ queryKey: qk.status, queryFn: () => api<{ connected: boolean; claude?: boolean }>("/api/status"), staleTime: Infinity, refetchOnWindowFocus: false });

export const useProjects = (enabled: boolean) => useQuery({
  queryKey: qk.projects, enabled, refetchInterval: SYNC_EVERY,
  queryFn: () => fetchAll<Project>("/projects"),
});

export const useToday = (enabled: boolean) => useQuery({
  queryKey: qk.today, enabled, refetchInterval: SYNC_EVERY,
  queryFn: async () => open(await fetchAll<Task>(`/tasks/filter?query=${encodeURIComponent("today | overdue")}`)),
});

export const useInbox = (inboxId: string | undefined) => useQuery({
  queryKey: qk.inbox, enabled: !!inboxId, refetchInterval: SYNC_EVERY,
  queryFn: async () => open(await fetchAll<Task>(`/tasks?project_id=${encodeURIComponent(inboxId!)}`)),
});

/** Set to true by a manual refresh, so the next calendar fetch skips the 5-minute cache. */
export const calendarRefresh = { force: false };
export interface EventsResult { events: CalEvent[]; errors: { name: string; error: string }[]; calendars: number }
export function useEvents(enabled: boolean, from = startOfToday(), to = addDays(startOfToday(), 1)) {
  const f = from.toISOString(), t = to.toISOString();
  return useQuery({
    queryKey: qk.events(f, t), enabled, refetchInterval: SYNC_EVERY,
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
  queryKey: qk.active, enabled, refetchInterval: 10 * 60_000, staleTime: 60_000,
  queryFn: async () => open(await fetchAll<Task>("/tasks")),
});

/** Everything finished in the last ~3 months (plus repeating-task ticks from the activity log). */
export async function fetchCompleted(): Promise<Task[]> {
    const since = addDays(startOfToday(), -HISTORY_DAYS).toISOString(), until = new Date(Date.now() + 60_000).toISOString();
    let done: Task[] = [];
    try { done = await fetchAll<Task>(`/tasks/completed/by_completion_date?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`); } catch { /* offline: show what we can */ }
    return [...done, ...(await recurringCompletions(done))];
  }

export const useCompleted = (enabled: boolean) => useQuery({ queryKey: qk.completed, enabled, staleTime: 60_000, queryFn: fetchCompleted });

export const projectMap = (ps: Project[] | undefined) => new Map((ps || []).map((p) => [p.id, p]));
export const inboxOf = (ps: Project[] | undefined) => (ps || []).find((p) => p.inbox_project || p.is_inbox_project) || (ps || []).find((p) => p.name === "Inbox");

/** Refetch everything the Day view shows. */
export function refreshAll(force = false) {
  if (force) calendarRefresh.force = true;
  return Promise.all([qk.projects, qk.today, qk.inbox, ["events"]].map((k) => queryClient.invalidateQueries({ queryKey: k })));
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
