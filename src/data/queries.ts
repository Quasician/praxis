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

export const useStatus = () => useQuery({ queryKey: qk.status, queryFn: () => api<{ connected: boolean }>("/api/status"), staleTime: Infinity, refetchOnWindowFocus: false });

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

export const useCompleted = (enabled: boolean) => useQuery({
  queryKey: qk.completed, enabled, staleTime: 60_000,
  queryFn: async () => {
    const since = addDays(startOfToday(), -HISTORY_DAYS).toISOString(), until = new Date(Date.now() + 60_000).toISOString();
    try {
      return await fetchAll<Task>(`/tasks/completed/by_completion_date?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`);
    } catch { return [] as Task[]; }
  },
});

export const projectMap = (ps: Project[] | undefined) => new Map((ps || []).map((p) => [p.id, p]));
export const inboxOf = (ps: Project[] | undefined) => (ps || []).find((p) => p.inbox_project || p.is_inbox_project) || (ps || []).find((p) => p.name === "Inbox");

/** Refetch everything the Day view shows. */
export function refreshAll(force = false) {
  if (force) calendarRefresh.force = true;
  return Promise.all([qk.projects, qk.today, qk.inbox, ["events"]].map((k) => queryClient.invalidateQueries({ queryKey: k })));
}
