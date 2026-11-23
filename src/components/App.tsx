import { useEffect, useRef } from "react";
import { ApiError } from "../lib/api";
import { minOfDay, toMin, ymd } from "../lib/dates";
import { willpower } from "../lib/tasks";
import type { Task } from "../lib/types";
import { plannerCfg } from "../domain/planner";
import { observeTasks } from "../domain/triage";
import { ensureConfig, updateConfig } from "../data/actions";
import { acceptPlan, computePlan, proposePlan } from "../data/planActions";
import { queryClient, qk, refreshAll, useActive } from "../data/queries";
import { useData } from "../data/useData";
import { toast, useUi } from "../state/ui";
import { AreasView } from "./AreasView";
import { CalendarsDialog } from "./CalendarsDialog";
import { DragGhost, Toast } from "./common";
import { cancelDrag, isDragging } from "./drag";
import { PlannerSettingsDialog } from "./PlannerSettings";
import { Setup } from "./Setup";
import { TasksPane } from "./TasksPane";
import { TimelinePane } from "./Timeline";
import { TopBar } from "./TopBar";
import { TriageDialog } from "./TriageDialog";
import { BrainDumpDialog, ClaudeDialog } from "./BrainDump";
import { useMedia } from "./useNow";
import { WeekView, useWeeklyAuto } from "./WeekView";

export function App() {
  const { status, connected, todayQ } = useData();
  if (status.isPending) return null;
  if (!connected) return <Setup />;
  if (todayQ.error instanceof ApiError && todayQ.error.status === 401) return <Setup message="Your Todoist connection expired. Paste your token again." />;
  return <Shell />;
}

function Shell() {
  const view = useUi((s) => s.view);
  const wide = useMedia("(min-width: 2200px)"); // ultrawide: show areas beside the day
  useBackgroundJobs();
  useShortcuts();
  return (
    <div id="app" className="app">
      <TopBar />
      {view === "day" && <main className={`layout${wide ? " wide" : ""}`}><TasksPane /><TimelinePane />{wide && <AreasView side />}</main>}
      {view === "week" && <WeekView />}
      {view === "areas" && <AreasView />}
      <TriageDialog />
      <PlannerSettingsDialog />
      <CalendarsDialog />
      <BrainDumpDialog />
      <ClaudeDialog />
      <Toast />
      <DragGhost />
    </div>
  );
}

/** Daily auto-plan, slip tracking, calendar error notices. */
function useBackgroundJobs() {
  const { todayQ, projectsQ, configQ, eventsQ, connected } = useData();
  const activeQ = useActive(connected); // full task list every 10 minutes (catches postponements made on your phone)
  const weeklyStarted = useWeeklyAuto();

  // First-run settings (areas guessed from project names).
  useEffect(() => { if (configQ.isSuccess && projectsQ.isSuccess) ensureConfig().catch(() => undefined); }, [configQ.isSuccess, projectsQ.isSuccess]);

  // Propose a plan the first time Praxis opens each day.
  const autoChecked = useRef(false);
  useEffect(() => {
    if (autoChecked.current || !todayQ.isSuccess || !configQ.isSuccess || !projectsQ.isSuccess || weeklyStarted === null) return;
    autoChecked.current = true;
    (async () => {
      const cfg = plannerCfg(await ensureConfig());
      const today = ymd(new Date());
      if (!cfg.auto || cfg.lastAuto === today || weeklyStarted) return;
      if (minOfDay(new Date()) > toMin(cfg.dayEnd) - 30) return;
      const plan = await computePlan();
      await updateConfig((c) => ({ ...c, planner: { ...(c.planner || {}), lastAuto: today } }));
      if (plan.items.length) {
        useUi.getState().setPlan({ ...plan, active: true });
        toast("Here's a plan for the rest of today. Accept it, adjust it, or discard it.");
      }
    })().catch((e) => console.warn("Auto-plan skipped:", e));
  }, [todayQ.isSuccess, configQ.isSuccess, projectsQ.isSuccess, weeklyStarted]);

  // Slip tracking: a task pushed later while already due counts as a slip.
  const observe = (tasks: Task[], complete: boolean) => {
    const mem = queryClient.getQueryData<{ taskMemory?: Record<string, { due: string; moves: number }> }>(qk.config)?.taskMemory || {};
    if (!observeTasks(mem, tasks, complete)) return;
    updateConfig((c) => { const next = observeTasks(c.taskMemory || {}, tasks, complete); return next ? { ...c, taskMemory: next } : c; }).catch(() => undefined);
  };
  useEffect(() => { if (todayQ.data && configQ.isSuccess) observe(todayQ.data, false); }, [todayQ.data, configQ.isSuccess]); // eslint-disable-line
  useEffect(() => { if (activeQ.data && configQ.isSuccess) observe(activeQ.data, true); }, [activeQ.data, configQ.isSuccess]); // eslint-disable-line

  // Tell you once when a calendar can't be loaded.
  const lastErr = useRef("");
  useEffect(() => {
    const errs = (eventsQ.data?.errors || []).map((x) => `${x.name}: ${x.error}`).join();
    if (errs && errs !== lastErr.current) toast(`Couldn't load calendar ${errs.split(",")[0]}`);
    lastErr.current = errs;
  }, [eventsQ.data]);

  // Hooks for automated tests (harmless in normal use).
  const { cfg } = useData();
  useEffect(() => {
    (window as unknown as { __praxis: unknown }).__praxis = {
      planner: () => useUi.getState().plan,
      willpower: (t: Task) => willpower(t, cfg),
      refresh: () => refreshAll(),
      plan: (reshuffle?: boolean) => proposePlan(reshuffle),
      resetFullScan: () => queryClient.invalidateQueries({ queryKey: qk.active }),
    };
  }, [cfg]);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      const el = document.activeElement as HTMLElement | null;
      const typing = (el && /INPUT|TEXTAREA|SELECT/.test(el.tagName)) || !!document.querySelector("dialog[open]");
      if (e.key === "Escape") {
        if (isDragging()) { cancelDrag(); return; }
        el?.blur();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "q" || e.key === "/") { e.preventDefault(); ui.focusQuickAdd(); }
      else if (e.key === "r") refreshAll(true);
      else if (e.key === "1") { ui.setView("day"); ui.setTab("today"); }
      else if (e.key === "2") { ui.setView("day"); ui.setTab("inbox"); }
      else if (e.key === "d") ui.setView("day");
      else if (e.key === "w") ui.setView("week");
      else if (e.key === "a") ui.setView("areas");
      else if (e.key === "p") proposePlan();
      else if (e.key === "b") { e.preventDefault(); ui.openDialog("dump"); }
      else if (e.key === "Enter" && ui.plan.active && ui.plan.items.length) acceptPlan();
    };
    document.addEventListener("keydown", onKey);
    // Desktop app: global quick-add hotkey.
    const onQuickAdd = () => useUi.getState().focusQuickAdd();
    const onDump = () => useUi.getState().openDialog("dump");
    window.addEventListener("praxis:quick-add", onQuickAdd);
    window.addEventListener("praxis:brain-dump", onDump);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("praxis:quick-add", onQuickAdd);
      window.removeEventListener("praxis:brain-dump", onDump);
    };
  }, []);
}
