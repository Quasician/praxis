// The valley's calendar and clock: everything about the wallpaper that depends on the date, the time and the weather,
// worked out on the CPU as plain numbers. The renderer (render.ts) only draws what this says.
import { sunTimes, DEFAULT_LAT } from "../domain/sun";

export type RGB = [number, number, number];
export type Weather = "clear" | "cloudy" | "mist" | "rain" | "snow";

const sm = (t: number) => { const c = Math.max(0, Math.min(1, t)); return c * c * (3 - 2 * c); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mixc = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const hex = (h: string): RGB => [0, 2, 4].map((i) => parseInt(h.replace("#", "").slice(i, i + 2), 16)) as RGB;

// ---------------------------------------------------------------- light: five moods, blended through the day
export interface Phase {
  stops: [number, string][]; dark: string; sun: string;
  glowA: [string, number, number, number]; glowB: [string, number, number, number];
  stars: number; light: number; cl: [string, string]; snow: [string, string];
}
export const PHASES: Record<"dawn" | "day" | "gold" | "dusk" | "night", Phase> = {
  dawn: { stops: [[0, "#0a1230"], [.4, "#1a2452"], [.68, "#3d3566"], [.86, "#6e4570"], [.95, "#96586f"], [1, "#b87a70"]], dark: "#0c0c18",
    sun: "#ffc49a", glowA: ["#f08a78", .5, .30, .2], glowB: ["#ffcf96", .7, .1, .085], stars: .3, light: .6, cl: ["#ffbfa6", "#55486e"], snow: ["#ffd6c2", "#5f6492"] },
  day: { stops: [[0, "#08204a"], [.45, "#12407a"], [.8, "#245c94"], [.95, "#3b79ab"], [1, "#5f93bd"]], dark: "#081425",
    sun: "#fff1d0", glowA: ["#a5cdea", .28, .9, .1], glowB: ["#ffffff", 0, .1, .1], stars: 0, light: 1.0, cl: ["#dfe7f2", "#5f79a6"], snow: ["#f3f6fb", "#6f8fc0"] },
  gold: { stops: [[0, "#0d1838"], [.4, "#27305c"], [.66, "#5a4266"], [.84, "#8c5058"], [.94, "#b86a40"], [1, "#c98238"]], dark: "#0d0b13",
    sun: "#ffb663", glowA: ["#ff8a4a", .52, .28, .2], glowB: ["#ffd480", .75, .1, .085], stars: .08, light: .95, cl: ["#ffb070", "#5c4666"], snow: ["#ffc79a", "#6a5f92"] },
  dusk: { stops: [[0, "#070c22"], [.45, "#161a48"], [.72, "#3a2a66"], [.88, "#6a3570"], [.96, "#8f4668"], [1, "#a85a5a"]], dark: "#090818",
    sun: "#e58aa4", glowA: ["#c8508a", .45, .32, .2], glowB: ["#ff9a5a", .55, .12, .06], stars: .5, light: .34, cl: ["#e0809c", "#322c58"], snow: ["#d79ab8", "#454a80"] },
  night: { stops: [[0, "#03050d"], [.55, "#080d22"], [.85, "#101a3c"], [1, "#1b2a55"]], dark: "#04060d",
    sun: "#c9d6f2", glowA: ["#3a4f8a", .28, .9, .14], glowB: ["#ffffff", 0, .1, .1], stars: 1, light: .3, cl: ["#8fa0c8", "#161c36"], snow: ["#a9b8dc", "#2a355c"] },
};
type PhaseName = keyof typeof PHASES;

function gradAt(stops: [number, string][], y: number): RGB {
  for (let i = 1; i < stops.length; i++) {
    const [a, ca] = stops[i - 1], [b, cb] = stops[i];
    if (y <= b) return mixc(hex(ca), hex(cb), sm((y - a) / (b - a)));
  }
  return hex(stops[stops.length - 1][1]);
}

/** Which moods are in the air at this minute, and how much of each (they always add up to 1). */
export function phaseWeights(minute: number, rise: number, set: number): [PhaseName, number][] {
  const keys: [number, PhaseName][] = [
    [rise - 80, "night"], [rise + 15, "dawn"], [rise + 110, "day"], [set - 120, "day"],
    [set - 40, "gold"], [set + 30, "dusk"], [set + 100, "night"],
  ];
  if (minute <= keys[0][0] || minute >= keys[keys.length - 1][0]) return [["night", 1]];
  for (let i = 1; i < keys.length; i++) {
    if (minute <= keys[i][0]) {
      const t = sm((minute - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]));
      return keys[i - 1][1] === keys[i][1] ? [[keys[i][1], 1]] : [[keys[i - 1][1], 1 - t], [keys[i][1], t]];
    }
  }
  return [["night", 1]];
}
export const mainPhase = (w: [PhaseName, number][]) => [...w].sort((a, b) => b[1] - a[1])[0][0];

// ---------------------------------------------------------------- the moon: its real phase
/** 0 = new, .25 = first quarter, .5 = full, .75 = last quarter. */
export function moonPhase(d: Date) {
  const SYN = 29.530588853, ref = Date.UTC(2000, 0, 6, 18, 14);
  return (((d.getTime() - ref) / 864e5 / SYN) % 1 + 1) % 1;
}

// ---------------------------------------------------------------- seasons: a continuous year
const doyOf = (d: Date) => (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5;
const md = (m: number, day: number) => doyOf(new Date(2026, m - 1, day));
/** A value that follows keyframes [day-of-year, value] round the year (wrapping December to January). */
function yearCurve(doy: number, keys: [number, number][]) {
  const k = [...keys].sort((a, b) => a[0] - b[0]);
  const ext = [[k[k.length - 1][0] - 365, k[k.length - 1][1]], ...k, [k[0][0] + 365, k[0][1]]];
  for (let i = 1; i < ext.length; i++) if (doy <= ext[i][0]) return lerp(ext[i - 1][1], ext[i][1], sm((doy - ext[i - 1][0]) / (ext[i][0] - ext[i - 1][0])));
  return k[0][1];
}

export interface Season {
  doy: number;
  snowAlt: number;          // snow lies above this "altitude" on the land
  groundSnow: number;       // 0..1: snow on the meadow, frozen lake, snow on the boughs
  ground: RGB; conifer: RGB; grass: RGB;
  forestLeaves: RGB[];      // the colours a hillside forest shows from afar
  flowers: number;          // 0..1 drifts of wildflowers
  flowerColors: RGB[];
  fallen: number;           // 0..1 fallen leaves on the meadow
  shrubColors: RGB[];
  autumnish: number;        // how much the forest patches lean to autumn colours (0..1)
}
const SP_GROUND: RGB = [70, 118, 66], SU_GROUND: RGB = [56, 102, 56], AU_GROUND: RGB = [118, 96, 54];
export function seasonOf(d: Date): Season {
  const doy = doyOf(d);
  const spring = yearCurve(doy, [[md(2, 25), 0], [md(4, 10), 1], [md(5, 20), 1], [md(6, 20), 0], [md(12, 31), 0]]);
  const summer = yearCurve(doy, [[md(5, 10), 0], [md(6, 20), 1], [md(9, 5), 1], [md(10, 1), 0], [md(1, 1), 0]]);
  const autumn = yearCurve(doy, [[md(9, 1), 0], [md(10, 5), 1], [md(11, 25), 1], [md(12, 20), 0], [md(1, 1), 0]]);
  const groundSnow = yearCurve(doy, [[md(12, 4), 0], [md(12, 20), 1], [md(2, 20), 1], [md(3, 8), 0], [md(6, 1), 0]]);
  const sumW = spring + summer + autumn + 1e-6;
  const blend = (a: RGB, b: RGB, c: RGB) => [0, 1, 2].map((i) => (a[i] * spring + b[i] * summer + c[i] * autumn) / sumW) as RGB;
  const ground = blend(SP_GROUND, SU_GROUND, AU_GROUND);   // the meadow when it isn't under snow
  const conifer = mixc(blend([38, 86, 66], [28, 74, 56], [30, 68, 54]), [24, 56, 50], groundSnow);
  const grass = mixc(blend([96, 150, 72], [78, 128, 62], [176, 142, 70]), [150, 142, 128], groundSnow);
  const autumnish = autumn / sumW * (1 - groundSnow);
  const forestLeaves: RGB[] = autumnish > .5
    ? [[232, 178, 52], [206, 78, 40], [226, 122, 40], [150, 84, 42]]
    : spring > summer ? [[126, 178, 96], [150, 196, 110], [104, 160, 90], [238, 170, 190]] : [[58, 128, 74], [46, 110, 66], [80, 140, 70], [66, 122, 60]];
  return {
    doy, groundSnow, ground, conifer, grass, forestLeaves, autumnish,
    snowAlt: yearCurve(doy, [[md(1, 15), -400], [md(2, 25), -400], [md(3, 25), 250], [md(4, 25), 400], [md(6, 10), 560], [md(7, 20), 650],
      [md(9, 1), 640], [md(10, 5), 520], [md(11, 1), 380], [md(11, 25), 250], [md(12, 12), 0], [md(12, 22), -400]]),
    flowers: Math.max(spring * yearCurve(doy, [[md(3, 20), 0], [md(4, 10), 1], [md(5, 25), 1], [md(6, 15), .6], [md(12, 1), 0]]), summer * .6) * (1 - groundSnow),
    flowerColors: spring > summer ? [[250, 244, 230], [248, 214, 90], [232, 150, 190], [170, 140, 230]] : [[250, 244, 230], [248, 214, 90], [150, 120, 220]],
    fallen: yearCurve(doy, [[md(9, 25), 0], [md(10, 25), .6], [md(11, 15), 1], [md(12, 10), .7], [md(12, 25), 0], [md(6, 1), 0]]) * (1 - groundSnow),
    shrubColors: groundSnow > .5 ? [[70, 60, 62]] : autumnish > .5 ? [[196, 84, 44], [222, 132, 46], [168, 110, 48], [132, 60, 50]]
      : spring > summer ? [[104, 160, 84], [128, 176, 96], [232, 168, 190]] : [[62, 122, 70], [84, 136, 72], [50, 104, 64]],
  };
}

// A deciduous tree's state on a date: its own turn date (a few days either side of its kind's), so colour moves through the forest.
export type LeafState = { look: "leaves" | "thin" | "bare"; color: RGB };
const KIND_SHIFT: Record<string, number> = { aspen: -7, birch: -4, poplar: -2, maple: 0, oak: 12, larch: 0 };
const AUTUMN: Record<string, RGB[]> = {
  oak: [[150, 84, 42], [164, 98, 46]], aspen: [[236, 184, 54]], maple: [[206, 78, 40], [226, 122, 40], [188, 52, 44]],
  poplar: [[240, 200, 70]], birch: [[232, 178, 52]], larch: [[226, 168, 54]],
};
const SPRING_LEAVES: RGB[] = [[126, 178, 96], [150, 196, 110], [104, 160, 90]];
const SUMMER_LEAVES: RGB[] = [[58, 128, 74], [46, 110, 66], [80, 140, 70]];
export function leafState(kind: string, r: number, doy: number): LeafState {
  const shift = (KIND_SHIFT[kind] ?? 0) + (r - .5) * 22;
  const d = doy - shift;
  const pick = (list: RGB[], salt: number) => list[Math.floor(((r * 7919 + salt) % 1) * list.length)];
  const spring = kind === "maple" ? [238, 170, 190] as RGB : kind === "aspen" && r < .3 ? [246, 216, 226] as RGB : pick(SPRING_LEAVES, .37);
  const summer = pick(SUMMER_LEAVES, .61);
  const fall = pick(AUTUMN[kind] || AUTUMN.maple, .83);
  if (kind === "larch") {
    if (d < md(4, 5) || d > md(11, 18)) return { look: "bare", color: fall };
    if (d < md(5, 25)) return { look: d < md(4, 20) ? "thin" : "leaves", color: [150, 196, 104] };
    if (d < md(10, 5)) return { look: "leaves", color: mixc([150, 196, 104], [74, 134, 74], sm((d - md(5, 25)) / 30)) };
    return { look: d > md(11, 6) ? "thin" : "leaves", color: mixc([74, 134, 74], fall, sm((d - md(10, 5)) / 14)) };
  }
  if (d < md(3, 22) || d > md(11, 15)) return { look: "bare", color: fall };
  if (d < md(4, 8)) return { look: "thin", color: spring };
  if (d < md(6, 1)) return { look: "leaves", color: mixc(spring, summer, sm((d - md(5, 10)) / 22)) };
  if (d < md(9, 20)) return { look: "leaves", color: summer };
  if (d < md(11, 1)) return { look: "leaves", color: mixc(summer, fall, sm((d - md(9, 20)) / 28)) };
  return { look: "thin", color: fall };
}

// ---------------------------------------------------------------- the whole picture's settings for one moment
export interface Scene {
  w: number; h: number;                 // pixels to render
  gradient: Float32Array;               // 256 rows x RGB: the sky from the top down to the horizon
  glows: { color: RGB; amount: number; sx: number; sy: number }[];
  glowX: number;
  haze: Float32Array;                   // 1024 samples across the width: the air colour at the horizon
  dark: RGB; sun: RGB; snowLit: RGB; snowShade: RGB; cloudLit: RGB; cloudShade: RGB;
  stars: number; light: number;         // 0..1
  up: boolean; sunX: number; sunY: number; moon: number; moonLit: number;
  lightX: number; lightDir: [number, number, number];
  season: Season; weather: Weather; wet: boolean; grey: number;   // grey: how overcast the light is (0..1)
  minute: number; when: Date;
}

export const DESIGN_W = 5120, DESIGN_H = 2160, HZ = 1778;
export interface SceneOpts { when: Date; weather?: Weather; width?: number; height?: number; box?: [number, number, number, number] | null; lat?: number; lng?: number }

/** Keep-out box of the lettering (design units) and the distance outside it, as the renderer measures it. */
export const KEEP: [number, number, number, number] = [800, 220, 4320, 1660];
export const distOut = (x: number, y: number) => Math.hypot(Math.max(KEEP[0] - x, x - KEEP[2], 0), Math.max(KEEP[1] - y, y - KEEP[3], 0));

export function sceneAt(o: SceneOpts): Scene {
  const when = o.when, weather = o.weather || "clear";
  const wet = weather === "rain" || weather === "snow";
  const grey = wet ? 1 : weather === "cloudy" ? .6 : weather === "mist" ? .3 : 0;
  const { rise, set } = sunTimes(when, o.lat, o.lng);
  const minute = when.getHours() * 60 + when.getMinutes() + when.getSeconds() / 60;
  const w = phaseWeights(minute, rise, set);
  const P = (f: (p: Phase) => number) => w.reduce((s, [n, k]) => s + f(PHASES[n]) * k, 0);
  const C = (f: (p: Phase) => string) => [0, 1, 2].map((i) => w.reduce((s, [n, k]) => s + hex(f(PHASES[n]))[i] * k, 0)) as RGB;
  const season = seasonOf(when);

  // The sun's (or moon's) arc: low in winter, high in summer, from the real noon altitude.
  const up = minute > rise && minute < set;
  const t = up ? (minute - rise) / (set - rise) : (((minute - set) % 1440) + 1440) % 1440 / (1440 - (set - rise));
  const decl = 23.44 * Math.sin((2 * Math.PI / 365) * (season.doy - 81));
  const noonAlt = 90 - (o.lat ?? DEFAULT_LAT) + decl;                       // 29° in December, 76° in June here
  const peakY = up ? lerp(660, 240, Math.max(0, Math.min(1, (noonAlt - 29) / 47))) : 330;
  let sunX = 380 + t * 4360, sunY = 1560 - Math.pow(Math.sin(Math.PI * t), .8) * (1560 - peakY);
  if (o.box) {                                                                 // the disc rides just over the words; only its glow passes behind them
    const over = sm((sunX - (o.box[0] - 330)) / 260) * sm(((o.box[2] + 330) - sunX) / 260);
    sunY = sunY * (1 - over) + Math.min(sunY, Math.max(96, o.box[1] - 125)) * over;
  }
  // Before dawn and after dusk the glow stays where the sun will rise or went down.
  const sinceSet = (((minute - set) % 1440) + 1440) % 1440, toRise = (((rise - minute) % 1440) + 1440) % 1440;
  const glowX = up ? sunX : sinceSet < toRise ? 4800 : 380;
  const lightSrc = up ? sunX : glowX;
  const lightX = Math.max(-1, Math.min(1, (lightSrc - 2560) / 1500));
  const alt = up ? Math.max(.06, Math.min(1, Math.sin(Math.PI * t) / .8)) : .05;
  const ld = [lightX * .9, .22 + .7 * alt, -.4]; const ln = Math.hypot(ld[0], ld[1], ld[2]);

  // The sky, as a column of colours (blending the moods' gradients) plus the glows round the sun.
  const gradient = new Float32Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const y = i / 255;
    const c = w.reduce((s, [n, k]) => { const g = gradAt(PHASES[n].stops, y); return [s[0] + g[0] * k, s[1] + g[1] * k, s[2] + g[2] * k]; }, [0, 0, 0]);
    gradient.set(c, i * 3);
  }
  const glows = (["glowA", "glowB"] as const).map((g) => ({
    color: C((p) => p[g][0]), amount: P((p) => p[g][1]) * (wet ? .55 : 1), sx: P((p) => p[g][2]), sy: P((p) => p[g][3]),
  }));
  const haze = new Float32Array(1024 * 3);
  const yh = HZ - 46;
  for (let i = 0; i < 1024; i++) {
    const x = (i + .5) / 1024 * DESIGN_W;
    let c = (() => { const r = Math.min(1, yh / HZ) * 255; const k = Math.min(255, Math.floor(r)); return [gradient[k * 3], gradient[k * 3 + 1], gradient[k * 3 + 2]]; })();
    const calm = .42 + .58 * sm(distOut(x, yh) / 700);
    for (const g of glows) {
      if (g.amount <= 0) continue;
      const a = Math.exp(-(((x - glowX) / (DESIGN_W * g.sx)) ** 2)) * Math.exp(-((Math.max(0, HZ - yh) / (DESIGN_H * g.sy)) ** 2)) * g.amount * calm;
      c = c.map((v, j) => v * (1 - a) + g.color[j] * a);
    }
    if (grey) { const m = (c[0] + c[1] + c[2]) / 3; c = c.map((v) => v * (1 - .22 * grey) + m * .14 * grey); }
    haze.set(c, i * 3);
  }
  const L = P((p) => p.light) * (1 - .4 * grey);
  return {
    w: o.width || DESIGN_W, h: o.height || DESIGN_H, gradient, glows, glowX, haze,
    dark: C((p) => p.dark), sun: C((p) => p.sun),
    snowLit: C((p) => p.snow[0]).map((v) => v * (.4 + .3 * L)) as RGB, snowShade: C((p) => p.snow[1]).map((v) => v * (.5 + .16 * L)) as RGB,
    cloudLit: C((p) => p.cl[0]), cloudShade: C((p) => p.cl[1]),
    stars: P((p) => p.stars) * (wet ? .2 : weather === "cloudy" ? .45 : 1), light: L,
    up, sunX, sunY, moon: moonPhase(when), moonLit: up ? 0 : 1,
    lightX, lightDir: [ld[0] / ln, ld[1] / ln, ld[2] / ln],
    season, weather, wet, grey, minute, when,
  };
}
