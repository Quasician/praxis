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
