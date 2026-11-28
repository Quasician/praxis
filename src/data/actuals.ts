// 4.6 Better actuals: saving your answer when a block ends. Done also ticks the task off in Todoist.
import { ymd } from "../lib/dates";
import { willpower } from "../lib/tasks";
import type { PlannerSettings } from "../lib/types";
import { type EndedBlock, type Outcome, withActual } from "../domain/actuals";
import { completeTask, updateConfigFresh } from "./actions";

/**
 * Records how a block went (and how long it took, when you said). Done completes the task in Todoist.
 * 5.1.1: the two happen side by side. Ticking the task off used to wait for the record to save, so a settings save that
 * failed (or never finished) left the task open, and a reminder's Done looked like it did nothing. If the record can't be
 * saved the task is still ticked off, and the error still reaches the caller.
 */
export async function answerBlock(b: EndedBlock, outcome: Outcome, minutes: number | undefined, cfg?: Pick<PlannerSettings, "deepLabel" | "lightLabel">, complete = true, why?: string): Promise<{ completed: boolean | null }> {
  const day = ymd(new Date(b.start));
  const done = outcome === "done" && complete ? completeTask(b.task) : Promise.resolve(null);
  const saved = updateConfigFresh((c) => withActual(c, day, b, outcome, minutes, willpower(b.task, cfg), new Date(), why));
  const [d, s] = await Promise.allSettled([done, saved]);
  if (s.status === "rejected") throw Object.assign(s.reason instanceof Error ? s.reason : new Error(String(s.reason)), { completed: d.status === "fulfilled" ? d.value : false });
  return { completed: d.status === "fulfilled" ? d.value : false };
}
