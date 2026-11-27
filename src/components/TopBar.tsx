import { useEffect, useState } from "react";
import { fmtTime, parseDue } from "../lib/dates";
import { splitToday } from "../lib/tasks";
import { api } from "../lib/api";
import { queryClient, qk, refreshAll } from "../data/queries";
import { useData } from "../data/useData";
import { useUi, type View } from "../state/ui";
import { useNow } from "./useNow";
import { RitualMarker } from "./ShutdownDialog";
import { StreakChip } from "./Habits";
import { VERSION } from "../lib/version";
import { WhatsNewCard } from "./Asks";
import { openSettings } from "./SettingsDialog";
import { updateConfig } from "../data/actions";
import { flush, usePending } from "../data/pending";
import { copyDiagnostics } from "../lib/diagnostics";
import { toast } from "../state/ui";

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
    <header className="topbar">{/* in the canvas (5.0) the same bar sits on the sky; Day, Week and Sky are zoom levels, Progress pulls in from the right */}
      <div className="dateblock">
        <div id="weekday" className="weekday">{now.toLocaleDateString([], { weekday: "long" })}<span id="version-tag" className="version-tag" title={`Praxis ${VERSION}`}>v{VERSION}</span></div>
        <div id="fulldate" className="fulldate">{now.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" })}</div>
      </div>
      <nav className="views" role="tablist" aria-label="View">
        {VIEWS.map((v) => (
          <button key={v.id} role="tab" data-view={v.id} className={`view-btn ${view === v.id ? "active" : ""}`} title={v.title} onClick={() => setView(v.id)}>{config?.ui?.canvas !== false && v.id === "progress" ? "Numbers" : v.label}</button>
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
        <RitualMarker />
        <button id="dump-btn" className="ghost-btn dump-btn" title="Brain dump: Claude turns a messy list into tasks (B)" onClick={() => openDialog("dump")}>✦ Brain dump</button>
        <button id="refresh-btn" className={`icon-btn ${todayQ.isFetching ? "spinning" : ""}`} title="Refresh (R)" aria-label="Refresh" onClick={() => refreshAll(true)}>
          <svg viewBox="0 0 24 24" width="18" height="18"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" /></svg>
        </button>
        <div className="menu-wrap">
          <button id="menu-btn" className="icon-btn" title="Settings" aria-label="Settings" onClick={(e) => { e.stopPropagation(); setMenu(!menu); }}>
            <svg viewBox="0 0 24 24" width="18" height="18"><circle cx="5" cy="12" r="1.8" fill="currentColor" /><circle cx="12" cy="12" r="1.8" fill="currentColor" /><circle cx="19" cy="12" r="1.8" fill="currentColor" /></svg>
          </button>
          <div id="menu" className="menu" hidden={!menu}>
            <button id="settings-btn" className="menu-strong" onClick={() => { setMenu(false); openSettings(); }}>Settings… <span className="menu-hint">theme, planner, reminders, lock, wallpaper</span></button>
            <button id="cmd-btn" onClick={() => { setMenu(false); useUi.setState({ cmdOpen: true }); }}>Command bar… (/)</button>
            <button id="new-project-btn" onClick={() => { setMenu(false); openDialog("constellation"); }}>New project…</button>
            <button id="letter-btn" onClick={() => { setMenu(false); openDialog("letter"); }}>Sunday letter…</button>
            <button id="review-btn" onClick={() => { setMenu(false); openDialog("review"); }}>Weekly review…</button>
            <button id="backlog-btn" onClick={() => { setMenu(false); openDialog("backlog"); }}>Clean up backlog with Claude…</button>
            <button id="shutdown-btn" onClick={() => { setMenu(false); openDialog("shutdown"); }}>Shut down the day… (S)</button>
            <button id="help-btn" onClick={() => { setMenu(false); openDialog("help"); }}>Keyboard shortcuts (?)</button>
            <button id="diagnostics-btn" title="Copies the version, settings (nothing private) and recent log, to paste into a chat with Claude when something's wrong" onClick={async () => {
              setMenu(false);
              try { toast(await copyDiagnostics() ? "Diagnostics copied. Paste them into your chat with Claude." : "Couldn't copy the diagnostics."); }
              catch (e) { toast(`Couldn't gather the diagnostics: ${(e as Error).message}`); }
            }}>Copy diagnostics</button>
            <a href="https://app.todoist.com/app/today" target="_blank" rel="noopener">Open Todoist</a>
            <button id="disconnect-btn" onClick={async () => {
              if (!confirm("Disconnect Todoist? Your tasks stay in Todoist; Praxis just forgets the token.")) return;
              await api("/api/token", { method: "DELETE" });
              queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== qk.status[0] });
              queryClient.refetchQueries({ queryKey: qk.status });
            }}>Disconnect Todoist</button>
            <div className="menu-foot" id="menu-version">
              <span>Praxis <b>{VERSION}</b></span>
              <button type="button" className="link-like" id="menu-news" onClick={() => useUi.setState({ newsOpen: true })}>What's new</button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

/** After an update: "Updated to 1.0.1 · What's new" opens a short card of what changed (5.0: in the app, not a link out). */
function UpdatedChip() {
  const { config } = useData();
  const seen = config?.lastSeenVersion as string | undefined;
  const open = useUi((s) => s.newsOpen);
  const dismiss = () => updateConfig((c) => ({ ...c, lastSeenVersion: VERSION })).catch(() => undefined);
  useEffect(() => { if (config && !seen) dismiss(); }, [!!config, seen]); // first install: nothing to announce
  const fresh = !!config && !!seen && seen !== VERSION;
  return (
    <>
      {fresh && (
        <span className="updated-chip" id="updated-chip">
          <button type="button" className="link-like" onClick={() => useUi.setState({ newsOpen: !open })}>✦ Updated to {VERSION} · What's new</button>
          <button aria-label="Dismiss" title="Dismiss" onClick={dismiss}>×</button>
        </span>
      )}
      {open && <div className="news-pop" id="news-pop" role="dialog" aria-label="What's new"><WhatsNewCard always onClose={() => useUi.setState({ newsOpen: false })} /></div>}
    </>
  );
}
