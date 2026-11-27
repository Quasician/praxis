// The valley as your Windows wallpaper (3.4).
//   • Opt-in. Turning it on remembers how your desktop was (a slideshow of your Mottos folder, say); turning it off puts it back.
//   • A hidden window draws the picture (src/valley); this module picks the motto, says when to redraw, and hands the file to Windows.
//   • Your Mottos folder is only ever read. Pictures go to Praxis's own folder (two files, alternating).
//   • Redrawn every 10 minutes, on the hour with the next motto, when a star is lit in your sky, and when you come back to the PC.
import { app, BrowserWindow, powerMonitor, screen } from "electron";
import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { safeMottoName } from "../server/app";
import { currentWeather } from "./weather";
import { dayIcon, type SkyIcon, type ValleyWeather } from "../src/valley/weather";
import { DEFAULT_LAT, DEFAULT_LNG } from "../src/domain/sun";
import { CITY_FILES } from "../src/city/model";
import { dimOf } from "../src/domain/review";
import type { SkyConstellation } from "../src/domain/sky";
import NATIVE_CS from "./wallpaper-native.cs";

type Cfg = Record<string, unknown>;
export interface WallpaperDeps {
  readConfig(): Cfg; writeConfig(c: Cfg): void;
  baseUrl(): string; log(...a: unknown[]): void;
}
export interface Saved { status: number; wallpaper: string; folder: string; options: number; tick: number; position: number }
export interface WallpaperCfg {
  enabled?: boolean; folder?: string; live?: boolean;
  bag?: string[]; current?: { name: string; hour: string } | null;
  tags?: Record<string, string>; saved?: Saved | null;
  last?: { at: string; file: string; motto: string; ms: number } | null; error?: string | null;
  weather?: ValleyWeather | null; useWeather?: boolean; lat?: number; lng?: number;
  liveHow?: string | null;
  /** 3.9: the valley (drawn) or the city (paintings from the city kit folder). */
  scene?: "valley" | "city"; cityFolder?: string;
  /** 3.9: the warmest and coldest readings seen today (°C), so the high stays right after the forecast has moved on. */
  tempDay?: { date: string; hi: number; lo: number; seen?: Partial<Record<SkyIcon, number>> } | null;
}
export interface WallpaperState extends WallpaperCfg { windows: boolean; mottos: number; defaultFolder: string; city: { folder: string; found: number; total: number } }

const isWin = process.platform === "win32";

/** The helper program's file name for this version of its C# source (a new source gets a new file). */
export const NATIVE_EXE = `praxis-wall-${crypto.createHash("sha1").update(NATIVE_CS).digest("hex").slice(0, 12)}.exe`;

/** The helper program: the one shipped with the app, else one built once into Praxis's own folder.
 *  It is a windowed program, not a console one, so starting it never opens a terminal window (PowerShell, used before 3.9.3, could). */
let building: Promise<string> | null = null;
export function helperExe(log: WallpaperDeps["log"]): Promise<string> {
  const shipped = path.join(process.resourcesPath || "", "native", NATIVE_EXE);
  if (fs.existsSync(shipped)) return Promise.resolve(shipped);
  const dir = app.getPath("userData"), own = path.join(dir, NATIVE_EXE);
  if (fs.existsSync(own)) return Promise.resolve(own);
  // Only when the app was built without it (a development copy): compile it once. This one time may flash a window.
  building ||= new Promise<string>((resolve, reject) => {
    const src = path.join(dir, "praxis-wallpaper.cs"), tmp = path.join(dir, `praxis-wall-${process.pid}.tmp.exe`);
    const q = (x: string) => `'${x.replace(/'/g, "''")}'`;
    try { fs.writeFileSync(src, NATIVE_CS, "utf8"); } catch (e) { return reject(e); }
    log("wallpaper helper: not shipped with this copy, building it once");
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
      `$ErrorActionPreference='Stop'; Add-Type -TypeDefinition (Get-Content -LiteralPath ${q(src)} -Raw -Encoding UTF8) -OutputAssembly ${q(tmp)} -OutputType WindowsApplication; Move-Item -LiteralPath ${q(tmp)} -Destination ${q(own)} -Force`],
      { windowsHide: true, timeout: 90_000 }, (err, _out, stderr) => {
        if (err || !fs.existsSync(own)) return reject(new Error(`Couldn't build the wallpaper helper: ${(stderr || err?.message || "").toString().split("\n")[0].trim()}`));
        resolve(own);
      });
  });
  building.catch(() => { building = null; });
  return building;
}

/** Runs the helper with an action and gives back the line it printed. */
export async function helper(args: string[], log: WallpaperDeps["log"]): Promise<string> {
  if (!isWin) { log("wallpaper (not Windows): would run", args.join(" ")); return args[0] === "status" ? "{}" : "ok"; }
  const exe = await helperExe(log);
  return new Promise((resolve, reject) => {
    execFile(exe, args, { windowsHide: true, timeout: 45_000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).toString().split("\n").slice(0, 3).join(" ").trim()));
      resolve(stdout.toString().trim());
    });
  });
}

/** A colour mixed toward a dim blue-grey by k (0 = unchanged). */
function fade(hex: string, k: number) {
  if (!k) return hex;
  const to = [70, 78, 104], n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255];
  return "#" + c.map((v, i) => Math.round(v + (to[i] - v) * k).toString(16).padStart(2, "0")).join("");
}
const COLORS = ["#8fb4ff", "#8fe0b0", "#f0b75a", "#c9a8ff", "#ff9fb0", "#9fd8ff", "#b8c4e8"];
/** Your active projects from the sky record, as the renderer wants them. */
/** 3.7: the shooting star (for 3 hours after you finish "the one") and the aurora (after a week of kept commitments). */
function eventsOf(cfg: Cfg, now = Date.now()) {
  const r = cfg.rewards as { meteorAt?: string; aurora?: { until?: string } | null } | undefined;
  const meteorAt = r?.meteorAt && now - Date.parse(r.meteorAt) < 3 * 3600e3 && now >= Date.parse(r.meteorAt) ? r.meteorAt : null;
  const aurora = r?.aurora?.until && Date.parse(r.aurora.until) > now ? 1 : 0;
  return { meteorAt, aurora };
}
function projectsOf(cfg: Cfg) {
  const sky = cfg.sky as { cons?: Record<string, SkyConstellation> } | undefined;
  const live = Object.entries(sky?.cons || {}).filter(([, c]) => !c.finished && c.steps?.length).sort((a, b) => (b[1].since || "").localeCompare(a[1].since || "")).slice(0, 7);
  // 4.0: a project with no star lit for a while fades here too (its colour is mixed toward the night sky).
  return live.map(([id, c], i) => ({ id, seed: c.seed, color: fade(COLORS[i % COLORS.length], dimOf(c)), steps: c.steps.map((s) => ({ lit: !!s.done, min: s.min || 20 })) }));
}

export function createWallpaper(deps: WallpaperDeps) {
  let win: BrowserWindow | null = null;
  let timer: NodeJS.Timeout | null = null;
  let busy = false, lastKey = "", locked = false;
  const defaultFolder = path.join(app.getPath("pictures"), "Mottos");
  const defaultCity = path.join(app.getPath("pictures"), "Praxis city kit", "keyframes-5k");
  // 4.4: the valley is retired; the city is the wallpaper's only scene (an old "valley" setting is read as the city).
  const sceneOf = (_w: WallpaperCfg) => "city" as const;
  const cfgOf = (): WallpaperCfg => (deps.readConfig().wallpaper as WallpaperCfg) || {};
  const save = (patch: Partial<WallpaperCfg>) => { const c = deps.readConfig(); deps.writeConfig({ ...c, wallpaper: { ...((c.wallpaper as WallpaperCfg) || {}), ...patch } }); };
  const folderOf = (w: WallpaperCfg) => w.folder || defaultFolder;
  const mottos = (w: WallpaperCfg) => { try { return fs.readdirSync(folderOf(w)).filter((n) => safeMottoName(n)).sort(); } catch { return []; } };

  /** Resolves once the valley page in a window has loaded its land and trees. */
  async function waitReady(w: BrowserWindow) {
    const started = Date.now();
    for (;;) {
      if (w.isDestroyed()) throw new Error("The wallpaper window closed.");
      const st = await w.webContents.executeJavaScript("window.__valley ? (window.__valley.error ? 'error:' + window.__valley.error : window.__valley.ready ? 'ready' : 'wait') : 'wait'").catch(() => "wait");
      if (st === "ready") return;
      if (String(st).startsWith("error:")) throw new Error(String(st).slice(6));
      if (Date.now() - started > 60_000) throw new Error("The wallpaper took too long to load.");
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  function ensureWindow(): Promise<BrowserWindow> {
    return new Promise((resolve, reject) => {
      if (win && !win.isDestroyed()) return resolve(win);
      win = new BrowserWindow({ show: false, width: 640, height: 270, skipTaskbar: true, focusable: false, title: "Praxis valley",
        webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: false } });
      win.on("closed", () => { win = null; });
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (e) => e.preventDefault());
      win.loadURL(`${deps.baseUrl()}/?valley=1`).catch(reject);
      const started = Date.now();
      const wait = async () => {
        if (!win || win.isDestroyed()) return reject(new Error("The wallpaper window closed."));
        const st = await win.webContents.executeJavaScript("window.__valley ? (window.__valley.error ? 'error:' + window.__valley.error : window.__valley.ready ? 'ready' : 'wait') : 'wait'").catch(() => "wait");
        if (st === "ready") return resolve(win);
        if (String(st).startsWith("error:")) return reject(new Error(String(st).slice(6)));
        if (Date.now() - started > 60_000) return reject(new Error("The wallpaper took too long to load."));
        setTimeout(wait, 400);
      };
      win.webContents.once("did-finish-load", wait);
    });
  }

  /** The motto for this hour: the next one from a shuffled bag (none repeats until all have shown), preferring ones meant for this time of day. */
  function pickMotto(w: WallpaperCfg, now: Date) {
    const all = mottos(w);
    if (!all.length) return null;
    const hour = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()} ${now.getHours()}`;
    if (w.current && w.current.hour === hour && all.includes(w.current.name)) return w.current.name;
    let bag = (w.bag || []).filter((n) => all.includes(n));
    if (!bag.length) bag = shuffle(all.filter((n) => n !== w.current?.name).concat(w.current?.name && all.includes(w.current.name) ? [w.current.name] : []));
    const h = now.getHours(), want = h >= 5 && h < 11 ? "morning" : h >= 11 && h < 17 ? "day" : h >= 17 && h < 22 ? "evening" : "night";
    const idx = Math.max(0, bag.findIndex((n) => !w.tags?.[n] || w.tags[n] === want || w.tags[n] === "any"));
    const name = bag.splice(idx, 1)[0];
    save({ bag, current: { name, hour } });
    return name;
  }

  function size() {
    const d = screen.getPrimaryDisplay();
    const pw = Math.round(d.size.width * d.scaleFactor), ph = Math.round(d.size.height * d.scaleFactor);
    const width = Math.min(8192, Math.max(1280, Math.round(Math.max(pw, ph * 5120 / 2160))));
    return { width, height: Math.round(width * 2160 / 5120) };
  }

  // ---------- real weather (every 15 minutes) ----------
  let weatherAt = 0;
  async function refreshWeather(force = false) {
    const w = cfgOf();
    if (!w.enabled || w.useWeather === false) return;
    if (!force && Date.now() - weatherAt < 15 * 60_000) return;
    weatherAt = Date.now();
    try {
      const now = await currentWeather(w.lat ?? DEFAULT_LAT, w.lng ?? DEFAULT_LNG);
      const prev = cfgOf().weather;
      const today = new Date().toDateString(), td = cfgOf().tempDay;
      const seen = td && td.date === today ? td : null;
      // Each check (every 15 minutes) counts as a quarter of an hour of whatever it was doing outside.
      const tally = { ...(seen?.seen || {}) };
      if (now.icon) tally[now.icon] = (tally[now.icon] || 0) + .25;
      const tempDay = now.tempC === null ? (seen ? { ...seen, seen: tally } : null)
        : { date: today, hi: Math.max(now.tempC, seen?.hi ?? -99), lo: Math.min(now.tempC, seen?.lo ?? 99), seen: tally };
      // "at" is when Praxis read it (the station's own reading can already be a couple of hours old, and would expire minutes later).
      now.at = new Date().toISOString();
      save({ weather: now, tempDay });
      if (!prev || prev.kind !== now.kind || Math.abs((prev.wind || 0) - now.wind) > .2) { lastKey = ""; deps.log("weather", now.kind, now.text); }
    } catch (e) { deps.log("weather failed", (e as Error).message); }
  }
  const weatherNow = () => { const w = cfgOf(); const x = w.useWeather === false ? null : w.weather; return x && Date.now() - Date.parse(x.at) < 3 * 3600_000 ? x : null; };
  /** 3.9: now, today's high and today's low in °F, for the top-left corner (only with real weather on). */
  const tempNow = () => {
    const x = weatherNow();
    if (!x || x.tempC === null || x.tempC === undefined) return null;
    const td = cfgOf().tempDay, seen = td && td.date === new Date().toDateString() ? td : null;
    const his = [x.tempC, x.hiC, seen?.hi].filter((v): v is number => typeof v === "number"), los = [x.tempC, x.loC, seen?.lo].filter((v): v is number => typeof v === "number");
    const f = (c: number) => Math.round(c * 9 / 5 + 32);
    return { now: f(x.tempC), hi: f(Math.max(...his)), lo: f(Math.min(...los)), icon: dayIcon(x.icons, seen?.seen) || x.icon || null };
  };

  // ---------- the live (moving) wallpaper ----------
  let live: BrowserWindow | null = null, watcher: ChildProcess | null = null, onBattery = false, fullApp = false;
  /** Set when the moving wallpaper couldn't get behind the icons: don't try again at every redraw (until restart, or it's switched on again). */
  let liveFailed = false;
  /** True while the moving wallpaper's window is in place behind the icons. Setting the still wallpaper makes Windows rebuild the
   *  desktop layer, which destroys that window: so while this is true, redraws only feed the moving picture (4.0.1). */
  let liveAttached = false;
  const livePaused = () => locked || onBattery || fullApp;
  function syncPause() { if (live && !live.isDestroyed()) live.webContents.executeJavaScript(`window.__valley && window.__valley.pause(${livePaused()})`).catch(() => undefined); }
  async function startLive() {
    if (live && !live.isDestroyed()) return;
    const d = screen.getPrimaryDisplay(), b = d.bounds;
    // Until it is behind the desktop icons the window stays far off-screen: a full-screen black window in front of
    // everything, even for a second, looks like a terminal taking over the screen. The helper moves it into place.
    const off = isWin ? { x: -32000, y: -32000 } : { x: b.x, y: b.y };
    live = new BrowserWindow({ ...off, width: b.width, height: b.height, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, focusable: false, show: false, backgroundColor: "#1b2233", title: "Praxis live wallpaper", hasShadow: false,
      webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    live.on("page-title-updated", (e) => e.preventDefault());
    live.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    live.webContents.on("will-navigate", (e) => e.preventDefault());
    live.on("closed", () => {
      live = null; liveAttached = false;
      deps.log("live wallpaper window closed");
      // Explorer restarting takes the window with it: come back if the live wallpaper is still on.
      if (cfgOf().enabled && cfgOf().live && !liveFailed) setTimeout(() => startLive().catch(() => undefined), 5000);
    });
    await live.loadURL(`${deps.baseUrl()}/?valley=1&live=1`);
    await waitReady(live);
    live.showInactive();
    // Draw the first frame while it's still off-screen, so it never sits behind the icons as an empty dark rectangle
    // while the paintings load (4.0.1). Skipped when it's paused (a full-screen app in front, the screen locked).
    await feedLive();
    for (const t0 = Date.now(); !livePaused() && Date.now() - t0 < 15_000;) {
      if (!live || live.isDestroyed()) return;
      if (await live.webContents.executeJavaScript("!!(window.__valley && (window.__valley.drawn || window.__valley.error))").catch(() => false)) break;
      await new Promise((r) => setTimeout(r, 150));
    }
    if (!live || live.isDestroyed()) return;
    const hwnd = live.getNativeWindowHandle();
    const id = hwnd.length >= 8 ? hwnd.readBigUInt64LE(0).toString() : String(hwnd.readUInt32LE(0));
    try {
      const how = await helper(["attach", id, String(Math.round(b.width * d.scaleFactor)), String(Math.round(b.height * d.scaleFactor))], deps.log);
      if (how.startsWith("no-desktop")) throw new Error("the desktop window wasn't found");
      save({ liveHow: how });
      liveAttached = true;
      deps.log("live wallpaper attached", how);
      if (!isWin) live.hide();
    } catch (e) { deps.log("live wallpaper couldn't attach", (e as Error).message); save({ error: "The moving wallpaper couldn't get behind your desktop icons; showing the still picture instead." }); liveFailed = true; lastKey = ""; stopLive(); return; }
    await feedLive();
    if (isWin && !watcher) {
      // One small helper keeps an eye on whether a full-screen app is in front (then the valley holds still).
      watcher = spawn(await helperExe(deps.log), ["watch", String(process.pid)], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
      watcher.stdout?.on("data", (b: Buffer) => { const last = b.toString().trim().split(/\s+/).pop(); const full = last === "full"; if (full !== fullApp) { fullApp = full; syncPause(); } });
      watcher.on("exit", () => { watcher = null; });
    }
  }
  function stopLive() {
    if (watcher) { watcher.kill(); watcher = null; }
    const w = live; live = null; liveAttached = false;
    if (w && !w.isDestroyed()) { w.removeAllListeners("closed"); w.destroy(); }
  }
  async function feedLive() {
    if (!live || live.isDestroyed()) return;
    const now = new Date(), wx = weatherNow();
    const job = { when: now.toISOString(), weather: wx?.kind || "clear", wind: wx?.wind ?? 0.2, motto: cfgOf().current?.name || pickMotto(cfgOf(), now), projects: projectsOf(deps.readConfig()), events: eventsOf(deps.readConfig()), scene: sceneOf(cfgOf()), temp: tempNow() };
    await live.webContents.executeJavaScript(`window.__valley.live(${JSON.stringify(job)})`).catch((e) => deps.log("live feed failed", e?.message || e));
    syncPause();
  }
  powerMonitor.on("on-battery", () => { onBattery = true; syncPause(); });
  powerMonitor.on("on-ac", () => { onBattery = false; syncPause(); });
  try { onBattery = powerMonitor.isOnBatteryPower(); } catch { /* older Electron */ }

  async function render(force = false) {
    const w = cfgOf();
    if (!w.enabled || busy || (locked && !force)) return;
    const now = new Date();
    const motto = pickMotto(cfgOf(), now);
    const projects = projectsOf(deps.readConfig()), events = eventsOf(deps.readConfig());
    await refreshWeather();
    const wx = weatherNow(), temp = tempNow();
    const key = `${sceneOf(w)}|${temp ? `${temp.now}/${temp.hi}/${temp.lo}/${temp.icon}` : ""}|${motto}|${Math.floor((now.getHours() * 60 + now.getMinutes()) / 10)}|${now.toDateString()}|${JSON.stringify(projects.map((p) => p.steps.filter((s) => s.lit).length))}|${wx?.kind}|${Math.round((wx?.wind ?? 0) * 4)}|${events.meteorAt || ""}|${events.aurora}`;
    if (!force && key === lastKey) return;
    busy = true;
    try {
      // The moving wallpaper is up: give it the new motto, weather and stars, and leave the still wallpaper alone.
      // (Setting it would destroy the moving window, which then had to be put back, at every redraw.)
      if (cfgOf().live && live && !live.isDestroyed() && liveAttached) {
        await feedLive();
        lastKey = key;
        save({ last: { at: now.toISOString(), file: cfgOf().last?.file || "", motto: motto || "", ms: 0 }, error: null });
        deps.log("wallpaper (moving)", sceneOf(w), motto, temp ? `${temp.now}F` : wx ? "no temperature" : "no weather");
        return;
      }
      const v = await ensureWindow();
      const job = { when: now.toISOString(), weather: wx?.kind || "clear", motto, projects, events, scene: sceneOf(w), temp, ...size() };
      const out = await v.webContents.executeJavaScript(`window.__valley.wallpaper(${JSON.stringify(job)})`) as { file: string; ms: number };
      await helper(["set", out.file, "4"], deps.log);
      lastKey = key;
      save({ last: { at: now.toISOString(), file: out.file, motto: motto || "", ms: out.ms }, error: null });
      if (cfgOf().live) { if (!live) { if (!liveFailed) startLive().catch((e) => deps.log("live wallpaper failed", e?.message || e)); } else await feedLive(); }
      deps.log("wallpaper", sceneOf(w), motto, out.ms + "ms", temp ? `${temp.now}F` : wx ? "no temperature" : "no weather");
    } catch (e) {
      const msg = (e as Error)?.message || String(e);
      deps.log("wallpaper failed", msg);
      save({ error: msg.slice(0, 300) });
    } finally { busy = false; }
  }

  function startTimer() {
    if (timer) return;
    timer = setInterval(() => render(false), 60_000);
    setTimeout(() => render(true), 2500);
  }
  function stopTimer() { if (timer) clearInterval(timer); timer = null; }
  powerMonitor.on("lock-screen", () => { locked = true; syncPause(); });
  powerMonitor.on("unlock-screen", () => { locked = false; lastKey = ""; syncPause(); setTimeout(() => render(true), 1500); });
  powerMonitor.on("resume", () => { lastKey = ""; setTimeout(() => render(true), 4000); });
  screen.on("display-metrics-changed", () => { lastKey = ""; });

  async function enable(folder?: string) {
    let saved: Saved | null = cfgOf().saved || null;
    if (!cfgOf().enabled) {
      try { const s = JSON.parse(await helper(["status"], deps.log) || "{}"); if (s && typeof s === "object" && "status" in s) saved = s as Saved; }
      catch (e) { deps.log("couldn't read the current wallpaper", (e as Error).message); }
    }
    // Your slideshow folder is where your mottos already are; otherwise Pictures\Mottos.
    const f = folder || cfgOf().folder || (saved?.folder && fs.existsSync(saved.folder) ? saved.folder : "") || defaultFolder;
    save({ enabled: true, folder: f, saved, error: null });
    lastKey = "";
    startTimer();
    await render(true);
    tagMottos().catch(() => undefined);
    return state();
  }
  /** Asks Claude once which time of day suits each motto (from its file name), for mottos it hasn't seen. Skipped without Claude. */
  async function tagMottos() {
    const w = cfgOf();
    const names = mottos(w).filter((n) => !w.tags?.[n]);
    if (!names.length) return;
    const r = await fetch(`${deps.baseUrl()}/api/claude/motto-tags`, { method: "POST", headers: { "x-planner": "1", "content-type": "application/json" }, body: JSON.stringify({ names }) });
    if (!r.ok) return;
    const { tags } = await r.json() as { tags: Record<string, string> };
    save({ tags: { ...(cfgOf().tags || {}), ...tags } });
    deps.log("mottos tagged", Object.keys(tags).length);
  }
  async function disable() {
    stopTimer();
    stopLive();
    const s = cfgOf().saved;
    let error: string | null = null;
    try {
      if (s && (s.status & 2) && s.folder) await helper(["slideshow", s.folder, String(s.options ?? 1), String(s.tick || 3_600_000), String(s.position ?? 4)], deps.log);
      else if (s?.wallpaper && fs.existsSync(s.wallpaper)) await helper(["set", s.wallpaper, String(s.position ?? 4)], deps.log);
    } catch (e) { error = `Couldn't put your old wallpaper back: ${(e as Error).message}`; deps.log(error); }
    save({ enabled: false, error });
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
    return state();
  }
  function state(): WallpaperState {
    const w = cfgOf();
    const cf = w.cityFolder || defaultCity;
    let found = 0;
    try { const have = new Set(fs.readdirSync(cf)); found = CITY_FILES.filter((n) => have.has(`${n}.png`)).length; } catch { /* no kit yet */ }
    return { ...w, windows: isWin, mottos: mottos(w).length, defaultFolder, city: { folder: cf, found, total: CITY_FILES.length } };
  }

  return {
    start() { if (cfgOf().enabled) { startTimer(); tagMottos().catch(() => undefined); } },
    stop() { stopLive(); },
    enable, disable, state,
    refresh: async () => { lastKey = ""; await refreshWeather(true); await render(true); return state(); },
    setLive: async (on: boolean) => { liveFailed = false; save({ live: on, error: null }); if (on && cfgOf().enabled) await startLive(); if (!on) { stopLive(); save({ liveHow: null }); lastKey = ""; await render(true); } return state(); },
    setWeather: async (on: boolean) => { save({ useWeather: on }); lastKey = ""; if (on) await refreshWeather(true); await render(true); return state(); },
    setCityFolder: async (cityFolder: string) => { save({ cityFolder }); lastKey = ""; if (cfgOf().enabled) await render(true); return state(); },
    setFolder: async (folder: string) => { save({ folder, bag: [], current: null }); lastKey = ""; if (cfgOf().enabled) await render(true); return state(); },
    window: () => win,
  };
}

function shuffle<T>(a: T[]) { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
