// 4.6 Better actuals: saving your answer when a block ends. Done also ticks the task off in Todoist.
import { ymd } from "../lib/dates";
import { willpower } from "../lib/tasks";
import type { PlannerSettings } from "../lib/types";
import { type EndedBlock, type Outcome, withActual } from "../domain/actuals";
import { completeTask, updateConfigFresh } from "./actions";

/** Records how a block went (and how long it took, when you said). Done completes the task in Todoist. */
export async function answerBlock(b: EndedBlock, outcome: Outcome, minutes: number | undefined, cfg?: Pick<PlannerSettings, "deepLabel" | "lightLabel">, complete = true, why?: string) {
  const day = ymd(new Date(b.start));
  await updateConfigFresh((c) => withActual(c, day, b, outcome, minutes, willpower(b.task, cfg), new Date(), why));
  if (outcome === "done" && complete) await completeTask(b.task);
}
