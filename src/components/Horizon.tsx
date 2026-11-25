// The Horizon: today from left to right as one sky. The sun crosses it at its real times,
// the past dims behind you, and your blocks hang below it at their times.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { allDayEventsOn, layoutBlocks, TL_END, TL_START, visibleEvents, type Block } from "../domain/layout";
import { workBand } from "../domain/planner";
import { seeded } from "../domain/sky";
import { skyStops, sunTimes } from "../domain/sun";
import { fmtMin, fmtSpan, minOfDay, toMin, ymd } from "../lib/dates";
import { blockMinutes, isMilestone, willpower } from "../lib/tasks";
import { colorOf, plain } from "../lib/text";
import type { Task } from "../lib/types";
import { completeTask } from "../data/actions";
import { proposePlan } from "../data/planActions";
import { useCommitted, useData } from "../data/useData";
import { useUi } from "../state/ui";
import { pointerMin, startDrag } from "./drag";
import { useNow } from "./useNow";
import { usePending } from "../data/pending";
import { CheckIcon, PlanBanner } from "./Timeline";
import { DayWeatherLayer, IdeaClouds, dayWeather } from "./SkyClouds";

const ROW_H_FULL = 70;      // one row of blocks (64 in the canvas, where the strip is shorter)
const LABEL_MIN = 120;      // the least room a block's label gets
const LABEL_MAX = 380;      // past this, a long title ends in "…" (the full title is in the tooltip)
const HOURS_VISIBLE = 13;   // how much of the day fits on screen at once

// Text is measured with the real font (in the page, so variable-font weights count), so a block is always at least as wide as its words.
let meter: HTMLSpanElement | null = null;
const widths = new Map<string, number>();
function textW(text: string, font: string) {
  if (typeof document === "undefined") return text.length * 7.4;
  const k = font + "|" + text;
  const hit = widths.get(k);
  if (hit !== undefined) return hit;
  if (!meter) {
    meter = document.createElement("span");
    meter.setAttribute("aria-hidden", "true");
    meter.style.cssText = "position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;pointer-events:none";
    document.body.appendChild(meter);
  }
  meter.style.font = `${font} var(--sans)`;
  meter.textContent = text;
  const w = meter.getBoundingClientRect().width;
  if (widths.size > 2000) widths.clear();
  widths.set(k, w);
  return w;
}
/** Room (px) a block needs for its title and its time line: check button, padding, and the longer of the two. */
export const labelPx = (title: string, time = "12:00 PM – 12:30 PM · 30m") =>
  Math.ceil(Math.min(LABEL_MAX, Math.max(LABEL_MIN, 66 + Math.max(textW(title, "600 14px"), textW(time, "12px")))));

type Item = { key: string; start: number; dur: number; label?: number; endAnchored?: boolean };

/** Where a block's box sits (px from the start of the day): as long as its time, or as wide as its words if
 *  that's wider. A finished block grows to the left instead, so it never reaches past the "now" line. */
export function boxOf(it: Item, hourW: number) {
  const t0 = (it.start / 60) * hourW, t1 = t0 + Math.max((it.dur / 60) * hourW - 3, 10);
  const w = Math.max(t1 - t0, it.label ?? LABEL_MIN);
  if (!it.endAnchored) return { x0: t0, x1: t0 + w, t0, t1 };
  const x0 = Math.max(0, t1 - w);
  return { x0, x1: x0 + w, t0, t1 };
}

/** Puts blocks in rows so nothing (labels included) overlaps; earlier blocks take the top rows. */
export function assignRows(items: Item[], hourW: number) {
  const rows: number[] = [];               // right edge (px) of the last thing in each row
  const out = new Map<string, number>();
  const boxes = items.map((it) => ({ it, ...boxOf(it, hourW) })).sort((a, b) => a.x0 - b.x0 || b.it.dur - a.it.dur);
  for (const { it, x0, x1 } of boxes) {
    let r = rows.findIndex((edge) => edge <= x0);
    if (r < 0) { r = rows.length; rows.push(0); }
    rows[r] = x1 + 10;
    out.set(it.key, r);
  }
  return { rows: out, count: rows.length };
}

/** compact (4.5, in the canvas): the big sky is already behind it, so its own sky is a thin band and the rows get the room. */
export function HorizonPane({ compact = false }: { compact?: boolean } = {}) {
  const { today, events, projects, cfg, trayIds, loading, config } = useData();
  const committedIds = useCommitted();
  const plan = useUi((s) => s.plan);
  const drag = useUi((s) => s.drag);
  const now = useNow();
  const tlRef = useRef<HTMLDivElement>(null);
  const scrolled = useRef(false);
  const [hourW, setHourW] = useState(110);
  const [SKY_H, setSkyH] = useState(150);
  const [, setFontsReady] = useState(0);
  useEffect(() => { document.fonts?.ready.then(() => { widths.clear(); setFontsReady((n) => n + 1); }); }, []);
  // Set before positions are worked out this render (dragging reads it too).
  document.documentElement.style.setProperty("--hour-x", `${hourW}px`);

  useLayoutEffect(() => {
    document.documentElement.dataset.layout = "horizon";
    const el = tlRef.current;
    // Measure the pane, not the scroller: the scroller's content is sized from this, so measuring it would feed back.
    const pane = el?.closest(".horizon-pane") as HTMLElement | null;
    // The sky gets about a third of the pane: it's the clock you read at a glance.
    const ro = el && pane ? new ResizeObserver(() => {
      setHourW(Math.max(84, Math.min(240, Math.floor((pane.clientWidth - 24) / HOURS_VISIBLE))));
      setSkyH(compact ? Math.round(Math.min(84, Math.max(52, el.clientHeight * 0.18))) : Math.round(Math.min(280, Math.max(140, el.clientHeight * 0.32))));
    }) : null;
    if (ro && pane) ro.observe(pane);
    return () => { ro?.disconnect(); delete document.documentElement.dataset.layout; };
  }, []);

  const ROW_H = compact ? 64 : ROW_H_FULL;
  const X = (m: number) => (m / 60 - TL_START) * hourW;
  const todayList = useMemo(() => today.filter((t) => !trayIds.has(t.id)), [today, trayIds]);
  const blocks = useMemo(() => layoutBlocks(todayList, visibleEvents(events, todayList)), [todayList, events, now]); // eslint-disable-line
  const allDay = allDayEventsOn(events, ymd(now));
  const nowMin = minOfDay(now);
  const ahead = blocks.filter((b) => b.task && b.end > nowMin);
  const aheadMin = ahead.reduce((s, b) => s + (b.end - Math.max(b.start, nowMin)), 0);
  const { rise, set } = useMemo(() => sunTimes(now), [ymd(now)]); // eslint-disable-line react-hooks/exhaustive-deps

  const timeText = (b: Block) => b.event ? `${fmtMin(b.start)} – ${fmtMin(b.end)}${b.event.location ? ` · ${b.event.location}` : ""}` : `${fmtMin(b.start)} – ${fmtMin(b.end)} · ${fmtSpan(b.dur)}`;
  const items: Item[] = [
    ...blocks.map((b, i) => ({ key: b.task ? `t${b.task.id}` : `e${i}`, start: b.start, dur: b.dur, endAnchored: b.end <= nowMin,
      label: labelPx(b.task ? plain(b.task.content) + (b.task.due?.is_recurring ? " ↻" : "") + (b.task && committedIds.has(b.task.id) ? "★ " : "") : b.event?.title || "", timeText(b)) - (b.event ? 30 : 0) })),
    ...(plan.active ? plan.items.map((it, i) => ({ key: `p${i}`, start: it.start, dur: it.dur, label: labelPx((it.committed ? "★ " : "") + plain(it.task.content), `${fmtMin(it.start)} – ${fmtMin(it.start + it.dur)} ${it.committed ? "" : "Bonus "}${it.source === "milestone" && it.milestone ? "◆ " + plain(it.milestone.content).slice(0, 24) : "Light"}` + "   ") - 30 })) : []),
  ];
  const itemOf = new Map(items.map((it) => [it.key, it]));
  const { rows, count } = assignRows(items, hourW);
  const lanesH = Math.max(5, count + 1) * ROW_H + 24;
  const width = (TL_END - TL_START) * hourW;

  // Open on "now" (a quarter of the way in), and slide to a proposed plan.
  useEffect(() => {
    if (!loading && !scrolled.current && tlRef.current) { tlRef.current.scrollLeft = Math.max(0, X(nowMin) - tlRef.current.clientWidth * 0.25); scrolled.current = true; }
  }, [loading, hourW]); // eslint-disable-line
  const firstPlanned = plan.active && plan.items[0] ? plan.items[0].start : null;
  useEffect(() => {
    if (firstPlanned !== null && tlRef.current) tlRef.current.scrollTo({ left: Math.max(0, X(firstPlanned) - hourW), behavior: "smooth" });
  }, [firstPlanned]); // eslint-disable-line

  const color = (t: Task) => colorOf(projects.get(t.project_id)?.color) || "var(--accent)";
  const lifting = (t: Task, idx?: number) => !!drag && (idx !== undefined ? drag.proposalIdx === idx : drag.proposalIdx === undefined && drag.task.id === t.id);
  const pos = (start: number, dur: number, row: number, c: string, key?: string): CSSProperties => {
    const it = (key && itemOf.get(key)) || { key: "", start, dur, label: labelPx(drag ? plain(drag.task.content) : "") };
    const bx = boxOf({ ...it, start: start - TL_START * 60, dur }, hourW);
    return { left: bx.x0, width: bx.x1 - bx.x0, top: SKY_H + 30 + row * ROW_H, ["--c" as string]: c,
      ["--len-l" as string]: `${bx.t0 - bx.x0}px`, ["--len-w" as string]: `${bx.t1 - bx.t0}px` };
  };
  const isShort = (key: string, dur: number) => { const it = itemOf.get(key); return !!it && (it.label ?? LABEL_MIN) > (dur / 60) * hourW - 3; };
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
  const hours = Array.from({ length: TL_END - TL_START + 1 }, (_, i) => TL_START + i);
  const stops = skyStops(rise, set, TL_START * 60, TL_END * 60).map(([v, p]) => `var(${v}) ${p.toFixed(1)}%`).join(", ");
  const target = drag?.target;
  // 3.8: today's own weather: the sky clouds over as the day fills (planned time against free time).
  const dayStart = toMin(cfg.dayStart);
  const eventMin = blocks.filter((b) => b.event).reduce((s, b) => s + Math.max(0, Math.min(b.end, dayEnd) - Math.max(b.start, dayStart)), 0);
  // Everything on today counts once: a block at its length, a proposed block at its length, anything else at its usual length.
  const placed = new Set([...blocks.filter((b) => b.task).map((b) => b.task!.id), ...(plan.active ? plan.items.map((it) => it.task.id) : [])]);
  const loose = todayList.filter((t) => !placed.has(t.id) && !isMilestone(t)).reduce((s, t) => s + blockMinutes(t), 0);
  const taskMin = blocks.filter((b) => b.task).reduce((s, b) => s + b.dur, 0) + loose + (plan.active ? plan.items.reduce((s, it) => s + it.dur, 0) : 0);
  const weather = dayWeather(taskMin, Math.max(0, dayEnd - dayStart - eventMin));
  const ideas = (config?.ideas || []) as import("../data/ideas").Idea[];
  const [skyTop, setSkyTop] = useState(0);
  useLayoutEffect(() => { if (tlRef.current) setSkyTop(tlRef.current.offsetTop); });

  return (
    <section className="timeline-pane horizon-pane" id="horizon">
      <div className="timeline-head">
        <h2>Your day</h2>
        <span id="tl-summary" className="tl-summary">
          {loading ? "" : ahead.length ? `${ahead.length} block${ahead.length > 1 ? "s" : ""} ahead · ${fmtSpan(aheadMin)} planned` : "Nothing planned yet"}
        </span>
        <span className="tl-summary" id="hz-sun">Sunrise {fmtMin(rise)} · sunset {fmtMin(set)}</span>
        {!loading && <span className={`tl-summary hz-weather-word${weather.storm ? " storm" : ""}`} id="hz-weather" title={weather.tip} data-fill={weather.fill.toFixed(2)}>{weather.word}</span>}
        <span id="tl-allday" className="tl-allday">
          {allDay.map((e, i) => <span key={i} className="allday-chip" style={{ ["--c" as string]: e.color || "var(--ink-3)" }} title={e.calendar || ""}>{e.title}</span>)}
        </span>
        <button id="plan-btn" className="plan-btn" title="Fill your free time, hardest tasks first (P)" onClick={() => proposePlan()}>
          <svg viewBox="0 0 24 24" width="15" height="15"><path fill="currentColor" d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8zM19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9z" /></svg>
          Plan my day
        </button>
        <span className="hint">Drag tasks onto the day · drag a block's right edge to resize · drag it back to the list to unschedule</span>
      </div>

      <PlanBanner />

      <div id="timeline" className="timeline hz" ref={tlRef}
           onWheel={(e) => { if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX) && tlRef.current && !(e.target as HTMLElement).closest(".hz-lanes-scroll")) tlRef.current.scrollLeft += e.deltaY; }}>
        <div className="tl-grid hz-grid" style={{ width, height: SKY_H + 30 + lanesH }}>
          <div className="hz-sky" style={{ height: SKY_H, background: `linear-gradient(to right, ${stops})` }}>
            <SunArc width={width} rise={rise} set={set} nowMin={nowMin} X={X} skyH={SKY_H} />
            <DayWeatherLayer cover={weather.cover} storm={weather.storm} x0={X(dayStart)} x1={X(dayEnd)} skyH={SKY_H} />
          </div>
          <div className="hz-ruler" style={{ top: SKY_H }}>
            {hours.map((h) => <span key={h} style={{ left: X(h * 60) }}>{new Date(2000, 0, 1, h % 24).toLocaleTimeString([], { hour: "numeric" })}</span>)}
          </div>
          <div className="hz-lanes" style={{ top: SKY_H + 30, height: lanesH, backgroundSize: `${hourW}px 100%` }} />
          {work && <div className="hz-band work" id="hz-work" style={{ left: X(work[0]), width: X(work[1]) - X(work[0]), top: SKY_H + 30, height: lanesH }}>
            {nowMin < work[1] && <span style={{ left: 8 + Math.max(0, Math.min(X(nowMin), X(work[1]) - 170) - X(work[0])) }}>Work hours · until {fmtMin(work[1])}</span>}</div>}
          {dayEnd < TL_END * 60 && <div className="hz-band off" style={{ left: X(dayEnd), width: X(TL_END * 60) - X(dayEnd), top: SKY_H + 30, height: lanesH }}>
            <span style={{ left: 8 + Math.max(0, X(nowMin) - X(dayEnd)) }}>Wind down</span></div>}
          {now.getHours() >= TL_START && <div className="hz-past" style={{ width: Math.max(0, X(nowMin)), top: 0, height: SKY_H + 30 + lanesH }} aria-hidden="true" />}

          {plan.active && plan.items.map((it, i) => {
            const wp = willpower(it.task, cfg);
            return (
              <div key={`p${i}`} className={`tl-block proposed ${it.committed ? "committed" : "bonus"} ${lifting(it.task, i) ? "lifting" : ""} ${isShort(`p${i}`, it.dur) ? "short" : ""}`} data-idx={i} data-committed={it.committed ? "1" : "0"}
                   style={pos(it.start, it.dur, rows.get(`p${i}`) || 0, color(it.task), `p${i}`)} onPointerDown={(e) => onProposalDown(e, i)}>
                <span className="blk-len" aria-hidden="true" />
                <div className="blk-body">
                  <div className="blk-title">{it.committed ? <span className="commit-star" title="Committed">★ </span> : null}{plain(it.task.content)}</div>
                  <div className="blk-time">
                    {fmtMin(it.start)} – {fmtMin(it.start + it.dur)}{" "}
                    {!it.committed && <span className="pbadge bonus">Bonus</span>}
                    {it.source === "milestone" && it.milestone ? <span className="pbadge ms">◆ {plain(it.milestone.content).slice(0, 24)}</span>
                      : wp === 3 ? <span className="pbadge wp3">Deep</span> : wp === 1 ? <span className="pbadge wp1">Light</span> : null}
                  </div>
                </div>
                <div className="tl-resize" title="Drag to change length" />
              </div>
            );
          })}

          {blocks.map((b, i) => b.event ? (
            <div key={`e${i}`} className={`tl-block event ${b.end <= nowMin ? "past" : ""} ${b.event.transparent ? "free" : ""} ${isShort(`e${i}`, b.dur) ? "short" : ""}`}
                 style={pos(b.start, b.dur, rows.get(`e${i}`) || 0, b.event.color || "#8a8178", `e${i}`)}
                 title={`${b.event.title} · ${fmtMin(b.start)}–${fmtMin(b.end)}${b.event.location ? " · " + b.event.location : ""}${b.event.calendar ? ` (${b.event.calendar})` : ""}`}>
              <span className="blk-len" aria-hidden="true" />
              <div className="blk-body">
                <div className="blk-title">{b.event.title}</div>
                <div className="blk-time">{fmtMin(b.start)} – {fmtMin(b.end)}{b.event.location ? ` · ${b.event.location}` : ""}</div>
              </div>
            </div>
          ) : (
            <HzTask key={b.task!.id} b={b} color={color(b.task!)} past={b.end <= nowMin} lifting={lifting(b.task!)} short={isShort(`t${b.task!.id}`, b.dur)} style={pos(b.start, b.dur, rows.get(`t${b.task!.id}`) || 0, color(b.task!), `t${b.task!.id}`)} onPointerDown={(e) => onBlockDown(e, b)} />
          ))}

          {target && (
            <div className="tl-block preview" style={{ ...pos(target.start, target.dur, 0, "var(--accent)", drag?.kind !== "new" && drag?.proposalIdx === undefined ? `t${drag!.task.id}` : drag?.proposalIdx !== undefined ? `p${drag.proposalIdx}` : undefined), top: SKY_H + 30 + (drag?.kind !== "new" && drag?.proposalIdx === undefined ? (rows.get(`t${drag!.task.id}`) ?? 0) : drag?.proposalIdx !== undefined ? (rows.get(`p${drag.proposalIdx}`) ?? 0) : count) * ROW_H }}>
              <div className="blk-body">
                <div className="blk-title">{plain(drag!.task.content)}</div>
                <div className="blk-time">{fmtMin(target.start)} – {fmtMin(target.start + target.dur)} · {fmtSpan(target.dur)}</div>
              </div>
            </div>
          )}

          {now.getHours() >= TL_START && <div className="hz-now tl-now" style={{ left: X(nowMin), height: SKY_H + 30 + lanesH }} />}
        </div>
      </div>
      <IdeaClouds ideas={ideas} top={skyTop} height={Math.round(SKY_H * 0.62)} />
    </section>
  );
}

/** The sun's path across the sky band: solid behind you, dotted ahead; stars where it's night. */
function SunArc({ width, rise, set, nowMin, X, skyH: SKY_H }: { width: number; rise: number; set: number; nowMin: number; X: (m: number) => number; skyH: number }) {
  const base = SKY_H - 18, top = 26;
  const y = (m: number) => base - (base - top) * Math.sin(Math.PI * Math.min(1, Math.max(0, (m - rise) / (set - rise))));
  const path = (a: number, b: number) => { const pts: string[] = []; for (let m = a; m <= b; m += 6) pts.push(`${X(m).toFixed(1)},${y(m).toFixed(1)}`); pts.push(`${X(b).toFixed(1)},${y(b).toFixed(1)}`); return `M${pts.join(" L")}`; };
  const up = nowMin > rise && nowMin < set;
  const stars = useMemo(() => {
    const rnd = seeded("horizon-stars"), out: { x: number; y: number; r: number }[] = [];
    for (let i = 0; i < 70; i++) {
      const m = TL_START * 60 + rnd() * (TL_END - TL_START) * 60;
      if (m > rise - 50 && m < set + 50) { rnd(); continue; }
      out.push({ x: X(m), y: 8 + rnd() * (SKY_H - 30), r: 0.6 + rnd() * 0.9 });
    }
    return out;
  }, [width, rise, set, SKY_H]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <svg className="hz-arc" width={width} height={SKY_H} aria-hidden="true">
      {stars.map((s, i) => <circle key={i} className="hz-star" cx={s.x} cy={s.y} r={s.r} />)}
      <line className="hz-horizon" x1={0} x2={width} y1={base} y2={base} />
      {nowMin > rise && <path className="hz-path done" d={path(rise, Math.min(nowMin, set))} />}
      {nowMin < set && <path className="hz-path ahead" d={path(Math.max(rise, nowMin), set)} />}
      {up ? (
        <g className="hz-sun" id="hz-sun-disc" transform={`translate(${X(nowMin)} ${y(nowMin)})`}>
          <circle r="22" className="glow" /><circle r="10" className="disc" />
        </g>
      ) : nowMin >= TL_START * 60 && (
        <g className="hz-moon" id="hz-moon" transform={`translate(${X(nowMin)} ${30})`}><circle r="8" className="disc" /><circle r="8" cx="4" cy="-2" className="bite" /></g>
      )}
    </svg>
  );
}

function HzTask({ b, color, past, lifting, short, style, onPointerDown }: { b: Block; color: string; past: boolean; lifting: boolean; short: boolean; style: CSSProperties; onPointerDown: (e: PointerEvent) => void }) {
  const committed = useCommitted();
  const t = b.task!;
  const pending = usePending().ids.has(t.id);
  const rec = t.due && t.due.is_recurring;
  return (
    <div className={`tl-block ${past ? "past" : ""} ${lifting ? "lifting" : ""} ${short ? "short" : ""} ${pending ? "pending" : ""}`} data-id={t.id} style={{ ...style, ["--c" as string]: color }}
         title={`${plain(t.content)} · ${fmtMin(b.start)}–${fmtMin(b.end)}`} onPointerDown={onPointerDown}>
      <span className="blk-len" aria-hidden="true" />
      <button className="blk-check" title="Complete" aria-label="Complete task" onClick={() => completeTask(t)}><CheckIcon /></button>
      <div className="blk-body">
        <div className="blk-title">{committed.has(t.id) && <span className={`commit-star ${committed.get(t.id)!.star ? "the-one" : ""}`}>★ </span>}{plain(t.content)}{rec ? <span className="rec" title="Repeats"> ↻</span> : null}</div>
        <div className="blk-time">{fmtMin(b.start)} – {fmtMin(b.end)} · {fmtSpan(b.dur)}</div>
      </div>
      <div className="tl-resize" title="Drag to change length" />
    </div>
  );
}
