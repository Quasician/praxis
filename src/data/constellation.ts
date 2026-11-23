// New projects ("constellations"): Claude drafts the steps; Praxis writes the milestone and its steps to Todoist.
import { api, syncMapped, uuid } from "../lib/api";
import { MILESTONE_LABEL } from "../lib/tasks";
import { ymd } from "../lib/dates";
import type { Config, SyncCommand } from "../lib/types";
import { plannerCfg } from "../domain/planner";
import { EMPTY_SKY } from "../domain/sky";
import { queryClient, qk } from "./queries";
import { reconcileSoon, updateConfig } from "./actions";

export type Effort = "light" | "medium" | "deep";
export interface DraftStep { key: string; title: string; minutes: number; effort: Effort }
export interface Draft { name: string; steps: DraftStep[] }

const clampMin = (n: unknown) => { const m = Math.round(Number(n) || 30); return Math.max(5, Math.min(240, m)); };

export async function drawWithClaude(goal: string, opts: { notes?: string; deadline?: string; area?: string }): Promise<Draft> {
  const today = new Date().toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const r = await api<{ name: string; steps: { title?: string; minutes?: number; effort?: string }[] }>("/api/claude/constellation", { method: "POST", body: { goal, ...opts, today } });
  const steps = (r.steps || []).filter((s) => s && typeof s.title === "string" && s.title.trim()).slice(0, 12).map((s) => ({
    key: uuid(), title: s.title!.trim(), minutes: clampMin(s.minutes), effort: (s.effort === "deep" || s.effort === "light" ? s.effort : "medium") as Effort,
  }));
  if (!steps.length) throw new Error("Claude didn't come back with any steps. Try describing the goal a little more.");
  return { name: (r.name || goal).trim(), steps };
}

/** Writes the milestone and its steps to Todoist in one go, and remembers the shape you picked. Returns the milestone's id. */
export async function createConstellation(d: { name: string; steps: DraftStep[]; projectId: string; deadline?: string; seed: string; firstToday: boolean; areaId?: string }) {
  const cfg = plannerCfg(queryClient.getQueryData<Config>(qk.config));
  const temp = uuid();
  const cmds: SyncCommand[] = [{
    type: "item_add", uuid: uuid(), temp_id: temp,
    args: { content: d.name.trim(), project_id: d.projectId, labels: [MILESTONE_LABEL], ...(d.deadline ? { deadline: { date: d.deadline } } : {}) },
  }];
  const stepTemps: string[] = [];
  d.steps.filter((s) => s.title.trim()).forEach((s, i) => {
    const t = uuid(); stepTemps.push(t);
    const label = s.effort === "deep" ? cfg.deepLabel : s.effort === "light" ? cfg.lightLabel : "";
    cmds.push({
      type: "item_add", uuid: uuid(), temp_id: t,
      args: {
        content: s.title.trim(), project_id: d.projectId, parent_id: temp, child_order: i + 1,
        duration: { amount: s.minutes, unit: "minute" }, ...(label ? { labels: [label] } : {}),
        ...(i === 0 && d.firstToday ? { due: { date: ymd(new Date()) } } : {}),
      },
    });
  });
  const { failed, ids } = await syncMapped(cmds);
  if (failed.some((c) => c.temp_id === temp)) throw new Error("Todoist didn't accept the new project.");
  if (failed.length) throw new Error(`Todoist rejected ${failed.length} of the steps. The project is there; add the rest in Todoist.`);
  const id = ids[temp];
  if (id) {
    // Keep the shape you saw in the preview.
    await updateConfig((c) => {
      const sky = c.sky || EMPTY_SKY;
      const was = sky.cons[id];
      return { ...c, sky: { ...sky, cons: { ...sky.cons, [id]: { ...(was || { name: d.name.trim(), area: d.areaId, steps: [], since: new Date().toISOString(), target: d.deadline || null }), seed: d.seed } } } };
    });
  }
  reconcileSoon(0);
  queryClient.invalidateQueries({ queryKey: qk.active });
  return id;
}

/** "I'm stuck": one tiny next move from Claude (or a plain fallback without it). */
export async function askNextMove(task: { content: string; description?: string }, opts: { project?: string; tried: string[]; minutesIn: number }) {
  const today = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  return api<{ move: string; why?: string }>("/api/claude/unstick", { method: "POST", body: { task: task.content, notes: task.description || "", ...opts, today } });
}
