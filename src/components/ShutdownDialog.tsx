import { useEffect, useMemo, useRef } from "react";
import { completedAt } from "../domain/areas";
import { nextDate } from "../domain/triage";
import { dayCapacity, spreadTasks } from "../domain/week";
import { addDays, fmtSpan, minOfDay, parseDue, startOfToday, toMin, ymd } from "../lib/dates";
import { blockMinutes, isMilestone, willpower } from "../lib/tasks";
import { Inline, colorOf, plain } from "../lib/text";
import type { Task } from "../lib/types";
import { bulkMove, bulkPlace, finishTask, moveToSomeday, setTaskDate, updateConfig } from "../data/actions";
import { useActive, useCompleted, useEvents } from "../data/queries";
import { useData } from "../data/useData";
import { toast, useUi } from "../state/ui";
import { Dialog } from "./common";
import { useNow } from "./useNow";

export function ShutdownDialog() {
  return <Dialog name="shutdown" id="shutdown-dialog" className="shutdown-dialog"><ShutdownBody /></Dialog>;
}

/** True once it's past the reminder time and today hasn't been closed yet. */
export function useShutdownDue() {
  const { cfg, config } = useData();
  const now = useNow();
  return !!config && minOfDay(now) >= toMin(cfg.shutdownAt) && cfg.lastShutdown !== ymd(now);
}

/** The evening pill in the top bar (plus one gentle toast when it first appears). */
export function ShutdownPill() {
  const due = useShutdownDue();
  const openDialog = useUi((s) => s.openDialog);
  const told = useRef(false);
  useEffect(() => {
    if (due && !told.current) { told.current = true; toast("Time to shut down the day. Press S when you're ready."); }
  }, [due]);
  if (!due) return null;
  return <button id="shutdown-pill" className="shutdown-pill" title="Close out today (S)" onClick={() => openDialog("shutdown")}>☾ Shut down the day</button>;
}

function ShutdownBody() {
  const { today, connected, projects, cfg } = useData();
  const close = useUi((s) => s.closeDialog);
  const completedQ = useCompleted(connected);
  const activeQ = useActive(connected);
  const tomorrow = addDays(startOfToday(), 1);
  const eventsQ = useEvents(connected, tomorrow, addDays(tomorrow, 7)); // the week ahead, for spreading leftovers
  const todayKey = ymd(startOfToday()), tomKey = ymd(tomorrow);

  // 1. What got done
  const done = (completedQ.data || []).filter((t) => completedAt(t) >= startOfToday());
  const doneMin = done.reduce((s, t) => s + (t.duration?.unit === "minute" ? t.duration.amount : 0), 0);

  // 2. What's still open from today (and before)
  const open = today.filter((t) => { const d = parseDue(t.due); return d && ymd(d.d) <= todayKey && !isMilestone(t); })
    .sort((a, b) => (parseDue(a.due)!.d < parseDue(b.due)!.d ? 1 : -1));
  const movable = open.filter((t) => !t.due?.is_recurring);

  // 3. Tomorrow
  const tom = useMemo(() => (activeQ.data || []).filter((t) => { const d = parseDue(t.due); return d && ymd(d.d) === tomKey; }), [activeQ.data, tomKey]);
  const events = (eventsQ.data?.events || []).filter((e) => !e.allDay && new Date(e.start) < addDays(tomorrow, 1) && new Date(e.end) > tomorrow);
  const timed = tom.filter((t) => parseDue(t.due)!.hasTime);
  const capacity = dayCapacity(cfg, tomorrow, events, timed);
  const load = tom.filter((t) => !parseDue(t.due)!.hasTime).reduce((s, t) => s + blockMinutes(t), 0);
  const deep = tom.filter((t) => willpower(t, cfg) === 3).length;
  const sortedTom = [...tom].sort((a, b) => {
    const da = parseDue(a.due)!, db = parseDue(b.due)!;
    return (da.hasTime ? minOfDay(da.d) : 9999) - (db.hasTime ? minOfDay(db.d) : 9999) || willpower(b, cfg) - willpower(a, cfg);
  });

  const finish = async () => {
    await updateConfig((c) => ({ ...c, planner: { ...(c.planner || {}), lastShutdown: todayKey } }));
    close("shutdown");
    toast(open.length ? `Day closed. ${open.length} task${open.length === 1 ? " stays" : "s stay"} where ${open.length === 1 ? "it is" : "they are"}.` : "Day closed. Nothing left hanging. See you tomorrow.");
  };

  return (
    <div className="shutdown-form">
      <div>
        <h2>Shut down the day</h2>
        <p className="dialog-sub">Two minutes: see what you got done, give every leftover a home, glance at tomorrow. Then stop thinking about it.</p>
      </div>

      <section className="sd-section" id="sd-done">
        <h3>Done today <span className="n">{done.length}</span>{doneMin > 0 && <span className="sd-time"> · {fmtSpan(doneMin)}</span>}</h3>
        {done.length ? (
          <ul className="sd-done">{done.slice(0, 12).map((t, i) => (
            <li key={t.id + i} style={{ ["--c" as string]: colorOf(projects.get(t.project_id)?.color) }}><span className="sd-check">✓</span><Inline text={t.content} />{t.recurring && <span className="sd-rep" title="Repeating task">↻</span>}</li>
          ))}{done.length > 12 && <li className="sd-more">and {done.length - 12} more</li>}</ul>
        ) : <p className="sd-empty">Nothing ticked off today. That happens. Tomorrow's a fresh start.</p>}
      </section>

      <section className="sd-section" id="sd-open">
        <h3>Still open <span className="n">{open.length}</span>
          {movable.length > 1 && <span className="sd-bulk">
            <button type="button" id="sd-spread" className="ghost-btn" title="Each goes to the first day this week with room, so tomorrow doesn't overflow"
              onClick={() => bulkPlace(spreadTasks(cfg, movable, Array.from({ length: 7 }, (_, i) => addDays(tomorrow, i)), activeQ.data || [], eventsQ.data?.events || []), "over the week")}>Spread {movable.length} over the week</button>
            <button type="button" id="sd-all-tomorrow" className="ghost-btn" onClick={() => bulkMove(movable, tomKey, "tomorrow")}>All to tomorrow</button>
          </span>}
        </h3>
        {open.length ? <ul className="sd-open">{open.map((t) => <LeftoverRow key={t.id} t={t} />)}</ul>
          : <p className="sd-empty" id="sd-clear">Nothing left over. Every task from today has a home.</p>}
      </section>

      <section className="sd-section" id="sd-tomorrow">
        <h3>Tomorrow <span className="sd-sub">{tomorrow.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}</span></h3>
        <div className={`cap ${load > capacity ? "over" : load > capacity * 0.8 ? "full" : ""}`} title={`${fmtSpan(load)} planned of ${fmtSpan(capacity)} free`}><i style={{ width: `${Math.min(100, capacity ? (load / capacity) * 100 : 100)}%` }} /></div>
        <p className="sd-cap" id="sd-cap">
          {fmtSpan(load)} of tasks for {fmtSpan(capacity)} of free time{deep ? ` · ${deep} deep` : ""}
          {load > capacity ? <b className="sd-warn"> · more than fits: tomorrow's plan will leave some out</b> : ""}
        </p>
        {events.length > 0 && <ul className="sd-events">{events.map((e, i) => <li key={i}><b>{new Date(e.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</b> {e.title}</li>)}</ul>}
        {sortedTom.length ? <ul className="sd-tom">{sortedTom.map((t) => {
          const d = parseDue(t.due)!;
          return <li key={t.id}>{d.hasTime && <b>{d.d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</b>}<Inline text={t.content} />{t.due?.is_recurring && <span className="sd-rep">↻</span>}</li>;
        })}</ul> : <p className="sd-empty">Nothing planned yet. The morning plan will pull from your Inbox and the week's list.</p>}
      </section>

      <div className="dialog-actions">
        <button type="button" className="ghost-btn" onClick={() => close("shutdown")}>Not now</button>
        <button type="button" id="sd-finish" className="primary" onClick={finish}>{open.length ? `Close the day (${open.length} left as is)` : "Close the day"}</button>
      </div>
    </div>
  );
}

function LeftoverRow({ t }: { t: Task }) {
  const { projects } = useData();
  const rec = !!t.due?.is_recurring;
  const d = parseDue(t.due)!;
  const late = ymd(d.d) < ymd(startOfToday());
  return (
    <li className="sd-row" data-id={t.id} style={{ ["--c" as string]: colorOf(projects.get(t.project_id)?.color) }}>
      <div className="sd-title"><Inline text={t.content} />{rec && <span className="sd-rep" title={t.due?.string}>↻</span>}{late && <span className="sd-late">{Math.round((+startOfToday() - +new Date(d.d.getFullYear(), d.d.getMonth(), d.d.getDate())) / 864e5)}d overdue</span>}</div>
      <div className="sd-acts">
        <button type="button" data-act="done" title="I did it" onClick={() => finishTask(t, "done")}>✓ Done</button>
        <button type="button" data-act="tomorrow" onClick={() => setTaskDate(t, nextDate("tomorrow"), "tomorrow")}>Tomorrow</button>
        {rec ? <button type="button" data-act="skip" title="Skip to the next time it repeats" onClick={() => finishTask(t, "skip")}>Skip</button> : <>
          <button type="button" data-act="nextweek" onClick={() => setTaskDate(t, nextDate("nextweek"), "next week")}>Next week</button>
          <button type="button" data-act="someday" title="No date, tagged @someday" onClick={() => moveToSomeday(t)}>Someday</button>
          <button type="button" data-act="drop" className="danger" title="Complete it, tagged @dropped" onClick={() => { if (confirm(`Drop “${plain(t.content)}”? It's marked complete and tagged @dropped, so you can still find it.`)) finishTask(t, "drop"); }}>Drop</button>
        </>}
      </div>
    </li>
  );
}
