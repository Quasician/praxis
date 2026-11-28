// The living sky, drawn (5.1). One still frame at the screen's own resolution: a 2D canvas for the sky, stars, trails,
// constellations, your year, the ridge and the motto, and one small WebGL pass for the clouds. Nothing here loops: the
// wallpaper asks for a new frame when something has changed (about once a minute), and falling rain or snow is a separate,
// GPU-only layer made by precipLayer() that the page slides along without redrawing anything.
import { drawSkyIcon } from "../valley/skyIcons";
import type { SkyIcon } from "../valley/weather";
import type { Weather } from "../valley/model";
import {
  D_W, D_H, ARC, clamp, mix, rng, lightAt, trailOf, skyWeather, weatherLook, weatherColours, cloudColours, realSky,
  placeProjects, historyStars, mottoFit, fieldStars, onArc, openArc, type ProjectIn, type History, type SkyWeather,
} from "./model";

export interface MottoArt { bmp: ImageBitmap; w: number; h: number }
export interface SkyTemp { now: number; hi: number; lo: number; icon?: SkyIcon | null }
export interface SkyJob {
  when: Date; weather?: Weather; icon?: SkyIcon | null; wind?: number;
  motto?: MottoArt | null; projects?: ProjectIn[]; history?: History | null; temp?: SkyTemp | null;
  events?: { meteorAge?: number | null; aurora?: number };
  lat?: number; lng?: number;
  /** A still picture (the Windows wallpaper file): rain and snow are drawn into it, since nothing moves them. */
  still?: boolean;
}
export interface SkyInfo { ms: number; weather: SkyWeather; wind: number; phase: string }

type Ctx = CanvasRenderingContext2D;
const FONT = '"Segoe UI Variable Text", "Segoe UI", Inter, system-ui, sans-serif';
const FONT_DISPLAY = '"Segoe UI Variable Display", "Segoe UI", Inter, system-ui, sans-serif';

// ---------------------------------------------------------------- the motto's lettering
/** Turns a motto picture (light lettering on black) into lettering on a clear background, cropped to the words.
 *  Colours stay as they are (the red dot on the film ones stays red); only the black goes. */
export async function prepareMotto(blob: Blob): Promise<MottoArt> {
  const full = await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const W = full.width, H = full.height;
  // Find the words on a small copy first.
  const sw = Math.max(64, Math.round(W / 4)), sh = Math.max(27, Math.round(H / 4));
  const small = new OffscreenCanvas(sw, sh), sg = small.getContext("2d", { willReadFrequently: true })!;
  sg.drawImage(full, 0, 0, sw, sh);
  const px = sg.getImageData(0, 0, sw, sh).data;
  let x0 = sw, y0 = sh, x1 = -1, y1 = -1;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const i = (y * sw + x) * 4;
    if (Math.max(px[i], px[i + 1], px[i + 2]) > 22) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) { full.close(); throw new Error("The motto picture looks empty."); }
  const pad = 6;
  const cx = Math.max(0, x0 * 4 - pad * 4), cy = Math.max(0, y0 * 4 - pad * 4);
  const cw = Math.min(W - cx, (x1 - x0 + 1 + pad * 2) * 4), ch = Math.min(H - cy, (y1 - y0 + 1 + pad * 2) * 4);
  const crop = new OffscreenCanvas(cw, ch), cg = crop.getContext("2d", { willReadFrequently: true })!;
  cg.drawImage(full, cx, cy, cw, ch, 0, 0, cw, ch);
  full.close();
  const img = cg.getImageData(0, 0, cw, ch), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = Math.max(d[i], d[i + 1], d[i + 2]);
    if (a <= 3) { d[i + 3] = 0; continue; }
    const k = 255 / a;
    d[i] = Math.min(255, d[i] * k); d[i + 1] = Math.min(255, d[i + 1] * k); d[i + 2] = Math.min(255, d[i + 2] * k); d[i + 3] = a;
  }
  cg.putImageData(img, 0, 0);
  return { bmp: await createImageBitmap(crop), w: cw, h: ch };
}

// ---------------------------------------------------------------- clouds (WebGL)
const CLOUD_VS = `#version 300 es
void main() { vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0); gl_Position = vec4(p, 0.0, 1.0); }`;
const CLOUD_FS = `#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uK, uDrift, uTh, uSharp, uOpacity; uniform int uOct;
uniform vec3 uLit, uShadow;
out vec4 o;
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
vec2 grad(vec2 i) { float h = hash(i) * 6.2831853; return vec2(cos(h), sin(h)); }
float gnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(mix(dot(grad(i), f), dot(grad(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
             mix(dot(grad(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)), dot(grad(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5; mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 9; i++) { if (i >= uOct) break; s += a * gnoise(p); p = r * p * 2.02 + 17.3; a *= 0.5; }
  return 0.5 + s;
}
float density(vec2 d) { return fbm(vec2((d.x - uDrift) * 0.0017, d.y * 0.0052)); }
float band(float y) {   // more cloud high up, thinner around the motto, a little near the hills
  float t = y / ${D_H.toFixed(1)};
  if (t < 0.14) return mix(0.6, 1.0, t / 0.14);
  if (t < 0.44) return 1.0;
  if (t < 0.62) return mix(1.0, 0.6, (t - 0.44) / 0.18);
  if (t < 0.84) return mix(0.6, 0.85, (t - 0.62) / 0.22);
  if (t < 0.92) return mix(0.85, 0.0, (t - 0.84) / 0.08);
  return 0.0;
}
float hole(vec2 d) {    // a soft clearing around the motto
  float r = length((d - vec2(840.0, 420.0)) / vec2(640.0, 170.0));
  if (r < 0.6) return mix(0.78, 0.5, r / 0.6);
  if (r < 1.0) return mix(0.5, 0.0, (r - 0.6) / 0.4);
  return 0.0;
}
void main() {
  vec2 d = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uK;
  float sh = clamp(uSharp * (density(d - vec2(0.0, 6.0)) - uTh), 0.0, 1.0);
  float lt = clamp(uSharp * 0.9 * (density(d + vec2(0.0, 4.0)) - uTh - 0.07), 0.0, 1.0);
  vec3 c = mix(uShadow, uLit, lt);
  float a = (sh + lt * (1.0 - sh)) * band(d.y) * (1.0 - hole(d)) * uOpacity;
  o = vec4(c * a, a);
}`;

class Clouds {
  canvas: OffscreenCanvas; gl: WebGL2RenderingContext; prog: WebGLProgram; u: (n: string) => WebGLUniformLocation | null;
  constructor(public W: number, public H: number) {
    this.canvas = new OffscreenCanvas(W, H);
    const gl = this.canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("No WebGL2 for the clouds.");
    this.gl = gl;
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Cloud shader: ${gl.getShaderInfoLog(s)}`); return s; };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, CLOUD_VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, CLOUD_FS)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Cloud shader: ${gl.getProgramInfoLog(p)}`);
    this.prog = p;
    const cache = new Map<string, WebGLUniformLocation | null>();
    this.u = (n) => { if (!cache.has(n)) cache.set(n, gl.getUniformLocation(p, n)); return cache.get(n)!; };
  }
  draw(o: { drift: number; th: number; sharp: number; opacity: number; lit: string; shadow: string }) {
    const { gl, W, H } = this, k = W / D_W;
    const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255) as [number, number, number];
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.uniform2f(this.u("uRes"), W, H); gl.uniform1f(this.u("uK"), k);
    gl.uniform1f(this.u("uDrift"), o.drift); gl.uniform1f(this.u("uTh"), o.th); gl.uniform1f(this.u("uSharp"), o.sharp); gl.uniform1f(this.u("uOpacity"), o.opacity);
    // More octaves on bigger screens, so cloud edges stay crisp at 5K instead of going soft.
    gl.uniform1i(this.u("uOct"), Math.min(9, 5 + Math.max(0, Math.ceil(Math.log2(k)))));
    gl.uniform3f(this.u("uLit"), ...rgb(o.lit)); gl.uniform3f(this.u("uShadow"), ...rgb(o.shadow));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  dispose() { this.gl.getExtension("WEBGL_lose_context")?.loseContext(); }
}

// ---------------------------------------------------------------- falling rain or snow (a layer the page slides along)
export interface PrecipLayer { canvas: HTMLCanvasElement; dx: number; dy: number; ms: number; fps: number }
/** A screen-sized layer (plus one tile) of slanted rain or drifting snow that repeats seamlessly when slid by (dx, dy) device
 *  pixels: the page moves it with a GPU transform, so falling rain costs no drawing at all. */
export function precipLayer(kind: "rain" | "snow", W: number, H: number, windMph: number): PrecipLayer {
  const k = W / D_W;
  const angle = (kind === "rain" ? 8 + windMph * 1.2 : 4 + windMph * 0.8) * Math.PI / 180;
  const th = Math.round((kind === "rain" ? 240 : 300) * k);
  const tw = Math.max(8, Math.round(th * Math.tan(angle)));
  // The tile is tw wide and th tall; the layer repeats it, and sliding by one tile (tw, th) lands on the same picture.
  const tile = new OffscreenCanvas(Math.max(tw, 1) * 6, th), tg = tile.getContext("2d")!;
  const r = rng(kind === "rain" ? 77 : 78), TW = tile.width;
  if (kind === "rain") {
    for (let i = 0; i < 42; i++) {
      const x = r() * TW, y = r() * th, near = r() < 0.55, len = (near ? 22 + r() * 22 : 12 + r() * 12) * k, a = (0.3 + r() * 0.4) * (near ? 1 : 0.45);
      const ex = x + Math.sin(angle) * len, ey = y + Math.cos(angle) * len;
      for (const [ox, oy] of [[0, 0], [-TW, 0], [0, -th], [-TW, -th], [TW, 0], [0, th]]) {
        const g = tg.createLinearGradient(x + ox, y + oy, ex + ox, ey + oy);
        g.addColorStop(0, "rgba(220,230,255,0)"); g.addColorStop(1, `rgba(225,234,255,${a})`);
        tg.strokeStyle = g; tg.lineWidth = (near ? 1.4 : 1) * k; tg.beginPath(); tg.moveTo(x + ox, y + oy); tg.lineTo(ex + ox, ey + oy); tg.stroke();
      }
    }
  } else {
    for (let i = 0; i < 46; i++) {
      const x = r() * TW, y = r() * th, near = r() < 0.5, rad = (near ? 1.6 + r() * 1.4 : 0.8 + r() * 0.7) * k, a = near ? 0.85 : 0.5;
      for (const [ox, oy] of [[0, 0], [-TW, 0], [0, -th], [-TW, -th], [TW, 0], [0, th]]) { tg.fillStyle = `rgba(245,248,255,${a})`; tg.beginPath(); tg.arc(x + ox, y + oy, rad, 0, Math.PI * 2); tg.fill(); }
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = W + TW; canvas.height = H + th;
  const g = canvas.getContext("2d")!;
  // Shift each row of tiles sideways by the slant, so the pattern also repeats along the direction it falls.
  for (let row = 0, y = 0; y < canvas.height; row++, y += th) for (let x = -((row * tw) % TW) - TW; x < canvas.width; x += TW) g.drawImage(tile, x, y);
  return { canvas, dx: tw, dy: th, ms: kind === "rain" ? 380 : 2600, fps: kind === "rain" ? 30 : 20 };
}

// ---------------------------------------------------------------- the frame
export class LivingSkyRenderer {
  private clouds: Clouds | null = null;
  private grain: HTMLCanvasElement | null = null;
  private field = fieldStars();
  private drift: number | null = null;
  private driftAt = 0;
  constructor(public canvas: HTMLCanvasElement, public W: number, public H: number) {
    canvas.width = W; canvas.height = H;
  }

  render(job: SkyJob): SkyInfo {
    const t0 = performance.now();
    const { W, H } = this, k = W / D_W;
    const g = this.canvas.getContext("2d", { alpha: false })!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = "source-over"; g.filter = "none"; g.shadowBlur = 0;
    // Design units from here on; the canvas is the screen's own size.
    g.setTransform(k, 0, 0, k, 0, (H - D_H * k) / 2);

    const L = lightAt(job.when, job.lat, job.lng);
    const kind = skyWeather(job.icon, job.weather), wx = weatherLook(kind);
    const windMph = Math.round((job.wind ?? 0.25) * 25);
    const col = weatherColours(L, wx);
    const sp = onArc(clamp(L.dayT, -0.06, 1.06)), mp = onArc(clamp(L.nT));
    const veil = 1 - wx.cover * 0.85;

    // ---- the sky
    const bg = g.createLinearGradient(0, 0, 0, D_H);
    bg.addColorStop(0, col.top); bg.addColorStop(0.58, col.mid); bg.addColorStop(0.92, col.hor); bg.addColorStop(1, col.hor);
    g.fillStyle = bg; g.fillRect(-2, -D_H, D_W + 4, D_H * 3);

    // ---- the glow around the sun (or, faintly, the moon)
    const moonO = L.moonUp ? clamp(L.night * 1.2) * clamp(L.moonLit * 4) * (1 - wx.cover * 0.7) : 0;
    {
      const gx = L.sunUp ? sp.x : mp.x, gy = L.sunUp ? sp.y : mp.y;
      const gw = L.sunUp ? 900 + 500 * (1 - L.alt) + wx.cover * 300 : 520;
      const go = L.sunUp ? (0.25 + 0.55 * (1 - L.alt)) * (1 - wx.cover * 0.35) : moonO * 0.2;
      const gc = L.sunUp ? mix("#ffb07a", "#fff3d6", L.alt) : "#b8c4ff";
      if (go > 0.01) {
        g.save(); g.translate(gx, gy); g.scale(1, 0.6);
        const rg = g.createRadialGradient(0, 0, 0, 0, 0, gw / 2);
        rg.addColorStop(0, gc); rg.addColorStop(1, gc + "00");
        g.globalAlpha = go; g.fillStyle = rg; g.beginPath(); g.arc(0, 0, gw / 2, 0, Math.PI * 2); g.fill(); g.restore();
      }
    }

    // ---- faint field stars, then the real constellations over Milpitas
    const fieldO = L.night * 0.9 * veil;
    if (fieldO > 0.01) {
      g.fillStyle = "#ffffff";
      for (const s of this.field) { g.globalAlpha = s.o * fieldO; g.beginPath(); g.arc(s.x, s.y, s.r, 0, Math.PI * 2); g.fill(); }
    }
    const realO = Math.pow(L.night, 1.3) * veil;
    if (realO > 0.01) {
      const sky = realSky(job.when, job.lat, job.lng);
      g.globalAlpha = realO * 0.26; g.strokeStyle = "#d6e0ff"; g.lineWidth = 0.55; g.lineCap = "round";
      g.beginPath(); for (const [x0, y0, x1, y1] of sky.lines) { g.moveTo(x0, y0); g.lineTo(x1, y1); } g.stroke();
      for (const s of sky.stars) {
        const r = clamp(2.3 - s.mag * 0.48, 0.7, 3), o = clamp(1.05 - s.mag * 0.16, 0.35, 1);
        if (s.mag < 1.2) { const rg = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 4); rg.addColorStop(0, "rgba(220,230,255,0.55)"); rg.addColorStop(1, "rgba(220,230,255,0)"); g.globalAlpha = realO * o; g.fillStyle = rg; g.beginPath(); g.arc(s.x, s.y, r * 4, 0, Math.PI * 2); g.fill(); }
        g.globalAlpha = realO * o; g.fillStyle = "#eef2ff"; g.beginPath(); g.arc(s.x, s.y, r, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = realO * 0.62; g.fillStyle = "#d6e0ff"; g.font = `500 9.5px ${FONT}`; g.textAlign = "center"; g.textBaseline = "top";
      (g as Ctx & { letterSpacing: string }).letterSpacing = "2.4px";
      for (const l of sky.labels) g.fillText(l.t, l.x, l.y);
      (g as Ctx & { letterSpacing: string }).letterSpacing = "0px";
    }
    this.aurora(g, job, L, veil);
    this.meteor(g, job, L, veil);

    // ---- your year along the horizon
    const hist = historyStars(job.history, job.when);
    const galO = (0.45 + 0.55 * L.night) * (1 - wx.cover * 0.4);
    {
      g.save(); g.globalAlpha = galO; g.filter = `blur(${Math.round(18 * k)}px)`;
      const lg = g.createLinearGradient(hist.path[0][0], 0, hist.path[hist.path.length - 1][0], 0);
      lg.addColorStop(0, "rgba(255,226,184,0.08)"); lg.addColorStop(0.85, "rgba(255,226,184,0.4)"); lg.addColorStop(1, "rgba(255,217,166,0.85)");
      g.strokeStyle = lg; g.lineWidth = 38; g.lineCap = "round"; g.beginPath();
      hist.path.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke(); g.restore();
      for (const s of hist.stars) {
        g.globalAlpha = galO * s.o;
        if (s.mile || s.fresh) { const rg = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 4.5); rg.addColorStop(0, s.mile ? "rgba(255,205,130,0.7)" : "rgba(255,230,190,0.6)"); rg.addColorStop(1, "rgba(255,220,170,0)"); g.fillStyle = rg; g.beginPath(); g.arc(s.x, s.y, s.r * 4.5, 0, Math.PI * 2); g.fill(); }
        g.fillStyle = s.mile ? "#ffd38a" : "#ffeacc"; g.beginPath(); g.arc(s.x, s.y, s.r, 0, Math.PI * 2); g.fill();
      }
    }

    // ---- the day track, the trails, the sun and the moon
    const segs = [...trailOf("sun", L, 1 - wx.cover * 0.5), ...trailOf("moon", L, clamp(L.moonLit * 4) * (1 - wx.cover * 0.7))];
    // The faint dotted guide only where no trail lies over it (its dots would show through the trail as dashes).
    g.globalAlpha = 0.4; g.strokeStyle = "#ffffff"; g.lineWidth = 1.2; g.lineCap = "round"; g.setLineDash([0.01, 8.5]);
    for (const [a, b] of openArc(segs)) { g.beginPath(); g.ellipse(ARC.cx, ARC.hy, ARC.rx, ARC.ry, 0, Math.PI + Math.PI * a, Math.PI + Math.PI * b); g.stroke(); }
    g.setLineDash([]);
    g.save(); g.lineCap = "butt";
    for (const s of segs) {
      const sun = s.kind === "sun";
      g.globalAlpha = s.o; g.strokeStyle = sun ? "rgba(255,216,165,0.95)" : "rgba(212,220,255,0.95)";
      g.shadowColor = sun ? "rgba(255,190,120,0.55)" : "rgba(160,178,255,0.55)"; g.shadowBlur = 8 * k;
      g.lineWidth = 2; g.beginPath(); g.moveTo(s.x0, s.y0); g.lineTo(s.x1 + (s.x1 - s.x0) * 0.01, s.y1 + (s.y1 - s.y0) * 0.01); g.stroke();
    }
    g.restore();
    if (L.sunUp) {
      const sc = mix("#ff9a5a", "#fffaf0", clamp(L.alt * 1.6)), halo = mix("#ffb070", "#fff1cc", L.alt), so = 1 - wx.cover * 0.6;
      g.save(); g.globalAlpha = so;
      const hg = g.createRadialGradient(sp.x, sp.y, 20, sp.x, sp.y, 120);
      hg.addColorStop(0, halo + "cc"); hg.addColorStop(0.35, halo + "44"); hg.addColorStop(1, halo + "00");
      g.fillStyle = hg; g.beginPath(); g.arc(sp.x, sp.y, 120, 0, Math.PI * 2); g.fill();
      const dg = g.createRadialGradient(sp.x - 6, sp.y - 6, 2, sp.x, sp.y, 28);
      dg.addColorStop(0, "#ffffff"); dg.addColorStop(0.7, sc); dg.addColorStop(1, mix(sc, halo, 0.5));
      g.shadowColor = halo; g.shadowBlur = 40 * k; g.fillStyle = dg; g.beginPath(); g.arc(sp.x, sp.y, 28, 0, Math.PI * 2); g.fill(); g.restore();
    }
    if (moonO > 0.01) this.moon(g, mp.x, mp.y, 20, L.moonAge, moonO);

    // ---- clouds
    if (wx.cloud > 0) {
      this.clouds ||= new Clouds(W, Math.ceil(D_H * k));
      const now = job.when.getTime();
      if (this.drift === null) { this.drift = (rng(Math.floor(now / 864e5))() * 4000); this.driftAt = now; }
      // Clouds drift with the wind between frames (never jumping when the wind changes).
      this.drift -= clamp((now - this.driftAt) / 3.6e6, 0, 2) * windMph * 9; this.driftAt = now;
      const cc = cloudColours(L, wx, col.top);
      this.clouds.draw({ drift: this.drift, th: wx.th, sharp: wx.sharp, opacity: wx.cloud, lit: cc.lit, shadow: cc.shadow });
      g.save(); g.setTransform(1, 0, 0, 1, 0, (H - D_H * k) / 2); g.globalAlpha = 1; g.drawImage(this.clouds.canvas, 0, 0); g.restore();
    }

    // ---- your projects, in gold (counts only: names never appear on the wallpaper)
    const constO = (0.55 + 0.45 * L.night) * (1 - wx.cover * 0.3);
    for (const p of placeProjects(job.projects || [])) {
      const o = constO * (1 - 0.6 * p.dim);
      g.globalAlpha = o * 0.62; g.strokeStyle = "#ffd38a"; g.lineWidth = 0.6;
      g.beginPath(); for (const [x0, y0, x1, y1] of p.lines) { g.moveTo(x0, y0); g.lineTo(x1, y1); } g.stroke();
      for (const s of p.stars) {
        g.globalAlpha = o;
        if (s.lit) {
          const rg = g.createRadialGradient(s.x, s.y, 0, s.x, s.y, 9); rg.addColorStop(0, "rgba(255,205,130,0.75)"); rg.addColorStop(1, "rgba(255,205,130,0)");
          g.fillStyle = rg; g.beginPath(); g.arc(s.x, s.y, 9, 0, Math.PI * 2); g.fill();
          g.fillStyle = "#ffd38a"; g.beginPath(); g.arc(s.x, s.y, 3.2, 0, Math.PI * 2); g.fill();
        } else {
          g.fillStyle = "rgba(255,211,138,0.1)"; g.strokeStyle = "rgba(255,211,138,0.85)"; g.lineWidth = 0.9;
          g.beginPath(); g.arc(s.x, s.y, 2.6, 0, Math.PI * 2); g.fill(); g.stroke();
        }
      }
      g.globalAlpha = o * 0.9; g.fillStyle = "#ffe2b0"; g.font = `400 10.5px ${FONT}`; g.textAlign = "center"; g.textBaseline = "top";
      g.shadowColor = "rgba(5,10,30,0.5)"; g.shadowBlur = 6 * k; g.fillText(p.label.t, p.label.x, p.label.y); g.shadowBlur = 0;
    }

    // ---- rain or snow, in a still picture (the moving wallpaper slides its own layer instead)
    if (job.still && (wx.rain || wx.snow)) this.stillPrecip(g, wx.rain ? "rain" : "snow", windMph);

    // ---- the hills
    const ink = "#0a1124";
    g.globalAlpha = 1;
    g.fillStyle = mix(col.hor, ink, 0.3 + L.night * 0.45);
    g.beginPath(); g.moveTo(0, 631); g.bezierCurveTo(160, 609, 300, 627, 430, 619); g.bezierCurveTo(560, 611, 700, 599, 860, 615);
    g.bezierCurveTo(1020, 631, 1180, 635, 1320, 613); g.bezierCurveTo(1460, 591, 1560, 605, D_W, 623); g.lineTo(D_W, D_H + 40); g.lineTo(0, D_H + 40); g.closePath(); g.fill();
    g.fillStyle = mix(col.hor, ink, 0.55 + L.night * 0.35);
    g.beginPath(); g.moveTo(0, 665); g.bezierCurveTo(200, 647, 360, 669, 560, 657); g.bezierCurveTo(760, 645, 900, 639, 1100, 659);
    g.bezierCurveTo(1300, 679, 1450, 673, D_W, 653); g.lineTo(D_W, D_H + 40); g.lineTo(0, D_H + 40); g.closePath(); g.fill();

    // ---- fog
    if (wx.fog > 0) {
      const fc = mix(mix(col.hor, "#ffffff", 0.35), mix(col.hor, "#8890a8", 0.25), L.night);
      const fg = g.createLinearGradient(0, D_H, 0, D_H - 300);
      fg.addColorStop(0, fc); fg.addColorStop(0.22, fc); fg.addColorStop(1, fc + "00");
      g.globalAlpha = wx.fog; g.fillStyle = fg; g.fillRect(0, D_H - 300, D_W, 340);
      for (const [x, y, w, h] of [[570, 580, 900, 120], [1150, 615, 1100, 110], [180, 600, 700, 90]]) {
        g.save(); g.translate(x, y); g.scale(1, h / w);
        const rg = g.createRadialGradient(0, 0, 0, 0, 0, w / 2); rg.addColorStop(0, fc); rg.addColorStop(1, fc + "00");
        g.fillStyle = rg; g.beginPath(); g.arc(0, 0, w / 2, 0, Math.PI * 2); g.fill(); g.restore();
      }
    }

    // ---- months under your year
    g.globalAlpha = 0.6; g.fillStyle = "#ffffff"; g.font = `500 9.5px ${FONT}`; g.textAlign = "left"; g.textBaseline = "alphabetic";
    (g as Ctx & { letterSpacing: string }).letterSpacing = "2.3px";
    for (const m of hist.months) g.fillText(m.t, m.x, D_H - 16);
    g.globalAlpha = 1; g.fillStyle = "#ffe2b0"; g.font = `600 9.5px ${FONT}`; g.textAlign = "right"; g.fillText("TODAY", D_W - 20, D_H - 16);
    (g as Ctx & { letterSpacing: string }).letterSpacing = "0px";

    // ---- the motto, fitted to its zone
    if (job.motto) {
      const m = job.motto, fit = mottoFit(m.w, m.h, D_W / 5120);
      g.save(); g.globalAlpha = 1;
      g.shadowColor = `rgba(5,10,30,${(0.45 + 0.3 * wx.cover).toFixed(2)})`; g.shadowBlur = 30 * k; g.shadowOffsetY = 2 * k;
      g.imageSmoothingQuality = "high";
      g.drawImage(m.bmp, fit.x, fit.y, fit.w, fit.h);
      g.shadowColor = `rgba(5,10,30,${(0.25 + 0.3 * wx.cover).toFixed(2)})`; g.shadowBlur = 3 * k; g.shadowOffsetY = 1 * k;
      g.drawImage(m.bmp, fit.x, fit.y, fit.w, fit.h);
      g.restore();
    }

    // ---- today's weather, top left
    if (job.temp) this.weatherBox(g, job.temp, k);

    // ---- film grain, at the screen's own pixels
    this.grainPass(g);

    const phase = L.sunUp ? (L.alt > 0.5 ? "day" : "low sun") : L.night > 0.5 ? "night" : "twilight";
    return { ms: Math.round(performance.now() - t0), weather: kind, wind: windMph, phase };
  }

  private moon(g: Ctx, x: number, y: number, r: number, age: number, o: number) {
    g.save(); g.translate(x, y); g.globalAlpha = o;
    const rg = g.createRadialGradient(0, 0, r * 0.8, 0, 0, r * 3); rg.addColorStop(0, "rgba(200,210,255,0.28)"); rg.addColorStop(1, "rgba(200,210,255,0)");
    g.fillStyle = rg; g.beginPath(); g.arc(0, 0, r * 3, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(30,38,70,0.55)"; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
    // The lit part: the bright limb's half-disc plus (or minus) the terminator's half-ellipse.
    const waxing = age < 0.5, c = Math.cos(2 * Math.PI * age), tw = Math.abs(c) * r;
    g.fillStyle = "#eef0ff"; g.beginPath();
    if (waxing) { g.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false); g.ellipse(0, 0, tw, r, 0, Math.PI / 2, -Math.PI / 2, c > 0); }
    else { g.arc(0, 0, r, Math.PI / 2, -Math.PI / 2, false); g.ellipse(0, 0, tw, r, 0, -Math.PI / 2, Math.PI / 2, c > 0); }
    g.fill(); g.restore();
  }

  private aurora(g: Ctx, job: SkyJob, L: ReturnType<typeof lightAt>, veil: number) {
    const a = (job.events?.aurora || 0) * Math.pow(L.night, 1.5) * veil;
    if (a < 0.02) return;
    g.save(); g.globalAlpha = a * 0.55; g.globalCompositeOperation = "screen"; g.filter = `blur(${Math.round(10 * this.W / D_W)}px)`;
    const r = rng(Math.floor(job.when.getTime() / 864e5));
    for (let i = 0; i < 26; i++) {
      const x = 80 + i * 60 + r() * 30, top = 330 + r() * 90, h = 140 + r() * 120;
      const lg = g.createLinearGradient(0, top, 0, top + h); lg.addColorStop(0, "rgba(156,104,246,0)"); lg.addColorStop(0.5, "rgba(120,200,200,0.5)"); lg.addColorStop(1, "rgba(96,240,168,0)");
      g.fillStyle = lg; g.fillRect(x, top, 34 + r() * 30, h);
    }
    g.restore();
  }

  private meteor(g: Ctx, job: SkyJob, L: ReturnType<typeof lightAt>, veil: number) {
    const age = job.events?.meteorAge;
    if (age === null || age === undefined || age < 0 || age > 3 * 3600) return;
    const o = (1 - age / (3 * 3600)) * Math.max(0.35, L.night) * veil;
    if (o < 0.03) return;
    g.save(); g.globalAlpha = o; g.lineCap = "round";
    const x0 = 1430, y0 = 210, x1 = 1270, y1 = 300;
    const lg = g.createLinearGradient(x0, y0, x1, y1); lg.addColorStop(0, "rgba(255,255,255,0)"); lg.addColorStop(1, "rgba(255,246,225,0.95)");
    g.strokeStyle = lg; g.lineWidth = 1.6; g.shadowColor = "rgba(255,230,190,0.8)"; g.shadowBlur = 6 * this.W / D_W;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.fillStyle = "#fffaf0"; g.beginPath(); g.arc(x1, y1, 2.2, 0, Math.PI * 2); g.fill(); g.restore();
  }

  private stillPrecip(g: Ctx, kind: "rain" | "snow", windMph: number) {
    const r = rng(kind === "rain" ? 77 : 78), angle = (kind === "rain" ? 8 + windMph * 1.2 : 4 + windMph * 0.8) * Math.PI / 180;
    g.save(); g.lineCap = "round";
    for (let i = 0; i < (kind === "rain" ? 260 : 220); i++) {
      const x = r() * (D_W + 200) - 200, y = r() * 660, near = r() < 0.55;
      if (kind === "rain") {
        const len = near ? 22 + r() * 22 : 12 + r() * 12, ex = x + Math.sin(angle) * len, ey = y + Math.cos(angle) * len;
        const lg = g.createLinearGradient(x, y, ex, ey); lg.addColorStop(0, "rgba(220,230,255,0)"); lg.addColorStop(1, `rgba(225,234,255,${((0.3 + r() * 0.4) * (near ? 1 : 0.45)).toFixed(2)})`);
        g.strokeStyle = lg; g.lineWidth = near ? 1.4 : 1; g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.stroke();
      } else { g.fillStyle = `rgba(245,248,255,${near ? 0.85 : 0.5})`; g.beginPath(); g.arc(x, y, near ? 1.6 + r() * 1.4 : 0.8 + r() * 0.7, 0, Math.PI * 2); g.fill(); }
    }
    g.restore();
  }

  private weatherBox(g: Ctx, t: SkyTemp, k: number) {
    g.save(); g.globalAlpha = 1;
    g.font = `500 34px ${FONT_DISPLAY}`; const tw = g.measureText(`${t.now}°`).width;
    g.font = `400 12px ${FONT}`; const lw = Math.max(g.measureText(`H ${t.hi}°`).width, g.measureText(`L ${t.lo}°`).width);
    const icon = t.icon ? 40 : 0, gap = 16, x = 40, y = 36, w = 16 + icon + (icon ? gap : 0) + tw + gap + lw + 20, h = 68;
    g.fillStyle = "rgba(8,14,34,0.32)"; g.strokeStyle = "rgba(255,255,255,0.16)"; g.lineWidth = 1;
    g.beginPath(); g.roundRect(x, y, w, h, 14); g.fill(); g.stroke();
    let cx = x + 16;
    if (t.icon) {
      const px = Math.ceil(48 * k), ic = new OffscreenCanvas(px, px), ig = ic.getContext("2d")!;
      drawSkyIcon(ig, t.icon, px / 2, px / 2, px * 0.9, Math.max(1.5, px * 0.9 * 0.045));
      g.drawImage(ic, cx - 4, y + h / 2 - 24, 48, 48);
      cx += icon + gap;
    }
    g.fillStyle = "#ffffff"; g.textBaseline = "middle"; g.textAlign = "left";
    g.font = `500 34px ${FONT_DISPLAY}`; g.fillText(`${t.now}°`, cx, y + h / 2 + 1);
    cx += tw + gap;
    g.globalAlpha = 0.92; g.font = `400 12px ${FONT}`;
    (g as Ctx & { letterSpacing: string }).letterSpacing = "1px";
    g.fillText(`H ${t.hi}°`, cx, y + h / 2 - 9); g.fillText(`L ${t.lo}°`, cx, y + h / 2 + 10);
    (g as Ctx & { letterSpacing: string }).letterSpacing = "0px";
    g.restore();
  }

  private grainPass(g: Ctx) {
    if (!this.grain) {
      const c = document.createElement("canvas"); c.width = 256; c.height = 256;
      const gg = c.getContext("2d")!, img = gg.createImageData(256, 256), r = rng(4404);
      for (let i = 0; i < img.data.length; i += 4) { const v = Math.round(96 + r() * 64); img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
      gg.putImageData(img, 0, 0); this.grain = c;
    }
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 0.22; g.globalCompositeOperation = "overlay";
    g.fillStyle = g.createPattern(this.grain, "repeat")!; g.fillRect(0, 0, this.W, this.H); g.restore();
  }

  dispose() { this.clouds?.dispose(); this.clouds = null; }
}
