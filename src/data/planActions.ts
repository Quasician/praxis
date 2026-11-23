// Proposing, adjusting and accepting the auto-planner's plan.
import { itemUpdate, sync } from "../lib/api";
import { timedDue } from "../lib/tasks";
import type { Config, Task } from "../lib/types";
import { buildPlan, plannerCfg } from "../domain/planner";
import { triageItems } from "../domain/triage";
import { queryClient, qk } from "./queries";
import { reconcileSoon } from "./actions";
import { toast, useUi } from "../state/ui";
import { fetchAll } from "../lib/api";
import type { EventsResult } from "./queries";

function inputs() {
  const config = queryClient.getQueryData<Config>(qk.config) || {};
  const today = queryClient.getQueryData<Task[]>(qk.today) || [];
  const eventsData = queryClient.getQueriesData<EventsResult>({ queryKey: ["events"] }).map(([, d]) => d).find(Boolean);
  const memory = config.taskMemory || {};
  return {
    cfg: plannerCfg(config), today,
    events: eventsData?.events || [],
    tray: new Set(triageItems(today, memory).map((x) => x.task.id)),
    slips: (id: string) => (memory[id] && memory[id].moves) || 0,
  };
}

/** Make sure we know about milestones (all open tasks) before planning; skip quietly if that fails. */
async function activeTasks(): Promise<Task[]> {
  const cached = queryClient.getQueryData<Task[]>(qk.active);
  const state = queryClient.getQueryState(qk.active);
  if (cached && state && Date.now() - state.dataUpdatedAt < 5 * 60_000) return cached;
  try {
    return await queryClient.fetchQuery({ queryKey: qk.active, queryFn: async () => (await fetchAll<Task>("/tasks")).filter((t) => !t.checked && !t.is_deleted) });
  } catch { return cached || []; }
}

export async function computePlan(reshuffle = false) {
  const ui = useUi.getState();
  const seed = reshuffle ? (ui.plan.seed || 7) * 31 + 17 : 0;
  const plan = buildPlan({ ...inputs(), active: await activeTasks(), seed });
  return { ...plan, seed };
}

export async function proposePlan(reshuffle = false) {
  const ui = useUi.getState();
  ui.setView("day");
  const plan = await computePlan(reshuffle);
  if (!plan.items.length && !plan.unplaced.length) {
    useUi.getState().clearPlan();
    toast(plan.freeMin ? "Nothing left to plan today. Everything already has a time." : "No free time left in today's planning window.");
    return;
  }
  useUi.getState().setPlan({ ...plan, active: true });
}

export const discardPlan = () => useUi.getState().clearPlan();

/** Move/resize a proposed block, or (remove = true) take it out of the plan. */
export function adjustProposal(idx: number, target: { start: number; dur: number } | null, remove: boolean) {
  const { plan, setPlan } = useUi.getState();
  const items = plan.items.slice();
  const it = items[idx];
  if (!it) return;
  if (remove) {
    items.splice(idx, 1);
    setPlan({ items, unplaced: [it, ...plan.unplaced] });
  } else if (target) {
    items[idx] = { ...it, start: target.start, dur: target.dur };
    items.sort((a, b) => a.start - b.start);
    setPlan({ items });
  }
}

export async function acceptPlan() {
  const items = useUi.getState().plan.items.slice();
  if (!items.length) return discardPlan();
  const commands = items.map((it) => itemUpdate({ id: it.task.id, due: timedDue(it.task, new Date(), it.start), duration: { amount: it.dur, unit: "minute" } }));
  try {
    const rejected = await sync(commands);
    discardPlan();
    toast(rejected.length
      ? `Planned ${commands.length - rejected.length} of ${commands.length}. Todoist rejected ${rejected.length}.`
      : `Planned ${commands.length} block${commands.length > 1 ? "s" : ""}. Your phone will remind you as each one starts.`);
  } catch (e) {
    toast(`Couldn't save the plan: ${(e as Error).message}`);
    return;
  }
  reconcileSoon(0);
}
