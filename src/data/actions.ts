// Everything that changes Todoist or your settings. Changes show up instantly
// (optimistic) and are rolled back if Todoist rejects them.
import { api, closeTask, itemUpdate, reopenTask, syncOrThrow } from "../lib/api";
import { parseDue, sameDay, startOfToday, ymd } from "../lib/dates";
import { DROPPED_LABEL, MILESTONE_LABEL, SOMEDAY_LABEL, dueFor, timedDue } from "../lib/tasks";
import { plain } from "../lib/text";
import type { Config, Due, Duration, Task } from "../lib/types";
import { queryClient, qk } from "./queries";
import { toast } from "../state/ui";
import { seedAreas } from "../domain/areas";
import { fetchAll } from "../lib/api";
import type { Project } from "../lib/types";

const TASK_KEYS = [qk.today, qk.inbox, qk.active];

// ---------- local cache edits ----------
type Snapshot = [readonly unknown[], Task[] | undefined][];
const snapshot = (): Snapshot => TASK_KEYS.map((k) => [k, queryClient.getQueryData<Task[]>(k)]);
const restore = (s: Snapshot) => { for (const [k, v] of s) queryClient.setQueryData(k, v); };

/** Patch a task everywhere it's cached. Returns an undo. */
export function patchTask(id: string, patch: (t: Task) => Partial<Task>) {
  const snap = snapshot();
  for (const k of TASK_KEYS) queryClient.setQueryData<Task[]>(k, (ts) => ts?.map((t) => (t.id === id ? { ...t, ...patch(t) } : t)));
  // A task now due today belongs in the Today list even if it came from elsewhere.
  const today = queryClient.getQueryData<Task[]>(qk.today) || [];
  const src = [...(queryClient.getQueryData<Task[]>(qk.inbox) || []), ...(queryClient.getQueryData<Task[]>(qk.active) || [])].find((t) => t.id === id);
  const d = src && parseDue(src.due);
  if (src && d && (sameDay(d.d, new Date()) || d.d < startOfToday()) && !today.some((t) => t.id === id)) {
    queryClient.setQueryData<Task[]>(qk.today, [...today, src]);
  }
  return () => restore(snap);
}
export function removeTask(id: string) {
  const snap = snapshot();
  for (const k of TASK_KEYS) queryClient.setQueryData<Task[]>(k, (ts) => ts?.filter((t) => t.id !== id));
  return () => restore(snap);
}

let reconcileTimer: ReturnType<typeof setTimeout> | undefined;
/** After a change, re-read from Todoist a little later to pick up anything it adjusted. */
export function reconcileSoon(ms = 3500) {
  clearTimeout(reconcileTimer);
  reconcileTimer = setTimeout(() => {
    for (const k of [...TASK_KEYS, qk.completed]) queryClient.invalidateQueries({ queryKey: k });
  }, ms);
}

const short = (t: Task, n = 50) => plain(t.content).slice(0, n);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------- settings ----------
let saveChain: Promise<unknown> = Promise.resolve();
/**
 * Change settings. The change shows up immediately; saves are serialized so overlapping
 * changes can't clobber each other (each save sends the latest full settings).
 */
export function updateConfig(fn: (c: Config) => Config): Promise<Config> {
  const cached = queryClient.getQueryData<Config>(qk.config);
  if (cached) queryClient.setQueryData(qk.config, fn(cached));
  const run = async () => {
    if (!cached) queryClient.setQueryData(qk.config, fn(await api<Config>("/api/config")));
    return api<Config>("/api/config", { method: "POST", body: queryClient.getQueryData<Config>(qk.config) });
  };
  const p = saveChain.then(run, run);
  saveChain = p.catch(() => undefined);
  return p;
}

/** Make sure settings exist; on first run guess areas from project names. */
export async function ensureConfig(): Promise<Config> {
  const cfg: Config = queryClient.getQueryData<Config>(qk.config) ?? (await queryClient.fetchQuery({ queryKey: qk.config, queryFn: () => api<Config>("/api/config") })) ?? {};
  if (Array.isArray(cfg.areas)) return cfg;
  const projects = queryClient.getQueryData<Project[]>(qk.projects) || (await fetchAll<Project>("/projects"));
  return updateConfig((c) => (Array.isArray(c.areas) ? c : { ...c, areas: seedAreas(projects) }));
}

// ---------- tasks ----------
export async function completeTask(task: Task) {
  const undo = removeTask(task.id);
  try {
    await closeTask(task.id);
    toast(`Completed “${short(task, 60)}”`, {
      label: "Undo",
      run: async () => {
        try { await reopenTask(task.id); } catch { toast("Couldn't undo. Reopen it in Todoist."); }
        reconcileSoon(0);
      },
    });
    if (task.due && task.due.is_recurring) reconcileSoon(500); // moves to its next date
    else reconcileSoon();
  } catch {
    undo();
    toast("Couldn't complete that task. Try again.");
  }
}

export async function quickAdd(text: string, forToday: boolean) {
  let task: Task;
  try {
    task = await api<Task>("/api/todoist/tasks/quick", { method: "POST", body: { text } }); // Todoist's natural-language parser
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status !== 404 && status !== 405) throw e;
    task = await api<Task>("/api/todoist/tasks", { method: "POST", body: { content: text, ...(forToday ? { due_string: "today" } : {}) } });
  }
  if (forToday && task && task.id && !task.due) {
    await api(`/api/todoist/tasks/${encodeURIComponent(task.id)}`, { method: "POST", body: { due_string: "today" } });
  }
  toast("Added");
  reconcileSoon(0);
}

/** Give a task a time block today. */
export async function scheduleTask(task: Task, startMin: number, dur: number) {
  const due = timedDue(task, new Date(), startMin);
  const duration: Duration = { amount: dur, unit: "minute" };
  const undo = patchTask(task.id, (t) => ({ due: { ...(t.due || {}), ...due, datetime: undefined } as Due, duration }));
  try {
    await syncOrThrow([itemUpdate({ id: task.id, due, duration })]);
    reconcileSoon(4000);
  } catch (e) {
    undo();
    toast(`Couldn't schedule that: ${errMsg(e)}`);
  }
}

export async function unscheduleTask(task: Task) {
  if (task.due && task.due.is_recurring) { toast("Repeating tasks keep a time. Drag the block to move it instead."); return; }
  const date = ymd(new Date());
  const undo = patchTask(task.id, (t) => ({ due: { ...(t.due || {}), date, datetime: undefined } as Due, duration: null }));
  try {
    await syncOrThrow([itemUpdate({ id: task.id, due: { date }, duration: null })]);
    toast(`Unscheduled “${short(task)}”. Still due today.`);
    reconcileSoon(4000);
  } catch (e) {
    undo();
    toast(`Couldn't unschedule that: ${errMsg(e)}`);
  }
}

/** Set a (date-only, or keep-the-time) due date. Used by triage, Do today and the weekly planner. */
export async function setTaskDate(task: Task, date: string, label: string) {
  const oldDue = task.due;
  const due = dueFor(task, date);
  const undo = patchTask(task.id, (t) => ({ due: { ...(t.due || {}), ...due, datetime: undefined } as Due }));
  try {
    await syncOrThrow([itemUpdate({ id: task.id, due })]);
    toast(`“${short(task, 40)}” → ${label}`, {
      label: "Undo",
      run: async () => {
        try { await syncOrThrow([itemUpdate({ id: task.id, due: oldDue ? { date: oldDue.date, ...(oldDue.is_recurring ? { string: oldDue.string, is_recurring: true } : {}) } : null })]); }
        catch (e) { toast(`Couldn't undo: ${errMsg(e)}`); }
        reconcileSoon(0);
      },
    });
    reconcileSoon();
  } catch (e) { undo(); toast(errMsg(e)); }
}

export async function moveToSomeday(task: Task) {
  const labels = [...new Set([...(task.labels || []), SOMEDAY_LABEL])];
  const old = { due: task.due, labels: task.labels || [] };
  const undo = removeTask(task.id);
  try { await syncOrThrow([itemUpdate({ id: task.id, due: null, labels })]); } catch (e) { undo(); toast(errMsg(e)); return; }
  toast(`“${short(task, 40)}” parked in Someday`, {
    label: "Undo",
    run: async () => { await syncOrThrow([itemUpdate({ id: task.id, due: old.due ? { date: old.due.date } : null, labels: old.labels })]).catch((e) => toast(errMsg(e))); reconcileSoon(0); },
  });
  reconcileSoon();
}

export async function bulkSomeday(tasks: Task[]) {
  const olds = tasks.map((t) => ({ id: t.id, date: t.due?.date, labels: t.labels || [] }));
  const cmds = tasks.map((t) => itemUpdate({ id: t.id, due: null, labels: [...new Set([...(t.labels || []), SOMEDAY_LABEL])] }));
  try {
    await syncOrThrow(cmds);
    for (const t of tasks) removeTask(t.id);
    toast(`Moved ${tasks.length} tasks to Someday`, {
      label: "Undo",
      run: async () => { await syncOrThrow(olds.map((o) => itemUpdate({ id: o.id, due: o.date ? { date: o.date } : null, labels: o.labels }))).catch((e) => toast(errMsg(e))); reconcileSoon(0); },
    });
    reconcileSoon();
  } catch (e) { toast(`Couldn't move them: ${errMsg(e)}`); reconcileSoon(0); }
}

/** Done, Skip (repeating: close this occurrence) or Drop (complete tagged @dropped, recoverable). */
export async function finishTask(task: Task, how: "done" | "skip" | "drop") {
  const undo = removeTask(task.id);
  try {
    if (how === "drop") await syncOrThrow([itemUpdate({ id: task.id, labels: [...new Set([...(task.labels || []), DROPPED_LABEL])] })]);
    await closeTask(task.id);
  } catch (e) { undo(); toast(`Couldn't do that: ${errMsg(e)}`); return; }
  const name = short(task, 40);
  const msg = how === "skip" ? `Skipped to the next “${name}”` : how === "drop" ? `Dropped “${name}” (still in Todoist's completed list)` : `Done: “${name}”`;
  toast(msg, how === "skip" ? undefined : { label: "Undo", run: async () => { await reopenTask(task.id).catch(() => toast("Couldn't undo.")); reconcileSoon(0); } });
  reconcileSoon();
}

/** Turn a task into a milestone with one small first step due today. */
export async function breakDown(task: Task, step: string) {
  const labels = [...new Set([...(task.labels || []), MILESTONE_LABEL])];
  const undo = removeTask(task.id);
  try {
    await syncOrThrow([itemUpdate({ id: task.id, due: null, labels })]);
    await api("/api/todoist/tasks", { method: "POST", body: { content: step, parent_id: task.id, due_string: "today" } });
  } catch (e) { undo(); toast(`Couldn't break it down: ${errMsg(e)}`); return; }
  toast(`“${short(task, 36)}” is now a milestone. First step is on today.`);
  reconcileSoon(500);
}

// ---------- milestones & areas ----------
export async function addStep(parentId: string, text: string) {
  await api("/api/todoist/tasks", { method: "POST", body: { content: text, parent_id: parentId } });
  reconcileSoon(0);
}

export async function addMilestone(projectId: string, title: string, target: string) {
  const body = { content: title, project_id: projectId, labels: [MILESTONE_LABEL] };
  try {
    await api("/api/todoist/tasks", { method: "POST", body: target ? { ...body, deadline_date: target } : body });
  } catch (e) {
    if (!target) throw e;
    await api("/api/todoist/tasks", { method: "POST", body: { ...body, due_date: target } }); // accounts without deadlines
    toast("Saved the target as a due date (deadlines weren't available).");
  }
  reconcileSoon(0);
}

export async function doToday(task: Task) {
  if (task.due && task.due.is_recurring) { toast("That one repeats, so it already has its own schedule."); return; }
  const undo = patchTask(task.id, () => ({ due: { date: ymd(new Date()) } }));
  try {
    await api(`/api/todoist/tasks/${encodeURIComponent(task.id)}`, { method: "POST", body: { due_string: "today" } });
    toast(`Added to today: “${short(task)}”`);
    reconcileSoon(0);
  } catch (e) { undo(); toast(`Couldn't add it to today: ${errMsg(e)}`); }
}

/** Move several tasks to one date in a single batch (repeating ones keep their repeat). */
export const bulkMove = (tasks: Task[], date: string, label: string) => bulkPlace(tasks.map((t) => [t, date]), `to ${label}`);

/** Give each task its own date, all in one batch. */
export async function bulkPlace(pairs: [Task, string][], label: string) {
  const tasks = pairs.map(([t]) => t);
  const olds = tasks.map((t) => ({ id: t.id, due: t.due }));
  const undos = pairs.map(([t, date]) => patchTask(t.id, () => ({ due: { ...dueFor(t, date) } as Due })));
  try {
    await syncOrThrow(pairs.map(([t, date]) => itemUpdate({ id: t.id, due: dueFor(t, date) })));
    toast(`Moved ${tasks.length} task${tasks.length === 1 ? "" : "s"} ${label}`, {
      label: "Undo",
      run: async () => {
        await syncOrThrow(olds.map((o) => itemUpdate({ id: o.id, due: o.due ? { date: o.due.date, ...(o.due.is_recurring ? { string: o.due.string, is_recurring: true } : {}) } : null }))).catch((e) => toast(errMsg(e)));
        reconcileSoon(0);
      },
    });
    reconcileSoon();
  } catch (e) { undos.forEach((u) => u()); toast(`Couldn't move them: ${errMsg(e)}`); }
}
