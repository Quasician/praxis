import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { completedAt, computeArea, startOfWeek } from "../domain/areas";
import { dayStats, habitStreak } from "../domain/progress";
import { willpower } from "../lib/tasks";
import { plannerCfg } from "../domain/planner";
import { changed, dayLabel, dayLoad, draftWeek, dueOnDay, isNextWeek, targetWeek, weekKey, type Lane, type WeekCard, type WeekDay } from "../domain/week";
import { addDays, fmtMin, fmtSpan, fromYmd, minOfDay, parseDue, toMin, ymd } from "../lib/dates";
import { itemUpdate, sync } from "../lib/api";
import { SOMEDAY_LABEL } from "../lib/tasks";
import { colorOf, plain } from "../lib/text";
import { reconcileSoon, updateConfig } from "../data/actions";
import { useActive, useCompleted, useEvents } from "../data/queries";
import { useData } from "../data/useData";
import { toast, useUi } from "../state/ui";

// ---------- automatic Friday draft ----------
/** true if the weekly draft was opened automatically (the daily auto-plan then waits), false if not, null while deciding. */
export function useWeeklyAuto(): boolean | null {
  const { configQ, todayQ } = useData();
  const [started, setStarted] = useState<boolean | null>(null);
  useEffect(() => {
    if (started !== null || !configQ.isSuccess || !todayQ.isSuccess) return;
    const cfg = plannerCfg(configQ.data);
    const days = targetWeek();
    const key = weekKey(days);
    const now = new Date(), dow = now.getDay();
    const afterWork = !cfg.workDays.includes(dow) || minOfDay(now) >= toMin(cfg.workEnd) + cfg.afterWork;
    const planningDay = (dow === cfg.weeklyDay && afterWork) || (isNextWeek(days) && dow !== cfg.weeklyDay); // Fri after work, or catch up over the weekend
    const due = cfg.weeklyAuto && isNextWeek(days) && planningDay && cfg.lastWeekPlan !== key && cfg.lastWeekPrompt !== key;
    if (due) {
      useUi.getState().setView("week");
      updateConfig((c) => ({ ...c, planner: { ...(c.planner || {}), lastWeekPrompt: key } })).catch(() => undefined);
      toast("Here's a draft of next week. Drag things around, then accept it.");
    }
    setStarted(due);
  }, [configQ.isSuccess, todayQ.isSuccess, started]); // eslint-disable-line
  return started;
}

// ---------- accepting ----------
async function acceptWeek(cards: WeekCard[], key: string) {
  const todo = cards.filter(changed);
  const commands = todo.map((c) => {
    const labels = c.task.labels || [];
    if (c.lane === "someday") return itemUpdate({ id: c.task.id, due: null, labels: [...new Set([...labels, SOMEDAY_LABEL])] });
    return itemUpdate({ id: c.task.id, due: dueOnDay(c.task, c.day!), ...(c.source === "someday" ? { labels: labels.filter((l) => l.toLowerCase() !== SOMEDAY_LABEL) } : {}) });
  });
  try {
    const rejected = commands.length ? await sync(commands) : [];
    await updateConfig((c) => ({ ...c, planner: { ...(c.planner || {}), lastWeekPlan: key } }));
    const placed = todo.filter((c) => c.day).length, parked = todo.filter((c) => c.lane === "someday").length;
    toast(rejected.length ? `Saved ${commands.length - rejected.length} of ${commands.length} changes. Todoist rejected ${rejected.length}.`
      : `Week planned: ${placed} task${placed === 1 ? "" : "s"} placed${parked ? `, ${parked} parked in Someday` : ""}. Each morning's plan picks the times.`);
    useUi.getState().setWeek(null);
    reconcileSoon(0);
  } catch (e) { toast(`Couldn't save the week: ${(e as Error).message}`); }
}

// ---------- the view ----------
export function WeekView() {
  const { cfg, config, connected } = useData();
  const days = useMemo(() => targetWeek(), []);
  const key = weekKey(days);
  const activeQ = useActive(connected);
  const completedQ = useCompleted(connected);
  const eventsQ = useEvents(connected, days[0], addDays(days[days.length - 1], 1));
  const week = useUi((s) => s.week);
  const setWeek = useUi((s) => s.setWeek);
  const ready = activeQ.isSuccess && completedQ.isSuccess && eventsQ.isSuccess && !!config;

  const redraft = () => setWeek({ key, ...draftWeek({ cfg, days, active: activeQ.data!, completed: completedQ.data!, events: eventsQ.data!.events, areas: config!.areas || [] }) });
  useEffect(() => { if (ready && (!week || week.key !== key)) redraft(); }, [ready, key, week]); // eslint-disable-line

  const [dragging, setDragging] = useState<WeekCard | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  if (!week) return <main id="week-view" className="week-view"><div className="empty"><div className="big">Drafting your week…</div></div></main>;

  const move = (id: string, dest: string) => {
    const [kind, value] = dest.split(":");
    setWeek({ ...week, cards: week.cards.map((c) => (c.task.id !== id ? c : kind === "day" ? { ...c, day: value, lane: null } : { ...c, day: null, lane: value as Lane })) });
  };
  const onStart = (e: DragStartEvent) => setDragging(week.cards.find((c) => c.task.id === e.active.id) || null);
  const onEnd = (e: DragEndEvent) => { setDragging(null); if (e.over) move(String(e.active.id), String(e.over.id)); };

  const changes = week.cards.filter(changed).length;
  const lane = (l: Lane) => week.cards.filter((c) => c.lane === l);
  const next = isNextWeek(days);
  const range = `${dayLabel(week.days[0].key)} – ${dayLabel(week.days[week.days.length - 1].key)}`;

  return (
    <main id="week-view" className="week-view">
      <div className="week-head">
        <div>
          <h2>{next ? "Plan next week" : "Plan the rest of this week"}</h2>
          <p className="areas-sub" id="week-range">{range}</p>
        </div>
        <div className="week-actions">
          <button id="week-redraft" className="ghost-btn" title="Start over from a fresh draft" onClick={redraft}>Redraft</button>
          <button id="week-accept" className="primary" onClick={() => acceptWeek(week.cards, key)}>{changes ? `Accept (${changes} change${changes === 1 ? "" : "s"})` : "Accept"}</button>
        </div>
      </div>

      {next && <LookBack />}

      <DndContext sensors={sensors} onDragStart={onStart} onDragEnd={onEnd} onDragCancel={() => setDragging(null)}>
        <div className="week-board" style={{ gridTemplateColumns: `repeat(${week.days.length}, minmax(150px, 1fr))` }}>
          {week.days.map((d) => <DayColumn key={d.key} day={d} cards={week.cards.filter((c) => c.day === d.key)} load={dayLoad(week.cards, d.key)} />)}
        </div>
        <div className="week-lanes">
          <LaneBox id="unplaced" title="Didn't fit" hint="Drag onto a day, or leave for later." cards={lane("unplaced")} />
          <LaneBox id="someday" title="Someday" hint="Parked on purpose: no date, tagged @someday." cards={lane("someday")} />
          <LaneBox id="resurfaced" title="Resurfaced from Someday" hint="Your oldest parked tasks. Drag one onto a day to bring it back." cards={lane("resurfaced")} />
        </div>
        <DragOverlay>{dragging ? <Card c={dragging} overlay /> : null}</DragOverlay>
      </DndContext>
    </main>
  );
}

/** Friday recap: what you got done this week, before planning the next one. */
function LookBack() {
  const { config, connected, cfg } = useData();
  const activeQ = useActive(connected), completedQ = useCompleted(connected);
  if (!config?.areas || !activeQ.data || !completedQ.data) return null;
  const completed = completedQ.data;
  const stats = config.areas.map((a) => computeArea(a, activeQ.data!, completed));
  const week = completed.filter((t) => completedAt(t) >= startOfWeek());
  const lastWeek = completed.filter((t) => completedAt(t) >= addDays(startOfWeek(), -7) && completedAt(t) < startOfWeek());
  const done = week.length;
  const elsewhere = done - stats.reduce((s, x) => s + x.weekDone, 0);
  const quiet = stats.filter((x) => x.quiet).map((x) => x.area.name);
  const days = dayStats(config, completed, 7);
  const committed = days.reduce((s, d) => s + d.committed, 0), committedDone = days.reduce((s, d) => s + d.committedDone, 0);
  const best = [...days].sort((a, b) => (b.plannedDone + b.extra) - (a.plannedDone + a.extra))[0];
  const streakDays = habitStreak(config, completed).days;
  const starred = new Set(Object.values(config.history || {}).flatMap((r) => r.planned.filter((p) => p.star || p.committed).map((p) => p.id)));
  const wins = [...week].sort((a, b) => Number(starred.has(b.id)) - Number(starred.has(a.id)) || willpower(b, cfg) - willpower(a, cfg)).slice(0, 5);
  const diff = done - lastWeek.length;
  return (
    <div className="lookback recap" id="lookback">
      <div className="recap-top">
        <span className="lb-title">Your week</span>
        <span className="recap-big"><b>{done}</b> done{lastWeek.length > 0 && <span className={`recap-diff ${diff >= 0 ? "up" : "down"}`}>{diff >= 0 ? `+${diff}` : diff} vs last week</span>}</span>
        {committed > 0 && <span className="recap-stat"><b>{committedDone}/{committed}</b> commitments kept</span>}
        {streakDays > 0 && <span className="recap-stat"><b>{streakDays}</b>-day streak</span>}
        {best && best.plannedDone + best.extra > 0 && <span className="recap-stat">best day <b>{fromYmd(best.day).toLocaleDateString([], { weekday: "long" })}</b></span>}
      </div>
      {wins.length > 0 && <ul className="recap-wins">{wins.map((t, i) => <li key={t.id + i}>{starred.has(t.id) ? "★ " : "✓ "}{plain(t.content)}</li>)}</ul>}
      <div className="recap-areas">
        {stats.map((x) => (
          <span key={x.area.id} className={`lb-chip ${x.quiet ? "quiet" : ""}`} style={{ ["--c" as string]: colorOf(x.area.color) }}>
            <i />{x.area.name} · {x.weekDone}{x.weekMin ? ` · ${fmtSpan(x.weekMin)}` : ""}
          </span>
        ))}
        {elsewhere > 0 && <span className="lb-chip" title="Done in projects that aren't in an area (edit areas to include them)"><i />Outside areas · {elsewhere}</span>}
      </div>
      {quiet.length > 0 && <span className="lb-quiet">Gone quiet: {quiet.join(", ")}. Next week gives each one a task.</span>}
    </div>
  );
}

function DayColumn({ day, cards, load }: { day: WeekDay; cards: WeekCard[]; load: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day.key}` });
  const pct = day.capacity ? Math.min(130, Math.round((load / day.capacity) * 100)) : load ? 130 : 0;
  const sorted = [...cards].sort((a, b) => {
    const da = parseDue(a.task.due), db = parseDue(b.task.due);
    const ta = da?.hasTime ? minOfDay(da.d) : 9999, tb = db?.hasTime ? minOfDay(db.d) : 9999;
    return ta - tb || b.wp - a.wp;
  });
  const isToday = day.key === ymd(new Date());
  return (
    <section ref={setNodeRef} className={`day-col ${isOver ? "over" : ""} ${isToday ? "today" : ""}`} data-day={day.key}>
      <DaySky pct={pct} load={load} capacity={day.capacity} steps={cards.filter((c) => c.source === "milestone" || !!c.task.parent_id).length} today={isToday} />
      <header className="day-head">
        <div className="day-name">{day.date.toLocaleDateString([], { weekday: "short" })}<span>{day.date.toLocaleDateString([], { month: "short", day: "numeric" })}</span></div>
        {day.work && <span className="day-work" title="Work hours">Work {fmtMin(day.work[0])}–{fmtMin(day.work[1])}</span>}
        <div className={`cap ${pct > 100 ? "over" : pct > 80 ? "full" : ""}`} title={`${fmtSpan(load)} planned of ${fmtSpan(day.capacity)} free`}>
          <i style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <div className="cap-text">{fmtSpan(load)} / {fmtSpan(day.capacity)}</div>
      </header>
      {day.allDay.map((e, i) => <div key={`a${i}`} className="day-allday" style={{ ["--c" as string]: e.color || "var(--ink-3)" }}>{e.title}</div>)}
      {day.events.filter((e) => !e.transparent).map((e, i) => (
        <div key={`e${i}`} className="day-event" style={{ ["--c" as string]: e.color || "var(--ink-3)" }} title={e.calendar || ""}>
          <b>{new Date(e.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</b> {e.title}
        </div>
      ))}
      <div className="day-cards">{sorted.map((c) => <DraggableCard key={c.task.id} c={c} />)}</div>
    </section>
  );
}

function LaneBox({ id, title, hint, cards }: { id: Lane; title: string; hint: string; cards: WeekCard[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: `lane:${id}` });
  return (
    <section ref={setNodeRef} className={`lane ${isOver ? "over" : ""}`} data-lane={id}>
      <header><h3>{title} <span className="n">{cards.length}</span></h3><span className="lane-hint">{hint}</span></header>
      <div className="lane-cards">{cards.map((c) => <DraggableCard key={c.task.id} c={c} />)}</div>
    </section>
  );
}

function DraggableCard({ c }: { c: WeekCard }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: c.task.id, disabled: c.locked });
  return <Card c={c} innerRef={setNodeRef} dragProps={{ ...attributes, ...listeners }} dragging={isDragging} />;
}

const SOURCE_LABEL: Record<WeekCard["source"], string> = { fixed: "", overdue: "Overdue", stale: "Stale", milestone: "Milestone", quiet: "Quiet area", someday: "Someday" };

function Card({ c, innerRef, dragProps, dragging, overlay }: { c: WeekCard; innerRef?: (el: HTMLElement | null) => void; dragProps?: Record<string, unknown>; dragging?: boolean; overlay?: boolean }) {
  const { projects } = useData();
  const proj = projects.get(c.task.project_id);
  const d = parseDue(c.task.due);
  const moved = changed(c);
  const badge: ReactNode = c.wp === 3 ? <span className="pbadge wp3">Deep</span> : c.wp === 1 ? <span className="pbadge wp1">Light</span> : null;
  return (
    <div ref={innerRef} {...dragProps} data-id={c.task.id}
         className={`wk-card src-${c.source} ${c.locked ? "locked" : ""} ${moved ? "moved" : ""} ${dragging ? "dragging" : ""} ${overlay ? "overlay" : ""}`}
         style={{ ["--c" as string]: colorOf(proj?.color) }} title={c.note || ""}>
      <div className="wk-title">{plain(c.task.content)}</div>
      <div className="wk-meta">
        {d?.hasTime && <span className="wk-time">{d.d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>}
        <span>{fmtSpan(c.dur)}</span>
        {badge}
        {c.source !== "fixed" && <span className={`wk-src ${c.source}`}>{c.source === "overdue" && c.note ? c.note : SOURCE_LABEL[c.source]}</span>}
        {c.locked && <span title="Repeats: keeps its own schedule">↻</span>}
      </div>
    </div>
  );
}

/** Each day as a little sky: the fuller the day, the cloudier; over capacity is a storm. Stars are project steps planned that day. */
export function weatherFor(pct: number) {
  return pct > 100 ? "storm" : pct > 80 ? "cloudy" : pct > 45 ? "partly" : "clear";
}
const WEATHER_TEXT = { clear: "Clear", partly: "Some clouds", cloudy: "Full", storm: "Stormy" } as const;
function DaySky({ pct, load, capacity, steps, today }: { pct: number; load: number; capacity: number; steps: number; today: boolean }) {
  const w = weatherFor(pct);
  const setView = useUi((s) => s.setView);
  const clouds = { clear: [], partly: [[150, 22, .8]], cloudy: [[118, 18, .9], [176, 28, .8]], storm: [[96, 16, 1], [150, 12, 1.05], [204, 20, .95]] }[w] as [number, number, number][];
  return (
    <div className={`day-sky ${w} ${today ? "today" : ""}`} data-weather={w} title={`${WEATHER_TEXT[w]}: ${fmtSpan(load)} planned of ${fmtSpan(capacity)} free${today ? " · click to open today" : ""}`}
         onClick={today ? () => setView("day") : undefined} role={today ? "button" : undefined}>
      <svg viewBox="0 0 280 64" preserveAspectRatio="xMaxYMid meet" aria-hidden="true">
        {Array.from({ length: Math.min(steps, 7) }, (_, i) => (
          <g key={`s${i}`} className="ds-star" transform={`translate(${14 + i * 15} ${13 + (i % 2) * 8})`}><circle r="2.4" /><circle r="6" className="halo" /></g>
        ))}
        {w !== "storm" && <g className="ds-sun" transform="translate(246 26)"><circle r={today ? 13 : 10} className="halo" /><circle r={today ? 8 : 6.5} /></g>}
        {clouds.map(([x, y, k], i) => (
          <g key={i} className="ds-cloud" transform={`translate(${x} ${y}) scale(${k})`}>
            <circle cx="0" cy="8" r="9" /><circle cx="12" cy="2" r="12" /><circle cx="26" cy="7" r="9.5" /><rect x="-9" y="8" width="44" height="10" rx="5" />
          </g>
        ))}
        {w === "storm" && [110, 140, 170, 200, 230].map((x) => <line key={x} className="ds-rain" x1={x} y1="44" x2={x - 5} y2="58" />)}
      </svg>
      <span className="day-weather">{WEATHER_TEXT[w]}{steps ? ` · ${steps} ${steps === 1 ? "star" : "stars"}` : ""}</span>
    </div>
  );
}
