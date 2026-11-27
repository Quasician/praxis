// 5.0 The command bar: runs what you typed (domain/commands reads it), each change with a one-line undo.
import { addDays, fmtMin, minOfDay, parseDue, startOfToday, ymd } from "../lib/dates";
import { blockMinutes, dueFor, timedDue } from "../lib/tasks";
import { api, itemUpdate, syncOrThrow } from "../lib/api";
import type { Config, Task } from "../lib/types";
import { blockOf } from "../domain/actuals";
import { findTask, parseCommand, type Command } from "../domain/commands";
import { plannerCfg } from "../domain/planner";
import { plain } from "../lib/text";
import { answerBlock } from "./actuals";
import { completeTask, quickAdd, unscheduleTask, updateConfigFresh, reconcileSoon } from "./actions";
import { proposePlan } from "./planActions";
import { queryClient, qk, refreshTodoist } from "./queries";
import { useUi, type DialogName } from "../state/ui";

export type Result =
  | { ok: true; msg: string; undo?: () => Promise<unknown> }
  | { ok: false; msg: string; choices?: Task[]; cmd?: Command };

const FOCUS_MIN = 25;
const todayList = () => (queryClient.getQueryData<Task[]>(qk.today) || []).filter((t) => !t.checked);
const allOpen = () => queryClient.getQueryData<Task[]>(qk.active) || [];
const startOf = (t: Task) => { const d = parseDue(t.due); return d?.hasTime && ymd(d.d) === ymd(new Date()) ? minOfDay(d.d) : null; };
const name = (t: Task) => `“${plain(t.content).slice(0, 50)}”`;

/** Reads and runs a sentence. `pick`: the task you chose when it was a close call. */
export async function runCommand(text: string, pick?: { cmd: Command; task: Task }): Promise<Result> {
  const now = new Date();
  let cmd: Command | null = pick?.cmd || parseCommand(text, minOfDay(now), now.getDay());
  let task: Task | undefined = pick?.task;
  if (!cmd) {
    const ai = await askClaude(text).catch((e: Error) => ({ error: e.message }));
    if ("error" in ai) return { ok: false, msg: ai.error.includes("key") || ai.error.includes("401") ? "I couldn't read that. Try “move groceries to 4”, “skip gym, tired”, “focus on taxes for 45 min”." : ai.error };
    if (ai.say) return { ok: false, msg: ai.say };
    cmd = ai.cmd ?? null; task = ai.task;
    if (!cmd) return { ok: false, msg: "I couldn't read that. Try “move groceries to 4”, “skip gym, tired”, “focus on taxes for 45 min”." };
  }
  if (!("q" in cmd)) return (await runSimple(cmd)) || { ok: false, msg: "I couldn't do that." };
  if (!task && !cmd.q) return { ok: false, msg: "I couldn't tell which task you meant." };
  if (!task) {
    const found = findTask(cmd.q, todayList(), allOpen(), minOfDay(now), startOf);
    if (found.choices.length) return { ok: false, msg: "Which one?", choices: found.choices, cmd };
    if (!found.task) return { ok: false, msg: `I couldn't find a task like “${cmd.q}”.` };
    task = found.task;
  }
  return execute(cmd, task!);
}

async function execute(cmd: Command, task: Task): Promise<Result> {
  const now = new Date();
  switch (cmd.kind) {
    case "move": {
      const cur = startOf(task), dur = blockMinutes(task);
      let at = cmd.at ?? (cmd.by != null ? Math.ceil(((cur ?? minOfDay(now)) + cmd.by) / 5) * 5 : undefined);
      const day = addDays(startOfToday(), cmd.day || 0);
      if (at == null && !cmd.day) return { ok: false, msg: "When to? Try “move it to 4” or “push it 30 min”." };
      if (at != null && at >= 24 * 60) return { ok: false, msg: "That runs past midnight. Try a time today, or “tomorrow at 9”." };
      // A new day without a time keeps the time it had (if any).
      if (at == null) { const d = parseDue(task.due); if (d?.hasTime) at = minOfDay(d.d); }
      const due = at != null ? timedDue(task, day, at) : dueFor(task, ymd(day));
      const before = { due: task.due ? dueFor(task, task.due.date) : null, duration: task.duration ?? null };
      await syncOrThrow([itemUpdate({ id: task.id, due, ...(at != null ? { duration: { amount: dur, unit: "minute" } } : {}) })]);
      refreshTodoist(); reconcileSoon(1500);
      const when = `${cmd.day ? (cmd.day === 1 ? "tomorrow" : day.toLocaleDateString([], { weekday: "long" })) : "today"}${at != null ? ` at ${fmtMin(at)}` : ""}`;
      return { ok: true, msg: `Moved ${name(task)} to ${when}.`, undo: async () => { await syncOrThrow([itemUpdate({ id: task.id, due: before.due, duration: before.duration })]); refreshTodoist(); } };
    }
    case "unschedule": await unscheduleTask(task); return { ok: true, msg: `Took the time off ${name(task)}.` };
    case "done": await completeTask(task); return { ok: true, msg: "" };   // completeTask has its own note with Undo
    case "skip": {
      const day = ymd(now);
      const cfg = plannerCfg(queryClient.getQueryData<Config>(qk.config));
      await answerBlock(blockOf(task), "skipped", undefined, cfg, false, cmd.why);
      return { ok: true, msg: `Skipped ${name(task)}${cmd.why ? `: ${cmd.why}` : ""}. It stays open.`,
        undo: () => updateConfigFresh((c) => { const r = c.history?.[day]; if (!r?.actual?.[task.id]) return c; const actual = { ...r.actual }; delete actual[task.id]; return { ...c, history: { ...c.history, [day]: { ...r, actual } } }; }) };
    }
    case "focus": {
      const st = startOf(task), left = st != null ? st + blockMinutes(task) - minOfDay(now) : 0;
      const minutes = cmd.minutes || (left >= 10 ? left : FOCUS_MIN);
      let prev: Config["focus"] = null;
      await updateConfigFresh((c) => { prev = c.focus ?? null; return { ...c, focus: { taskId: task.id, content: task.content, startedAt: now.toISOString(), minutes, lock: true } }; });
      useUi.getState().setNowTask(task.id);
      return { ok: true, msg: `Focusing on ${name(task)} for ${minutes} min.`, undo: () => updateConfigFresh((c) => ({ ...c, focus: prev })) };
    }
    default: return { ok: false, msg: "I couldn't do that." };
  }
}

/** Commands without a task. */
export async function runSimple(cmd: Command): Promise<Result | null> {
  const ui = useUi.getState();
  if (cmd.kind === "stop") {
    let prev: Config["focus"] = null;
    await updateConfigFresh((c) => { prev = c.focus ?? null; return { ...c, focus: null }; });
    return prev ? { ok: true, msg: "Timer stopped.", undo: () => updateConfigFresh((c) => ({ ...c, focus: prev })) } : { ok: true, msg: "No timer was running." };
  }
  if (cmd.kind === "add") { await quickAdd(cmd.text, false); return { ok: true, msg: "" }; }
  if (cmd.kind === "open") {
    if (cmd.what === "plan") { await proposePlan(); return { ok: true, msg: "" }; }
    if (cmd.what === "day" || cmd.what === "week" || cmd.what === "sky") { ui.setView(cmd.what === "sky" ? "areas" : cmd.what); return { ok: true, msg: "" }; }
    ui.openDialog(cmd.what as DialogName);
    return { ok: true, msg: "" };
  }
  return null;
}

/** Sentences Praxis couldn't read go to Claude with today's tasks (titles and times only). */
async function askClaude(text: string): Promise<{ cmd?: Command; task?: Task; say?: string }> {
  const now = new Date();
  const seen = new Set<string>(), tasks: Task[] = [];
  for (const t of [...todayList(), ...allOpen()]) if (!seen.has(t.id) && tasks.length < 80) { seen.add(t.id); tasks.push(t); }
  const r = await api<Record<string, unknown>>("/api/claude/command", { method: "POST", body: {
    text, now: now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), today: now.toDateString(),
    tasks: tasks.map((t) => { const d = parseDue(t.due); return { id: t.id, title: plain(t.content), when: d ? (d.hasTime ? `${ymd(d.d)} ${fmtMin(minOfDay(d.d))}` : ymd(d.d)) : undefined }; }),
  } });
  const kind = String(r.kind || "none");
  if (kind === "none") return { say: String(r.say || "That isn't something I can do from here.") };
  const task = tasks.find((t) => t.id === r.taskId);
  const time = typeof r.time === "string" ? r.time.match(/^(\d{1,2}):(\d{2})$/) : null;
  const at = time ? parseInt(time[1], 10) * 60 + parseInt(time[2], 10) : undefined;
  const q = task ? task.content : "";
  switch (kind) {
    case "move": return { task, cmd: { kind: "move", q, ...(at != null ? { at } : {}), ...(Number(r.day) ? { day: Number(r.day) } : {}), ...(!time && Number(r.minutes) ? { by: Number(r.minutes) } : {}) } };
    case "unschedule": case "done": return { task, cmd: { kind, q } };
    case "skip": return { task, cmd: { kind: "skip", q, ...(r.reason ? { why: String(r.reason) } : {}) } };
    case "focus": return { task, cmd: { kind: "focus", q, ...(Number(r.minutes) ? { minutes: Number(r.minutes) } : {}) } };
    case "stop": return { cmd: { kind: "stop" } };
    case "add": return { cmd: { kind: "add", text: String(r.text || text) } };
    case "open": return { cmd: { kind: "open", what: (String(r.what || "day")) as never } };
    default: return { say: "That isn't something I can do from here." };
  }
}
