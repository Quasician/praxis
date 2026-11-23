// Life areas: groups of Todoist projects, with weekly stats, quiet-area nudges and milestones
// (tasks labelled @milestone whose sub-tasks are the steps).
import { addDays, durationMinutes, parseDue, sameDay, startOfToday } from "../lib/dates";
import { isMilestone } from "../lib/tasks";
import type { Area, Project, Task } from "../lib/types";

export const QUIET_DAYS = 7;
export const HISTORY_DAYS = 89; // Todoist serves completed tasks in windows of up to ~3 months
export const AREA_COLORS = ["blue", "green", "violet", "sky_blue", "orange", "red", "teal", "magenta", "olive_green", "charcoal"];

const SEED_AREAS = [
  { name: "Career", color: "blue", match: /career|work|job|resume|interview|portfolio/i },
  { name: "Health", color: "green", match: /rowing|workout|exercise|fitness|health|gym|run|supplement|sleep/i },
  { name: "Hobbies", color: "violet", match: /hobb|book|read|piano|music|photo|camera|hik|game|art|draw|writing/i },
  { name: "Home", color: "sky_blue", match: /daily|weekly|shopping|grocer|meal|home|chore|errand|clean|apartment/i },
  { name: "Money", color: "olive_green", match: /financ|money|budget|tax|invest/i },
  { name: "Travel", color: "orange", match: /trip|travel|vacation/i },
];
export const newId = (prefix = "a") => prefix + Math.random().toString(36).slice(2, 9);

/** First-run guess at areas from project names. */
export function seedAreas(projects: Project[]): Area[] {
  const areas: Area[] = [];
  for (const p of projects) {
    if (p.inbox_project || p.is_inbox_project || p.is_archived) continue;
    const seed = SEED_AREAS.find((s) => s.match.test(p.name));
    if (!seed) continue;
    let area = areas.find((a) => a.name === seed.name);
    if (!area) { area = { id: newId(), name: seed.name, color: seed.color, projects: [] }; areas.push(area); }
    area.projects.push(p.id);
  }
  const order = SEED_AREAS.map((s) => s.name);
  return areas.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
}

export const startOfWeek = () => { const d = startOfToday(); return addDays(d, -((d.getDay() + 6) % 7)); };
export const completedAt = (t: Task) => new Date(t.completed_at || 0);
const effortMin = (t: Task) => { const m = durationMinutes(t); return m && m < 1440 ? m : 0; };

export interface MilestoneInfo { m: Task; steps: Task[]; doneSteps: number; total: number; pct: number; next: Task | null; target: string | null }
export interface AreaStats {
  area: Area; open: Task[]; milestones: MilestoneInfo[]; upNext: Task[];
  spark: { day: Date; n: number; min: number }[];
  weekMin: number; weekDone: number; quietFor: number | null; everActive: boolean; quiet: boolean;
}

export function computeArea(area: Area, active: Task[], completed: Task[]): AreaStats {
  const projects = new Set(area.projects);
  const inArea = (t: Task) => projects.has(t.project_id);
  const open = active.filter(inArea);
  const done = completed.filter(inArea);
  const doneWeek = done.filter((t) => completedAt(t) >= startOfWeek());

  const spark = [];
  for (let i = 6; i >= 0; i--) {
    const from = addDays(startOfToday(), -i), to = addDays(startOfToday(), -i + 1);
    const items = done.filter((t) => { const c = completedAt(t); return c >= from && c < to; });
    spark.push({ day: from, n: items.length, min: items.reduce((s, t) => s + (effortMin(t) || 15), 0) });
  }

  const last = done.reduce((m, t) => { const c = completedAt(t); return c > m ? c : m; }, new Date(0));
  const quietFor = last.getTime() ? Math.round((+startOfToday() - +new Date(last.getFullYear(), last.getMonth(), last.getDate())) / 864e5) : null;

  const milestones = open.filter(isMilestone).map((m): MilestoneInfo => {
    const steps = active.filter((t) => t.parent_id === m.id).sort((a, b) => (a.child_order ?? 0) - (b.child_order ?? 0));
    const doneSteps = completed.filter((t) => t.parent_id === m.id).length;
    const total = steps.length + doneSteps;
    return { m, steps, doneSteps, total, pct: total ? Math.round((doneSteps / total) * 100) : 0, next: steps[0] || null,
             target: (m.deadline && m.deadline.date) || (m.due && m.due.date) || null };
  }).sort((a, b) => (a.target || "9999").localeCompare(b.target || "9999"));

  const milestoneIds = new Set(milestones.map((x) => x.m.id));
  const upNext = open
    .filter((t) => !isMilestone(t) && !milestoneIds.has(t.parent_id || ""))
    .sort((a, b) => {
      const da = parseDue(a.due), db = parseDue(b.due);
      if (!!da !== !!db) return da ? -1 : 1;
      if (da && db && +da.d !== +db.d) return +da.d - +db.d;
      return b.priority - a.priority;
    })
    .slice(0, 3);

  return {
    area, open, milestones, upNext, spark,
    weekMin: doneWeek.reduce((s, t) => s + effortMin(t), 0),
    weekDone: doneWeek.length,
    quietFor, everActive: !!last.getTime(),
    quiet: area.projects.length > 0 && (quietFor === null || quietFor >= QUIET_DAYS),
  };
}

export const isOnDay = (t: Task, day: Date) => { const d = parseDue(t.due); return !!(d && sameDay(d.d, day)); };
