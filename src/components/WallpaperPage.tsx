// The wallpaper's own page (?wallpaper=1): the living sky (5.1). The desktop app keeps it in a hidden window and asks it for
// still pictures, and shows it behind the desktop icons as the moving wallpaper; tests drive it the same way, through
// window.__wallpaper.
import { useEffect, useRef, useState } from "react";
import { LivingSkyRenderer, prepareMotto, precipLayer, type MottoArt } from "../livingsky/render";
import { skyWeather, weatherLook, type ProjectIn, type History } from "../livingsky/model";
import type { SkyIcon, Weather } from "../livingsky/weather";

/** 3.7: the rewards in the sky. meteorAt: when you finished "the one"; aurora: 1 while it's out. */
export interface JobEvents { meteorAt?: string | null; aurora?: number }
/** 3.9: now / today's high / today's low in °F, shown in the top-left corner (null: not shown). */
export interface JobTemp { now: number; hi: number; lo: number; icon?: SkyIcon | null }
/** One of your projects, for the sky: its steps (lit when done) and how faded it is (0..1). */
export interface JobProject extends ProjectIn { color?: string }
export interface WallpaperJob {
  when: string; weather?: Weather; icon?: SkyIcon | null; wind?: number; motto?: string | null;
  projects?: JobProject[]; history?: History | null; events?: JobEvents; temp?: JobTemp | null;
  lat?: number; lng?: number; width?: number; height?: number;
  /** A still picture (the Windows wallpaper file): rain and snow are drawn into it. */
  still?: boolean;
}
const eventsAt = (e: JobEvents | undefined, at: number) => (e ? { aurora: e.aurora || 0, meteorAge: e.meteorAt ? (at - Date.parse(e.meteorAt)) / 1000 : null } : undefined);
declare global {
  interface Window {
    __wallpaper?: {
      ready: boolean;
      render(job: WallpaperJob): Promise<{ ms: number; phase: string; sky: string }>;
      dataURL(type?: string, quality?: number, scale?: number): string;
      wallpaper(job: WallpaperJob): Promise<{ file: string; ms: number }>;
      live(job: WallpaperJob): Promise<void>;
      pause(on: boolean): void;
      fps(): number;
      /** 4.0.1: the moving wallpaper has drawn at least one frame (the desktop app waits for this before putting it behind the icons). */
      drawn?: boolean;
      error?: string;
    };
  }
}

// The motto: the lettering from your motto picture, cut out of its black and fitted to the sky's motto zone.
const mottos = new Map<string, Promise<MottoArt>>();
function mottoArt(name: string | null | undefined): Promise<MottoArt | null> {
  if (!name) return Promise.resolve(null);
  let p = mottos.get(name);
  if (!p) {
    const url = /^(blob:|data:|https?:|\/)/.test(name) ? name : `/api/wallpaper/motto?name=${encodeURIComponent(name)}`;
    p = (async () => {
      const r = await fetch(url, { headers: { "x-planner": "1" } });
      if (!r.ok) throw new Error(`Couldn't open the motto (${r.status}).`);
      return prepareMotto(await r.blob());
    })();
    // Keep the last few (one an hour); drop failures so they're tried again.
    if (mottos.size > 3) { const [old] = mottos.keys(); mottos.get(old)!.then((m) => m.bmp.close()).catch(() => undefined); mottos.delete(old); }
    mottos.set(name, p);
    p.catch(() => mottos.delete(name));
  }
  return p;
}

export function WallpaperPage() {
  const holder = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("Loading the sky…");
  useEffect(() => {
    document.documentElement.classList.add("wallpaper-doc");
    let sky: LivingSkyRenderer | null = null, canvas: HTMLCanvasElement | null = null;
    const ensure = (w: number, h: number) => {
      if (!sky || sky.W !== w || sky.H !== h) {
        sky?.dispose();
        canvas?.remove();
        canvas = document.createElement("canvas");
        canvas.id = "sky-canvas";
        holder.current?.prepend(canvas);
        sky = new LivingSkyRenderer(canvas, w, h);
      }
      return sky;
    };
    const draw = async (o: WallpaperJob) => {
      const w = o.width || 5120, h = o.height || Math.round(w * 2160 / 5120);
      const r = ensure(w, h);
      const motto = await mottoArt(o.motto);
      const info = r.render({ when: new Date(o.when), weather: o.weather, icon: o.icon, wind: o.wind, motto, projects: o.projects,
        history: o.history, temp: o.temp, events: eventsAt(o.events, Date.parse(o.when)), lat: o.lat, lng: o.lng, still: o.still });
      return { ms: info.ms, phase: info.phase, sky: `${info.weather}, ${info.wind} mph` };
    };
    window.__wallpaper = {
      ready: false,
      render: draw,
      dataURL(type = "image/jpeg", quality = .92, scale = 1) {
        if (!canvas) return "";
        if (scale === 1) return canvas.toDataURL(type, quality);
        const s = document.createElement("canvas"); s.width = Math.round(canvas.width * scale); s.height = Math.round(canvas.height * scale);
        const g = s.getContext("2d")!; g.imageSmoothingQuality = "high"; g.drawImage(canvas, 0, 0, s.width, s.height);
        return s.toDataURL(type, quality);
      },
      async live(job) { liveJob = job; tick(); },
      pause(on) {
        if (on === paused) return;   // the desktop app says this after every update; only a change matters
        paused = on;
        if (precip) { if (on) precip.anim.pause(); else precip.anim.play(); }
        clearTimeout(timer); timer = 0;
        if (on || !liveJob) return;
        // Coming back (a full-screen app closed, the PC unlocked): the picture on screen is kept. If it's out of date, the
        // new one is drawn a moment later, not in the middle of the window switch that revealed the desktop.
        timer = window.setTimeout(tick, Date.now() - drawnAt > 60_000 ? 1500 : 60_000 - (Date.now() % 60_000) + 250);
      },
      fps() { const s = (performance.now() - since) / 1000; const f = frames / Math.max(1, s); frames = 0; since = performance.now(); return Math.round(f * 10) / 10; },
      /** Draws one wallpaper and hands it to the desktop app, which saves it and sets it. */
      async wallpaper(job) {
        const t0 = performance.now();
        await draw({ ...job, still: true });
        const blob = await new Promise<Blob>((res, rej) => canvas!.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't make the picture."))), "image/png"));
        const r = await fetch("/api/wallpaper/frame", { method: "POST", headers: { "x-planner": "1", "content-type": "image/png" }, body: blob });
        if (!r.ok) throw new Error(`Couldn't save the picture (${r.status}).`);
        const { file } = await r.json();
        return { file, ms: Math.round(performance.now() - t0) };
      },
    };

    // ---------- the moving wallpaper: one new picture a minute, and nothing in between ----------
    // The sun, moon, stars and clouds move slowly enough that a fresh frame each minute looks continuous; between frames the
    // window shows a still picture, so switching windows on the desktop never waits on the wallpaper. Only rain or snow moves
    // continuously, as a ready-made layer the graphics card slides along (no drawing, ~25 steps a second).
    let liveJob: WallpaperJob | null = null, paused = false, frames = 0, since = performance.now();
    let timer = 0, gen = 0, drawnAt = 0;
    let precip: { el: HTMLCanvasElement; anim: Animation; key: string } | null = null;
    const syncPrecip = () => {
      const job = liveJob, r = sky;
      const look = job && r ? weatherLook(skyWeather(job.icon, job.weather)) : null;
      const want = look?.rain ? "rain" as const : look?.snow ? "snow" as const : null;
      const windMph = Math.round((job?.wind ?? 0.25) * 25);
      const key = want && r ? `${want}|${windMph}|${r.W}x${r.H}` : "";
      if (precip && precip.key === key) { if (paused) precip.anim.pause(); else precip.anim.play(); return; }
      if (precip) { precip.anim.cancel(); precip.el.remove(); precip = null; }
      if (!want || !r) return;
      const layer = precipLayer(want, r.W, r.H, windMph), dpr = window.devicePixelRatio || 1, el = layer.canvas;
      el.className = "sky-precip";
      Object.assign(el.style, { left: `${-layer.dx / dpr}px`, top: `${-layer.dy / dpr}px`, width: `${el.width / dpr}px`, height: `${el.height / dpr}px` });
      holder.current?.appendChild(el);
      const anim = el.animate([{ transform: "translate(0px, 0px)" }, { transform: `translate(${layer.dx / dpr}px, ${layer.dy / dpr}px)` }],
        { duration: layer.ms, iterations: Infinity, easing: `steps(${Math.max(2, Math.round(layer.ms / 1000 * layer.fps))}, end)` });
      if (paused) anim.pause();
      precip = { el, anim, key };
    };
    // One drawing at a time: each tick bumps the generation, and an older one that finishes late stops instead of scheduling another.
    const tick = async () => {
      clearTimeout(timer); timer = 0;
      if (!liveJob || paused) { syncPrecip(); return; }
      const g = ++gen;
      const [w, h] = coverSize();
      try {
        await draw({ ...liveJob, when: new Date().toISOString(), width: w, height: h, still: false });
        if (g !== gen) return;
        frames++; drawnAt = Date.now(); window.__wallpaper!.drawn = true;
      } catch (e) { window.__wallpaper!.error = String((e as Error)?.message || e); }
      if (g !== gen) return;
      syncPrecip();
      if (!paused) timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 250);
    };
    const coverSize = () => {
      const dpr = window.devicePixelRatio || 1, w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
      const W = Math.min(8192, Math.max(w, Math.round(h * 5120 / 2160)));
      return [W, Math.round(W * 2160 / 5120)];
    };
    if (location.search.includes("live=1")) {
      document.documentElement.classList.add("wallpaper-live");
      let resizeAt = 0;
      // Wait for the size to settle (Windows can send several while the desktop rebuilds), then redraw once.
      window.addEventListener("resize", () => { if (!liveJob) return; clearTimeout(resizeAt); resizeAt = window.setTimeout(tick, 400); });
    }
    (async () => {
      try { await document.fonts?.ready; window.__wallpaper!.ready = true; setStatus("Ready"); }
      catch (e) { window.__wallpaper!.error = String((e as Error)?.message || e); setStatus(window.__wallpaper!.error); }
    })();
    return () => { sky?.dispose(); clearTimeout(timer); precip?.anim.cancel(); };
  }, []);
  return <div className="wallpaper-page"><div ref={holder} className="wallpaper-holder" /><p className="wallpaper-status" id="wallpaper-status">{status}</p></div>;
}
