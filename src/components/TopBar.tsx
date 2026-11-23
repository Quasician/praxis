import { useEffect, useState } from "react";
import { fmtTime, parseDue } from "../lib/dates";
import { splitToday } from "../lib/tasks";
import { api } from "../lib/api";
import { queryClient, qk, refreshAll } from "../data/queries";
import { useData } from "../data/useData";
import { useUi, type View } from "../state/ui";
import { useNow } from "./useNow";

const VIEWS: { id: View; label: string; title: string }[] = [
  { id: "day", label: "Day", title: "Plan your day (D)" },
  { id: "week", label: "Week", title: "Plan your week (W)" },
  { id: "areas", label: "Areas", title: "Life areas and milestones (A)" },
];

export function TopBar() {
  const { today, trayIds, todayQ, loading } = useData();
  const { view, setView, openDialog } = useUi();
  const [menu, setMenu] = useState(false);
  const now = useNow();

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menu]);

  const { overdue, today: todayList } = splitToday(today.filter((t) => !trayIds.has(t.id)));
  const timedLeft = todayList.filter((t) => { const d = parseDue(t.due); return d && d.hasTime && d.d > now; }).length;
  const synced = todayQ.dataUpdatedAt ? `Synced ${fmtTime(new Date(todayQ.dataUpdatedAt))}` : "";
  const status = todayQ.isError ? "Couldn't sync — retrying soon" : todayQ.isFetching && !todayQ.data ? "Syncing…" : synced;

  return (
    <header className="topbar">
      <div className="dateblock">
        <div id="weekday" className="weekday">{now.toLocaleDateString([], { weekday: "long" })}</div>
        <div id="fulldate" className="fulldate">{now.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })}</div>
      </div>
      <nav className="views" role="tablist" aria-label="View">
        {VIEWS.map((v) => (
          <button key={v.id} role="tab" data-view={v.id} className={`view-btn ${view === v.id ? "active" : ""}`} title={v.title} onClick={() => setView(v.id)}>{v.label}</button>
        ))}
      </nav>
      <div className="summary" id="summary" hidden={view !== "day"}>
        {!loading && <>
          <span><b>{todayList.length}</b> today</span>
          {overdue.length > 0 && <span className="overdue"><b>{overdue.length}</b> overdue</span>}
          {timedLeft > 0 && <span><b>{timedLeft}</b> still scheduled</span>}
          {trayIds.size > 0 && <button id="summary-triage" className="sum-tray" title="Review tasks that need a decision" onClick={() => openDialog("triage")}>⚑ <b>{trayIds.size}</b> need a decision</button>}
        </>}
      </div>
      <div className="actions">
        <span id="sync-status" className="sync-status">{status}</span>
        <button id="refresh-btn" className={`icon-btn ${todayQ.isFetching ? "spinning" : ""}`} title="Refresh (R)" aria-label="Refresh" onClick={() => refreshAll(true)}>
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" /></svg>
        </button>
        <div className="menu-wrap">
          <button id="menu-btn" className="icon-btn" title="Settings" aria-label="Settings" onClick={(e) => { e.stopPropagation(); setMenu(!menu); }}>
            <svg viewBox="0 0 24 24" width="18" height="18"><circle cx="5" cy="12" r="1.8" fill="currentColor" /><circle cx="12" cy="12" r="1.8" fill="currentColor" /><circle cx="19" cy="12" r="1.8" fill="currentColor" /></svg>
          </button>
          <div id="menu" className="menu" hidden={!menu}>
            <button id="planner-settings-btn" onClick={() => { setMenu(false); openDialog("planner"); }}>Planner settings…</button>
            <button id="calendars-btn" onClick={() => { setMenu(false); openDialog("calendars"); }}>Calendars…</button>
            <a href="https://app.todoist.com/app/today" target="_blank" rel="noopener">Open Todoist</a>
            <button id="disconnect-btn" onClick={async () => {
              if (!confirm("Disconnect Todoist? Your tasks stay in Todoist; Praxis just forgets the token.")) return;
              await api("/api/token", { method: "DELETE" });
              queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== qk.status[0] });
              queryClient.refetchQueries({ queryKey: qk.status });
            }}>Disconnect Todoist</button>
          </div>
        </div>
      </div>
    </header>
  );
}
