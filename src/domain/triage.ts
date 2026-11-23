// "Needs a decision": tasks 2+ days overdue, or that slipped 3+ times, wait in a tray
// until you decide. Slips are counted locally: a task pushed to a later date while it
// was already due (including from your phone) counts as one slip.
import { addDays, daysOverdue, startOfToday, ymd } from "../lib/dates";
import type { Task, TaskMemory } from "../lib/types";

export const TRIAGE_DAYS = 2;
export const SLIP_LIMIT = 3;

export interface TriageItem { task: Task; days: number; moves: number; recurring: boolean }

export function triageItems(today: Task[], memory: Record<string, TaskMemory> = {}): TriageItem[] {
  const out: TriageItem[] = [];
  for (const t of today) {
    if (!t.due) continue;
    const days = daysOverdue(t), moves = (memory[t.id] || { moves: 0 }).moves || 0;
    if (days >= TRIAGE_DAYS || moves >= SLIP_LIMIT) out.push({ task: t, days, moves, recurring: !!t.due.is_recurring });
  }
  return out.sort((a, b) => b.days - a.days || b.moves - a.moves);
}

/** Updates slip memory from a list of tasks. Returns a new memory object if anything changed. */
export function observeTasks(memory: Record<string, TaskMemory>, tasks: Task[], complete = false): Record<string, TaskMemory> | null {
  const mem = { ...memory };
  const today = ymd(new Date());
  let changed = false;
  const seen = new Set<string>();
  for (const t of tasks) {
    seen.add(t.id);
    if (!t.due || t.due.is_recurring) continue; // a repeating task moving forward isn't a slip
    const due = (t.due.date || "").slice(0, 10);
    const m = mem[t.id];
    if (!m) { mem[t.id] = { due, moves: 0 }; changed = true; continue; }
    if (due !== m.due) {
      const moves = due > m.due && m.due <= today ? (m.moves || 0) + 1 : m.moves || 0;
      mem[t.id] = { due, moves };
      changed = true;
    }
  }
  if (complete) for (const id of Object.keys(mem)) if (!seen.has(id)) { delete mem[id]; changed = true; }
  return changed ? mem : null;
}

export const TRIAGE_GROUPS = [
  { key: "slip", title: "Keeps slipping", test: (x: TriageItem) => x.moves >= SLIP_LIMIT && x.days < TRIAGE_DAYS },
  { key: "week", title: "Overdue 2–7 days", test: (x: TriageItem) => x.days >= TRIAGE_DAYS && x.days <= 7 },
  { key: "month", title: "Overdue 1–4 weeks", test: (x: TriageItem) => x.days > 7 && x.days <= 31 },
  { key: "half", title: "Overdue 1–6 months", test: (x: TriageItem) => x.days > 31 && x.days <= 183 },
  { key: "old", title: "Overdue 6+ months", test: (x: TriageItem) => x.days > 183 },
];

export function ageText(x: TriageItem) {
  if (x.days < TRIAGE_DAYS) return "due today";
  if (x.days < 14) return `${x.days} days overdue`;
  if (x.days < 60) return `${Math.round(x.days / 7)} weeks overdue`;
  if (x.days < 365) return `${Math.round(x.days / 30)} months overdue`;
  const y = (x.days / 365).toFixed(1).replace(/\.0$/, "");
  return `${y} year${y === "1" ? "" : "s"} overdue`;
}

export function nextDate(choice: "tomorrow" | "weekend" | "nextweek") {
  const d = startOfToday(), dow = d.getDay();
  if (choice === "tomorrow") return ymd(addDays(d, 1));
  if (choice === "weekend") return ymd(addDays(d, dow === 6 ? 7 : 6 - dow));
  return ymd(addDays(d, (8 - dow) % 7 || 7));
}
