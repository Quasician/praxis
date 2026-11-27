// UI state that isn't Todoist data: current view, filters, toasts, dialogs, the plan proposal, drag state.
import { create } from "zustand";
import type { Candidate, PlanItem } from "../domain/planner";
import type { Task } from "../lib/types";
import type { WeekCard, WeekDay } from "../domain/week";
import type { Proposal } from "../domain/dump";

/** 3.7: confetti for a day's commitments, a shooting star for "the one", the aurora for a week. */
export type CheerKind = "confetti" | "meteor" | "aurora" | "sunrise" | "sunset";

export type View = "day" | "week" | "areas" | "progress";
export type DialogName = "settings" | "triage" | "planner" | "calendars" | "areas" | "dump" | "claude" | "shutdown" | "help" | "morning" | "backlog" | "fresh" | "reminders" | "constellation" | "wallpaper" | "heal" | "letter" | "review";

/** 4.3: the rituals open in one docked panel at the side (one at a time), not as pop-ups over everything. */
export const RITUALS: DialogName[] = ["morning", "shutdown", "review", "letter", "triage", "backlog", "fresh", "heal"];

export interface Toast { id: number; msg: string; action?: { label: string; run: () => void } }

export interface DragState {
  kind: "new" | "move" | "resize";
  task: Task;
  start: number;           // for move/resize: block start (minutes)
  dur: number;
  grab: number;            // minutes between block start and pointer, for "move"
  proposalIdx?: number;    // dragging a proposed (not yet accepted) block
  started: boolean;
  x: number; y: number;
  overTimeline: boolean;
  target: { start: number; dur: number } | null;
  unschedule: boolean;
}

export interface PlanState { active: boolean; items: PlanItem[]; unplaced: Candidate[]; freeMin: number; seed: number; fillWhy?: string;
  /** 4.0, from the record: what you usually finish on a day like today (over how many days), and where your weak hours start. */
  capacityMin?: number | null; capacityDays?: number; weakFrom?: number | null; weakAll?: boolean }

interface UiState {
  view: View; setView: (v: View) => void;
  tab: "today" | "inbox"; setTab: (t: "today" | "inbox") => void;
  project: string | null; setProject: (p: string | null) => void;
  toast: Toast | null; showToast: (msg: string, action?: Toast["action"]) => void; hideToast: () => void;
  newsOpen?: boolean;   // 5.0: the What's new card, from the update chip or the menu
  cmdOpen?: boolean;    // 5.0: the command bar
  settingsAt?: string;  // 5.0: which section the settings open at
  dialogs: Record<DialogName, boolean>; openDialog: (d: DialogName) => void; closeDialog: (d: DialogName) => void;
  plan: PlanState; setPlan: (p: Partial<PlanState>) => void; clearPlan: () => void;
  drag: DragState | null; setDrag: (d: DragState | null) => void;
  quickAddFocus: number; focusQuickAdd: () => void;
  week: { key: string; days: WeekDay[]; cards: WeekCard[] } | null; setWeek: (w: UiState["week"]) => void;
  dump: DumpState; setDump: (d: Partial<DumpState>) => void;
  cheer: { n: number; msg: string; kind?: CheerKind }; celebrate: (msg: string, kind?: CheerKind) => void;
  nowTaskId: string | null; setNowTask: (id: string | null) => void;
  awayDays: number;
}

/** The brain dump survives closing the dialog, so nothing typed or sorted is lost. */
export interface DumpState { text: string; proposals: Proposal[] | null; questions: string[]; filing: boolean; ideaIds?: string[] }
const EMPTY_DUMP: DumpState = { text: "", proposals: null, questions: [], filing: false };
export { EMPTY_DUMP };

const EMPTY_PLAN: PlanState = { active: false, items: [], unplaced: [], freeMin: 0, seed: 0 };
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useUi = create<UiState>((set) => ({
  view: "day", setView: (view) => set({ view }),
  tab: "today", setTab: (tab) => set({ tab, project: null }),
  project: null, setProject: (project) => set({ project }),
  toast: null,
  showToast: (msg, action) => {
    clearTimeout(toastTimer);
    set({ toast: { id: Date.now(), msg, action } });
    toastTimer = setTimeout(() => set({ toast: null }), 5000);
  },
  hideToast: () => set({ toast: null }),
  dialogs: { settings: false, triage: false, planner: false, calendars: false, areas: false, dump: false, claude: false, shutdown: false, help: false, morning: false, backlog: false, fresh: false, reminders: false, constellation: false, wallpaper: false, heal: false, letter: false, review: false },
  openDialog: (d) => set((s) => {
    // 5.0: the old settings dialogs live in the one settings page now; asking for one opens that section.
    const at = ({ planner: "planner", reminders: "reminders", wallpaper: "wallpaper", calendars: "calendars" } as Record<string, string>)[d];
    if (at) return { dialogs: { ...s.dialogs, settings: true }, settingsAt: at };
    const dialogs = { ...s.dialogs };
    if (RITUALS.includes(d)) for (const r of RITUALS) dialogs[r] = false;   // one ritual at a time
    dialogs[d] = true;
    return { dialogs };
  }),
  closeDialog: (d) => set((s) => ({ dialogs: { ...s.dialogs, [d]: false } })),
  plan: EMPTY_PLAN,
  setPlan: (p) => set((s) => ({ plan: { ...s.plan, ...p } })),
  clearPlan: () => set((s) => ({ plan: { ...EMPTY_PLAN, seed: s.plan.seed } })),
  drag: null, setDrag: (drag) => set({ drag }),
  quickAddFocus: 0, focusQuickAdd: () => set((s) => ({ quickAddFocus: s.quickAddFocus + 1, view: "day" })),
  week: null, setWeek: (week) => set({ week }),
  dump: EMPTY_DUMP, setDump: (d) => set((s) => ({ dump: { ...s.dump, ...d } })),
  cheer: { n: 0, msg: "" }, celebrate: (msg, kind) => set((s) => ({ cheer: { n: s.cheer.n + 1, msg, kind } })),
  nowTaskId: null, setNowTask: (nowTaskId) => set({ nowTaskId }),
  awayDays: 0,
}));

export const toast = (msg: string, action?: Toast["action"]) => useUi.getState().showToast(msg, action);
