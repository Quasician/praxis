// The living sky (5.1): the wallpaper's scene since the city. Everything here is plain maths, no drawing, so it can be tested:
// the sky's colours through the day, the sun and moon on their arc and the trails they leave, the real stars over Milpitas,
// the weather's settings, where your projects' constellations sit, your year of finished things along the horizon, and how
// big the motto can be.
//
// Positions are in design units: a 1680 x 709 frame (the 5K2K screen's shape), scaled to the real screen when drawn.
import { sunTimes, DEFAULT_LAT, DEFAULT_LNG } from "../domain/sun";
import { shapeOf } from "../domain/sky";
import type { SkyIcon, Weather } from "./weather";

export const D_W = 1680, D_H = 709;

// ---------------------------------------------------------------- small helpers
export const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const hexRgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
export function mix(a: string, b: string, t: number) {
  const A = hexRgb(a), B = hexRgb(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * clamp(t)).toString(16).padStart(2, "0")).join("");
}
export function rng(seed: number) {
  let s = seed | 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const strSeed = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h; };
const hoursOf = (d: Date) => d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;

// ---------------------------------------------------------------- the day track (the arc the sun and moon travel)
export const ARC = { cx: 840, hy: 640, rx: 800, ry: 540 };
/** A point on the arc: t = 0 at the left end (where the sun rises), 1 at the right (where it sets). */
export const onArc = (t: number) => ({ x: ARC.cx - ARC.rx * Math.cos(Math.PI * t), y: ARC.hy - ARC.ry * Math.sin(Math.PI * t) });

// ---------------------------------------------------------------- the moon's real phase
/** 0 = new, .25 = first quarter, .5 = full, .75 = last quarter. */
export function moonPhase(d: Date) {
  const SYN = 29.530588853, ref = Date.UTC(2000, 0, 6, 18, 14);
  return (((d.getTime() - ref) / 864e5 / SYN) % 1 + 1) % 1;
}

// ---------------------------------------------------------------- the light
export interface Light {
  h: number; rise: number; set: number; nightLen: number;
  /** Where the sun is along its arc today (0..1 while it's up), and the moon along its arc tonight. */
  dayT: number; nT: number;
  sunUp: boolean; moonUp: boolean;
  /** 0 by day, 1 in full night. */
  night: number;
  /** How high the sun is (0 at the horizon, 1 at midday). */
  alt: number;
  top: string; mid: string; hor: string;
  /** 0 = new moon, .5 = full. lit: how much of it is lit (0..1). */
  moonAge: number; moonLit: number;
}

/** The sky's colours, keyed to the real sunrise and sunset (hours after them), as in the approved mock-up. */
function paletteKeys(rise: number, set: number): [number, string, string, string][] {
  const noon = (rise + set) / 2;
  return [
    [0, "#050918", "#0a1230", "#16213f"],
    [rise - 1.35, "#0a1130", "#26285a", "#5a4670"],
    [rise - 0.15, "#26386e", "#9a6d8c", "#f0aa7c"],
    [rise + 1.45, "#3a69b4", "#7ba5d8", "#d7e4ee"],
    [noon, "#2c63bf", "#6c9edc", "#c4dbf0"],
    [set - 1.6, "#3563ac", "#89a6cf", "#ecd5b0"],
    [set - 0.2, "#283468", "#a35e76", "#f6965a"],
    [set + 0.7, "#141a40", "#3c3364", "#7b4a62"],
    [set + 2.2, "#070c24", "#0f1736", "#1c2546"],
    [24, "#050918", "#0a1230", "#16213f"],
  ];
}

export function lightAt(when: Date, lat = DEFAULT_LAT, lng = DEFAULT_LNG): Light {
  const st = sunTimes(when, lat, lng);
  const rise = st.rise / 60, set = st.set / 60, h = hoursOf(when);
  const K = paletteKeys(rise, set);
  let i = 0;
  while (i < K.length - 2 && h >= K[i + 1][0]) i++;
  const a = K[i], b = K[i + 1], f = clamp((h - a[0]) / (b[0] - a[0]));
  let night = 0;
  if (h < rise + 0.6) night = clamp((rise + 0.6 - h) / 1.6);
  else if (h > set - 0.6) night = clamp((h - (set - 0.6)) / 1.8);
  const dayT = (h - rise) / (set - rise);
  const nightLen = 24 - (set - rise);
  const nT = ((((h - set) % 24) + 24) % 24) / nightLen;
  const moonAge = moonPhase(when);
  return {
    h, rise, set, nightLen, dayT, nT, night,
    sunUp: dayT > -0.06 && dayT < 1.06, moonUp: nT > 0.04 && nT < 0.96,
    alt: clamp(Math.sin(Math.PI * clamp(dayT))),
    top: mix(a[1], b[1], f), mid: mix(a[2], b[2], f), hor: mix(a[3], b[3], f),
    moonAge, moonLit: (1 - Math.cos(2 * Math.PI * moonAge)) / 2,
  };
}

// ---------------------------------------------------------------- trails
/** How long a piece of trail takes to fade away. Under the shortest gap between the sun leaving a spot and the moon reaching it
 *  (and the other way round), so the two trails never meet. */
export const TRAIL_FADE = 8;
export interface TrailSeg { x0: number; y0: number; x1: number; y1: number; t0: number; t1: number; o: number; kind: "sun" | "moon" }
/** The trail behind the sun or moon: pieces of the arc, each fading with the hours since it was passed, cut exactly at the body. */
export function trailOf(kind: "sun" | "moon", L: Light, factor: number, pieces = 120): TrailSeg[] {
  const start = kind === "sun" ? L.rise : L.set, len = kind === "sun" ? L.set - L.rise : L.nightLen;
  const tNow = kind === "sun" ? (L.sunUp ? L.dayT : -1) : (L.nT >= 0 && L.nT <= 1 ? L.nT : -1);
  const out: TrailSeg[] = [];
  if (factor <= 0.01) return out;
  for (let k = 0; k < pieces; k++) {
    const t0 = k / pieces;
    let t1 = (k + 1) / pieces;
    if (tNow >= t0 && tNow < t1) t1 = tNow;
    if (t1 <= t0) continue;
    const age = (((L.h - (start + ((t0 + t1) / 2) * len)) % 24) + 24) % 24;
    if (age >= TRAIL_FADE) continue;
    const o = Math.pow(1 - age / TRAIL_FADE, 1.6) * factor;
    if (o < 0.02) continue;
    const A = onArc(t0), B = onArc(t1);
    out.push({ x0: A.x, y0: A.y, x1: B.x, y1: B.y, t0, t1, o, kind });
  }
  return out;
}

/** The stretches of the arc (as t ranges) not covered by a visible trail, where the faint dotted guide line is drawn. */
export function openArc(segs: TrailSeg[], minO = 0.15): [number, number][] {
  const covered = segs.filter((s) => s.o >= minO).map((s) => [s.t0, s.t1] as [number, number]).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let from = 0;
  for (const [a, b] of covered) { if (a > from + 1e-6) out.push([from, a]); from = Math.max(from, b); }
  if (from < 1 - 1e-6) out.push([from, 1]);
  return out;
}

// ---------------------------------------------------------------- weather
export type SkyWeather = "clear" | "partly" | "overcast" | "fog" | "rain" | "snow";
export interface WeatherLook { kind: SkyWeather; cover: number; th: number; sharp: number; cloud: number; desat: number; fog: number; rain: number; snow: number }
/** The sky's weather from the forecast's symbol (or, without one, the older weather kind). */
export function skyWeather(icon?: SkyIcon | null, kind?: Weather | null): SkyWeather {
  switch (icon) {
    case "sun": return "clear";
    case "partly": return "partly";
    case "cloud": return "overcast";
    case "fog": return "fog";
    case "rain": case "storm": return "rain";
    case "snow": return "snow";
  }
  switch (kind) {
    case "cloudy": return "overcast";
    case "mist": return "fog";
    case "rain": return "rain";
    case "snow": return "snow";
    default: return "clear";
  }
}
export function weatherLook(kind: SkyWeather): WeatherLook {
  const base = { kind, rain: 0, snow: 0 };
  switch (kind) {
    case "clear": return { ...base, cover: 0, th: 0.66, sharp: 5, cloud: 0.55, desat: 0, fog: 0 };
    case "partly": return { ...base, cover: 0.35, th: 0.53, sharp: 4.6, cloud: 1, desat: 0.08, fog: 0 };
    case "overcast": return { ...base, cover: 0.85, th: 0.37, sharp: 3.4, cloud: 1, desat: 0.55, fog: 0 };
    case "fog": return { ...base, cover: 0.5, th: 0.48, sharp: 3, cloud: 0.5, desat: 0.35, fog: 0.9 };
    case "rain": return { ...base, cover: 0.95, th: 0.33, sharp: 3.2, cloud: 1, desat: 0.65, fog: 0.25, rain: 1 };
    case "snow": return { ...base, cover: 0.9, th: 0.36, sharp: 3.2, cloud: 1, desat: 0.6, fog: 0.15, snow: 1 };
  }
}
/** The sky's colours greyed for clouds. */
export function weatherColours(L: Light, wx: WeatherLook) {
  const grey = mix("#9aa3b2", "#10141e", L.night);
  return {
    top: mix(L.top, grey, wx.desat * 0.85),
    mid: mix(L.mid, mix(grey, "#ffffff", 0.12), wx.desat),
    hor: mix(L.hor, mix(grey, "#ffffff", 0.2), wx.desat),
  };
}
/** Cloud colours that follow the light: white at noon, peach and lilac low in the sky, dim moonlit shapes at night. */
export function cloudColours(L: Light, wx: WeatherLook, top: string) {
  const warm = L.sunUp ? Math.pow(1 - L.alt, 2.2) : 0;
  const litDay = mix("#ffffff", "#ffc7a0", warm), shDay = mix("#a9b7cc", "#7c6586", warm);
  return {
    lit: mix(mix(litDay, "#c9ced8", wx.desat * 0.6), mix(top, "#9aa4c8", 0.28), L.night),
    shadow: mix(mix(shDay, "#7d8595", wx.desat * 0.7), mix(top, "#000000", 0.15), L.night),
  };
}

// ---------------------------------------------------------------- the real sky
/** Bright stars of the constellations seen from the Bay Area through the year: [RA hours, Dec degrees, magnitude], and the lines between them. */
export const CATALOG: [string, [number, number, number][], [number, number][]][] = [
  ["ORION", [[5.919, 7.41, 0.5], [5.419, 6.35, 1.6], [5.585, 9.93, 3.4], [5.679, -1.94, 1.8], [5.604, -1.2, 1.7], [5.533, -0.3, 2.2], [5.796, -9.67, 2.1], [5.242, -8.2, 0.1]], [[0, 2], [2, 1], [0, 3], [1, 5], [3, 4], [4, 5], [3, 6], [5, 7]]],
  ["TAURUS", [[4.599, 16.51, 0.9], [5.438, 28.61, 1.7], [5.627, 21.14, 3.0], [4.477, 19.18, 3.5], [4.33, 15.63, 3.6], [4.382, 17.54, 3.8], [4.011, 12.49, 3.4]], [[6, 4], [4, 5], [5, 3], [3, 1], [4, 0], [0, 2]]],
  ["PLEIADES", [[3.791, 24.11, 2.9], [3.819, 24.05, 3.6], [3.747, 24.11, 3.7], [3.764, 24.37, 3.9], [3.772, 23.95, 4.2], [3.754, 24.47, 4.3]], []],
  ["PEGASUS", [[23.079, 15.21, 2.5], [23.063, 28.08, 2.4], [0.14, 29.09, 2.1], [0.22, 15.18, 2.8], [22.691, 10.83, 3.4], [21.736, 9.88, 2.4]], [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [4, 5]]],
  ["ANDROMEDA", [[0.14, 29.09, 2.1], [0.655, 30.86, 3.3], [1.162, 35.62, 2.1], [2.065, 42.33, 2.1]], [[0, 1], [1, 2], [2, 3]]],
  ["ARIES", [[2.12, 23.46, 2.0], [1.911, 20.81, 2.6], [1.892, 19.29, 3.9]], [[0, 1], [1, 2]]],
  ["CYGNUS", [[20.69, 45.28, 1.3], [20.37, 40.26, 2.2], [19.512, 27.96, 3.1], [20.77, 33.97, 2.5], [19.75, 45.13, 2.9]], [[0, 1], [1, 2], [4, 1], [1, 3]]],
  ["LYRA", [[18.616, 38.78, 0.0], [18.835, 33.36, 3.5], [18.982, 32.69, 3.3]], [[0, 1], [1, 2], [2, 0]]],
  ["AQUILA", [[19.846, 8.87, 0.8], [19.771, 10.61, 2.7], [19.922, 6.41, 3.7]], [[1, 0], [0, 2]]],
  ["GEMINI", [[7.577, 31.89, 1.6], [7.755, 28.03, 1.1], [6.732, 25.13, 3.0], [6.383, 22.51, 2.9], [6.629, 16.4, 1.9]], [[0, 1], [0, 2], [2, 3], [1, 4]]],
  ["CANIS MAJOR", [[6.752, -16.72, -1.46], [6.378, -17.96, 2.0], [7.14, -26.39, 1.8], [6.977, -28.97, 1.5]], [[1, 0], [0, 2], [2, 3]]],
  ["CANIS MINOR", [[7.655, 5.22, 0.4], [7.453, 8.29, 2.9]], [[0, 1]]],
  ["AURIGA", [[5.278, 46.0, 0.1], [5.992, 44.95, 1.9], [5.995, 37.21, 2.6], [5.438, 28.61, 1.7], [4.95, 33.17, 2.7], [5.033, 43.82, 3.0]], [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]]],
  ["LEO", [[10.14, 11.97, 1.4], [10.122, 16.76, 3.5], [10.333, 19.84, 2.0], [10.278, 23.42, 3.4], [9.879, 26.01, 3.9], [11.235, 20.52, 2.6], [11.818, 14.57, 2.1], [11.237, 15.43, 3.3]], [[0, 1], [1, 2], [2, 3], [3, 4], [2, 5], [5, 6], [6, 7], [7, 0], [5, 7]]],
  ["VIRGO", [[13.42, -11.16, 1.0], [12.694, -1.45, 2.7], [13.036, 10.96, 2.8], [12.332, -0.67, 3.9], [13.578, -0.6, 3.4]], [[0, 4], [4, 1], [1, 3], [1, 2]]],
  ["BOÖTES", [[14.261, 19.18, -0.05], [14.75, 27.07, 2.4], [15.032, 40.39, 3.5], [14.535, 38.31, 3.0], [13.911, 18.4, 2.7]], [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4]]],
  ["SCORPIUS", [[16.49, -26.43, 1.0], [16.006, -22.62, 2.3], [16.091, -19.81, 2.6], [16.836, -34.29, 2.3], [17.56, -37.1, 1.6], [17.708, -39.03, 2.4]], [[1, 0], [2, 1], [0, 3], [3, 4], [4, 5]]],
  ["SAGITTARIUS", [[18.403, -34.38, 1.8], [18.921, -26.3, 2.0], [18.35, -29.83, 2.7], [18.466, -25.42, 2.8], [19.043, -29.88, 2.6], [18.229, -21.06, 3.8]], [[0, 2], [2, 3], [3, 1], [1, 4], [4, 0], [3, 5]]],
  ["URSA MAJOR", [[11.062, 61.75, 1.8], [11.031, 56.38, 2.3], [11.897, 53.69, 2.4], [12.257, 57.03, 3.3], [12.9, 55.96, 1.8], [13.399, 54.93, 2.2], [13.792, 49.31, 1.9]], [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]]],
  ["CASSIOPEIA", [[0.675, 56.54, 2.2], [0.153, 59.15, 2.3], [0.945, 60.72, 2.5], [1.43, 60.24, 2.7], [1.907, 63.67, 3.4]], [[1, 0], [0, 2], [2, 3], [3, 4]]],
  ["", [[22.961, -29.62, 1.2], [0.727, -17.99, 2.0], [3.038, 4.09, 2.5], [7.45, 8.29, 2.9], [16.49, -26.43, 1.0]], []],
];

export interface RealStar { x: number; y: number; mag: number }
export interface RealSky { stars: RealStar[]; lines: [number, number, number, number][]; labels: { x: number; y: number; t: string }[] }
/** Stars where they really are: looking south, east on the left and west on the right, the horizon at the arc's ends. */
export function realSky(when: Date, lat = DEFAULT_LAT, lng = DEFAULT_LNG): RealSky {
  const D2R = Math.PI / 180, LAT = lat * D2R;
  const jd = when.getTime() / 864e5 + 2440587.5;
  const lst = (((280.46061837 + 360.98564736629 * (jd - 2451545) + lng) % 360) + 360) % 360;
  const project = (raH: number, decD: number) => {
    const H = (lst - raH * 15) * D2R, dec = decD * D2R;
    const altD = Math.asin(Math.sin(LAT) * Math.sin(dec) + Math.cos(LAT) * Math.cos(dec) * Math.cos(H)) / D2R;
    const A = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(LAT) - Math.tan(dec) * Math.cos(LAT)) / D2R;
    return { x: 840 + A * 7, y: 640 - altD * 7.4, vis: altD > 1.5 && Math.abs(A) < 122 };
  };
  const out: RealSky = { stars: [], lines: [], labels: [] };
  const seen = new Set<string>();
  for (const [name, stars, edges] of CATALOG) {
    const P = stars.map(([ra, dec, mag]) => ({ ...project(ra, dec), mag, key: `${ra}/${dec}` }));
    for (const p of P) if (p.vis && !seen.has(p.key)) { seen.add(p.key); out.stars.push({ x: p.x, y: p.y, mag: p.mag }); }
    for (const [a, b] of edges) if (P[a].vis && P[b].vis) out.lines.push([P[a].x, P[a].y, P[b].x, P[b].y]);
    const V = P.filter((p) => p.vis);
    if (name && V.length >= Math.ceil(P.length / 2)) {
      const cx = V.reduce((t, p) => t + p.x, 0) / V.length, my = Math.max(...V.map((p) => p.y));
      if (my < 600) out.labels.push({ x: cx, y: my + 14, t: name });
    }
  }
  return out;
}

// ---------------------------------------------------------------- your projects, as gold constellations
export interface ProjectIn { id: string; name?: string; seed?: string; steps: { lit: boolean }[]; dim?: number }
export interface ProjectOut { stars: { x: number; y: number; lit: boolean }[]; lines: [number, number, number, number][]; label: { x: number; y: number; name: string; t: string }; dim: number }
/** Open patches of sky for project constellations: clear of the motto's zone, the arc, the weather box and each other. */
export const SLOTS: { cx: number; cy: number; w: number; h: number }[] = [
  { cx: 592, cy: 228, w: 250, h: 78 },
  { cx: 1104, cy: 234, w: 240, h: 78 },
  { cx: 1546, cy: 92, w: 170, h: 100 },
  { cx: 846, cy: 222, w: 130, h: 70 },
  { cx: 160, cy: 196, w: 190, h: 74 },
  { cx: 394, cy: 94, w: 110, h: 96 },
  { cx: 1290, cy: 72, w: 150, h: 76 },
];
/** A project's name for its label: plain text, at most 18 characters (labels must not reach the next constellation). */
export function shortName(name?: string) {
  const t = String(name || "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
  return t.length > 18 ? t.slice(0, 17).replace(/[\s,.;:–-]+$/, "") + "…" : t;
}
export function placeProjects(ps: ProjectIn[]): ProjectOut[] {
  return ps.slice(0, SLOTS.length).map((p, i) => {
    const slot = SLOTS[i], n = Math.max(2, Math.min(9, p.steps.length));
    const shape = shapeOf(p.seed || p.id, n);
    const xs = shape.pts.map((q) => q.x), ys = shape.pts.map((q) => q.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const s = Math.min(slot.w / Math.max(0.5, x1 - x0), (slot.h - 18) / Math.max(0.5, y1 - y0));
    const ox = slot.cx - ((x0 + x1) / 2) * s, oy = slot.cy - 9 - ((y0 + y1) / 2) * s;
    // Steps beyond nine share the last star (the shape stays readable); a star is lit when its step is done, in order.
    const litCount = p.steps.filter((x) => x.lit).length;
    const stars = shape.pts.map((q, k) => ({ x: ox + q.x * s, y: oy + q.y * s, lit: k < Math.round((litCount / p.steps.length) * n) }));
    const lines = shape.links.map(([a, b]) => [stars[a].x, stars[a].y, stars[b].x, stars[b].y] as [number, number, number, number]);
    const bottom = Math.max(...stars.map((q) => q.y));
    return { stars, lines, label: { x: slot.cx, y: Math.min(slot.cy + slot.h / 2 + 4, bottom + 14), name: shortName(p.name), t: `${litCount} / ${p.steps.length}` }, dim: p.dim || 0 };
  });
}

// ---------------------------------------------------------------- your year, as stars along the horizon
export interface History { days: Record<string, number>; milestones?: string[] }
export interface HistoryStar { x: number; y: number; r: number; o: number; mile: boolean; fresh: boolean }
export const HIST_X0 = 60, HIST_X1 = 1620;
const bandY = (u: number) => 578 + 10 * Math.sin(u * Math.PI * 3);
const ymdLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** One star per thing finished in the last 365 days, oldest on the left and today on the right; milestones are larger and gold. */
export function historyStars(h: History | null | undefined, when: Date): { stars: HistoryStar[]; path: [number, number][]; months: { x: number; t: string }[]; total: number } {
  const stars: HistoryStar[] = [];
  const today = new Date(when.getFullYear(), when.getMonth(), when.getDate());
  const miles = new Map<string, number>();
  for (const m of h?.milestones || []) { const k = m.slice(0, 10); miles.set(k, (miles.get(k) || 0) + 1); }
  let total = 0;
  for (let d = 0; d < 365; d++) {
    const ago = 364 - d, day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ago), key = ymdLocal(day);
    const n = Math.min(40, h?.days?.[key] || 0), m = Math.min(6, miles.get(key) || 0);
    total += n + m;
    const r = rng(strSeed(key));
    for (let j = 0; j < n + m; j++) {
      const mile = j >= n, u = (d + r()) / 365, g = (r() + r() + r() - 1.5) * 1.6;
      stars.push({ x: HIST_X0 + u * (HIST_X1 - HIST_X0), y: bandY(u) + g * 13, r: mile ? 1.8 : ago < 7 ? 1.15 : 0.75,
        o: mile ? 0.95 : 0.28 + 0.7 * Math.exp(-ago / 30), mile, fresh: ago < 2 });
    }
  }
  const path: [number, number][] = [];
  for (let k = 0; k <= 60; k++) { const u = k / 60; path.push([HIST_X0 + u * (HIST_X1 - HIST_X0), bandY(u)]); }
  const MN = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const months: { x: number; t: string }[] = [];
  for (let k = 2; k <= 12; k++) {
    const first = new Date(today.getFullYear(), today.getMonth() - 12 + k, 1);
    const d = 364 - Math.round((today.getTime() - first.getTime()) / 864e5);
    if (d >= 0) months.push({ x: HIST_X0 + (d / 365) * (HIST_X1 - HIST_X0), t: MN[first.getMonth()] });
  }
  return { stars, path, months, total };
}

// ---------------------------------------------------------------- the motto
/** The motto's zone: between the project constellations above and your year along the horizon below. */
export const MOTTO_ZONE = { x0: 340, x1: 1340, y0: 312, y1: 540, center: 400 };
/** Where the motto's lettering goes (design units): as large as its picture was made, shrunk to fit the zone, centred in it. */
export function mottoFit(boxW: number, boxH: number, nativeScale: number) {
  const zw = MOTTO_ZONE.x1 - MOTTO_ZONE.x0, zh = MOTTO_ZONE.y1 - MOTTO_ZONE.y0;
  const s = Math.min(nativeScale, zw / boxW, zh / boxH);
  const w = boxW * s, h = boxH * s;
  const y = clamp(MOTTO_ZONE.center - h / 2, MOTTO_ZONE.y0, MOTTO_ZONE.y1 - h);
  return { s, x: (MOTTO_ZONE.x0 + MOTTO_ZONE.x1) / 2 - w / 2, y, w, h };
}

// ---------------------------------------------------------------- field stars (the faint ones between the named stars)
export function fieldStars(n = 110) {
  const r = rng(1101), out: { x: number; y: number; r: number; o: number }[] = [];
  for (let i = 0; i < n; i++) out.push({ x: r() * D_W, y: Math.pow(r(), 1.4) * 590, r: 0.35 + Math.pow(r(), 3) * 0.7, o: 0.2 + r() * 0.5 });
  return out;
}
