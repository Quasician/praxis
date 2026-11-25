// The wallpaper's own page (?valley=1). The desktop app keeps it in a hidden window and asks it for pictures;
// tests and the year sheet drive it the same way, through window.__valley.
import { useEffect, useRef, useState } from "react";
import { loadAssets, ValleyRenderer, type CityInput, type RenderOpts, type SkyProject, type ValleyAssets } from "../valley/render";
import type { Weather } from "../valley/model";
import { cityPlan } from "../city/model";
import { drawSkyIcon } from "../valley/skyIcons";
import type { SkyIcon } from "../valley/weather";

/** 3.7: the rewards in the sky. meteorAt: when you finished "the one"; aurora: 1 while it's out. */
export interface JobEvents { meteorAt?: string | null; aurora?: number }
/** scene: 3.9, the valley (drawn) or the city (paintings from your city kit folder). */
/** temp: 3.9, now / today's high / today's low in °F, shown in the top-left corner (null: not shown). */
export interface JobTemp { now: number; hi: number; lo: number; icon?: SkyIcon | null }
export interface WallpaperJob { when: string; weather?: Weather; motto?: string | null; projects?: SkyProject[]; width?: number; height?: number; save?: boolean; events?: JobEvents; scene?: "valley" | "city"; temp?: JobTemp | null }
const eventsAt = (e: JobEvents | undefined, at: number) => (e ? { aurora: e.aurora || 0, meteorAge: e.meteorAt ? (at - Date.parse(e.meteorAt)) / 1000 : null } : undefined);
declare global {
  interface Window {
    __valley?: {
      ready: boolean;
      render(o: Omit<RenderOpts, "when" | "motto" | "events" | "city"> & { when: string; motto?: string | null; width?: number; height?: number; events?: JobEvents; scene?: "valley" | "city"; temp?: JobTemp | null }): Promise<{ ms: number; box: number[] | null; constellations: number; phase: string; doy: number; city?: string }>;
      dataURL(type?: string, quality?: number, scale?: number): string;
      maskCount(box: [number, number, number, number]): number;
      wallpaper(job: WallpaperJob): Promise<{ file: string; ms: number }>;
      live(job: WallpaperJob & { wind?: number }): Promise<void>;
      pause(on: boolean): void;
      fps(): number;
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
    const ensure = async (w: number, h: number) => {
      assets ||= loadAssets("./valley");
      const a = await assets;
      if (!renderer || renderer.W !== w || renderer.H !== h) {
        renderer?.dispose();
        canvas?.remove();
        canvas = document.createElement("canvas");
        canvas.id = "valley-canvas";
        holder.current?.appendChild(canvas);
        renderer = new ValleyRenderer(canvas, a, w, h);
      }
      return renderer;
    };
    window.__valley = {
      ready: false,
      async render(o) {
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
        if (!renderer) return "";
        const px = renderer.pixels();
        const c = document.createElement("canvas"); c.width = renderer.W; c.height = renderer.H;
        c.getContext("2d")!.putImageData(new ImageData(px, renderer.W, renderer.H), 0, 0);
        if (scale === 1) return c.toDataURL(type, quality);
        const s = document.createElement("canvas"); s.width = Math.round(renderer.W * scale); s.height = Math.round(renderer.H * scale);
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
        const [w, h] = coverSize();
        await ensure(w, h);
        liveJob = job;
        if (!loop && !paused) frame();
      },
      pause(on) { paused = on; if (!on && liveJob && !loop) frame(); },
      fps() { const s = (performance.now() - since) / 1000; const f = frames / Math.max(1, s); frames = 0; since = performance.now(); return Math.round(f * 10) / 10; },
      /** Draws one wallpaper and hands it to the desktop app, which saves it and sets it. */
      async wallpaper(job) {
        const t0 = performance.now();
        await window.__valley!.render({ when: job.when, weather: job.weather, motto: job.motto, projects: job.projects, width: job.width, height: job.height, events: job.events, scene: job.scene, temp: job.temp });
        const px = renderer!.pixels();
        const c = new OffscreenCanvas(renderer!.W, renderer!.H);
        c.getContext("2d")!.putImageData(new ImageData(px, renderer!.W, renderer!.H), 0, 0);
        const blob = await c.convertToBlob({ type: "image/png" });
        const r = await fetch("/api/valley/frame", { method: "POST", headers: { "x-planner": "1", "content-type": "image/png" }, body: blob });
        if (!r.ok) throw new Error(`Couldn't save the picture (${r.status}).`);
        const { file } = await r.json();
        return { file, ms: Math.round(performance.now() - t0) };
      },
    };
    // ---------- the live (moving) wallpaper: the same picture, redrawn ~12 times a second with the wind and water moving ----------
    let liveJob: (WallpaperJob & { wind?: number }) | null = null, paused = false, frames = 0, since = performance.now(), loop = 0;
    const live = location.search.includes("live=1");
    const frame = async () => {
      loop = 0;
      if (!liveJob || paused || !renderer) return;
      const t0 = performance.now();
      try {
        const motto = await mottoBitmap(liveJob.motto, renderer.W, renderer.H, liveJob.temp);
        const now = new Date();
        const city = liveJob.scene === "city" ? await cityInput(now, liveJob.weather, renderer.W) : null;
        renderer.render({ when: now, weather: liveJob.weather, motto, projects: liveJob.projects, time: t0 / 1000, wind: liveJob.wind ?? 0.2, events: eventsAt(liveJob.events, Date.now()), city });
        renderer.present();
        frames++;
      } catch (e) { window.__valley!.error = String((e as Error)?.message || e); return; }
      loop = window.setTimeout(frame, Math.max(4, 83 - (performance.now() - t0)));   // ~12 a second; timers, not animation frames, so it keeps going behind the icons
    };
    const coverSize = () => {
      const dpr = window.devicePixelRatio || 1, w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
      const W = Math.min(8192, Math.max(w, Math.round(h * 5120 / 2160)));
      return [W, Math.round(W * 2160 / 5120)];
    };
    if (live) {
      document.documentElement.classList.add("valley-live");
      window.addEventListener("resize", () => { if (liveJob) { const [w, h] = coverSize(); ensure(w, h); } });
    }
    (async () => {
      try { await ensure(640, 270); window.__valley!.ready = true; setStatus("Ready"); }
      catch (e) { window.__valley!.error = String((e as Error)?.message || e); setStatus(window.__valley!.error); }
    })();
    return () => { renderer?.dispose(); };
  }, []);
  return <div className="valley-page"><div ref={holder} className="valley-holder" /><p className="valley-status" id="valley-status">{status}</p></div>;
}
