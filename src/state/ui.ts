// UI state that isn't Todoist data: current view, filters, toasts, dialogs, the plan proposal, drag state.
import { create } from "zustand";
import type { Candidate, PlanItem } from "../domain/planner";
import type { Task } from "../lib/types";
import type { WeekCard, WeekDay } from "../domain/week";

export type View = "day" | "week" | "areas";
export type DialogName = "triage" | "planner" | "calendars" | "areas";

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

export interface PlanState { active: boolean; items: PlanItem[]; unplaced: Candidate[]; freeMin: number; seed: number }

interface UiState {
  view: View; setView: (v: View) => void;
  tab: "today" | "inbox"; setTab: (t: "today" | "inbox") => void;
  project: string | null; setProject: (p: string | null) => void;
  toast: Toast | null; showToast: (msg: string, action?: Toast["action"]) => void; hideToast: () => void;
  dialogs: Record<DialogName, boolean>; openDialog: (d: DialogName) => void; closeDialog: (d: DialogName) => void;
  plan: PlanState; setPlan: (p: Partial<PlanState>) => void; clearPlan: () => void;
  drag: DragState | null; setDrag: (d: DragState | null) => void;
  quickAddFocus: number; focusQuickAdd: () => void;
  week: { key: string; days: WeekDay[]; cards: WeekCard[] } | null; setWeek: (w: UiState["week"]) => void;
}

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
  dialogs: { triage: false, planner: false, calendars: false, areas: false },
  openDialog: (d) => set((s) => ({ dialogs: { ...s.dialogs, [d]: true } })),
  closeDialog: (d) => set((s) => ({ dialogs: { ...s.dialogs, [d]: false } })),
  plan: EMPTY_PLAN,
  setPlan: (p) => set((s) => ({ plan: { ...s.plan, ...p } })),
  clearPlan: () => set((s) => ({ plan: { ...EMPTY_PLAN, seed: s.plan.seed } })),
  drag: null, setDrag: (drag) => set({ drag }),
  quickAddFocus: 0, focusQuickAdd: () => set((s) => ({ quickAddFocus: s.quickAddFocus + 1, view: "day" })),
  week: null, setWeek: (week) => set({ week }),
}));

export const toast = (msg: string, action?: Toast["action"]) => useUi.getState().showToast(msg, action);
