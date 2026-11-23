// Brain dump: what Claude proposes, cleaned up, and how it becomes Todoist commands.
import { uuid } from "../lib/api";
import { addDays, fromYmd, startOfToday, ymd } from "../lib/dates";
import type { PlannerSettings, Project, SyncCommand, Task } from "../lib/types";

export type Willpower = "deep" | "medium" | "light";
export interface Proposal {
  key: string;
  sourceId?: string;         // an existing Inbox task being filed
  include: boolean;
  content: string;
  description: string;
  projectId: string;
  date: string;              // "" = no date
  time: string;              // "" = no time
  recurring: string;         // "" = doesn't repeat
  deadline: string;
  duration: number;
  willpower: Willpower;
  priority: number;
  labels: string[];
  note: string;
}

export const DURATIONS = [10, 15, 30, 45, 60, 90, 120, 180, 240];
const isDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(fromYmd(s).getTime());
const str = (s: unknown, max = 500) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const nearest = (n: number) => DURATIONS.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));

/** Turn Claude's raw answer into safe, editable proposals (unknown projects → Inbox, past dates dropped, etc.). */
export function cleanProposals(raw: unknown[], projects: Project[], inboxId: string, inbox: Task[], knownLabels: string[]): Proposal[] {
  const ids = new Set(projects.map((p) => p.id));
  const sources = new Map(inbox.map((t) => [t.id, t]));
  const labels = new Set(knownLabels.map((l) => l.toLowerCase()));
  const today = ymd(startOfToday());
  const seen = new Set<string>();
  const out: Proposal[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const x = r as Record<string, unknown>;
    const content = str(x.content, 300);
    if (!content) continue;
    const sourceId = typeof x.source_id === "string" && sources.has(x.source_id) && !seen.has(x.source_id) ? x.source_id : undefined;
    if (sourceId) seen.add(sourceId);
    const src = sourceId ? sources.get(sourceId) : undefined;
    let date = isDate(x.date) && x.date >= today ? x.date : "";
    let time = typeof x.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(x.time) && date ? x.time : "";
    let recurring = str(x.recurring, 80);
    // Filing an existing task: unless Claude gave it a new date, it keeps the one it had.
    if (src?.due && !date && !recurring) {
      if (src.due.is_recurring && src.due.string) recurring = src.due.string;
      else { date = src.due.date.slice(0, 10); time = src.due.date.length > 10 ? src.due.date.slice(11, 16) : ""; }
    }
    const wp = x.willpower === "deep" || x.willpower === "light" ? x.willpower : "medium";
    out.push({
      key: uuid(), sourceId, include: true, content,
      description: str(x.description, 2000) || src?.description || "",
      projectId: typeof x.project_id === "string" && ids.has(x.project_id) ? x.project_id : src?.project_id || inboxId,
      date, time, recurring,
      deadline: isDate(x.deadline) && x.deadline >= today ? x.deadline : "",
      duration: nearest(Number(x.duration_min) || 30),
      willpower: wp,
      priority: [1, 2, 3, 4].includes(Number(x.priority)) ? Number(x.priority) : 1,
      labels: Array.isArray(x.labels) ? x.labels.filter((l): l is string => typeof l === "string" && labels.has(l.toLowerCase())) : [],
      note: str(x.note, 120),
    });
  }
  return out;
}

function dueOf(p: Proposal) {
  if (p.recurring) return { string: p.recurring };
  if (p.date) return { date: p.time ? `${p.date}T${p.time}:00` : p.date };
  return null;
}

function sameDue(p: Proposal, t: Task) {
  if (!t.due) return !p.date && !p.recurring;
  if (t.due.is_recurring) return p.recurring === t.due.string;
  return !p.recurring && p.date === t.due.date.slice(0, 10) && p.time === (t.due.date.length > 10 ? t.due.date.slice(11, 16) : "");
}

/** Labels for a proposal: its own, plus the willpower label (an existing task keeps its other labels). */
function labelsOf(p: Proposal, cfg: PlannerSettings, existing: string[] = []) {
  const wpLabels = [cfg.deepLabel, cfg.lightLabel].map((l) => l.toLowerCase());
  const keep = existing.filter((l) => !wpLabels.includes(l.toLowerCase()));
  const wp = p.willpower === "deep" ? [cfg.deepLabel] : p.willpower === "light" ? [cfg.lightLabel] : [];
  return [...new Set([...keep, ...p.labels, ...wp])];
}

/** One Todoist sync batch: item_add for new tasks; item_update (+ item_move) for filed Inbox tasks.
 *  owner maps each command back to its proposal's key. */
export function proposalCommands(ps: Proposal[], cfg: PlannerSettings, inbox: Task[], withDeadlines = true): { cmds: SyncCommand[]; owner: Map<string, string> } {
  const byId = new Map(inbox.map((t) => [t.id, t]));
  const cmds: SyncCommand[] = [];
  const owner = new Map<string, string>();
  const push = (p: Proposal, c: SyncCommand) => { cmds.push(c); owner.set(c.uuid, p.key); };
  for (const p of ps.filter((x) => x.include && x.content.trim())) {
    const fields: Record<string, unknown> = {
      content: p.content.trim(),
      description: p.description,
      labels: labelsOf(p, cfg, p.sourceId ? byId.get(p.sourceId)?.labels : []),
      priority: p.priority,
      duration: { amount: p.duration, unit: "minute" },
      due: dueOf(p),
      ...(withDeadlines && p.deadline ? { deadline: { date: p.deadline } } : {}),
    };
    if (p.sourceId) {
      const src = byId.get(p.sourceId);
      if (src && sameDue(p, src)) delete fields.due;   // untouched date: leave it (and any repeat) exactly as it is
      push(p, { type: "item_update", uuid: uuid(), args: { id: p.sourceId, ...fields } });
      if (src && src.project_id !== p.projectId) push(p, { type: "item_move", uuid: uuid(), args: { id: p.sourceId, project_id: p.projectId } });
    } else {
      if (!fields.due) delete fields.due;
      push(p, { type: "item_add", uuid: uuid(), temp_id: uuid(), args: { ...fields, project_id: p.projectId } });
    }
  }
  return { cmds, owner };
}

/** "Mon 24" / "Today" / "Tomorrow" for a proposal's date chip. */
export function dateText(date: string) {
  if (!date) return "";
  const t = ymd(startOfToday());
  if (date === t) return "Today";
  if (date === ymd(addDays(startOfToday(), 1))) return "Tomorrow";
  return fromYmd(date).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}
