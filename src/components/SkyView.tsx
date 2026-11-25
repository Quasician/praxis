import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EMPTY_SKY, layoutSky, mergeSky, SKY_H, type ConstellationView } from "../domain/sky";
import { parseDue, startOfToday } from "../lib/dates";
import { isMilestone } from "../lib/tasks";
import { colorOf } from "../lib/text";
import type { Task } from "../lib/types";
import { doToday, updateConfig } from "../data/actions";
import { useActive, useCompleted } from "../data/queries";
import { useData } from "../data/useData";
import { useUi } from "../state/ui";
import { auroraOn } from "../domain/rewards";
import { wake } from "../data/review";

const SEEN_KEY = "praxis.sky.seen";
const readSeen = () => { try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; } };
const fmtDate = (iso?: string | null) => (iso ? new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso).toLocaleDateString([], { month: "short", day: "numeric" }) : "");
const dayWord = (n: number) => (n === 1 ? "1 day" : `${n} days`);

/** Keeps the saved sky in step with Todoist, and returns it. */
export function useSkyRecord() {
  const { config, connected } = useData();
  const activeQ = useActive(connected), completedQ = useCompleted(connected);
  const ready = !!config && activeQ.isSuccess && completedQ.isSuccess;
  const areas = config?.areas || [];
  const merged = useMemo(() => (ready ? mergeSky(config?.sky, activeQ.data!, completedQ.data!, areas) : config?.sky || EMPTY_SKY),
    [ready, config?.sky, activeQ.data, completedQ.data, areas]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ready || merged === (config?.sky || EMPTY_SKY)) return;
    updateConfig((c) => ({ ...c, sky: mergeSky(c.sky, activeQ.data!, completedQ.data!, c.areas || []) })).catch(() => undefined);
  }, [ready, merged]); // eslint-disable-line react-hooks/exhaustive-deps
  return { sky: merged, active: activeQ.data || [], ready };
}

/** The sky. On the Sky tab (3.8) it's also how you get around your areas: each area is a region; click one to open it. */
export function SkyView({ allAreas = false, selectedArea = null, onArea, actions }: { allAreas?: boolean; selectedArea?: string | null; onArea?: (id: string) => void; actions?: React.ReactNode } = {}) {
  const { config } = useData();
  const { sky, active, ready } = useSkyRecord();
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1600, h: 640 });
  const [seenAt] = useState(readSeen);
  const [hover, setHover] = useState<{ x: number; y: number; text: string; sub: string } | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 1600, h: el.clientHeight || 640 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Stars lit since your last look get to light up in front of you, once.
  useEffect(() => { const id = setTimeout(() => { try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch { /* ignore */ } }, 5000); return () => clearTimeout(id); }, []);

  const { nextIds, todayIds } = useMemo(() => nextAndToday(active), [active]);
  const W = SKY_H * (size.w / Math.max(1, size.h));
  const k = W / Math.max(1, size.w);                 // viewBox units per screen pixel: keeps text a steady size
  const lay = useMemo(() => layoutSky(sky, { width: W, areas: config?.areas || [], colorOf, nextIds, todayIds, seenAt, allAreas }),
    [sky, W, config?.areas, nextIds, todayIds, seenAt, allAreas]);
  const sel = [...lay.constellations, ...lay.milky].find((c) => c.id === picked) || null;
  const aurora = auroraOn(config?.rewards);

  const month = Date.now() - 30 * 864e5;
  const litMonth = Object.values(sky.cons).reduce((n, c) => n + c.steps.filter((s) => s.done && Date.parse(s.done) > month).length, 0);
  const show = (c: ConstellationView, i: number, e: React.MouseEvent) => {
    const s = c.stars[i], r = box.current!.getBoundingClientRect();
    setHover({ x: e.clientX - r.left, y: e.clientY - r.top, text: s.title,
      sub: s.lit ? `Done ${fmtDate(s.done)}` : s.next ? (s.today ? "Next step · on today" : "Next step") : s.today ? "On today" : "To do" });
  };

  return (
    <section className="sky-wrap" id="sky">
      <div className="sky-head">
        <div>
          <h2>Your sky</h2>
          <p className="areas-sub" id="sky-sub">
            {lay.constellations.length ? <><b>{lay.constellations.length}</b> {lay.constellations.length === 1 ? "project" : "projects"} in progress · <b>{litMonth}</b> {litMonth === 1 ? "star" : "stars"} lit in the last 30 days{lay.milky.length ? <> · <b>{lay.milky.length}</b> finished</> : null}</> : "Your projects become constellations here."}
          </p>
        </div>
        <div className="sky-head-right">
          <p className="sky-legend">Bright stars are done, faint ones are still to do, a gold ring is the next step. The lower a project sits, the sooner it's due.</p>
          {actions}
          <button className="primary" id="sky-new" onClick={() => useUi.getState().openDialog("constellation")}>+ New project</button>
        </div>
      </div>

      <div className="sky" ref={box} onMouseLeave={() => setHover(null)} onClick={() => setPicked(null)}>
        <svg viewBox={`0 0 ${W} ${SKY_H}`} preserveAspectRatio="none" className="sky-svg" role="img" aria-label="Your projects drawn as constellations">
          <defs>
            <linearGradient id="sky-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="sky-top" /><stop offset="1" className="sky-low" /></linearGradient>
            <radialGradient id="sky-glow"><stop offset="0" stopColor="#fff" stopOpacity=".55" /><stop offset=".35" stopColor="#fff" stopOpacity=".16" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></radialGradient>
            <radialGradient id="sky-band" cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#c9d4ff" stopOpacity=".10" /><stop offset="1" stopColor="#c9d4ff" stopOpacity="0" /></radialGradient>
          </defs>
          <rect width={W} height={SKY_H} fill="url(#sky-bg)" />
          <ellipse cx={W / 2} cy={44} rx={W * 0.55} ry={46} fill="url(#sky-band)" />
          {aurora && <SkyAurora W={W} />}
          {onArea && lay.regions.map((r) => (
            <rect key={`hit-${r.id || "other"}`} className={`sky-region-hit${(r.id || "other") === selectedArea ? " on" : ""}`} x={r.x} y={0} width={r.w} height={SKY_H}
              style={{ "--c": r.color } as React.CSSProperties} onClick={(e) => { e.stopPropagation(); setPicked(null); onArea(r.id || "other"); }} />
          ))}
          <g className="sky-dust">{lay.dust.map((d, i) => <circle key={i} cx={d.x} cy={d.y} r={d.r * k * 1.2} opacity={d.o} className={d.fresh ? "fresh" : ""} />)}</g>

          {lay.milky.map((c) => (
            <g key={c.id} className="sky-milky" transform={`translate(${c.x} ${c.y})`} onClick={(e) => { e.stopPropagation(); setPicked(c.id); }}
               onMouseMove={(e) => { const r = box.current!.getBoundingClientRect(); setHover({ x: e.clientX - r.left, y: e.clientY - r.top, text: c.name, sub: c.legend || `Finished ${fmtDate(c.finished)} · ${c.total} stars` }); }}>
              <rect x={-6} y={-6} width={c.w + 12} height={c.h + 12} fill="transparent" />
              {c.links.map((l, i) => <line key={i} x1={c.stars[l.a].x} y1={c.stars[l.a].y} x2={c.stars[l.b].x} y2={c.stars[l.b].y} />)}
              {c.stars.map((s) => <circle key={s.id} cx={s.x} cy={s.y} r={1.3 * k * 1.4} />)}
            </g>
          ))}

          {lay.constellations.map((c, ci) => (
            <g key={c.id} id={`con-${c.id}`} className={`sky-con ${picked === c.id ? "picked" : ""} ${c.late ? "late" : ""} ${c.dim ? "faded" : ""}`} data-standing={c.standing} transform={`translate(${c.x} ${c.y})`}
               style={{ "--c": c.color, "--fade": 1 - c.dim } as React.CSSProperties} data-lit={c.lit} data-total={c.total}
               onClick={(e) => { e.stopPropagation(); setPicked(picked === c.id ? null : c.id); }}>
              <rect className="sky-hit" x={-18} y={-18} width={c.w + 36} height={c.h + 70 * k} />
              {c.links.map((l, i) => (
                <line key={i} className={`sky-link ${l.lit ? "lit" : ""} ${l.lit && (c.stars[l.a].fresh || c.stars[l.b].fresh) ? "fresh" : ""}`}
                  x1={c.stars[l.a].x} y1={c.stars[l.a].y} x2={c.stars[l.b].x} y2={c.stars[l.b].y} pathLength={1}
                  strokeWidth={(l.lit ? 1.6 : 1) * k} style={{ animationDelay: `${0.4 + ci * 0.15 + i * 0.12}s` }} />
              ))}
              {c.stars.map((s, i) => (
                <g key={s.id} className={`sky-star ${s.lit ? "lit" : "dim"} ${s.next ? "next" : ""} ${s.today ? "today" : ""} ${s.fresh ? "fresh" : ""}`}
                   data-step={s.id} transform={`translate(${s.x} ${s.y})`}
                   onMouseMove={(e) => show(c, i, e)} onMouseLeave={() => setHover(null)}>
                  {/* The animation lives on an inner group: a CSS transform would replace the star's position. */}
                  <g className="star-in" style={{ animationDelay: `${0.3 + ci * 0.15 + i * 0.12}s` }}>
                    <circle className="hit" r={12 * k} />
                    {s.lit && <circle className="halo" r={s.r * 4.6 * k} fill="url(#sky-glow)" />}
                    {s.next && <circle className="ring" r={9 * k} strokeWidth={1.6 * k} />}
                    <circle className="core" r={(s.lit ? s.r : 2.4) * k} strokeWidth={1.3 * k} />
                  </g>
                </g>
              ))}
              <g className="sky-label" transform={`translate(0 ${c.h + 22 * k})`}>
                <text className="name" fontSize={14.5 * k}>{c.name}</text>
                <text className="sub" y={18 * k} fontSize={12.5 * k}>
                  {c.lit} of {c.total}{c.target ? ` · ${c.late ? `${dayWord(-(c.daysLeft || 0))} late` : c.daysLeft === 0 ? "due today" : `due ${fmtDate(c.target)}`}` : ""}{c.standing === "resting" ? " · set down" : c.standing === "stalled" || c.standing === "quiet" ? ` · quiet ${dayWord(c.quiet)}` : ""}
                </text>
                <rect className="bar" y={26 * k} width={90 * k} height={3 * k} rx={1.5 * k} />
                <rect className="bar-fill" y={26 * k} width={90 * k * (c.total ? c.lit / c.total : 0)} height={3 * k} rx={1.5 * k} />
              </g>
            </g>
          ))}

          <path className="sky-ground" d={`M0 ${lay.horizon} Q ${W * 0.25} ${lay.horizon - 8} ${W * 0.5} ${lay.horizon - 2} T ${W} ${lay.horizon - 4} L ${W} ${SKY_H} L 0 ${SKY_H} Z`} />
          {lay.regions.map((r) => (
            <text key={r.name} className={`sky-region${onArea ? " pick" : ""}${(r.id || "other") === selectedArea ? " on" : ""}`} data-area={r.id || "other"} x={r.x + r.w / 2} y={lay.horizon + 30 * k} fontSize={12.5 * k} textAnchor="middle"
              style={{ fill: `color-mix(in srgb, ${r.color} 55%, #fff)` }} {...(onArea ? { role: "button", tabIndex: 0, "aria-pressed": (r.id || "other") === selectedArea,
                onClick: (e: React.MouseEvent) => { e.stopPropagation(); setPicked(null); onArea(r.id || "other"); },
                onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onArea(r.id || "other"); } } } : {})}>{r.name}</text>
          ))}
        </svg>

        {hover && <div className="sky-tip" style={{ left: hover.x + 14, top: hover.y + 14 }}><b>{hover.text}</b><span>{hover.sub}</span></div>}
        {ready && !lay.constellations.length && !lay.milky.length && (
          <div className="sky-empty" id="sky-empty">
            <b>Your projects become constellations here.</b>
            <span>Describe a goal and Claude breaks it into steps. Each step you finish lights a star.</span>
            <button className="primary" onClick={(e) => { e.stopPropagation(); useUi.getState().openDialog("constellation"); }}>+ New project</button>
          </div>
        )}
        {sel && <Picked c={sel} active={active} right={sel.x + sel.w / 2 < W * 0.45} onClose={() => setPicked(null)} />}
      </div>
    </section>
  );
}

export function nextAndToday(active: Task[]) {
  const nextIds = new Map<string, string>(), todayIds = new Set<string>();
  const tonight = +startOfToday() + 864e5;
  for (const m of active.filter(isMilestone)) {
    const steps = active.filter((t) => t.parent_id === m.id).sort((a, b) => (a.child_order ?? 0) - (b.child_order ?? 0));
    if (steps[0]) nextIds.set(m.id, steps[0].id);
    for (const s of steps) { const d = parseDue(s.due); if (d && +d.d < tonight) todayIds.add(s.id); }
  }
  return { nextIds, todayIds };
}

export function Picked({ c, active, right, onClose }: { c: ConstellationView; active: Task[]; right: boolean; onClose: () => void }) {
  const next = c.nextStep && active.find((t) => t.id === c.nextStep!.id);
  return (
    <div className={`sky-card ${right ? "right" : ""}`} id="sky-card" onClick={(e) => e.stopPropagation()} style={{ "--c": c.color } as React.CSSProperties}>
      <button className="sky-card-x" aria-label="Close" onClick={onClose}>×</button>
      <span className="sky-card-area">{c.finished ? "Finished" : c.areaName || "Project"}</span>
      <h3>{c.name}</h3>
      <p className="sky-card-sub">
        {c.lit} of {c.total} stars lit
        {c.finished ? ` · finished ${fmtDate(c.finished)}` : c.target ? ` · ${c.late ? `${dayWord(-(c.daysLeft || 0))} past its deadline` : c.daysLeft === 0 ? "due today" : `due ${fmtDate(c.target)}, in ${dayWord(c.daysLeft || 0)}`}` : ""}
      </p>
      {c.legend && <p className="sky-card-legend" id="sky-legend-line">{c.legend}</p>}
      {c.standing === "resting" && <p className="sky-card-quiet" id="sky-card-quiet">Set down in a weekly review. It stays out of your plans until you pick it back up.</p>}
      {(c.standing === "stalled" || c.standing === "quiet") && <p className="sky-card-quiet" id="sky-card-quiet">No star lit in {dayWord(c.quiet)}{c.standing === "stalled" ? ". It has faded; lighting one brings it back." : "."}</p>}
      <ol className="sky-steps">
        {c.stars.map((s) => (
          <li key={s.id} className={s.lit ? "lit" : s.next ? "next" : ""}>
            <span className="dot" />{s.title}
            {s.lit ? <small>{fmtDate(s.done)}</small> : s.today ? <small>today</small> : null}
          </li>
        ))}
      </ol>
      {c.standing === "resting"
        ? <button className="primary" id="sky-wake" onClick={() => wake(c.id)}>Pick it back up</button>
        : next && !c.nextStep!.today && <button className="primary" id="sky-do-today" onClick={() => doToday(next)}>Do the next step today</button>}
    </div>
  );
}

/** 3.7: the aurora, after a week of kept commitments: rays of green and violet light along the top of your sky until morning. */
function SkyAurora({ W }: { W: number }) {
  const rays = useMemo(() => {
    const out: { x: number; y: number; h: number; o: number; v: boolean }[] = [];
    const n = Math.round(W / 9);
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) * W / n, u = x / W;
      const base = 96 + Math.sin(u * 13 + 1.3) * 22 + Math.sin(u * 31 - .6) * 8;          // the curtain's lower edge, wandering
      const curtain = Math.max(0, Math.sin(u * 9.5 + .4) * .6 + Math.sin(u * 23 + 2) * .4);   // where it's bright, where it thins out
      const flick = .55 + .45 * Math.sin(i * 12.9898) * Math.sin(i * 4.1414);
      if (curtain * flick < .05) continue;
      out.push({ x, y: base, h: 60 + curtain * 70, o: Math.min(.9, curtain * (.6 + .4 * flick)), v: Math.sin(u * 5 + 3) > .55 });
    }
    return out;
  }, [W]);
  const w = W / Math.round(W / 9) * 1.4;
  return (
    <g className="sky-aurora" id="sky-aurora" aria-hidden="true" filter="url(#aur-blur)">
      <defs>
        <filter id="aur-blur" x="-5%" y="-30%" width="110%" height="160%"><feGaussianBlur stdDeviation="3 5" /></filter>
        <linearGradient id="aur-g" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#7dffbf" stopOpacity=".7" /><stop offset=".35" stopColor="#4fe3a0" stopOpacity=".3" /><stop offset="1" stopColor="#4fe3a0" stopOpacity="0" /></linearGradient>
        <linearGradient id="aur-v" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stopColor="#8affd0" stopOpacity=".6" /><stop offset=".4" stopColor="#b48cff" stopOpacity=".28" /><stop offset="1" stopColor="#b48cff" stopOpacity="0" /></linearGradient>
      </defs>
      {rays.map((r, i) => <rect key={i} x={r.x - w / 2} y={r.y - r.h} width={w} height={r.h + 6} fill={r.v ? "url(#aur-v)" : "url(#aur-g)"} opacity={r.o} />)}
    </g>
  );
}
