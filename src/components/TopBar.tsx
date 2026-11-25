import { useEffect, useState } from "react";
import { fmtTime, parseDue } from "../lib/dates";
import { splitToday } from "../lib/tasks";
import { api } from "../lib/api";
import { queryClient, qk, refreshAll } from "../data/queries";
import { useData } from "../data/useData";
import { useUi, type View } from "../state/ui";
import { useNow } from "./useNow";
import { ShutdownPill } from "./ShutdownDialog";
import { StreakChip } from "./Habits";
import { RELEASE_URL, VERSION } from "../lib/version";
import { updateConfig } from "../data/actions";
import { flush, usePending } from "../data/pending";

const VIEWS: { id: View; label: string; title: string }[] = [
  { id: "day", label: "Day", title: "Plan your day (D)" },
  { id: "week", label: "Week", title: "Plan your week (W)" },
  { id: "areas", label: "Sky", title: "Your areas and projects, as a night sky (A)" },
  { id: "progress", label: "Progress", title: "Planned vs. done, and what Praxis has learned (G)" },
];

export function TopBar() {
  const { today, trayIds, todayQ, loading, config } = useData();
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
  const pending = usePending();
  const status = todayQ.isError ? "Couldn't sync — retrying soon" : todayQ.isFetching && !todayQ.data ? "Syncing…" : synced;

  return (
    <header className="topbar">
      <div className="dateblock">
        <div id="weekday" className="weekday">{now.toLocaleDateString([], { weekday: "long" })}<span id="version-tag" className="version-tag" title={`Praxis ${VERSION}`}>v{VERSION}</span></div>
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
        <StreakChip />
        <UpdatedChip />
        {pending.count > 0 && <button id="pending-chip" className="pending-chip" title="Todoist couldn't be reached, so these changes are kept here and sent as soon as it's back. Click to try now." onClick={() => flush()}>
          {pending.count} change{pending.count === 1 ? "" : "s"} waiting for Todoist</button>}
        <span id="sync-status" className="sync-status">{status}</span>
        <ShutdownPill />
        <button id="dump-btn" className="ghost-btn dump-btn" title="Brain dump: Claude turns a messy list into tasks (B)" onClick={() => openDialog("dump")}>✦ Brain dump</button>
        <button id="refresh-btn" className={`icon-btn ${todayQ.isFetching ? "spinning" : ""}`} title="Refresh (R)" aria-label="Refresh" onClick={() => refreshAll(true)}>
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" /></svg>
        </button>
        <div className="menu-wrap">
          <button id="menu-btn" className="icon-btn" title="Settings" aria-label="Settings" onClick={(e) => { e.stopPropagation(); setMenu(!menu); }}>
            <svg viewBox="0 0 24 24" width="18" height="18"><circle cx="5" cy="12" r="1.8" fill="currentColor" /><circle cx="12" cy="12" r="1.8" fill="currentColor" /><circle cx="19" cy="12" r="1.8" fill="currentColor" /></svg>
          </button>
          <div id="menu" className="menu" hidden={!menu}>
            <button id="planner-settings-btn" onClick={() => { setMenu(false); openDialog("planner"); }}>Planner settings…</button>
            <button id="new-project-btn" onClick={() => { setMenu(false); openDialog("constellation"); }}>New project…</button>
            <button id="reminders-btn" onClick={() => { setMenu(false); openDialog("reminders"); }}>Reminders…</button>
            <button id="wallpaper-btn" onClick={() => { setMenu(false); openDialog("wallpaper"); }}>Wallpaper…</button>
            <button id="letter-btn" onClick={() => { setMenu(false); openDialog("letter"); }}>Sunday letter…</button>
            <button id="review-btn" onClick={() => { setMenu(false); openDialog("review"); }}>Weekly review…</button>
            <button id="calendars-btn" onClick={() => { setMenu(false); openDialog("calendars"); }}>Calendars…</button>
            <button id="claude-btn" onClick={() => { setMenu(false); openDialog("claude"); }}>Claude…</button>
            <button id="backlog-btn" onClick={() => { setMenu(false); openDialog("backlog"); }}>Clean up backlog with Claude…</button>
            <button id="shutdown-btn" onClick={() => { setMenu(false); openDialog("shutdown"); }}>Shut down the day… (S)</button>
            <div className="menu-group" id="appearance">
              <span className="menu-label">Theme</span>
              <div className="seg" role="radiogroup" aria-label="Theme">
                {(["auto", "dark", "light"] as const).map((t) => (
                  <button key={t} role="radio" aria-checked={(config?.ui?.theme || "auto") === t} data-theme-opt={t} className={(config?.ui?.theme || "auto") === t ? "on" : ""}
                    onClick={(e) => { e.stopPropagation(); updateConfig((c) => ({ ...c, ui: { ...(c.ui || {}), theme: t } })); }}>{t === "auto" ? "Auto" : t === "dark" ? "Dark" : "Light"}</button>
                ))}
              </div>
              <label className="menu-switch" onClick={(e) => e.stopPropagation()}><input type="checkbox" id="warm-evenings" checked={config?.ui?.warmEvenings !== false} onChange={(e) => updateConfig((c) => ({ ...c, ui: { ...(c.ui || {}), warmEvenings: e.target.checked } }))} /> Warmer colors after 8 PM</label>
              <label className="menu-switch" onClick={(e) => e.stopPropagation()}><input type="checkbox" id="horizon-layout" checked={config?.ui?.dayLayout !== "classic"} onChange={(e) => updateConfig((c) => ({ ...c, ui: { ...(c.ui || {}), dayLayout: e.target.checked ? "horizon" : "classic" } }))} /> Day as a horizon (left to right)</label>
              <label className="menu-switch" onClick={(e) => e.stopPropagation()}><input type="checkbox" id="focus-mode" checked={!!config?.ui?.focus} onChange={(e) => updateConfig((c) => ({ ...c, ui: { ...(c.ui || {}), focus: e.target.checked } }))} /> Focus mode (F): only what's next</label>
            </div>
            <button id="help-btn" onClick={() => { setMenu(false); openDialog("help"); }}>Keyboard shortcuts (?)</button>
            <a href="https://app.todoist.com/app/today" target="_blank" rel="noopener">Open Todoist</a>
            <button id="disconnect-btn" onClick={async () => {
              if (!confirm("Disconnect Todoist? Your tasks stay in Todoist; Praxis just forgets the token.")) return;
              await api("/api/token", { method: "DELETE" });
              queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== qk.status[0] });
              queryClient.refetchQueries({ queryKey: qk.status });
            }}>Disconnect Todoist</button>
            <div className="menu-foot" id="menu-version">
              <span>Praxis <b>{VERSION}</b></span>
              <a href={RELEASE_URL} target="_blank" rel="noopener">What's new</a>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

/** After an update: "Updated to 1.0.1 · What's new" until you dismiss it. */
function UpdatedChip() {
  const { config } = useData();
  const seen = config?.lastSeenVersion as string | undefined;
  const dismiss = () => updateConfig((c) => ({ ...c, lastSeenVersion: VERSION })).catch(() => undefined);
  useEffect(() => { if (config && !seen) dismiss(); }, [!!config, seen]); // first install: nothing to announce
  if (!config || !seen || seen === VERSION) return null;
  return (
    <span className="updated-chip" id="updated-chip">
      <a href={RELEASE_URL} target="_blank" rel="noopener" onClick={dismiss}>✦ Updated to {VERSION} · What's new</a>
      <button aria-label="Dismiss" title="Dismiss" onClick={dismiss}>×</button>
    </span>
  );
}
