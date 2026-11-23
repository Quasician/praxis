// One hook that gathers what most screens need.
import { useMemo } from "react";
import { inboxOf, projectMap, useConfig, useEvents, useInbox, useProjects, useStatus, useToday } from "./queries";
import { plannerCfg } from "../domain/planner";
import { triageItems } from "../domain/triage";
import type { Task } from "../lib/types";

const NONE: Task[] = [];

export function useData() {
  const status = useStatus();
  const connected = !!status.data?.connected;
  const projectsQ = useProjects(connected);
  const inboxProject = inboxOf(projectsQ.data);
  const todayQ = useToday(connected);
  const inboxQ = useInbox(inboxProject?.id);
  const eventsQ = useEvents(connected);
  const configQ = useConfig(connected);

  const today = todayQ.data || NONE;
  const memory = configQ.data?.taskMemory;
  const tray = useMemo(() => triageItems(today, memory || {}), [today, memory]);
  const trayIds = useMemo(() => new Set(tray.map((x) => x.task.id)), [tray]);
  const projects = useMemo(() => projectMap(projectsQ.data), [projectsQ.data]);

  return {
    status, connected,
    projectsQ, projects, inboxProject,
    todayQ, today, inboxQ, inbox: inboxQ.data || NONE,
    eventsQ, events: eventsQ.data?.events || [],
    configQ, config: configQ.data, cfg: plannerCfg(configQ.data),
    tray, trayIds,
    slips: (id: string) => (memory && memory[id] && memory[id].moves) || 0,
    loading: todayQ.isPending || projectsQ.isPending,
  };
}

/** Today's committed tasks (★), from the plan you accepted or committed to this morning. */
export function useCommitted(): Map<string, { star: boolean }> {
  const { config } = useData();
  const day = new Date();
  const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
  const planned = config?.history?.[key]?.planned || [];
  return new Map(planned.filter((p) => p.committed).map((p) => [p.id, { star: !!p.star }]));
}
