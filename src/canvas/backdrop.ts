// 5.0 The canvas's backdrop: the sky by time of day, and one landscape drawn in that time's colours.
// Pure: shapes and colours only. components/Canvas.tsx draws them.
import { seeded } from "../domain/sky";

export type Phase = "night" | "dawn" | "day" | "gold" | "dusk";
/** Daytime phases: a lit sky, light panels, constellations drawn in dark ink. */
export const isLit = (p: Phase) => p === "day" || p === "gold";

export interface Palette {
  sky: [string, number][];           // gradient stops, top to horizon (colour, % down the sky)
  far: string; mid: string; near: string; front: string; snow: string; water: string;
  stars: number;                     // how bright the stars are (0 by day)
  clouds: [string, string, string] | null; // cumulus top, middle, shadow (null: none)
  sun: string; glow: string;
}
export const PALETTES: Record<Phase, Palette> = {
  night: { sky: [["#0f1424", 0], ["#1b2440", 62], ["#2a3558", 100]], far: "#2a3760", mid: "#1e2a4c", near: "#151e3a", front: "#0e1528", snow: "#5d6b98", water: "#34446f",
    stars: 1, clouds: null, sun: "#eef1fb", glow: "#c9d4ff" },
  dawn: { sky: [["#22305a", 0], ["#6b5f8f", 42], ["#d79a8c", 74], ["#f4c79a", 100]], far: "#7d7aa6", mid: "#544f80", near: "#3a375f", front: "#272845", snow: "#e9d2d6", water: "#c9a0a8",
    stars: .35, clouds: null, sun: "#fff1d6", glow: "#ffc89a" },
  day: { sky: [["#2f73c9", 0], ["#5b9ee6", 30], ["#9ccaf2", 66], ["#dfeefb", 100]], far: "#a9c3de", mid: "#6f97b4", near: "#4f7f7c", front: "#3f6b5c", snow: "#f4f8fd", water: "#b9d9f0",
    stars: 0, clouds: ["#ffffff", "#f3f7fc", "#c9d8ec"], sun: "#fffef6", glow: "#ffeaa8" },
  gold: { sky: [["#3f6fb0", 0], ["#8fb2d8", 36], ["#f2cf96", 74], ["#f6a865", 100]], far: "#c9a98f", mid: "#8f7d7c", near: "#5e5a63", front: "#3f3f4c", snow: "#fff0dc", water: "#f2c08a",
    stars: 0, clouds: ["#fff6e8", "#fbe2c4", "#d9a98a"], sun: "#fff4d6", glow: "#ffc47a" },
  dusk: { sky: [["#1c2348", 0], ["#3f3a6e", 42], ["#8b5e86", 72], ["#d98a6a", 100]], far: "#4d4573", mid: "#352f58", near: "#251f42", front: "#18152e", snow: "#a08bb0", water: "#7a5a80",
    stars: .55, clouds: null, sun: "#ffd9b0", glow: "#ff9f7a" },
};

// ---------- the land: drawn in a 2100 x 300 box (y down, 0 = the top of the highest peak's room) ----------
export const LAND_W = 2100, LAND_H = 300;
const FAR: [number, number][] = [[0, 112], [90, 90], [170, 100], [260, 64], [330, 84], [430, 50], [500, 68], [560, 36], [640, 72], [730, 90], [820, 68], [900, 84],
  [1000, 48], [1070, 60], [1130, 16], [1200, 54], [1270, 40], [1350, 76], [1450, 92], [1540, 64], [1620, 78], [1700, 44], [1780, 70], [1870, 88], [1960, 60], [2040, 76], [2100, 64]];
const SNOW: [number, number][][] = [[[1130, 16], [1108, 34], [1122, 30], [1132, 40], [1146, 30], [1160, 36]], [[560, 36], [542, 50], [556, 47], [566, 55], [580, 48]],
  [[1700, 44], [1684, 56], [1698, 53], [1708, 60], [1720, 54]], [[430, 50], [416, 61], [428, 59], [438, 65], [448, 60]]];
const midY = (x: number) => 142 - 16 * Math.sin(x / 210 + .6) - 9 * Math.sin(x / 83 + 2);
const nearY = (x: number) => 176 - 12 * Math.sin(x / 260 + 2.2) - 6 * Math.sin(x / 61);
const poly = (pts: [number, number][]) => "M " + pts.map(([x, y]) => `${x} ${y}`).join(" L ");
const curve = (f: (x: number) => number) => { const p: string[] = []; for (let x = 0; x <= LAND_W; x += 30) p.push(`L ${x} ${f(x).toFixed(0)}`); return `M 0 ${f(0).toFixed(0)} ${p.join(" ")}`; };
const pine = (x: number, y: number, h: number) => `M ${(x - h * .28).toFixed(0)} ${y.toFixed(0)} L ${x.toFixed(0)} ${(y - h).toFixed(0)} L ${(x + h * .28).toFixed(0)} ${y.toFixed(0)} Z`;
function trees(f: (x: number) => number, step: number, keep: number, lo: number, hi: number, where: (x: number) => boolean, seed: string) {
  const r = seeded(seed), out: string[] = [];
  for (let x = step / 2; x < LAND_W; x += step) {
    const k = r(), h = lo + r() * (hi - lo);
    if (k < keep && where(x)) out.push(pine(x, f(x) + 3, h));
  }
  return out.join(" ");
}
const DOWN = ` L ${LAND_W} ${LAND_H} L 0 ${LAND_H} Z`;
/** The land's layers, back to front, each a path and which palette colour fills it. */
export const LAND: { d: string; fill: keyof Pick<Palette, "far" | "mid" | "near" | "front" | "snow" | "water"> }[] = [
  { d: poly(FAR) + DOWN, fill: "far" },
  ...SNOW.map((s) => ({ d: poly(s) + " Z", fill: "snow" as const })),
  { d: curve(midY) + DOWN, fill: "mid" },
  { d: trees(midY, 13, .7, 10, 22, (x) => Math.sin(x / 140) > -.35, "pines-mid"), fill: "mid" },
  { d: "M 1180 164 Q 1370 154 1560 166 L 1560 190 L 1180 190 Z", fill: "water" },
  { d: curve(nearY) + DOWN, fill: "near" },
  { d: trees(nearY, 19, .55, 18, 40, (x) => x < 520 || x > 1560 || (x > 860 && x < 1180), "pines-near"), fill: "near" },
  { d: "M0 212 Q 420 192 900 206 T 2100 196" + DOWN, fill: "front" },
];

// ---------- clouds (by day): low cumulus banks just above the land, in the sky's own box (2100 x 900) ----------
export interface Puff { x: number; y: number; r: number }
export interface Cloud { x: number; base: number; w: number; puffs: Puff[] }
const bank = (x: number, base: number, w: number, p: [number, number, number][]): Cloud => ({ x, base, w, puffs: p.map(([dx, dy, r]) => ({ x: x + dx, y: base - dy, r })) });
export const CLOUDS: Cloud[] = [
  bank(760, 830, 430, [[-150, 20, 50], [-80, 62, 70], [0, 96, 92], [20, 150, 60], [92, 70, 78], [160, 26, 52], [-30, 138, 54]]),
  bank(1290, 846, 300, [[-100, 14, 38], [-40, 46, 56], [36, 60, 62], [104, 20, 40]]),
  bank(1700, 838, 240, [[-76, 12, 32], [-18, 40, 48], [52, 30, 42], [96, 8, 26]]),
  bank(420, 852, 170, [[-50, 8, 24], [0, 26, 34], [48, 10, 24]]),
];

/** Background stars, the same every night. */
export const STARS = (() => { const r = seeded("canvas-stars"); return Array.from({ length: 160 }, () => ({ x: r() * 2100, y: r() * 820, r: .7 + r() * 1.2, o: .25 + r() * .55 })); })();

/** Where the sun is (2100 x 900 sky box): rises low on the left, crosses high, sets low on the right, inside the open
 *  middle of the screen (the panels cover the outer fifths at the Day zoom). Null when it's down. */
export function sunPos(minute: number, rise: number, set: number) {
  const p = (minute - rise) / (set - rise);
  if (p < -.06 || p > 1.06) return null;
  const el = Math.sin(Math.PI * Math.max(0, Math.min(1, p)));
  return { x: 420 + 1260 * Math.max(0, Math.min(1, p)), y: 800 - el * 660, low: 1 - el };
}
/** Where the moon is through the night (left to right). Null by day. */
export function moonPos(minute: number, rise: number, set: number) {
  const start = set + 40, len = 1440 - start + rise - 40;
  const p = (((minute - start) % 1440) + 1440) % 1440 / len;
  if (p > 1) return null;
  return { x: 240 + 1620 * p, y: 820 - Math.sin(Math.PI * p) * 640 };
}

/** The phase of the sky at a minute of the day, from today's sunrise and sunset (the same edges the rest of Praxis uses). */
export function phaseAt(minute: number, rise: number, set: number): Phase {
  if (minute >= rise - 60 && minute < rise + 75) return "dawn";
  if (minute >= rise + 75 && minute < set - 80) return "day";
  if (minute >= set - 80 && minute < set + 10) return "gold";
  if (minute >= set + 10 && minute < set + 75) return "dusk";
  return "night";
}
