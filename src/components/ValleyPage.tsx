// The wallpaper's own page (?valley=1). The desktop app keeps it in a hidden window and asks it for pictures;
// tests and the year sheet drive it the same way, through window.__valley.
import { useEffect, useRef, useState } from "react";
import { loadAssets, ValleyRenderer, type CityInput, type RenderOpts, type SkyProject, type ValleyAssets } from "../valley/render";
import type { Weather } from "../valley/model";
import { cityPlan } from "../city/model";
import { drawSkyIcon } from "../valley/skyIcons";
import type { SkyIcon } from "../valley/weather";
import { LivingSkyRenderer, prepareMotto, precipLayer, type MottoArt } from "../livingsky/render";
import { skyWeather, weatherLook, type ProjectIn, type History } from "../livingsky/model";

/** 3.7: the rewards in the sky. meteorAt: when you finished "the one"; aurora: 1 while it's out. */
export interface JobEvents { meteorAt?: string | null; aurora?: number }
/** scene: 3.9, the valley (drawn) or the city (paintings from your city kit folder). */
/** temp: 3.9, now / today's high / today's low in °F, shown in the top-left corner (null: not shown). */
export interface JobTemp { now: number; hi: number; lo: number; icon?: SkyIcon | null }
/** 5.1: scene "sky" is the living sky; it also takes the forecast's symbol, the wind, your year of finished things and where you are. */
export interface WallpaperJob { when: string; weather?: Weather; motto?: string | null; projects?: SkyProject[]; width?: number; height?: number; save?: boolean; events?: JobEvents; scene?: "valley" | "city" | "sky"; temp?: JobTemp | null;
  icon?: SkyIcon | null; wind?: number; history?: History | null; lat?: number; lng?: number }
const eventsAt = (e: JobEvents | undefined, at: number) => (e ? { aurora: e.aurora || 0, meteorAge: e.meteorAt ? (at - Date.parse(e.meteorAt)) / 1000 : null } : undefined);
declare global {
  interface Window {
    __valley?: {
      ready: boolean;
      render(o: Omit<RenderOpts, "when" | "motto" | "events" | "city" | "projects"> & { when: string; motto?: string | null; width?: number; height?: number; events?: JobEvents; scene?: "valley" | "city" | "sky"; temp?: JobTemp | null; projects?: (SkyProject & { dim?: number })[]; icon?: SkyIcon | null; history?: History | null; lat?: number; lng?: number; still?: boolean }): Promise<{ ms: number; box: number[] | null; constellations: number; phase: string; doy: number; city?: string; sky?: string }>;
      dataURL(type?: string, quality?: number, scale?: number): string;
      maskCount(box: [number, number, number, number]): number;
      wallpaper(job: WallpaperJob): Promise<{ file: string; ms: number }>;
      live(job: WallpaperJob & { wind?: number }): Promise<void>;
      pause(on: boolean): void;
      fps(): number;
      /** 4.0.1: the moving wallpaper has drawn at least one frame (the desktop app waits for this before putting it behind the icons). */
      drawn?: boolean;
      error?: string;
    };
  }
}

let assets: Promise<ValleyAssets> | null = null;
const mottoCache = new Map<string, ImageBitmap>();
async function mottoBitmap(name: string | null | undefined, w: number, h: number, temp?: JobTemp | null) {
  if (!name && !temp) return null;
  const key = `${name || ""}|${w}x${h}|${temp ? `${temp.now}/${temp.hi}/${temp.lo}/${temp.icon || ""}` : ""}`;
  if (mottoCache.has(key)) return mottoCache.get(key)!;
  let bmp: ImageBitmap | null = null;
  if (name) {
    const url = /^(blob:|data:|https?:|\/)/.test(name) ? name : `/api/valley/motto?name=${encodeURIComponent(name)}`;
    const r = await fetch(url, { headers: { "x-planner": "1" } });
    if (!r.ok) throw new Error(`Couldn't open the motto (${r.status}).`);
    bmp = await createImageBitmap(await r.blob(), { resizeWidth: w, resizeHeight: h, resizeQuality: "high", premultiplyAlpha: "none", colorSpaceConversion: "none" });
  }
  // 3.9: today's temperatures in the top-left corner, drawn as more lettering, so they get the motto's shadow and contrast guard.
  if (temp) {
    const c = new OffscreenCanvas(w, h), g = c.getContext("2d")!, k = w / 5120;
    g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
    if (bmp) { g.drawImage(bmp, 0, 0, w, h); bmp.close(); }
    g.fillStyle = "#fff"; g.textBaseline = "alphabetic";
    const face = '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';
    // One tidy block: the temperature and the day's symbol on top, today's high and low under them spread to the same width,
    // so the left and right edges line up.
    const x0 = 150 * k, base = 290 * k, s = Math.round(170 * k), iw = s * .92 * .96;   // the symbol's drawn width
    g.font = `300 ${Math.round(150 * k)}px ${face}`;
    const tw = g.measureText(`${temp.now}°`).width;
    const gap = 44 * k, width = tw + (temp.icon ? gap + iw : 0);
    g.textAlign = "left"; g.fillText(`${temp.now}°`, x0, base);
    if (temp.icon) {
      const ic = new OffscreenCanvas(s * 2, s * 2), ig = ic.getContext("2d")!;
      drawSkyIcon(ig, temp.icon, s, s, s * .92, Math.max(2, 7.5 * k));
      g.drawImage(ic, x0 + width - iw / 2 - s, 236 * k - s);
    }
    g.font = `400 ${Math.round(60 * k)}px ${face}`;
    const row = base + 92 * k;
    g.textAlign = "left"; g.fillText(`H ${temp.hi}°`, x0 + 8 * k, row);
    g.textAlign = "right"; g.fillText(`L ${temp.lo}°`, x0 + width, row);
    g.textAlign = "left";
    bmp = c.transferToImageBitmap();
  }
  if (!bmp) return null;
  if (mottoCache.size > 3) { for (const b of mottoCache.values()) b.close(); mottoCache.clear(); }
  mottoCache.set(key, bmp);
  return bmp;
}

// 5.1: the living sky's motto: the lettering from your motto picture, cut out of its black and fitted to the sky's motto zone.
const skyMottos = new Map<string, Promise<MottoArt>>();
function skyMotto(name: string | null | undefined): Promise<MottoArt | null> {
  if (!name) return Promise.resolve(null);
  let p = skyMottos.get(name);
  if (!p) {
    const url = /^(blob:|data:|https?:|\/)/.test(name) ? name : `/api/valley/motto?name=${encodeURIComponent(name)}`;
    p = (async () => {
      const r = await fetch(url, { headers: { "x-planner": "1" } });
      if (!r.ok) throw new Error(`Couldn't open the motto (${r.status}).`);
      return prepareMotto(await r.blob());
    })();
    // Keep the last few (one an hour); drop failures so they're tried again.
    if (skyMottos.size > 3) { const [old] = skyMottos.keys(); skyMottos.get(old)!.then((m) => m.bmp.close()).catch(() => undefined); skyMottos.delete(old); }
    skyMottos.set(name, p);
    p.catch(() => skyMottos.delete(name));
  }
  return p;
}

// 3.9: the city's paintings, fetched from your city kit folder as they're needed (the two on screen, the grey day, the mask).
const cityImages = new Map<string, { w: number; img: Promise<ImageBitmap> }>();
async function cityInput(when: Date, weather: Weather | undefined, width: number): Promise<CityInput> {
  const plan = cityPlan(when, weather);
  for (const [name, e] of cityImages) if (!plan.files.includes(name)) { cityImages.delete(name); e.img.then((b) => b.close()).catch(() => undefined); }
  const images: Record<string, ImageBitmap> = {};
  await Promise.all(plan.files.map(async (name) => {
    const isMask = name.endsWith("-mask"), w = isMask ? 0 : Math.min(5120, width);
    let e = cityImages.get(name);
    if (!e || e.w !== w) {
      const img = (async () => {
        const r = await fetch(`/api/city/frame?name=${encodeURIComponent(name)}`, { headers: { "x-planner": "1" } });
        if (!r.ok) throw new Error(r.status === 404 ? `The city kit folder has no ${name}.png.` : `Couldn't open ${name}.png (${r.status}).`);
        const blob = await r.blob();
        return createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none", ...(w && w < 5120 ? { resizeWidth: w, resizeHeight: Math.round(w * 2160 / 5120), resizeQuality: "high" as const } : {}) });
      })();
      e = { w, img };
      cityImages.set(name, e);
      img.catch(() => { if (cityImages.get(name) === e) cityImages.delete(name); });
    }
    images[name] = await e.img;
  }));
  return { plan, images };
}

export function ValleyPage() {
  const holder = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Loading the valley…");
  useEffect(() => {
    document.documentElement.classList.add("valley-doc");
    let renderer: ValleyRenderer | null = null;
    let canvas: HTMLCanvasElement | null = null;
    // 5.1: the living sky has its own canvas and renderer (a 2D canvas plus a small WebGL pass for the clouds).
    let sky: LivingSkyRenderer | null = null, skyCanvas: HTMLCanvasElement | null = null;
    const ensure = async (w: number, h: number) => {
      assets ||= loadAssets("./valley");
      const a = await assets;
      if (sky) { sky.dispose(); sky = null; skyCanvas?.remove(); skyCanvas = null; }
      if (!renderer || renderer.W !== w || renderer.H !== h) {
        renderer?.dispose();
        canvas?.remove();
        canvas = document.createElement("canvas");
        canvas.id = "valley-canvas";
        holder.current?.prepend(canvas);
        renderer = new ValleyRenderer(canvas, a, w, h);
      }
      return renderer;
    };
    const ensureSky = (w: number, h: number) => {
      if (renderer) { renderer.dispose(); renderer = null; canvas?.remove(); canvas = null; }
      if (!sky || sky.W !== w || sky.H !== h) {
        sky?.dispose();
        skyCanvas?.remove();
        skyCanvas = document.createElement("canvas");
        skyCanvas.id = "sky-canvas";
        holder.current?.prepend(skyCanvas);
        sky = new LivingSkyRenderer(skyCanvas, w, h);
      }
      return sky;
    };
    type SkyRenderJob = Parameters<NonNullable<typeof window.__valley>["render"]>[0];
    const drawSky = async (o: SkyRenderJob) => {
      const w = o.width || 5120, h = o.height || Math.round(w * 2160 / 5120);
      const r = ensureSky(w, h);
      const motto = await skyMotto(o.motto);
      const info = r.render({ when: new Date(o.when), weather: o.weather, icon: o.icon, wind: o.wind, motto, projects: o.projects as ProjectIn[] | undefined,
        history: o.history, temp: o.temp, events: eventsAt(o.events, Date.parse(o.when)), lat: o.lat, lng: o.lng, still: o.still });
      return { ms: info.ms, box: null, constellations: (o.projects || []).length, phase: info.phase, doy: 0, sky: `${info.weather}, ${info.wind} mph` };
    };
    const pixelsCanvas = (): HTMLCanvasElement | null => {
      if (sky && skyCanvas) return skyCanvas;
      if (!renderer) return null;
      const c = document.createElement("canvas"); c.width = renderer.W; c.height = renderer.H;
      c.getContext("2d")!.putImageData(new ImageData(renderer.pixels(), renderer.W, renderer.H), 0, 0);
      return c;
    };
    window.__valley = {
      ready: false,
      async render(o) {
        if (o.scene === "sky") return drawSky(o);
        const w = o.width || 5120, h = o.height || Math.round(w * 2160 / 5120);
        const r = await ensure(w, h);
        const motto = await mottoBitmap(o.motto, w, h, o.temp);
        const city = o.scene === "city" ? await cityInput(new Date(o.when), o.weather, w) : null;
        const info = r.render({ ...o, when: new Date(o.when), motto, events: eventsAt(o.events, Date.parse(o.when)), city });
        r.present();
        const phase = info.scene.light > .8 ? "day" : info.scene.up ? "low sun" : "night";
        return { ms: Math.round(info.ms), box: info.box, constellations: info.constellations, phase, doy: info.scene.season.doy,
          city: city ? `${city.plan.season} ${city.plan.a}${city.plan.a !== city.plan.b ? ` → ${city.plan.b} ${Math.round(city.plan.k * 100)}%` : ""}` : undefined };
      },
      dataURL(type = "image/jpeg", quality = .92, scale = 1) {
        const c = pixelsCanvas();
        if (!c) return "";
        if (scale === 1) return c.toDataURL(type, quality);
        const s = document.createElement("canvas"); s.width = Math.round(c.width * scale); s.height = Math.round(c.height * scale);
        const g = s.getContext("2d")!; g.imageSmoothingQuality = "high"; g.drawImage(c, 0, 0, s.width, s.height);
        return s.toDataURL(type, quality);
      },
      /** In a picture drawn with mask: true, how many scenery pixels fall inside a box (design units). */
      maskCount(box) {
        if (!renderer) return -1;
        const px = renderer.pixels(), W = renderer.W, H = renderer.H, k = W / 5120;
        let n = 0;
        for (let y = Math.floor(box[1] * k); y < Math.min(H, box[3] * k); y++) for (let x = Math.floor(box[0] * k); x < Math.min(W, box[2] * k); x++) if (px[(y * W + x) * 4] > 8) n++;
        return n;
      },
      async live(job) {
        liveJob = job;
        if (job.scene === "sky") { skyTick(); return; }
        const [w, h] = coverSize();
        await ensure(w, h);
        if (!paused) startLoop();
      },
      pause(on) {
        if (on === paused) return;   // the desktop app says this after every update; only a change matters
        paused = on;
        if (precip) { if (on) precip.anim.pause(); else precip.anim.play(); }
        if (on) { clearTimeout(loop); loop = 0; clearTimeout(skyTimer); skyTimer = 0; return; }
        if (liveJob?.scene === "sky") {
          // Coming back (a full-screen app closed, the PC unlocked): the picture on screen is kept. If it's out of date, the
          // new one is drawn a moment later, not in the middle of the window switch that revealed the desktop.
          clearTimeout(skyTimer);
          skyTimer = window.setTimeout(skyTick, Date.now() - skyDrawnAt > 60_000 ? 1500 : 60_000 - (Date.now() % 60_000) + 250);
        } else if (liveJob) startLoop();
      },
      fps() { const s = (performance.now() - since) / 1000; const f = frames / Math.max(1, s); frames = 0; since = performance.now(); return Math.round(f * 10) / 10; },
      /** Draws one wallpaper and hands it to the desktop app, which saves it and sets it. */
      async wallpaper(job) {
        const t0 = performance.now();
        await window.__valley!.render({ when: job.when, weather: job.weather, motto: job.motto, projects: job.projects, width: job.width, height: job.height, events: job.events, scene: job.scene, temp: job.temp,
          icon: job.icon, wind: job.wind, history: job.history, lat: job.lat, lng: job.lng, still: true });
        const c = pixelsCanvas()!;
        const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't make the picture."))), "image/png"));
        const r = await fetch("/api/valley/frame", { method: "POST", headers: { "x-planner": "1", "content-type": "image/png" }, body: blob });
        if (!r.ok) throw new Error(`Couldn't save the picture (${r.status}).`);
        const { file } = await r.json();
        return { file, ms: Math.round(performance.now() - t0) };
      },
    };
    let liveJob: WallpaperJob | null = null, paused = false, frames = 0, since = performance.now(), loop = 0;
    const live = location.search.includes("live=1");

    // ---------- the moving city/valley: redrawn ~12 times a second ----------
    // One loop at a time: each start bumps the generation, and a frame from an older loop stops instead of scheduling another.
    // (Before 5.1, pausing and resuming while a frame was still loading could leave two or more loops running at once,
    // each redrawing the whole 5K picture: the desktop got slower every time you switched windows.)
    let gen = 0;
    const startLoop = () => { clearTimeout(loop); loop = 0; const g = ++gen; frame(g); };
    const frame = async (g: number) => {
      if (g !== gen || !liveJob || paused || !renderer) return;
      const t0 = performance.now();
      try {
        const motto = await mottoBitmap(liveJob.motto, renderer.W, renderer.H, liveJob.temp);
        const now = new Date();
        const city = liveJob.scene === "city" ? await cityInput(now, liveJob.weather, renderer.W) : null;
        if (g !== gen || paused || !renderer) return;
        renderer.render({ when: now, weather: liveJob.weather, motto, projects: liveJob.projects, time: t0 / 1000, wind: liveJob.wind ?? 0.2, events: eventsAt(liveJob.events, Date.now()), city });
        renderer.present();
        frames++; window.__valley!.drawn = true;
      } catch (e) { window.__valley!.error = String((e as Error)?.message || e); return; }
      loop = window.setTimeout(() => frame(g), Math.max(4, 83 - (performance.now() - t0)));   // ~12 a second; timers, not animation frames, so it keeps going behind the icons
    };

    // ---------- 5.1: the moving living sky: one new picture a minute, and nothing in between ----------
    // The sun, moon, stars and clouds move slowly enough that a fresh frame each minute looks continuous; between frames the
    // window shows a still picture, so switching windows on the desktop never waits on the wallpaper. Only rain or snow moves
    // continuously, as a ready-made layer the graphics card slides along (no drawing, ~25 steps a second).
    let skyTimer = 0, skyGen = 0, skyDrawnAt = 0;
    let precip: { el: HTMLCanvasElement; anim: Animation; key: string } | null = null;
    const syncPrecip = () => {
      const job = liveJob, r = sky;
      const kind = job && r ? weatherLook(skyWeather(job.icon, job.weather)) : null;
      const want = kind?.rain ? "rain" as const : kind?.snow ? "snow" as const : null;
      const windMph = Math.round(((job?.wind ?? 0.25)) * 25);
      const key = want && r ? `${want}|${windMph}|${r.W}x${r.H}` : "";
      if (precip && precip.key === key) { if (paused) precip.anim.pause(); else precip.anim.play(); return; }
      if (precip) { precip.anim.cancel(); precip.el.remove(); precip = null; }
      if (!want || !r) return;
      const layer = precipLayer(want, r.W, r.H, windMph), dpr = window.devicePixelRatio || 1;
      const el = layer.canvas;
      el.className = "sky-precip";
      Object.assign(el.style, { left: `${-layer.dx / dpr}px`, top: `${-layer.dy / dpr}px`, width: `${el.width / dpr}px`, height: `${el.height / dpr}px` });
      holder.current?.appendChild(el);
      const anim = el.animate([{ transform: "translate(0px, 0px)" }, { transform: `translate(${layer.dx / dpr}px, ${layer.dy / dpr}px)` }],
        { duration: layer.ms, iterations: Infinity, easing: `steps(${Math.max(2, Math.round(layer.ms / 1000 * layer.fps))}, end)` });
      if (paused) anim.pause();
      precip = { el, anim, key };
    };
    const skyTick = async () => {
      clearTimeout(skyTimer); skyTimer = 0;
      if (!liveJob || liveJob.scene !== "sky" || paused) { syncPrecip(); return; }
      const g = ++skyGen;
      const [w, h] = coverSize();
      try {
        await drawSky({ ...liveJob, when: new Date().toISOString(), width: w, height: h, still: false });
        if (g !== skyGen) return;
        frames++; skyDrawnAt = Date.now(); window.__valley!.drawn = true;
      } catch (e) { window.__valley!.error = String((e as Error)?.message || e); }
      if (g !== skyGen) return;
      syncPrecip();
      if (!paused) skyTimer = window.setTimeout(skyTick, 60_000 - (Date.now() % 60_000) + 250);
    };

    const coverSize = () => {
      const dpr = window.devicePixelRatio || 1, w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
      const W = Math.min(8192, Math.max(w, Math.round(h * 5120 / 2160)));
      return [W, Math.round(W * 2160 / 5120)];
    };
    if (live) {
      document.documentElement.classList.add("valley-live");
      let resizeAt = 0;
      window.addEventListener("resize", () => {
        if (!liveJob) return;
        clearTimeout(resizeAt);
        // Wait for the size to settle (Windows can send several while the desktop rebuilds), then redraw once.
        resizeAt = window.setTimeout(() => { if (liveJob?.scene === "sky") skyTick(); else { const [w, h] = coverSize(); ensure(w, h); } }, 400);
      });
    }
    (async () => {
      // The valley's land and trees load only if the valley or city is asked for; the sky needs nothing but its fonts.
      try { await document.fonts?.ready; window.__valley!.ready = true; setStatus("Ready"); }
      catch (e) { window.__valley!.error = String((e as Error)?.message || e); setStatus(window.__valley!.error); }
    })();
    return () => { renderer?.dispose(); sky?.dispose(); clearTimeout(loop); clearTimeout(skyTimer); precip?.anim.cancel(); };
  }, []);
  return <div className="valley-page"><div ref={holder} className="valley-holder" /><p className="valley-status" id="valley-status">{status}</p></div>;
}
