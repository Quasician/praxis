// 5.0 One canvas: the sky is the backdrop, lit by the real time of day, with your projects as constellations in it.
// Today's list sits at the left, what the record says at the right, and the day (or the week) along the bottom.
// Day, Week and Sky are zoom levels of the same screen; the numbers pull in from the right.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CLOUDS, LAND, LAND_H, LAND_W, PALETTES, STARS, isLit, moonPos, phaseAt, sunPos, type Phase } from "../canvas/backdrop";
import { layoutSky, SKY_H, type ConstellationView } from "../domain/sky";
import { sunTimes } from "../domain/sun";
import { dayStats } from "../domain/progress";
import { bands, capacity, CAPACITY_DAYS, insights, recordDays, span, weakHours } from "../domain/record";
import { reviewProjects } from "../domain/review";
import { behindProjects } from "../domain/forecast";
import { fromYmd, minOfDay, ymd } from "../lib/dates";
import { colorOf } from "../lib/text";
import { useActive, useCompleted } from "../data/queries";
import { useData } from "../data/useData";
import { useUi } from "../state/ui";
import { useNow } from "./useNow";
import { TopBar } from "./TopBar";
import { TasksPane } from "./TasksPane";
import { HorizonPane } from "./Horizon";
import { WeekView } from "./WeekView";
import { ProgressView } from "./ProgressView";
import { AreasView } from "./AreasView";
import { nextAndToday, Picked, useSkyRecord } from "./SkyView";

type Zoom = "day" | "week" | "sky";
const MIRRORS = [`translate(2 0) scale(-1 1)`, "", `translate(${LAND_W * 2 - 2} 0) scale(-1 1)`];
const fmtDate = (iso?: string | null) => (iso ? new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso).toLocaleDateString([], { month: "short", day: "numeric" }) : "");

/** The phase of the sky right now (changes every few minutes). */
export function usePhase(): Phase {
  const now = useNow();
  const { rise, set } = useMemo(() => sunTimes(now), [ymd(now)]); // eslint-disable-line react-hooks/exhaustive-deps
  return phaseAt(minOfDay(now), rise, set);
}

export function CanvasView() {
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const phase = usePhase();
  const lit = isLit(phase);
  // Progress is a panel over the canvas; the zoom underneath stays where it was.
  const last = useRef<Zoom>("day");
  if (view === "day") last.current = "day"; else if (view === "week") last.current = "week"; else if (view === "areas") last.current = "sky";
  const zoom = last.current;
  const [drawer, setDrawer] = useState<null | "areas">(null);
  const numbers = view === "progress";
  const closeDrawer = () => { setDrawer(null); if (numbers) setView(zoom === "sky" ? "areas" : zoom); };
  useEffect(() => {
    if (!numbers && !drawer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("dialog[open], .ritual-panel")) closeDrawer(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="cv" id="canvas" data-theme={lit ? "light" : "dark"} data-phase={phase} data-zoom={zoom} {...(lit ? { "data-lit": "" } : {})}>
      <Backdrop phase={phase} />
      <TopBar />
      <div className="cv-mid">
        {zoom === "day" && <aside className="cv-left" aria-label="Today">{<TasksPane />}</aside>}
        <ConstellationLayer lit={lit} labels={zoom === "sky"} onArea={() => setDrawer("areas")} />
        {zoom === "day" && <aside className="cv-right" aria-label="The record"><RecordPanel /></aside>}
      </div>
      {zoom !== "sky" && <div className={`cv-bottom ${zoom}`}>{zoom === "day" ? <HorizonPane compact /> : <WeekView />}</div>}
      {zoom === "sky" && (
        <div className="cv-sky-actions">
          <button type="button" className="ghost-btn" id="cv-areas" onClick={() => setDrawer("areas")}>Areas in detail</button>
          <button type="button" className="primary" id="cv-new-project" onClick={() => useUi.getState().openDialog("constellation")}>+ New project</button>
        </div>
      )}
      {(numbers || drawer) && (
        <div className="cv-drawer" id="cv-drawer" role="region" aria-label={numbers ? "Numbers" : "Areas"}>
          <div className="cv-drawer-head">
            <h2>{numbers ? "Numbers" : "Areas"}</h2>
            <button type="button" className="icon-btn" id="cv-drawer-close" aria-label="Close" title="Close (Esc)" onClick={closeDrawer}>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
          </div>
          {numbers ? <ProgressView /> : <AreasView side />}
        </div>
      )}
    </div>
  );
}

// ---------- the backdrop ----------
/** The sky is drawn 900 units tall and as wide as the screen's shape needs, so nothing is cropped or stretched:
 *  the sun and clouds keep their place across the width whatever the window's proportions. */
function Backdrop({ phase }: { phase: Phase }) {
  const now = useNow();
  const p = PALETTES[phase];
  const { rise, set } = useMemo(() => sunTimes(now), [ymd(now)]); // eslint-disable-line react-hooks/exhaustive-deps
  const m = minOfDay(now);
  const box = useRef<SVGSVGElement>(null);
  const [W, setW] = useState(2100);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); if (r.height > 0) setW(Math.max(900, Math.round(900 * r.width / r.height))); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fx = W / 2100;   // the drawing's own positions are for a 2100-wide sky
  const sun = sunPos(m, rise, set);
  const moon = !isLit(phase) ? moonPos(m, rise, set) : null;
  return (
    <div className="cv-back" aria-hidden="true">
      <svg className="cv-skybox" ref={box} viewBox={`0 0 ${W} 900`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="cv-sky" x1="0" y1="0" x2="0" y2="1">{p.sky.map(([c, o]) => <stop key={o} offset={`${o}%`} stopColor={c} />)}</linearGradient>
          <radialGradient id="cv-sun"><stop offset="0" stopColor={p.sun} /><stop offset=".16" stopColor={p.glow} stopOpacity=".9" /><stop offset=".42" stopColor={p.glow} stopOpacity=".3" /><stop offset="1" stopColor={p.glow} stopOpacity="0" /></radialGradient>
          {p.clouds && <linearGradient id="cv-cloud" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={p.clouds[0]} /><stop offset=".6" stopColor={p.clouds[1]} /><stop offset="1" stopColor={p.clouds[2]} /></linearGradient>}
          <filter id="cv-soft" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="9" /></filter>
        </defs>
        <rect width={W} height="900" fill="url(#cv-sky)" />
        {p.stars > 0 && <g className="cv-stars" opacity={p.stars}>{STARS.map((s, i) => <circle key={i} cx={s.x * fx} cy={s.y} r={s.r * 1.3} fill="#dfe6ff" opacity={s.o} />)}</g>}
        {sun && <g className="cv-sun"><circle cx={sun.x * fx} cy={sun.y} r={230 + 120 * sun.low} fill="url(#cv-sun)" /><circle cx={sun.x * fx} cy={sun.y} r={42 + 10 * sun.low} fill={p.sun} /></g>}
        {moon && <g className="cv-moon"><circle cx={moon.x * fx} cy={moon.y} r="110" fill="url(#cv-sun)" opacity=".5" /><circle cx={moon.x * fx} cy={moon.y} r="30" fill="#eef1fb" /></g>}
        {p.clouds && CLOUDS.map((c, i) => {
          const dx = c.x * fx - c.x;   // the bank keeps its shape; only where it sits across the width moves
          return (
            <g key={i} transform={`translate(${dx} 0)`}>
              <ellipse cx={c.x} cy={c.base + 10} rx={c.w * .52} ry="16" fill={p.clouds![2]} opacity=".4" filter="url(#cv-soft)" />
              {c.puffs.map((u, j) => <circle key={j} cx={u.x} cy={u.y} r={u.r} fill="url(#cv-cloud)" />)}
              <rect x={c.x - c.w / 2} y={c.base - 26} width={c.w} height="34" rx="17" fill={p.clouds![1]} />
              {c.puffs.filter((_, j) => j % 2 === 0).map((u, j) => <circle key={`h${j}`} cx={u.x - u.r * .18} cy={u.y - u.r * .22} r={u.r * .62} fill={p.clouds![0]} opacity=".75" />)}
            </g>
          );
        })}
      </svg>
      {/* Fitted by height so the peaks are never cut off; mirrored copies either side fill a screen wider than the drawing. */}
      <svg className="cv-land" viewBox={`0 0 ${LAND_W} ${LAND_H}`} preserveAspectRatio="xMidYMax meet">
        {/* Layer by layer across the three copies, so where they meet each layer covers the join fully (no seam). */}
        {LAND.map((l, i) => <g key={i} fill={p[l.fill]}>{MIRRORS.map((t) => <path key={t} d={l.d} transform={t || undefined} />)}</g>)}
      </svg>
      <div className="cv-ground" style={{ background: p.front }} />
    </div>
  );
}

// ---------- the constellations ----------
function ConstellationLayer({ lit, labels, onArea }: { lit: boolean; labels: boolean; onArea: (id: string) => void }) {
  const { config } = useData();
  const { sky, active } = useSkyRecord();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 500 });
  const [picked, setPicked] = useState<string | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; text: string; sub: string } | null>(null);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 1200, h: el.clientHeight || 500 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { nextIds, todayIds } = useMemo(() => nextAndToday(active), [active]);
  const W = SKY_H * (size.w / Math.max(1, size.h)), k = W / Math.max(1, size.w);
  const lay = useMemo(() => layoutSky(sky, { width: W, areas: config?.areas || [], colorOf, nextIds, todayIds, seenAt: Date.now(), allAreas: labels }),
    [sky, W, config?.areas, nextIds, todayIds, labels]); // eslint-disable-line react-hooks/exhaustive-deps
  const sel = [...lay.constellations, ...lay.milky].find((c) => c.id === picked) || null;
  const tip = (c: ConstellationView, i: number, e: React.MouseEvent) => {
    const s = c.stars[i], r = box.current!.getBoundingClientRect();
    setHover({ x: e.clientX - r.left, y: e.clientY - r.top, text: s.title, sub: s.lit ? `Done ${fmtDate(s.done)}` : s.next ? "Next step" : s.today ? "On today" : "To do" });
  };
  return (
    <div className="cv-sky" ref={box} onMouseLeave={() => setHover(null)} onClick={() => setPicked(null)}>
      <svg viewBox={`0 0 ${W} ${SKY_H}`} preserveAspectRatio="none" className="cv-sky-svg" role="img" aria-label="Your projects drawn as constellations">
        {lay.milky.map((c) => (
          <g key={c.id} className="cvs-milky" transform={`translate(${c.x} ${c.y})`} onClick={(e) => { e.stopPropagation(); setPicked(c.id); }}>
            <rect x={-6} y={-6} width={c.w + 12} height={c.h + 12} fill="transparent" />
            {c.links.map((l, i) => <line key={i} x1={c.stars[l.a].x} y1={c.stars[l.a].y} x2={c.stars[l.b].x} y2={c.stars[l.b].y} strokeWidth={k} />)}
            {c.stars.map((s) => <circle key={s.id} cx={s.x} cy={s.y} r={1.6 * k} />)}
          </g>
        ))}
        {lay.constellations.map((c) => (
          <g key={c.id} id={`cvc-${c.id}`} className={`cvs-con${c.late || c.pace?.behind ? " late" : ""}${picked === c.id ? " picked" : ""}`} data-standing={c.standing}
             transform={`translate(${c.x} ${c.y})`} style={{ "--c": c.color, opacity: picked === c.id ? 1 : 1 - c.dim } as React.CSSProperties}
             onClick={(e) => { e.stopPropagation(); setPicked(picked === c.id ? null : c.id); }}>
            <rect className="cvs-hit" x={-18} y={-18} width={c.w + 36} height={c.h + 70 * k} />
            {c.links.map((l, i) => <line key={i} className={`cvs-link${l.lit ? " lit" : ""}`} x1={c.stars[l.a].x} y1={c.stars[l.a].y} x2={c.stars[l.b].x} y2={c.stars[l.b].y}
              strokeWidth={(l.lit ? 2 : 1.3) * k} strokeDasharray={l.lit ? undefined : `${3 * k} ${6 * k}`} />)}
            {c.stars.map((s, i) => (
              <g key={s.id} className={`cvs-star${s.lit ? " lit" : ""}`} transform={`translate(${s.x} ${s.y})`} onMouseMove={(e) => tip(c, i, e)} onMouseLeave={() => setHover(null)}>
                <circle className="hit" r={12 * k} />
                {s.lit && <circle className="halo" r={(lit ? 14 : 16) * k} />}
                {s.next && <circle className="ring" r={10 * k} strokeWidth={2 * k} />}
                <circle className="core" r={(s.lit ? Math.min(7, 3 + s.r * .5) : 3.4) * k} strokeWidth={(lit ? 2.2 : 1.6) * k} />
              </g>
            ))}
            <g transform={`translate(0 ${c.h + 24 * k})`}>
              <text className="cvs-name" fontSize={16 * k}>{c.name}</text>
              <text className="cvs-sub" y={19 * k} fontSize={13 * k}>
                {c.lit} of {c.total}{c.pace && c.standing !== "stalled" && c.standing !== "resting" ? ` · ${c.pace.when} at this pace` : ""}{c.target ? ` · ${c.late ? "late" : c.daysLeft === 0 ? "due today" : `due ${fmtDate(c.target)}`}` : ""}
                {c.standing === "resting" ? " · set down" : c.standing === "stalled" || c.standing === "quiet" ? ` · quiet ${c.quiet} days` : ""}
              </text>
            </g>
          </g>
        ))}
        {labels && lay.regions.map((r) => (
          <text key={r.name} className="cvs-region" x={r.x + r.w / 2} y={SKY_H - 10 * k} fontSize={14 * k} textAnchor="middle" role="button" tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onArea(r.id || "other"); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onArea(r.id || "other"); } }}>{r.name}</text>
        ))}
      </svg>
      {hover && <div className="sky-tip" style={{ left: hover.x + 14, top: hover.y + 14 }}><b>{hover.text}</b><span>{hover.sub}</span></div>}
      {sel && <Picked c={sel} active={active} right={sel.x + sel.w / 2 < W * 0.45} onClose={() => setPicked(null)} />}
    </div>
  );
}

// ---------- the record panel ----------
const LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
function RecordPanel() {
  const { config, cfg, connected } = useData();
  const completed = useCompleted(connected).data;
  const active = useActive(connected).data;
  const setView = useUi((s) => s.setView);
  const openDialog = useUi((s) => s.openDialog);
  const ready = !!config && !!completed;
  const days = useMemo(() => (ready ? recordDays(config, completed!, active || []) : []), [ready, config, completed, active]); // eslint-disable-line react-hooks/exhaustive-deps
  const weak = useMemo(() => (ready ? weakHours(bands(config, completed!)) : null), [ready, config, completed]); // eslint-disable-line react-hooks/exhaustive-deps
  const says = insights(days, weak, config).filter((s) => s.id !== "slips").slice(0, 3);
  const cap = capacity(days, cfg);
  const week = ready ? dayStats(config, completed!, 7) : [];
  const stalled = reviewProjects(config?.sky).stalled.length;
  const behind = behindProjects(config?.sky).slice(0, 2);
  return (
    <section className="cv-panel rec" id="cv-record">
      <div className="rec-head">
        <h3>The record</h3>
        <button type="button" className="link-btn" id="cv-all-numbers" onClick={() => setView("progress")}>All numbers</button>
      </div>
      {!ready ? <div className="skeleton" /> : <>
        {says.length ? <ul className="rec-says">{says.map((s) => <li key={s.id} title={s.detail}>{s.text}</li>)}</ul>
          : <p className="rec-wait">Praxis learns from your days. After {CAPACITY_DAYS} days with a plan it says here what it sees ({Math.min(days.length, CAPACITY_DAYS)} of {CAPACITY_DAYS} so far).</p>}
        {cap && <p className="rec-cap">Today's commitments stop at about <b>{span(cap.min)}</b>.</p>}
        {behind.map((b) => <p key={b.id} className="rec-warn" title={b.detail}>{b.name} is {b.text}.</p>)}
        {stalled > 0 && <p className="rec-warn">{stalled === 1 ? "One project hasn't" : `${stalled} projects haven't`} had a star lit in three weeks. <button type="button" className="link-btn" onClick={() => openDialog("review")}>Decide</button></p>}
        <div className="rec-week">
          <span className="rec-week-title">Last 7 days</span>
          <div className="rec-bars" role="img" aria-label="Planned work done each of the last seven days">
            {week.map((d) => (
              <div key={d.day} className="rec-day" title={`${fromYmd(d.day).toLocaleDateString([], { weekday: "long" })}: ${d.plannedDone} of ${d.planned} planned done${d.extra ? `, +${d.extra} more` : ""}`}>
                <div className="rec-track"><div className="rec-fill" style={{ height: `${d.planned ? (d.plannedDone / d.planned) * 100 : 0}%` }} /></div>
                <span>{LETTERS[fromYmd(d.day).getDay()]}</span>
              </div>
            ))}
          </div>
        </div>
      </>}
    </section>
  );
}
