// The night sky: your projects as constellations.
//   • Each @milestone task is a constellation; its sub-tasks are the stars.
//   • Finished steps are lit stars, joined by lines. Steps still to do are faint, so the whole shape shows from day one.
//   • A project's height is its deadline: the closer it is, the lower it sinks toward the horizon.
//   • Bigger steps (longer duration) are brighter stars.
//   • Finished projects drift up into the Milky Way; finished loose tasks are stardust.
// Todoist only serves ~3 months of completed tasks, so the sky keeps its own record of every star (in the config).
import { isMilestone } from "../lib/tasks";
import type { Area, Task } from "../lib/types";

export interface SkyStep { id: string; title: string; min: number; done?: string }
export interface SkyConstellation { name: string; area?: string; steps: SkyStep[]; since: string; finished?: string; target?: string | null }
export interface SkyRecord { cons: Record<string, SkyConstellation>; dust: Record<string, number> }

export const EMPTY_SKY: SkyRecord = { cons: {}, dust: {} };
const DUST_KEEP = 400;   // days of stardust kept
const DEFAULT_MIN = 20;  // a step with no duration

const plainTitle = (s: string) => String(s || "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`]/g, "").trim();
const minutesOf = (t: Task) => {
  const d = t.duration;
  if (!d) return DEFAULT_MIN;
  const m = d.unit === "day" ? d.amount * 1440 : d.amount;
  return m > 0 && m < 1440 ? m : DEFAULT_MIN;
};
const ymdOf = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const targetOf = (m: Task) => (m.deadline && m.deadline.date) || (m.due && m.due.date && m.due.date.slice(0, 10)) || null;

/**
 * Brings the saved sky up to date with Todoist. Pure: returns a new record (or the same object if nothing changed).
 * Steps keep the order they were first seen in, so a constellation's shape never reshuffles: new steps add stars.
 */
export function mergeSky(prev: SkyRecord | undefined, active: Task[], completed: Task[], areas: Area[], now = new Date()): SkyRecord {
  const old = prev || EMPTY_SKY;
  const cons: Record<string, SkyConstellation> = {};
  const areaOf = (projectId: string) => areas.find((a) => a.projects.includes(projectId))?.id;
  const activeById = new Map(active.map((t) => [t.id, t]));
  const doneById = new Map(completed.map((t) => [t.id, t]));
  const childrenOpen = new Map<string, Task[]>(), childrenDone = new Map<string, Task[]>();
  for (const t of active) if (t.parent_id) childrenOpen.set(t.parent_id, [...(childrenOpen.get(t.parent_id) || []), t]);
  for (const t of completed) if (t.parent_id) childrenDone.set(t.parent_id, [...(childrenDone.get(t.parent_id) || []), t]);

  const build = (id: string, m: Task | undefined, was: SkyConstellation | undefined, finishedAt?: string): SkyConstellation => {
    const open = (childrenOpen.get(id) || []).sort((a, b) => (a.child_order ?? 0) - (b.child_order ?? 0));
    const done = (childrenDone.get(id) || []).sort((a, b) => (a.completed_at || "").localeCompare(b.completed_at || ""));
    const steps: SkyStep[] = [];
    // Keep every star we already know about, in its original place.
    for (const s of was?.steps || []) {
      const a = activeById.get(s.id), c = doneById.get(s.id);
      if (a) steps.push({ id: s.id, title: plainTitle(a.content), min: minutesOf(a) });                       // open (maybe reopened)
      else if (c) steps.push({ id: s.id, title: plainTitle(c.content), min: minutesOf(c), done: s.done || c.completed_at || now.toISOString() });
      else if (s.done) steps.push(s);                                                                           // done long ago: kept forever
      else if (finishedAt) steps.push({ ...s, done: finishedAt });                                              // the project was finished with it
      // else: deleted in Todoist, so the star goes too
    }
    const known = new Set(steps.map((s) => s.id));
    // New stars: ones already finished first (in the order you did them), then the open ones in Todoist's order.
    for (const c of done) if (!known.has(c.id)) steps.push({ id: c.id, title: plainTitle(c.content), min: minutesOf(c), done: c.completed_at || now.toISOString() });
    for (const a of open) if (!known.has(a.id)) steps.push({ id: a.id, title: plainTitle(a.content), min: minutesOf(a) });
    const src = m || doneById.get(id);
    return {
      name: src ? plainTitle(src.content) : was?.name || "Project",
      area: (src && areaOf(src.project_id)) || was?.area,
      since: was?.since || now.toISOString(),
      steps,
      ...(finishedAt ? { finished: finishedAt } : {}),
      target: src ? targetOf(src) : was?.target ?? null,
    };
  };

  for (const m of active.filter(isMilestone)) cons[m.id] = build(m.id, m, old.cons[m.id]);
  for (const [id, was] of Object.entries(old.cons)) {
    if (cons[id]) continue;
    if (was.finished) { cons[id] = was; continue; }                                    // already in the Milky Way
    const c = doneById.get(id);
    if (c) cons[id] = build(id, undefined, was, c.completed_at || now.toISOString());   // just finished
    // else: deleted (or no longer a milestone): it leaves the sky
  }
  // Milestones finished before Praxis ever saw them still belong in the Milky Way.
  for (const c of completed) {
    if (cons[c.id] || !isMilestone(c)) continue;
    if ((childrenDone.get(c.id) || []).length) cons[c.id] = build(c.id, undefined, undefined, c.completed_at || now.toISOString());
  }

  // Stardust: finished tasks that aren't project steps, counted per day. Max keeps days that rolled out of Todoist's window.
  const stepIds = new Set(Object.values(cons).flatMap((x) => x.steps.map((s) => s.id)));
  const counts: Record<string, number> = {};
  for (const t of completed) {
    if (!t.completed_at || stepIds.has(t.id) || cons[t.id] || t.parent_id && cons[t.parent_id]) continue;
    const k = ymdOf(t.completed_at); counts[k] = (counts[k] || 0) + 1;
  }
  const dust: Record<string, number> = { ...old.dust };
  for (const [k, n] of Object.entries(counts)) dust[k] = Math.max(dust[k] || 0, n);
  const cutoff = ymdOf(new Date(now.getTime() - DUST_KEEP * 864e5).toISOString());
  for (const k of Object.keys(dust)) if (k < cutoff) delete dust[k];

  const next = { cons, dust };
  return JSON.stringify(next) === JSON.stringify(old) ? old : next;
}

// ---------------------------------------------------------------- layout

/** Same seed, same numbers: shapes are stable across sessions and machines. */
export function seeded(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * A constellation's shape: star i depends only on the project's id and the stars before it,
 * so adding a step adds a star without moving the others. Mostly a winding path, with the odd branch.
 */
export function shapeOf(id: string, n: number): { pts: { x: number; y: number }[]; links: [number, number][] } {
  const rnd = seeded(id);
  const pts = [{ x: 0, y: 0 }];
  const links: [number, number][] = [];
  let ang = rnd() * Math.PI * 2;
  for (let i = 1; i < n; i++) {
    const branch = i > 2 && rnd() < 0.25;
    const from = branch ? Math.floor(rnd() * (i - 1)) : i - 1;
    // Real constellations zig-zag: turn 35-110 degrees each step, left or right.
    const turn = (0.6 + rnd() * 1.3) * (rnd() < 0.5 ? -1 : 1);
    const len = 0.85 + rnd() * 0.4;
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    let best: { x: number; y: number } | null = null, bestScore = Infinity, a = ang + turn;
    // Try a few directions; keep stars apart and the shape compact (close to its middle).
    for (let k = 0; k < 8; k++, a += 0.8) {
      const p = { x: pts[from].x + Math.cos(a) * len, y: pts[from].y + Math.sin(a) * len * 0.85 };
      const crowd = pts.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 0.62) ? 100 : 0;
      const score = crowd + Math.hypot(p.x - cx, (p.y - cy) * 1.5) * 0.6 + k * 0.05;
      if (score < bestScore) { bestScore = score; best = p; if (!crowd && k === 0) break; }
    }
    ang = Math.atan2(best!.y - pts[from].y, best!.x - pts[from].x);
    pts.push(best!);
    links.push([from, i]);
  }
  return { pts, links };
}

export interface StarView { id: string; x: number; y: number; r: number; lit: boolean; next: boolean; today: boolean; fresh: boolean; title: string; done?: string; min: number }
export interface ConstellationView {
  id: string; name: string; color: string; areaName: string;
  x: number; y: number; w: number; h: number;          // bounds, for the label and clicking
  stars: StarView[]; links: { a: number; b: number; lit: boolean }[];
  lit: number; total: number; daysLeft: number | null; late: boolean; finished?: string; target: string | null;
  nextStep: StarView | null;
}
export interface DustView { x: number; y: number; r: number; o: number; fresh: boolean }
export interface SkyLayout { width: number; height: number; horizon: number; constellations: ConstellationView[]; milky: ConstellationView[]; dust: DustView[]; regions: { name: string; color: string; x: number; w: number }[] }

export interface LayoutOpts {
  width: number;                  // viewBox units (height is fixed)
  areas: Area[];
  colorOf: (c?: string) => string;
  now?: Date;
  nextIds: Map<string, string>;   // milestone id -> its next open step (Todoist order)
  todayIds: Set<string>;          // steps due today
  seenAt: number;                 // stars lit after this get the "just lit" animation
}

export const SKY_H = 420;
const HORIZON = 372;
const TOP = 96;                   // below the Milky Way
const LABEL_H = 66;               // room under a constellation for its name, count and bar

/** Where everything goes. Areas are regions of the sky, left to right; deadlines set the height. */
export function layoutSky(sky: SkyRecord, o: LayoutOpts): SkyLayout {
  const now = o.now || new Date();
  const W = Math.max(600, o.width);
  const live = Object.entries(sky.cons).filter(([, c]) => !c.finished && c.steps.length);
  const done = Object.entries(sky.cons).filter(([, c]) => c.finished).sort((a, b) => (a[1].finished || "").localeCompare(b[1].finished || ""));

  // Regions: the areas that have a project in the sky, in your area order; then everything else.
  const used = o.areas.filter((a) => live.some(([, c]) => c.area === a.id));
  const hasOther = live.some(([, c]) => !c.area || !o.areas.some((a) => a.id === c.area));
  const regionList = [...used.map((a) => ({ id: a.id as string | undefined, name: a.name, color: o.colorOf(a.color) })), ...(hasOther ? [{ id: undefined, name: "Other", color: "#c9cfdc" }] : [])];
  const regionW = (W - 80) / Math.max(1, regionList.length);
  const regions = regionList.map((r, i) => ({ name: r.name, color: r.color, x: 40 + i * regionW, w: regionW }));

  const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
  const daysTo = (t?: string | null) => (t ? Math.round((new Date(t.length <= 10 ? `${t}T00:00:00` : t).getTime() - day0.getTime()) / 864e5) : null);
  const heightFor = (d: number | null) => (d === null ? TOP + 40 : d < 0 ? HORIZON - 34 : HORIZON - 50 - (Math.min(d, 60) / 60) * (HORIZON - 50 - TOP));

  const build = (id: string, c: SkyConstellation, scale: number, color: string): ConstellationView => {
    const { pts, links } = shapeOf(id, c.steps.length);
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const minX = Math.min(...xs), minY = Math.min(...ys);
    const nextId = o.nextIds.get(id);
    const stars = c.steps.map((s, i): StarView => {
      const lit = !!s.done;
      return {
        id: s.id, title: s.title, done: s.done, min: s.min, lit,
        x: (pts[i].x - minX) * scale, y: (pts[i].y - minY) * scale,
        r: lit ? 3.2 + Math.min(4.2, Math.sqrt(s.min / 9)) : 2.4,
        next: !lit && s.id === nextId, today: !lit && o.todayIds.has(s.id),
        fresh: lit && !!s.done && Date.parse(s.done) > o.seenAt,
      };
    });
    const w = (Math.max(...xs) - minX) * scale, h = (Math.max(...ys) - minY) * scale;
    const d = daysTo(c.target);
    return {
      id, name: c.name, color, areaName: o.areas.find((a) => a.id === c.area)?.name || "",
      x: 0, y: 0, w, h, stars, links: links.map(([a, b]) => ({ a, b, lit: stars[a].lit && stars[b].lit })),
      lit: stars.filter((s) => s.lit).length, total: stars.length, daysLeft: d, late: d !== null && d < 0,
      finished: c.finished, target: c.target ?? null, nextStep: stars.find((s) => s.next) || stars.find((s) => !s.lit) || null,
    };
  };

  const constellations: ConstellationView[] = [];
  regionList.forEach((r, ri) => {
    const mine = live.filter(([, c]) => (r.id ? c.area === r.id : !c.area || !o.areas.some((a) => a.id === c.area)));
    const scale = Math.min(96, regionW / 4.6, (HORIZON - TOP) / 3.2);
    const views = mine.map(([id, c]) => ({ v: build(id, c, scale, r.color), want: heightFor(daysTo(c.target)) })).sort((a, b) => a.want - b.want);
    // Stack them top to bottom by deadline, alternating sides so neighbours don't collide.
    let floor = TOP;
    views.forEach(({ v, want }, i) => {
      const y = Math.max(want - v.h / 2, floor);
      const side = views.length > 1 ? (i % 2 ? 0.58 : 0.08) : 0.5 - v.w / 2 / regionW;
      v.x = regions[ri].x + Math.max(14, Math.min(regionW - v.w - 14, side * regionW));
      v.y = Math.max(TOP, Math.min(y, HORIZON - v.h - LABEL_H));
      floor = v.y + (views.length > 3 ? v.h * 0.55 : v.h + LABEL_H + 10);
      constellations.push(v);
    });
  });

  // The Milky Way: finished projects, small, along a gentle band across the top.
  const milky = done.map(([id, c], i) => {
    const v = build(id, c, 13, "#f3e3bf");
    const t = (i + 0.5) / Math.max(done.length, 6);
    v.x = 40 + t * (W - 120);
    v.y = 18 + Math.sin(t * Math.PI) * 26 - v.h / 2 + 12;
    return v;
  });

  // Stardust: one speck per finished loose task, scattered (seeded by day), newer ones brighter.
  const dust: DustView[] = [];
  const days = Object.entries(sky.dust).sort((a, b) => b[0].localeCompare(a[0]));
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  for (const [k, n] of days) {
    const age = Math.max(0, Math.round((day0.getTime() - new Date(`${k}T00:00:00`).getTime()) / 864e5));
    const rnd = seeded(`dust:${k}`);
    for (let i = 0; i < Math.min(n, 24) && dust.length < 900; i++) {
      dust.push({ x: 10 + rnd() * (W - 20), y: 10 + rnd() * (HORIZON - 30), r: 0.6 + rnd() * 0.7, o: Math.max(0.18, 0.75 - age / 160), fresh: k === todayKey });
    }
  }
  return { width: W, height: SKY_H, horizon: HORIZON, constellations, milky, dust, regions };
}
