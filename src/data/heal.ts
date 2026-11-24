// 3.6 Never rot: self-healing days.
// Skipped yesterday's shutdown? Praxis can re-home the leftovers by itself: one-off tasks spread over the next days
// within your capacity, missed repeats back on today. A morning note lists what moved, with an undo.
// Because it changes dates while you're not looking, it asks once before it ever does this.
import { itemUpdate, sync } from "../lib/api";
import { addDays, parseDue, startOfToday, ymd } from "../lib/dates";
import { dueFor } from "../lib/tasks";
import { plain } from "../lib/text";
import type { Config, Due, Task } from "../lib/types";
import { plannerCfg } from "../domain/planner";
import { spreadTasks } from "../domain/week";
import { reconcileSoon, updateConfig } from "./actions";
import { AWAY_DAYS, daysAway, overdueNow } from "./habits";
import { queryClient, qk, type EventsResult } from "./queries";
import { toast } from "../state/ui";

export interface HealMove { id: string; title: string; from: Due | null; to: string }
export interface HealNote { day: string; moves: HealMove[]; undone?: boolean; seen?: boolean }
type HealCfg = { selfHeal?: boolean; healedOn?: string; healNote?: HealNote | null };
const healOf = (c?: Config) => ((c?.planner || {}) as HealCfg);

/** Yesterday's shutdown was skipped and there are leftovers (and you weren't away long: that's the fresh start's job). */
export function healDue(config: Config | undefined, today: Task[], now = new Date()) {
  if (!config) return [];
  const cfg = plannerCfg(config), h = healOf(config);
  const day = ymd(now), yesterday = ymd(addDays(startOfToday(), -1));
  // Only for someone who shuts down their days (at least once before), and only the morning after a missed one.
  if (!cfg.lastShutdown || h.healedOn === day || cfg.lastShutdown === yesterday || cfg.lastShutdown === day) return [];
  if (daysAway(config) >= AWAY_DAYS) return [];
  return overdueNow(today);
}

/** Moves the leftovers, saves the morning note, and returns how many moved. */
export async function heal(tasks: Task[]) {
  const config = queryClient.getQueryData<Config>(qk.config);
  const cfg = plannerCfg(config), day = ymd(new Date());
  const oneOff = tasks.filter((t) => !t.due?.is_recurring), repeats = tasks.filter((t) => t.due?.is_recurring);
  const days = Array.from({ length: 7 }, (_, i) => addDays(startOfToday(), i));
  const active = queryClient.getQueryData<Task[]>(qk.active) || [];
  const events = queryClient.getQueriesData<EventsResult>({ queryKey: ["events"] }).flatMap(([, d]) => d?.events || []);
  const pairs: [Task, string][] = [...repeats.map((t) => [t, day] as [Task, string]), ...spreadTasks(cfg, oneOff, days, active, events)];
  const moves: HealMove[] = pairs.map(([t, d]) => ({ id: t.id, title: plain(t.content).slice(0, 80), from: t.due ? { ...t.due } : null, to: d }));
  const cmds = pairs.map(([t, d]) => itemUpdate({ id: t.id, due: dueFor(t, d) }));
  for (let i = 0; i < cmds.length; i += 90) await sync(cmds.slice(i, i + 90));
  await updateConfig((c) => ({ ...c, planner: { ...(c.planner || {}), healedOn: day, healNote: { day, moves } } }));
  reconcileSoon(0);
  return moves.length;
}

/** Puts every moved task back where it was. */
export async function undoHeal() {
  const note = healOf(queryClient.getQueryData<Config>(qk.config)).healNote;
  if (!note || note.undone) return;
  const cmds = note.moves.map((m) => itemUpdate({ id: m.id, due: m.from ? { date: m.from.date, ...(m.from.is_recurring ? { string: m.from.string, is_recurring: true } : {}) } : null }));
  const bad = (await sync(cmds)).length;
  await updateConfig((c) => ({ ...c, planner: { ...(c.planner || {}), healNote: { ...note, undone: true } } }));
  toast(bad ? `Put most back; Todoist rejected ${bad}.` : `Put ${note.moves.length} task${note.moves.length === 1 ? "" : "s"} back where they were.`);
  reconcileSoon(0);
}

export async function answerHeal(on: boolean, tasks: Task[]) {
  await updateConfig((c) => ({ ...c, planner: { ...(c.planner || {}), selfHeal: on, ...(on ? {} : { healedOn: ymd(new Date()) }) } }));
  if (on && tasks.length) await heal(tasks);
}
export const dismissHealNote = () => updateConfig((c) => { const n = healOf(c).healNote; return n ? { ...c, planner: { ...(c.planner || {}), healNote: { ...n, seen: true } } } : c; });

/** What to do this morning: nothing, ask once, or heal straight away. */
export async function morningHeal(config: Config, today: Task[]): Promise<"none" | "ask" | "healed"> {
  const due = healDue(config, today);
  if (!due.length) return "none";
  const on = healOf(config).selfHeal;
  if (on === false) return "none";
  if (on === undefined) return "ask";
  await heal(due);
  return "healed";
}
export const leftoverDays = (t: Task) => { const d = parseDue(t.due); return d ? Math.round((+startOfToday() - +new Date(d.d.getFullYear(), d.d.getMonth(), d.d.getDate())) / 864e5) : 0; };
