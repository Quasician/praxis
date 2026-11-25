// Proposing, adjusting and accepting the auto-planner's plan.
import { itemUpdate, sync } from "../lib/api";
import { timedDue } from "../lib/tasks";
import type { Config, Task } from "../lib/types";
import { buildPlan, plannerCfg } from "../domain/planner";
import { effectiveFill, learn, recordPlan } from "../domain/progress";
import { bands, capacity, recordDays, weakHours } from "../domain/record";
import { willpower } from "../lib/tasks";
import { ymd } from "../lib/dates";
import { plain } from "../lib/text";
import { updateConfig } from "./actions";
import { triageItems } from "../domain/triage";
import { fetchCompleted, queryClient, qk } from "./queries";
import { reconcileSoon } from "./actions";
import { toast, useUi } from "../state/ui";
import { fetchAll } from "../lib/api";
import type { EventsResult } from "./queries";

function inputs() {
  const config = queryClient.getQueryData<Config>(qk.config) || {};
  const today = queryClient.getQueryData<Task[]>(qk.today) || [];
  const eventsData = queryClient.getQueriesData<EventsResult>({ queryKey: ["events"] }).map(([, d]) => d).find(Boolean);
  const memory = config.taskMemory || {};
  const cfg = plannerCfg(config);
  const completed = queryClient.getQueryData<Task[]>(qk.completed) || [];
  const fx = effectiveFill(cfg, config, completed);
  const energy = config.history?.[ymd(new Date())]?.energy || "full";
  const fill = energy === "low" ? Math.min(fx.fill, 40) : fx.fill;
  const why = energy === "low" ? "a low-energy day: light work and tiny versions" : energy === "slammed" ? "a slammed day: one small thing" : fx.why;
  // Tiny versions: Claude's, else a plain "5 minutes of …" for habits and Deep work.
  const tiny: Record<string, string> = {};
  for (const t of today) if (t.due?.is_recurring || willpower(t, cfg) === 3) tiny[t.id] = `Just 5 minutes: ${plain(t.content)}`;
  Object.assign(tiny, config.tiny || {});
  // 4.0: what the record says about a day like today.
  const active = queryClient.getQueryData<Task[]>(qk.active) || [];
  const cap = capacity(recordDays(config, completed, active), cfg);
  const weak = weakHours(bands(config, completed));
  const resting = new Set(Object.entries(config.sky?.cons || {}).filter(([, c]) => c.rest && !c.finished).map(([id]) => id));
  return {
    cfg, today, fill, fillWhy: why, energy, tiny,
    capacityMin: cap?.min ?? null, capacityDays: cap?.days ?? 0, weakFrom: weak?.from ?? null, resting,
    learned: learn(cfg, config.samples, completed),
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
  await queryClient.ensureQueryData({ queryKey: qk.completed, queryFn: fetchCompleted }).catch(() => undefined); // for adaptive fill + learning
  const inp = inputs();
  const plan = buildPlan({ ...inp, active: await activeTasks(), seed });
  const learns = inp.cfg.learn && inp.energy === "full";
  return { ...plan, seed, fillWhy: inp.fillWhy, capacityMin: learns ? inp.capacityMin : null, capacityDays: inp.capacityDays, weakFrom: learns ? inp.weakFrom : null, weakAll: !!plan.weakAll };
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

/** Saves the plan's times to Todoist and remembers what was planned (and committed) today. */
export async function acceptPlan(opts: { committed?: boolean } = {}) {
  const items = useUi.getState().plan.items.slice();
  if (!items.length) return discardPlan();
  const cfg = plannerCfg(queryClient.getQueryData<Config>(qk.config));
  const day = ymd(new Date());
  updateConfig((c) => ({
    ...c,
    history: recordPlan(c.history, day, items.map((it) => ({
      id: it.task.id, content: it.task.content, wp: willpower(it.task, cfg), project: it.task.project_id, committed: !!it.committed, ...(it.star ? { star: true } : {}), ...(it.tiny ? { tiny: it.tiny } : {}), min: it.dur, start: it.start,
    })), opts.committed),
  })).catch(() => undefined);
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
