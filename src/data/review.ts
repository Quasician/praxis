// 4.0 The weekly review's decisions, carried out: in Todoist where a task changes, in Praxis's own record otherwise.
import { itemUpdate, syncMapped, syncOrThrow, uuid } from "../lib/api";
import { dueFor } from "../lib/tasks";
import { plain } from "../lib/text";
import type { Config, SyncCommand, Task } from "../lib/types";
import { plannerCfg } from "../domain/planner";
import { reviewWeek, type Decision, type Review } from "../domain/review";
import type { SkyConstellation } from "../domain/sky";
import { reconcileSoon, updateConfig } from "./actions";
import { askNextMove } from "./constellation";
import { queryClient, qk } from "./queries";

const activeNow = () => queryClient.getQueryData<Task[]>(qk.active) || [];
const openSteps = (id: string) => activeNow().filter((t) => t.parent_id === id).sort((a, b) => (a.child_order ?? 0) - (b.child_order ?? 0));
/** Changes one project's entry in the sky record. */
const setCon = (id: string, fn: (c: SkyConstellation) => SkyConstellation) => updateConfig((c) => {
  const was = c.sky?.cons?.[id];
  return was ? { ...c, sky: { ...c.sky!, cons: { ...c.sky!.cons, [id]: fn(was) } } } : c;
});
const stamp = () => new Date().toISOString();

/** Keep going: the next step goes on a day, and the project's clock starts again. */
export async function keepGoing(id: string, day: string) {
  const next = openSteps(id)[0];
  if (!next) throw new Error("That project has no open step left in Todoist.");
  if (!next.due?.is_recurring) await syncOrThrow([itemUpdate({ id: next.id, due: dueFor(next, day) })]);
  await setCon(id, ({ rest: _rest, ...c }) => ({ ...c, kept: stamp() }));
  reconcileSoon(0);
  return plain(next.content);
}

/** Shrink: a ten-minute first step goes in front of the next one (Claude words it when connected), on a day. */
export async function shrink(id: string, day: string, claude: boolean) {
  const next = openSteps(id)[0];
  const milestone = activeNow().find((t) => t.id === id);
  if (!next || !milestone) throw new Error("That project has no open step left in Todoist.");
  let title = `10 minutes on: ${plain(next.content)}`;
  if (claude) {
    try { const r = await askNextMove({ content: next.content, description: next.description }, { project: plain(milestone.content), tried: [], minutesIn: 0 }); if (r.move?.trim()) title = r.move.trim().slice(0, 200); }
    catch { /* the plain version is fine */ }
  }
  const cfg = plannerCfg(queryClient.getQueryData<Config>(qk.config));
  const cmds: SyncCommand[] = [{ type: "item_add", uuid: uuid(), temp_id: uuid(), args: {
    content: title, project_id: milestone.project_id, parent_id: id, child_order: (next.child_order ?? 1) - 1,
    duration: { amount: 10, unit: "minute" }, labels: [cfg.lightLabel], due: { date: day },
  } }];
  const { failed } = await syncMapped(cmds);
  if (failed.length) throw new Error("Todoist didn't accept the smaller step.");
  await setCon(id, ({ rest: _rest, ...c }) => ({ ...c, kept: stamp() }));
  reconcileSoon(0);
  queryClient.invalidateQueries({ queryKey: qk.active });
  return title;
}

/** Set it down: the project rests. It stays in Todoist and in the sky (faint); its steps lose their dates and stay out of plans. */
export async function setDown(id: string) {
  const dated = openSteps(id).filter((t) => t.due && !t.due.is_recurring);
  if (dated.length) await syncOrThrow(dated.map((t) => itemUpdate({ id: t.id, due: null })));
  await setCon(id, (c) => ({ ...c, rest: stamp() }));
  reconcileSoon(0);
  return dated.length;
}

/** Pick it back up: no longer resting, and its clock starts again. */
export const wake = (id: string) => setCon(id, ({ rest: _rest, ...c }) => ({ ...c, kept: stamp() }));

/** Marks this week's review done, with what was decided. Keeps the last twelve. */
export function saveReview(decisions: Record<string, Decision>, adjusted?: string) {
  const week = reviewWeek();
  return updateConfig((c) => {
    const was = c.reviews?.[week];   // opened again in the same week: the decisions add up
    const reviews: Record<string, Review> = { ...(c.reviews || {}), [week]: { week, at: stamp(), decisions: { ...(was?.decisions || {}), ...decisions }, ...(adjusted || was?.adjusted ? { adjusted: adjusted || was?.adjusted } : {}) } };
    for (const k of Object.keys(reviews).sort().slice(0, -12)) delete reviews[k];
    return { ...c, reviews };
  });
}
export const setCommitCount = (n: number) => updateConfig((c) => ({ ...c, planner: { ...(c.planner || {}), commitCount: n } }));
