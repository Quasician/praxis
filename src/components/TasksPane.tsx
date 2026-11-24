import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { usePending } from "../data/pending";
import { HealNoteCard } from "./HealNote";
import { fmtDayShort, fmtDuration, fmtTime, durationMinutes, parseDue, sameDay } from "../lib/dates";
import { blockMinutes, sortTasks, splitToday } from "../lib/tasks";
import { Inline, colorOf, plain } from "../lib/text";
import type { Task } from "../lib/types";
import { completeTask, quickAdd } from "../data/actions";
import { useCommitted, useData } from "../data/useData";
import { NowCard } from "./NowCard";
import { updateConfig } from "../data/actions";
import { useUi } from "../state/ui";
import { startDrag } from "./drag";

type Ctx = "overdue" | "today" | "inbox";

export function TasksPane() {
  const { today, inbox, trayIds, loading, config } = useData();
  const { tab, setTab, project, openDialog } = useUi();
  const { overdue, today: todayList } = useMemo(() => splitToday(today.filter((t) => !trayIds.has(t.id))), [today, trayIds]);
  const source = tab === "today" ? [...overdue, ...todayList] : inbox;
  const keep = (t: Task) => !project || t.project_id === project;
  const nowId = useUi((s) => s.nowTaskId);

  // Focus mode: just Now and the next three. Nothing else asks for attention.
  if (config?.ui?.focus) {
    const next = [...todayList, ...overdue].filter((t) => t.id !== nowId).slice(0, 3);
    return (
      <section className="tasks-pane focus-pane" id="focus-pane">
        <NowCard />
        {next.length > 0 && <><h3 className="focus-title">Up next</h3><ul className="tasks focus-list">{next.map((t) => <TaskRow key={t.id} t={t} ctx="today" />)}</ul></>}
        <button className="ghost-btn focus-exit" id="focus-exit" onClick={() => updateConfig((c) => ({ ...c, ui: { ...(c.ui || {}), focus: false } }))}>Show everything (F)</button>
      </section>
    );
  }

  return (
    <section className="tasks-pane">
      <NowCard />
      <HealNoteCard />
      <nav className="tabs" role="tablist">
        <button role="tab" data-tab="today" className={`tab ${tab === "today" ? "active" : ""}`} onClick={() => setTab("today")}>
          Today <span className="count" id="count-today">{loading ? "" : overdue.length + todayList.length || ""}</span>
        </button>
        <button role="tab" data-tab="inbox" className={`tab ${tab === "inbox" ? "active" : ""}`} onClick={() => setTab("inbox")}>
          Inbox <span className="count" id="count-inbox">{loading ? "" : inbox.length || ""}</span>
        </button>
      </nav>

      <QuickAdd forToday={tab === "today"} />
      {!loading && <Chips tasks={source} />}

      <div id="list" className="list" aria-live="polite">
        {loading ? Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" />)
          : tab === "today" ? (
            <>
              {trayIds.size > 0 && (
                <button className="tray-banner" id="open-triage" onClick={() => openDialog("triage")}>
                  <span className="tray-flag">⚑</span>
                  <span><b>{trayIds.size} task{trayIds.size === 1 ? "" : "s"}</b> need{trayIds.size === 1 ? "s" : ""} a decision</span>
                  <span className="tray-go">Review</span>
                </button>
              )}
              <Group title="Overdue" ctx="overdue" tasks={overdue.filter(keep)} />
              <Group title="Today" ctx="today" tasks={todayList.filter(keep)} />
              {!overdue.filter(keep).length && !todayList.filter(keep).length && (
                <div className="empty"><div className="big">All clear.</div>Nothing due today. Enjoy it, or pull something from your Inbox.</div>
              )}
            </>
          ) : (() => {
            const items = sortTasks(inbox.filter(keep), "inbox");
            return items.length
              ? <>
                  <button className="tray-banner dump-banner" id="file-inbox" onClick={() => openDialog("dump")}>
                    <span className="tray-flag">✦</span>
                    <span><b>{items.length} in your Inbox.</b> Let Claude file them: project, date, effort.</span>
                    <span className="tray-go">Sort</span>
                  </button>
                  <ul className="tasks" style={{ marginTop: 6 }}>{items.map((t) => <TaskRow key={t.id} t={t} ctx="inbox" />)}</ul>
                </>
              : <div className="empty"><div className="big">Inbox zero.</div>Anything you capture on your phone lands here.</div>;
          })()}
      </div>
    </section>
  );
}

function Chips({ tasks }: { tasks: Task[] }) {
  const { projects } = useData();
  const { project, setProject } = useUi();
  const counts = new Map<string, number>();
  for (const t of tasks) counts.set(t.project_id, (counts.get(t.project_id) || 0) + 1);
  const stale = !!project && !counts.has(project);
  useEffect(() => { if (stale) setProject(null); }, [stale, setProject]);
  if (counts.size < 2) return <div id="chips" className="chips" />;
  return (
    <div id="chips" className="chips">
      <button className={`chip ${project ? "" : "active"}`} onClick={() => setProject(null)}>All <span className="n">{tasks.length}</span></button>
      {[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => {
        const p = projects.get(id);
        if (!p) return null;
        return (
          <button key={id} className={`chip ${project === id ? "active" : ""}`} onClick={() => setProject(id)}>
            <span className="dot" style={{ background: colorOf(p.color) }} />{p.name} <span className="n">{n}</span>
          </button>
        );
      })}
    </div>
  );
}

function Group({ title, ctx, tasks }: { title: string; ctx: Ctx; tasks: Task[] }) {
  if (!tasks.length) return null;
  return (
    <>
      <div className={`group-title ${ctx === "overdue" ? "overdue" : ""}`}>{title} <span className="n">{tasks.length}</span></div>
      <ul className="tasks">{tasks.map((t) => <TaskRow key={t.id} t={t} ctx={ctx} />)}</ul>
    </>
  );
}

function TaskRow({ t, ctx }: { t: Task; ctx: Ctx }) {
  const committed = useCommitted();
  const { projects } = useData();
  const lifting = useUi((s) => !!s.drag && s.drag.proposalIdx === undefined && s.drag.task.id === t.id);
  const pending = usePending().ids.has(t.id);
  const [done, setDone] = useState(false);
  const due = parseDue(t.due);
  const proj = projects.get(t.project_id);
  const now = new Date();
  const dur = durationMinutes(t);

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".check, a, button")) return;
    e.preventDefault(); // no text selection while dragging
    startDrag(e, { kind: "new", task: t, start: 0, dur: blockMinutes(t), grab: 0 });
  };
  const complete = () => { setDone(true); setTimeout(() => completeTask(t), 520); }; // let the check pop and the row fold first

  return (
    <li className={`task p${t.priority || 1} ${t.parent_id ? "sub" : ""} ${done ? "done" : ""} ${lifting ? "lifting" : ""} ${pending ? "pending" : ""}`} data-id={t.id} onPointerDown={onPointerDown}
        title={pending ? "Waiting to reach Todoist" : undefined}>
      <button className="check" title="Complete" aria-label="Complete task" onClick={complete}>
        <svg viewBox="0 0 24 24" width="12" height="12"><path fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </button>
      <div className="body">
        <div className="content">{committed.has(t.id) && <span className={`commit-star ${committed.get(t.id)!.star ? "the-one" : ""}`} title={committed.get(t.id)!.star ? "The one that matters today" : "Committed today"}>★ </span>}<Inline text={t.content} /></div>
        {t.description && <div className="desc">{plain(t.description.split("\n")[0])}</div>}
        <div className="meta">
          {due && ctx === "overdue" && <span className="late">{fmtDayShort(due.d)}{due.hasTime ? " " + fmtTime(due.d) : ""}</span>}
          {due && ctx !== "overdue" && due.hasTime && <span className={`time ${sameDay(due.d, now) && due.d < now ? "late" : ""}`}>{fmtTime(due.d)}</span>}
          {due && ctx === "inbox" && !due.hasTime && <span>{sameDay(due.d, now) ? "Today" : due.d.toLocaleDateString([], { month: "short", day: "numeric" })}</span>}
          {due?.recurring && <span title="Repeats">↻</span>}
          {dur ? <span>{fmtDuration(dur)}</span> : null}
          {proj && ctx !== "inbox" && <span className="proj"><i style={{ background: colorOf(proj.color) }} />{proj.name}</span>}
          {(t.labels || []).map((l) => <span key={l}>@{l}</span>)}
        </div>
      </div>
      <a className="open-link" href={`https://app.todoist.com/app/task/${encodeURIComponent(t.id)}`} target="_blank" rel="noopener" title="Open in Todoist">↗</a>
    </li>
  );
}

function QuickAdd({ forToday }: { forToday: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const focusTick = useUi((s) => s.quickAddFocus);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (focusTick) ref.current?.focus(); }, [focusTick]);
  return (
    <form id="quick-add" className="quick-add" autoComplete="off" onSubmit={async (e) => {
      e.preventDefault();
      const text = ref.current!.value.trim();
      if (!text) return;
      setBusy(true);
      try { await quickAdd(text, forToday); ref.current!.value = ""; }
      catch (err) { useUi.getState().showToast(`Couldn't add task: ${(err as Error).message}`); }
      finally { setBusy(false); setTimeout(() => ref.current?.focus(), 0); }
    }}>
      <span className="plus">+</span>
      <input id="quick-input" ref={ref} type="text" disabled={busy}
             placeholder={forToday ? "Add a task for today — e.g. “Call landlord 3pm”" : "Add to Inbox — e.g. “Return boots friday”"} />
      <kbd>Q</kbd>
    </form>
  );
}
