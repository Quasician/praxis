// The wallpaper's own page (?valley=1). The desktop app keeps it in a hidden window and asks it for pictures;
// tests and the year sheet drive it the same way, through window.__valley.
import { useEffect, useRef, useState } from "react";
import { loadAssets, ValleyRenderer, type RenderOpts, type SkyProject, type ValleyAssets } from "../valley/render";
import type { Weather } from "../valley/model";

export interface WallpaperJob { when: string; weather?: Weather; motto?: string | null; projects?: SkyProject[]; width?: number; height?: number; save?: boolean }
declare global {
  interface Window {
    __valley?: {
      ready: boolean;
      render(o: Omit<RenderOpts, "when" | "motto"> & { when: string; motto?: string | null; width?: number; height?: number }): Promise<{ ms: number; box: number[] | null; constellations: number; phase: string; doy: number }>;
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
async function mottoBitmap(name: string | null | undefined, w: number, h: number) {
  if (!name) return null;
  const key = `${name}|${w}x${h}`;
  if (mottoCache.has(key)) return mottoCache.get(key)!;
  const url = /^(blob:|data:|https?:|\/)/.test(name) ? name : `/api/valley/motto?name=${encodeURIComponent(name)}`;
  const r = await fetch(url, { headers: { "x-planner": "1" } });
  if (!r.ok) throw new Error(`Couldn't open the motto (${r.status}).`);
  const bmp = await createImageBitmap(await r.blob(), { resizeWidth: w, resizeHeight: h, resizeQuality: "high", premultiplyAlpha: "none", colorSpaceConversion: "none" });
  if (mottoCache.size > 3) { for (const b of mottoCache.values()) b.close(); mottoCache.clear(); }
  mottoCache.set(key, bmp);
  return bmp;
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
        const motto = await mottoBitmap(o.motto, w, h);
        const info = r.render({ ...o, when: new Date(o.when), motto });
        r.present();
        const phase = info.scene.light > .8 ? "day" : info.scene.up ? "low sun" : "night";
        return { ms: Math.round(info.ms), box: info.box, constellations: info.constellations, phase, doy: info.scene.season.doy };
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
        await window.__valley!.render({ when: job.when, weather: job.weather, motto: job.motto, projects: job.projects, width: job.width, height: job.height });
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
        const motto = await mottoBitmap(liveJob.motto, renderer.W, renderer.H);
        renderer.render({ when: new Date(), weather: liveJob.weather, motto, projects: liveJob.projects, time: t0 / 1000, wind: liveJob.wind ?? 0.2 });
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
