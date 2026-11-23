import { useEffect, useMemo, useRef, type CSSProperties, type PointerEvent } from "react";
import { allDayEventsOn, layoutBlocks, TL_END, TL_START, visibleEvents, type Block } from "../domain/layout";
import { workBand } from "../domain/planner";
import { fmtMin, fmtSpan, minOfDay, parseDue, toMin, ymd } from "../lib/dates";
import { willpower } from "../lib/tasks";
import { colorOf, plain } from "../lib/text";
import type { Task } from "../lib/types";
import { completeTask } from "../data/actions";
import { acceptPlan, discardPlan, proposePlan } from "../data/planActions";
import { useCommitted, useData } from "../data/useData";
import { useUi } from "../state/ui";
import { hourPx, minToY, pointerMin, startDrag } from "./drag";
import { useHourHeight, useNow } from "./useNow";

const blockStyle = (start: number, dur: number, color: string, col = 0, cols = 1, minH = 20): CSSProperties => ({
  top: minToY(start), height: Math.max((dur / 60) * hourPx() - 2, minH),
  ["--c" as string]: color, left: `calc(${(col / cols) * 100}% + 4px)`, width: `calc(${100 / cols}% - 8px)`,
});

const CheckIcon = ({ size = 10 }: { size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size}><path fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" d="M5 12.5l4.5 4.5L19 7.5" /></svg>
);

export function TimelinePane() {
  const { today, events, projects, cfg, trayIds, loading } = useData();
  const plan = useUi((s) => s.plan);
  const drag = useUi((s) => s.drag);
  const now = useNow();
  useHourHeight();
  const tlRef = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);

  const todayList = useMemo(() => today.filter((t) => !trayIds.has(t.id)), [today, trayIds]);
  const blocks = useMemo(() => layoutBlocks(todayList, visibleEvents(events, todayList)), [todayList, events, now]); // eslint-disable-line
  const allDay = allDayEventsOn(events, ymd(now));
  const nowMin = minOfDay(now);
  const ahead = blocks.filter((b) => b.task && b.end > nowMin);
  const aheadMin = ahead.reduce((s, b) => s + (b.end - Math.max(b.start, nowMin)), 0);

  // Scroll to "now" once, and to the plan when one is proposed.
  useEffect(() => {
    if (!loading && !scrolled.current && tlRef.current) {
      tlRef.current.scrollTop = Math.max(0, minToY(nowMin) - hourPx() * 1.5);
      scrolled.current = true;
    }
  }, [loading]); // eslint-disable-line
  const firstPlanned = plan.active && plan.items[0] ? plan.items[0].start : null;
  useEffect(() => {
    if (firstPlanned !== null && tlRef.current) tlRef.current.scrollTo({ top: Math.max(0, minToY(firstPlanned) - hourPx()), behavior: "smooth" });
  }, [firstPlanned]);

  const color = (t: Task) => colorOf(projects.get(t.project_id)?.color) || "var(--accent)";
  const lifting = (t: Task, idx?: number) => !!drag && (idx !== undefined ? drag.proposalIdx === idx : drag.proposalIdx === undefined && drag.task.id === t.id);

  const onBlockDown = (e: PointerEvent, b: Block) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".blk-check") || !b.task) return;
    e.preventDefault();
    startDrag(e, { kind: (e.target as HTMLElement).closest(".tl-resize") ? "resize" : "move", task: b.task, start: b.start, dur: b.dur, grab: pointerMin(e) - b.start });
  };
  const onProposalDown = (e: PointerEvent, idx: number) => {
    if (e.button !== 0) return;
    const it = plan.items[idx];
    e.preventDefault();
    startDrag(e, { kind: (e.target as HTMLElement).closest(".tl-resize") ? "resize" : "move", task: it.task, start: it.start, dur: it.dur, grab: pointerMin(e) - it.start, proposalIdx: idx });
  };

  const work = workBand(cfg, now);
  const dayEnd = toMin(cfg.dayEnd);
  const hours = Array.from({ length: TL_END - TL_START }, (_, i) => TL_START + i);
  const target = drag?.target;

  return (
    <section className="timeline-pane">
      <div className="timeline-head">
        <h2>Your day</h2>
        <span id="tl-summary" className="tl-summary">
          {loading ? "" : ahead.length ? `${ahead.length} block${ahead.length > 1 ? "s" : ""} ahead · ${fmtSpan(aheadMin)} planned` : "Nothing planned yet"}
        </span>
        <span id="tl-allday" className="tl-allday">
          {allDay.map((e, i) => <span key={i} className="allday-chip" style={{ ["--c" as string]: e.color || "var(--ink-3)" }} title={e.calendar || ""}>{e.title}</span>)}
        </span>
        <button id="plan-btn" className="plan-btn" title="Fill your free time, hardest tasks first (P)" onClick={() => proposePlan()}>
          <svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8zM19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9z" /></svg>
          Plan my day
        </button>
        <span className="hint">Drag tasks here to block time · drag the bottom edge to resize · drag back to the list to unschedule</span>
      </div>

      <PlanBanner />

      <div id="timeline" className="timeline" ref={tlRef}>
        <div className="tl-grid">
          <div className="tl-sky" aria-hidden="true" />
          {now.getHours() >= TL_START && <div className="tl-past" aria-hidden="true" style={{ height: Math.max(0, minToY(nowMin)) }} />}
          {hours.map((h) => <div key={h} className="tl-hour"><span>{new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: "numeric" })}</span></div>)}

          {work && <div className="tl-band work" style={{ top: minToY(work[0]), height: ((work[1] - work[0]) / 60) * hourPx() }}><span>Work</span></div>}
          {dayEnd < TL_END * 60 && <div className="tl-band off" style={{ top: minToY(dayEnd), height: ((TL_END * 60 - dayEnd) / 60) * hourPx() }}><span>Wind down</span></div>}

          {plan.active && plan.items.map((it, i) => {
            const wp = willpower(it.task, cfg), compact = it.dur < 45;
            return (
              <div key={`p${i}`} className={`tl-block proposed ${it.committed ? "committed" : "bonus"} ${compact ? "compact" : ""} ${lifting(it.task, i) ? "lifting" : ""}`} data-idx={i} data-committed={it.committed ? "1" : "0"}
                   style={blockStyle(it.start, it.dur, color(it.task))} onPointerDown={(e) => onProposalDown(e, i)}>
                <div className="blk-body">
                  <div className="blk-title">{it.committed ? <span className="commit-star" title="Committed">★ </span> : null}{plain(it.task.content)}</div>
                  <div className="blk-time">
                    {fmtMin(it.start)} – {fmtMin(it.start + it.dur)}{compact ? "" : ` · ${fmtSpan(it.dur)}`}{" "}
                    {!it.committed && <span className="pbadge bonus">Bonus</span>}
                    {it.source === "milestone" && it.milestone ? <span className="pbadge ms">◆ {plain(it.milestone.content).slice(0, 28)}</span>
                      : wp === 3 ? <span className="pbadge wp3">Deep</span> : wp === 1 ? <span className="pbadge wp1">Light</span> : null}
                  </div>
                </div>
                <div className="tl-resize" title="Drag to change length" />
              </div>
            );
          })}

          {blocks.map((b, i) => b.event ? (
            <div key={`e${i}`} className={`tl-block event ${b.end <= nowMin ? "past" : ""} ${b.dur < 45 ? "compact" : ""} ${b.event.transparent ? "free" : ""}`}
                 style={blockStyle(b.start, b.dur, b.event.color || "#8a8178", b.col, b.cols, 18)}
                 title={`${b.event.title} · ${fmtMin(b.start)}–${fmtMin(b.end)}${b.event.location ? " · " + b.event.location : ""}${b.event.calendar ? ` (${b.event.calendar})` : ""}`}>
              <svg className="ev-icon" viewBox="0 0 24 24" width="11" height="11"><rect x="3" y="5" width="18" height="16" rx="3" fill="none" stroke="currentColor" strokeWidth="2.2" /><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
              <div className="blk-body">
                <div className="blk-title">{b.event.title}</div>
                <div className="blk-time">{fmtMin(b.start)} – {fmtMin(b.end)}{b.dur >= 45 && b.event.location ? ` · ${b.event.location}` : ""}</div>
              </div>
            </div>
          ) : (
            <TaskBlock key={b.task!.id} b={b} color={color(b.task!)} past={b.end <= nowMin} lifting={lifting(b.task!)} onPointerDown={(e) => onBlockDown(e, b)} />
          ))}

          {target && (
            <div className={`tl-block preview ${target.dur < 45 ? "compact" : ""}`} style={{ top: minToY(target.start), height: Math.max((target.dur / 60) * hourPx() - 2, 20) }}>
              <div className="blk-body">
                <div className="blk-title">{plain(drag!.task.content)}</div>
                <div className="blk-time">{fmtMin(target.start)} – {fmtMin(target.start + target.dur)}{target.dur < 45 ? "" : ` · ${fmtSpan(target.dur)}`}</div>
              </div>
            </div>
          )}

          {now.getHours() >= TL_START && <div className="tl-now" style={{ top: minToY(nowMin) }} />}
        </div>
      </div>
    </section>
  );
}

function TaskBlock({ b, color, past, lifting, onPointerDown }: { b: Block; color: string; past: boolean; lifting: boolean; onPointerDown: (e: PointerEvent) => void }) {
  const committed = useCommitted();
  const t = b.task!;
  const compact = b.dur < 45;
  const rec = t.due && t.due.is_recurring;
  return (
    <div className={`tl-block ${past ? "past" : ""} ${compact ? "compact" : ""} ${lifting ? "lifting" : ""}`} data-id={t.id}
         style={blockStyle(b.start, b.dur, color, b.col, b.cols)} title={`${plain(t.content)} · ${fmtMin(b.start)}–${fmtMin(b.end)}`} onPointerDown={onPointerDown}>
      <button className="blk-check" title="Complete" aria-label="Complete task" onClick={() => completeTask(t)}><CheckIcon /></button>
      <div className="blk-body">
        <div className="blk-title">{committed.has(t.id) && <span className={`commit-star ${committed.get(t.id)!.star ? "the-one" : ""}`}>★ </span>}{plain(t.content)}{rec ? <span className="rec" title="Repeats"> ↻</span> : null}</div>
        <div className="blk-time">{fmtMin(b.start)} – {fmtMin(b.end)}{compact ? "" : ` · ${fmtSpan(b.dur)}`}</div>
      </div>
      <div className="tl-resize" title="Drag to change length" />
    </div>
  );
}

function PlanBanner() {
  const plan = useUi((s) => s.plan);
  const { cfg } = useData();
  if (!plan.active) return null;
  const mins = plan.items.reduce((s, it) => s + it.dur, 0);
  const deep = plan.items.filter((it) => willpower(it.task, cfg) === 3).length;
  return (
    <div id="plan-banner" className="plan-banner">
      <div className="plan-line">
        <div className="plan-text"><b>Proposed plan</b> · <span id="plan-committed">★ {plan.items.filter((it) => it.committed).length} committed</span>{plan.items.some((it) => !it.committed) ? ` + ${plan.items.filter((it) => !it.committed).length} bonus` : ""} · {fmtSpan(mins)}{deep ? ` · ${deep} deep-focus first` : " · hardest first"}</div>
        <div className="plan-actions">
          <button id="plan-discard" className="ghost-btn" onClick={discardPlan}>Discard</button>
          <button id="plan-reshuffle" className="ghost-btn" title="Try a different order within each willpower level" onClick={() => proposePlan(true)}>Reshuffle</button>
          <button id="plan-accept" className="primary" disabled={!plan.items.length} onClick={() => acceptPlan()}>Accept</button>
        </div>
      </div>
      {plan.unplaced.length > 0 && (
        <div className="plan-unplaced">Didn't fit today:{" "}
          {plan.unplaced.slice(0, 6).map((c) => <span key={c.task.id}>{plain(c.task.content)}</span>)}
          {plan.unplaced.length > 6 && <span>+{plan.unplaced.length - 6} more</span>}
        </div>
      )}
      {plan.fillWhy && <div className="plan-hint" id="plan-fill-why">Lighter or fuller than usual: {plan.fillWhy}.</div>}
      <div className="plan-hint">★ = what you commit to; bonus blocks are only if you have energy left. Drag blocks to adjust, or onto the list to leave one out.</div>
    </div>
  );
}

export const hasTime = (t: Task) => !!parseDue(t.due)?.hasTime;
