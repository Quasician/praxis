// Low-energy days, tiny versions, the fresh start, "the one" on your phone, and celebrations.
import { itemUpdate, sync, api } from "../lib/api";
import { addDays, parseDue, startOfToday, ymd } from "../lib/dates";
import { SOMEDAY_LABEL, dueFor, hasLabel, willpower } from "../lib/tasks";
import { plain } from "../lib/text";
import type { Config, Energy, Task } from "../lib/types";
import { plannerCfg } from "../domain/planner";
import { spreadTasks } from "../domain/week";
import { completeTask, reconcileSoon, updateConfig } from "./actions";
import { queryClient, qk } from "./queries";
import { toast, useUi } from "../state/ui";
import type { EventsResult } from "./queries";

const today = () => ymd(new Date());
const cfgNow = () => queryClient.getQueryData<Config>(qk.config);

/** A task worth a tiny version: repeating habits and Deep work. */
export const needsTiny = (t: Task) => !!t.due?.is_recurring || willpower(t, plannerCfg(cfgNow())) === 3;
/** The tiny version: Claude's if we have one, else a plain "5 minutes of …". */
export const tinyFor = (t: Task, config = cfgNow()) => config?.tiny?.[t.id] || `Just 5 minutes: ${plain(t.content)}`;
export const energyToday = (config = cfgNow()): Energy => config?.history?.[today()]?.energy || "full";

export async function setEnergy(energy: Energy) {
  const day = today();
  await updateConfig((c) => ({ ...c, history: { ...(c.history || {}), [day]: { ...(c.history || {})[day], planned: (c.history || {})[day]?.planned || [], energy } } }));
}

/** Ask Claude for tiny versions of the given tasks (the ones we don't have yet). */
export async function fetchTiny(tasks: Task[]) {
  const have = cfgNow()?.tiny || {};
  const missing = tasks.filter((t) => !have[t.id]).slice(0, 40);
  if (!missing.length) return 0;
  const res = await api<{ versions: { id: string; tiny: string }[] }>("/api/claude/tiny", {
    method: "POST", body: { today: new Date().toDateString(), tasks: missing.map((t) => ({ id: t.id, content: plain(t.content) })) },
  });
  const ids = new Set(missing.map((t) => t.id));
  const got = Object.fromEntries(res.versions.filter((v) => ids.has(v.id) && typeof v.tiny === "string" && v.tiny.trim()).map((v) => [v.id, v.tiny.trim().slice(0, 160)]));
  await updateConfig((c) => ({ ...c, tiny: { ...(c.tiny || {}), ...got } }));
  return Object.keys(got).length;
}

export async function setTiny(id: string, text: string) {
  await updateConfig((c) => ({ ...c, tiny: { ...(c.tiny || {}), [id]: text.slice(0, 160) } }));
}

/** You did the tiny version: today counts. A repeating task moves on to its next date; a one-off stays open. */
export async function doTiny(task: Task) {
  const day = today();
  await updateConfig((c) => {
    const rec = (c.history || {})[day] || { planned: [] };
    return { ...c, history: { ...(c.history || {}), [day]: { ...rec, tinyDone: [...new Set([...(rec.tinyDone || []), task.id])] } } };
  });
  if (task.due?.is_recurring) await completeTask(task);
  else toast(`Tiny version done: “${plain(task.content).slice(0, 50)}”. Today counts.`);
  celebrateIfEarned(task.id);
}

// ---------- celebrations ----------
/** Confetti for finishing the one that matters, or every commitment; quiet otherwise. */
export function celebrateIfEarned(doneId: string) {
  const rec = cfgNow()?.history?.[today()];
  if (!rec) return;
  const committed = rec.planned.filter((p) => p.committed);
  if (!committed.some((p) => p.id === doneId)) return;
  const open = new Set((queryClient.getQueryData<Task[]>(qk.today) || []).filter((t) => { const d = parseDue(t.due); return d && ymd(d.d) <= today(); }).map((t) => t.id));
  const tiny = new Set([...(rec.tinyDone || []), doneId]);
  const left = committed.filter((p) => p.id !== doneId && open.has(p.id) && !tiny.has(p.id));
  const ui = useUi.getState();
  if (!left.length) ui.celebrate(committed.length > 1 ? `All ${committed.length} commitments done. Everything else today is a bonus.` : "Done. Today's a win.");
  else if (rec.planned.find((p) => p.id === doneId)?.star) ui.celebrate("That's the one that mattered. Today's already a win.");
}

// ---------- "the one" on your phone ----------
/** Raise the one that matters to p1 in Todoist for today (so your phone shows it first); put earlier ones back. */
export async function starOnPhone(task: Task | undefined) {
  const config = cfgNow() || {};
  const day = today();
  const cmds = [];
  const restored: string[] = [];
  for (const [d, rec] of Object.entries(config.history || {})) {
    if (d === day || !rec.star) continue;
    cmds.push(itemUpdate({ id: rec.star.id, priority: rec.star.prevPriority }));
    restored.push(d);
  }
  let star: { id: string; prevPriority: number } | undefined;
  if (task && (task.priority || 1) < 4) { cmds.push(itemUpdate({ id: task.id, priority: 4 })); star = { id: task.id, prevPriority: task.priority || 1 }; }
  if (cmds.length) await sync(cmds).catch(() => []); // a task that's gone since can't be restored; that's fine
  await updateConfig((c) => {
    const h = { ...(c.history || {}) };
    for (const d of restored) { const { star: _s, ...rest } = h[d]; h[d] = rest; }
    if (star) h[day] = { ...h[day], planned: h[day]?.planned || [], star };
    return { ...c, history: h };
  });
}

/** At shutdown: the one goes back to its usual priority. */
export async function unstarToday() {
  const rec = cfgNow()?.history?.[today()];
  if (!rec?.star) return;
  await sync([itemUpdate({ id: rec.star.id, priority: rec.star.prevPriority })]).catch(() => []);
  const day = today();
  await updateConfig((c) => { const h = { ...(c.history || {}) }; if (h[day]) { const { star: _s, ...rest } = h[day]; h[day] = rest; } return { ...c, history: h }; });
}

// ---------- fresh start ----------
export const AWAY_DAYS = 3;   // last opened 3+ days ago = at least two full days away
export const PILE = 3;        // and at least this many overdue

export function overdueNow(todayTasks: Task[]) {
  const t0 = startOfToday();
  return todayTasks.filter((t) => { const d = parseDue(t.due); return d && d.d < t0 && !hasLabel(t, SOMEDAY_LABEL); });
}

export function daysAway(config: Config | undefined) {
  if (!config?.lastOpen) return 0;
  return Math.round((+startOfToday() - +new Date(config.lastOpen + "T00:00:00")) / 864e5);
}

/** Clear the pile: one-off tasks spread over the week (or parked), missed repeats start again today. */
export async function freshStart(tasks: Task[], mode: "spread" | "someday") {
  const cfg = plannerCfg(cfgNow());
  const oneOff = tasks.filter((t) => !t.due?.is_recurring), repeats = tasks.filter((t) => t.due?.is_recurring);
  const cmds = repeats.map((t) => itemUpdate({ id: t.id, due: dueFor(t, today()) }));
  if (mode === "someday") cmds.push(...oneOff.map((t) => itemUpdate({ id: t.id, due: null, labels: [...new Set([...(t.labels || []), SOMEDAY_LABEL])] })));
  else {
    const days = Array.from({ length: 7 }, (_, i) => addDays(startOfToday(), i + 1));
    const active = queryClient.getQueryData<Task[]>(qk.active) || [];
    const events = queryClient.getQueriesData<EventsResult>({ queryKey: ["events"] }).flatMap(([, d]) => d?.events || []);
    cmds.push(...spreadTasks(cfg, oneOff, days, active, events).map(([t, d]) => itemUpdate({ id: t.id, due: dueFor(t, d) })));
  }
  let rejected = 0;
  for (let i = 0; i < cmds.length; i += 90) rejected += (await sync(cmds.slice(i, i + 90))).length;
  toast(rejected ? `Mostly done; Todoist rejected ${rejected}.` : `Fresh start: ${oneOff.length} ${mode === "spread" ? "spread over the next week" : "parked in Someday"}${repeats.length ? `, ${repeats.length} repeating task${repeats.length === 1 ? "" : "s"} back on today` : ""}.`);
  reconcileSoon(0);
}
