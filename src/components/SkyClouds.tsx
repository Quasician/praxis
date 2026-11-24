// 3.8: clouds on the Horizon. Two kinds, and they never mean the weather outside:
//  - the day's own weather: the sky clouds over as today fills up (soft grey, unlabelled, behind everything);
//  - your ideas: small white clouds with words on them, drifting across until Claude turns them into tasks.
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { seeded } from "../domain/sky";
import { fmtSpan } from "../lib/dates";
import type { Idea } from "../data/ideas";
import { releaseIdea, shapeIdeas } from "../data/ideas";

/** How full today is: what's planned against the free time you have. */
export function dayWeather(taskMin: number, freeMin: number) {
  const fill = freeMin > 0 ? taskMin / freeMin : taskMin > 0 ? 2 : 0;
  const cover = Math.max(0, Math.min(1, (fill - 0.4) / 0.6));
  const word = fill > 1.1 ? "More planned than fits" : fill > 0.95 ? "Overcast" : fill > 0.7 ? "Clouding over" : fill > 0.4 ? "A few clouds" : "Clear skies";
  const tip = freeMin > 0 ? `${fmtSpan(Math.round(taskMin))} planned in ${fmtSpan(Math.round(freeMin))} of free time today` : "No free time left today";
  return { fill, cover, storm: fill > 1.1, word, tip };
}

/** A flat, simple cloud: a rounded base with two or three puffs on top. */
function Cloud({ w, seed, className }: { w: number; seed: string; className?: string }) {
  const rnd = seeded(seed);
  const h = Math.max(18, w * 0.17), n = 2 + Math.floor(rnd() * 2);
  const puffs = Array.from({ length: n }, (_, i) => {
    const cx = w * (0.26 + (0.48 * (i + 0.5)) / n + (rnd() - 0.5) * 0.06), r = h * (0.62 + rnd() * 0.3) * (i === Math.floor(n / 2) ? 1.2 : 1);
    return { cx, r };
  });
  const top = Math.max(...puffs.map((p) => p.r));
  return (
    <svg className={className} width={w} height={h + top} viewBox={`0 ${-top} ${w} ${h + top}`} aria-hidden="true">
      <rect x={0} y={0} width={w} height={h} rx={h / 2} />
      {puffs.map((p, i) => <circle key={i} cx={p.cx} cy={h * 0.5} r={p.r} />)}
    </svg>
  );
}

/** The day's weather, painted into the Horizon's sky band (it scrolls with the day). */
export function DayWeatherLayer({ cover, storm, x0, x1, skyH }: { cover: number; storm: boolean; x0: number; x1: number; skyH: number }) {
  const clouds = useMemo(() => {
    const n = Math.round(cover * 16) + (storm ? 5 : 0);
    const rnd = seeded("day-weather");
    return Array.from({ length: n }, (_, i) => ({ x: x0 + rnd() * Math.max(1, x1 - x0 - 120), y: 6 + rnd() * skyH * 0.5, w: 70 + rnd() * 90, seed: `dw${i}`, d: 30 + rnd() * 40 }));
  }, [cover, storm, x0, x1, skyH]);
  if (cover <= 0) return null;
  return (
    <div className={`hz-weather${storm ? " storm" : ""}`} id="hz-weather-layer" data-clouds={clouds.length} aria-hidden="true" style={{ "--cover": cover } as CSSProperties}>
      <div className="hz-overcast" />
      {clouds.map((c) => (
        <div key={c.seed} className="hz-wcloud" style={{ left: c.x, top: c.y, "--d": `${c.d}s` } as CSSProperties}><Cloud w={c.w} seed={c.seed} /></div>
      ))}
    </div>
  );
}

/** Your ideas, drifting across the part of the sky you can see. Click one to make it real (or let it go). */
export function IdeaClouds({ ideas, top, height }: { ideas: Idea[]; top: number; height: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(1000);
  const [open, setOpen] = useState<string | null>(null);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 1000)); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (!ideas.length) return null;
  const sel = ideas.find((i) => i.id === open) || null;
  return (
    <div className="idea-sky" style={{ top }} onClick={() => setOpen(null)}>
      <div className="idea-lane" id="idea-sky" ref={box} style={{ height, "--pw": `${w}px` } as CSSProperties}>
      {ideas.map((idea, i) => {
        const rnd = seeded(`idea:${idea.id}`);
        const dur = 160 + rnd() * 120, lane = (i * 0.37 + rnd() * 0.3) % 1;
        const label = idea.text.length > 26 ? idea.text.slice(0, 25).trimEnd() + "…" : idea.text;
        const cw = Math.max(120, Math.min(230, 44 + label.length * 6.8));
        return (
          <button key={idea.id} type="button" className={`idea-cloud${open === idea.id ? " open" : ""}`} data-id={idea.id} title={idea.text}
            style={{ top: 4 + lane * Math.max(10, height - 50), "--lh": `${Math.round(Math.max(18, cw * 0.17))}px`, "--dur": `${dur}s`, "--delay": `${-rnd() * dur}s`, "--cw": `${cw}px` } as CSSProperties}
            onClick={(e) => { e.stopPropagation(); setOpen(open === idea.id ? null : idea.id); }}>
            <Cloud w={cw} seed={`ic:${idea.id}`} className="idea-shape" />
            <span className="idea-label">{label}</span>
          </button>
        );
      })}
      </div>
      {sel && (
        <div className="idea-pop" id="idea-pop" role="dialog" aria-label="Idea" onClick={(e) => e.stopPropagation()}>
          <p className="idea-text">{sel.text}</p>
          <p className="idea-age">An idea since {new Date(sel.at).toLocaleDateString([], { month: "short", day: "numeric" })}</p>
          <div className="idea-acts">
            <button type="button" id="idea-shape" className="primary" onClick={() => { setOpen(null); shapeIdeas([sel.id]); }}>Turn it into tasks with Claude</button>
            {ideas.length > 1 && <button type="button" id="idea-shape-all" className="ghost-btn" onClick={() => { setOpen(null); shapeIdeas(ideas.map((i) => i.id)); }}>All {ideas.length} ideas</button>}
            <button type="button" id="idea-drop" className="ghost-btn" onClick={() => { setOpen(null); releaseIdea(sel.id); }}>Let it go</button>
          </div>
        </div>
      )}
    </div>
  );
}
