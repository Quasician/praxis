// The valley as your Windows wallpaper (3.4).
//   • Opt-in. Turning it on remembers how your desktop was (a slideshow of your Mottos folder, say); turning it off puts it back.
//   • A hidden window draws the picture (src/valley); this module picks the motto, says when to redraw, and hands the file to Windows.
//   • Your Mottos folder is only ever read. Pictures go to Praxis's own folder (two files, alternating).
//   • Redrawn every 10 minutes, on the hour with the next motto, when a star is lit in your sky, and when you come back to the PC.
import { app, BrowserWindow, powerMonitor, screen } from "electron";
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import { safeMottoName } from "../server/app";
import { currentWeather } from "./weather";
import type { ValleyWeather } from "../src/valley/weather";
import { DEFAULT_LAT, DEFAULT_LNG } from "../src/domain/sun";

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
}
export interface WallpaperState extends WallpaperCfg { windows: boolean; mottos: number; defaultFolder: string }

const isWin = process.platform === "win32";
const PS1 = String.raw`param([string]$Action, [string]$Path = "", [string]$Folder = "", [int]$Tick = 3600000, [int]$Options = 1, [int]$Position = 4)
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace PraxisWall {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IShellItem {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppv);
    void GetParent(out IShellItem ppsi);
    void GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
    void GetAttributes(uint sfgaoMask, out uint psfgaoAttribs);
    void Compare(IShellItem psi, uint hint, out int piOrder);
  }
  [ComImport, Guid("b63ea76d-1f85-456f-a19c-48159efa858b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IShellItemArray {
    void BindToHandler(IntPtr pbc, ref Guid bhid, ref Guid riid, out IntPtr ppvOut);
    void GetPropertyStore(int flags, ref Guid riid, out IntPtr ppv);
    void GetPropertyDescriptionList(IntPtr keyType, ref Guid riid, out IntPtr ppv);
    void GetAttributes(int attribFlags, uint sfgaoMask, out uint psfgaoAttribs);
    void GetCount(out uint pdwNumItems);
    void GetItemAt(uint dwIndex, out IShellItem ppsi);
    void EnumItems(out IntPtr ppenumShellItems);
  }
  [ComImport, Guid("B92B56A9-8B55-4E14-9A89-0199BBB6F93B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IDesktopWallpaper {
    void SetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitorID, [MarshalAs(UnmanagedType.LPWStr)] string wallpaper);
    [return: MarshalAs(UnmanagedType.LPWStr)] string GetWallpaper([MarshalAs(UnmanagedType.LPWStr)] string monitorID);
    [return: MarshalAs(UnmanagedType.LPWStr)] string GetMonitorDevicePathAt(uint monitorIndex);
    uint GetMonitorDevicePathCount();
    RECT GetMonitorRECT([MarshalAs(UnmanagedType.LPWStr)] string monitorID);
    void SetBackgroundColor(uint color);
    uint GetBackgroundColor();
    void SetPosition(int position);
    int GetPosition();
    void SetSlideshow(IShellItemArray items);
    IShellItemArray GetSlideshow();
    void SetSlideshowOptions(int options, uint slideshowTick);
    void GetSlideshowOptions(out int options, out uint slideshowTick);
    void AdvanceSlideshow([MarshalAs(UnmanagedType.LPWStr)] string monitorID, int direction);
    int GetStatus();
    void Enable([MarshalAs(UnmanagedType.Bool)] bool enable);
  }
  [ComImport, Guid("C2CF3110-460E-4fc1-B9D0-8A1C0C9CC4BD")] public class DesktopWallpaperClass {}
  public static class W {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName(string pszPath, IntPtr pbc, ref Guid riid, out IShellItem ppv);
    [DllImport("shell32.dll", PreserveSig = false)]
    static extern void SHCreateShellItemArrayFromShellItem(IShellItem psi, ref Guid riid, out IShellItemArray ppv);
    static IDesktopWallpaper D() { return (IDesktopWallpaper)new DesktopWallpaperClass(); }
    public static string[] Status() {
      var d = D();
      string status = "0", wall = "", folder = "", opts = "0", tick = "0", pos = "4";
      try { status = d.GetStatus().ToString(); } catch {}
      try { wall = d.GetWallpaper(null) ?? ""; } catch {}
      try { var a = d.GetSlideshow(); uint n; a.GetCount(out n); if (n > 0) { IShellItem it; a.GetItemAt(0, out it); string s; it.GetDisplayName(0x80058000, out s); folder = s ?? ""; } } catch {}
      try { int o; uint t; d.GetSlideshowOptions(out o, out t); opts = o.ToString(); tick = t.ToString(); } catch {}
      try { pos = d.GetPosition().ToString(); } catch {}
      return new string[] { status, wall, folder, opts, tick, pos };
    }
    public static void Set(string path, int position) { var d = D(); d.SetPosition(position); d.SetWallpaper(null, path); }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string name);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string name);
    [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint timeout, out IntPtr result);
    [DllImport("user32.dll")] static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MONITORINFO mi);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, System.Text.StringBuilder sb, int n);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr ctx);
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(POINT pt, uint flags);
    [DllImport("user32.dll")] static extern bool ScreenToClient(IntPtr h, ref POINT p);

    /** Puts a window behind the desktop icons, over the wallpaper, covering the main screen. */
    public static string Attach(long hwnd, int w, int h) {
      // Real pixels on every screen (per-monitor DPI aware), so positions aren't scaled behind our back.
      try { if (SetThreadDpiAwarenessContext(new IntPtr(-4)) == IntPtr.Zero) SetProcessDPIAware(); } catch { SetProcessDPIAware(); }
      IntPtr me = new IntPtr(hwnd), r;
      IntPtr progman = FindWindow("Progman", null);
      if (progman == IntPtr.Zero) return "no-desktop";
      SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(1), 0, 1000, out r);
      SendMessageTimeout(progman, 0x052C, IntPtr.Zero, IntPtr.Zero, 0, 1000, out r);
      IntPtr target = IntPtr.Zero; string how = "";
      // Before Windows 11 24H2: a WorkerW next to the one that holds the icons.
      EnumWindows(delegate (IntPtr top, IntPtr l) {
        if (FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero) { IntPtr ww = FindWindowEx(IntPtr.Zero, top, "WorkerW", null); if (ww != IntPtr.Zero) target = ww; }
        return true;
      }, IntPtr.Zero);
      if (target != IntPtr.Zero) how = "workerw";
      // Windows 11 24H2 and later: the WorkerW lives inside Progman, under the icons.
      if (target == IntPtr.Zero) { target = FindWindowEx(progman, IntPtr.Zero, "WorkerW", null); if (target != IntPtr.Zero) how = "progman-workerw"; }
      if (target == IntPtr.Zero) { target = progman; how = "progman"; }
      SetParent(me, target);
      // Cover the main screen exactly: take its rectangle on the desktop and convert it into the parent's own coordinates
      // (the parent isn't always at the desktop's corner, so offsetting by the virtual screen alone can land it off to one side).
      var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
      POINT o = new POINT(); o.X = 0; o.Y = 0;
      int x, y;
      if (GetMonitorInfo(MonitorFromPoint(o, 1), ref mi)) {
        POINT p = new POINT(); p.X = mi.rcMonitor.Left; p.Y = mi.rcMonitor.Top;
        ScreenToClient(target, ref p);
        x = p.X; y = p.Y; w = mi.rcMonitor.Right - mi.rcMonitor.Left; h = mi.rcMonitor.Bottom - mi.rcMonitor.Top;
      } else { x = -GetSystemMetrics(76); y = -GetSystemMetrics(77); }
      SetWindowPos(me, IntPtr.Zero, x, y, w, h, 0x0004 | 0x0010 | 0x0040);
      // Measure where it actually landed on screen and nudge it until it matches the main screen
      // (the parent's coordinates can be offset or DPI-scaled in ways a single conversion gets wrong).
      int tl = mi.rcMonitor.Left, tt = mi.rcMonitor.Top, tw = mi.rcMonitor.Right - mi.rcMonitor.Left, th = mi.rcMonitor.Bottom - mi.rcMonitor.Top;
      if (tw > 0 && th > 0) for (int i = 0; i < 4; i++) {
        RECT got; if (!GetWindowRect(me, out got)) break;
        int gw = got.Right - got.Left, gh = got.Bottom - got.Top;
        if (got.Left == tl && got.Top == tt && gw == tw && gh == th) break;
        if (gw > 0 && gh > 0) { w = (int)Math.Round((double)w * tw / gw); h = (int)Math.Round((double)h * th / gh); }
        x += tl - got.Left; y += tt - got.Top;
        SetWindowPos(me, IntPtr.Zero, x, y, w, h, 0x0004 | 0x0010 | 0x0040);
      }
      if (how == "progman") { IntPtr dv = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null); if (dv != IntPtr.Zero) SetWindowPos(me, dv, x, y, w, h, 0x0010 | 0x0040); }
      return how + " " + x + "," + y + " " + w + "x" + h;
    }
    /** "full" when the window in front covers its whole screen (a game, a full-screen video), else "normal". */
    public static string Foreground() {
      IntPtr f = GetForegroundWindow();
      if (f == IntPtr.Zero) return "normal";
      var sb = new System.Text.StringBuilder(256); GetClassName(f, sb, 256);
      string c = sb.ToString();
      if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd") return "normal";
      RECT wr; if (!GetWindowRect(f, out wr)) return "normal";
      var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
      if (!GetMonitorInfo(MonitorFromWindow(f, 2), ref mi)) return "normal";
      return (wr.Left <= mi.rcMonitor.Left && wr.Top <= mi.rcMonitor.Top && wr.Right >= mi.rcMonitor.Right && wr.Bottom >= mi.rcMonitor.Bottom) ? "full" : "normal";
    }
    public static void Slideshow(string folder, int options, uint tick, int position) {
      Guid iidItem = typeof(IShellItem).GUID, iidArr = typeof(IShellItemArray).GUID;
      IShellItem item; SHCreateItemFromParsingName(folder, IntPtr.Zero, ref iidItem, out item);
      IShellItemArray arr; SHCreateShellItemArrayFromShellItem(item, ref iidArr, out arr);
      var d = D(); d.SetPosition(position); d.SetSlideshow(arr); d.SetSlideshowOptions(options, tick);
    }
  }
}
"@
switch ($Action) {
  "status" { $s = [PraxisWall.W]::Status(); [ordered]@{ status = [int]$s[0]; wallpaper = $s[1]; folder = $s[2]; options = [int]$s[3]; tick = [int64]$s[4]; position = [int]$s[5] } | ConvertTo-Json -Compress }
  "set" { [PraxisWall.W]::Set($Path, $Position); "ok" }
  "slideshow" { [PraxisWall.W]::Slideshow($Folder, $Options, [uint32]$Tick, $Position); "ok" }
  "attach" { [PraxisWall.W]::Attach([int64]$Path, $Tick, $Options) }
  "watch" { while ($true) { [Console]::Out.WriteLine([PraxisWall.W]::Foreground()); [Console]::Out.Flush(); Start-Sleep -Milliseconds 2000 } }
}
`;

function powershell(args: string[], log: WallpaperDeps["log"]): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!isWin) { log("wallpaper (not Windows): would run", args.join(" ")); return resolve(args[1] === "status" ? "{}" : "ok"); }
    const file = path.join(app.getPath("userData"), "praxis-wallpaper.ps1");
    try { if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== PS1) fs.writeFileSync(file, PS1, "utf8"); } catch (e) { return reject(e); }
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file, ...args],
      { windowsHide: true, timeout: 45_000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message).toString().split("\n").slice(0, 3).join(" ").trim()));
        resolve(stdout.toString().trim());
      });
  });
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
  const sky = cfg.sky as { cons?: Record<string, { name: string; steps: { done?: string; min: number }[]; finished?: string; since: string; seed?: string }> } | undefined;
  const live = Object.entries(sky?.cons || {}).filter(([, c]) => !c.finished && c.steps?.length).sort((a, b) => (b[1].since || "").localeCompare(a[1].since || "")).slice(0, 7);
  return live.map(([id, c], i) => ({ id, seed: c.seed, color: COLORS[i % COLORS.length], steps: c.steps.map((s) => ({ lit: !!s.done, min: s.min || 20 })) }));
}

export function createWallpaper(deps: WallpaperDeps) {
  let win: BrowserWindow | null = null;
  let timer: NodeJS.Timeout | null = null;
  let busy = false, lastKey = "", locked = false;
  const defaultFolder = path.join(app.getPath("pictures"), "Mottos");
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
      save({ weather: now });
      if (!prev || prev.kind !== now.kind || Math.abs((prev.wind || 0) - now.wind) > .2) { lastKey = ""; deps.log("weather", now.kind, now.text); }
    } catch (e) { deps.log("weather failed", (e as Error).message); }
  }
  const weatherNow = () => { const w = cfgOf(); const x = w.useWeather === false ? null : w.weather; return x && Date.now() - Date.parse(x.at) < 3 * 3600_000 ? x : null; };

  // ---------- the live (moving) wallpaper ----------
  let live: BrowserWindow | null = null, watcher: ChildProcess | null = null, onBattery = false, fullApp = false;
  const livePaused = () => locked || onBattery || fullApp;
  function syncPause() { if (live && !live.isDestroyed()) live.webContents.executeJavaScript(`window.__valley && window.__valley.pause(${livePaused()})`).catch(() => undefined); }
  async function startLive() {
    if (live && !live.isDestroyed()) return;
    const d = screen.getPrimaryDisplay(), b = d.bounds;
    live = new BrowserWindow({ x: b.x, y: b.y, width: b.width, height: b.height, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, focusable: false, show: false, backgroundColor: "#000000", title: "Praxis live wallpaper", hasShadow: false,
      webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    live.on("page-title-updated", (e) => e.preventDefault());
    live.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    live.webContents.on("will-navigate", (e) => e.preventDefault());
    live.on("closed", () => {
      live = null;
      // Explorer restarting takes the window with it: come back if the live wallpaper is still on.
      if (cfgOf().enabled && cfgOf().live) setTimeout(() => startLive().catch(() => undefined), 5000);
    });
    await live.loadURL(`${deps.baseUrl()}/?valley=1&live=1`);
    await waitReady(live);
    live.showInactive();
    const hwnd = live.getNativeWindowHandle();
    const id = hwnd.length >= 8 ? hwnd.readBigUInt64LE(0).toString() : String(hwnd.readUInt32LE(0));
    try {
      const how = await powershell(["-Action", "attach", "-Path", id, "-Tick", String(Math.round(b.width * d.scaleFactor)), "-Options", String(Math.round(b.height * d.scaleFactor))], deps.log);
      save({ liveHow: how });
      deps.log("live wallpaper attached", how);
      if (!isWin) live.hide();
    } catch (e) { deps.log("live wallpaper couldn't attach", (e as Error).message); save({ error: "The moving wallpaper couldn't get behind your desktop icons; showing the still picture instead." }); stopLive(); return; }
    await feedLive();
    if (isWin && !watcher) {
      // One small helper keeps an eye on whether a full-screen app is in front (then the valley holds still).
      const file = path.join(app.getPath("userData"), "praxis-wallpaper.ps1");
      watcher = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file, "-Action", "watch"], { windowsHide: true });
      watcher.stdout?.on("data", (b: Buffer) => { const last = b.toString().trim().split(/\s+/).pop(); const full = last === "full"; if (full !== fullApp) { fullApp = full; syncPause(); } });
      watcher.on("exit", () => { watcher = null; });
    }
  }
  function stopLive() {
    if (watcher) { watcher.kill(); watcher = null; }
    const w = live; live = null;
    if (w && !w.isDestroyed()) { w.removeAllListeners("closed"); w.destroy(); }
  }
  async function feedLive() {
    if (!live || live.isDestroyed()) return;
    const now = new Date(), wx = weatherNow();
    const job = { when: now.toISOString(), weather: wx?.kind || "clear", wind: wx?.wind ?? 0.2, motto: cfgOf().current?.name || pickMotto(cfgOf(), now), projects: projectsOf(deps.readConfig()), events: eventsOf(deps.readConfig()) };
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
    const wx = weatherNow();
    const key = `${motto}|${Math.floor((now.getHours() * 60 + now.getMinutes()) / 10)}|${now.toDateString()}|${JSON.stringify(projects.map((p) => p.steps.filter((s) => s.lit).length))}|${wx?.kind}|${Math.round((wx?.wind ?? 0) * 4)}|${events.meteorAt || ""}|${events.aurora}`;
    if (!force && key === lastKey) return;
    busy = true;
    try {
      const v = await ensureWindow();
      const job = { when: now.toISOString(), weather: wx?.kind || "clear", motto, projects, events, ...size() };
      const out = await v.webContents.executeJavaScript(`window.__valley.wallpaper(${JSON.stringify(job)})`) as { file: string; ms: number };
      await powershell(["-Action", "set", "-Path", out.file, "-Position", "4"], deps.log);
      lastKey = key;
      save({ last: { at: now.toISOString(), file: out.file, motto: motto || "", ms: out.ms }, error: null });
      if (cfgOf().live) { if (!live) startLive().catch((e) => deps.log("live wallpaper failed", e?.message || e)); else await feedLive(); }
      deps.log("wallpaper", motto, out.ms + "ms");
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
      try { const s = JSON.parse(await powershell(["-Action", "status"], deps.log) || "{}"); if (s && typeof s === "object" && "status" in s) saved = s as Saved; }
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
      if (s && (s.status & 2) && s.folder) await powershell(["-Action", "slideshow", "-Folder", s.folder, "-Tick", String(s.tick || 3_600_000), "-Options", String(s.options ?? 1), "-Position", String(s.position ?? 4)], deps.log);
      else if (s?.wallpaper && fs.existsSync(s.wallpaper)) await powershell(["-Action", "set", "-Path", s.wallpaper, "-Position", String(s.position ?? 4)], deps.log);
    } catch (e) { error = `Couldn't put your old wallpaper back: ${(e as Error).message}`; deps.log(error); }
    save({ enabled: false, error });
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
    return state();
  }
  function state(): WallpaperState {
    const w = cfgOf();
    return { ...w, windows: isWin, mottos: mottos(w).length, defaultFolder };
  }

  return {
    start() { if (cfgOf().enabled) { startTimer(); tagMottos().catch(() => undefined); } },
    stop() { stopLive(); },
    enable, disable, state,
    refresh: async () => { lastKey = ""; await refreshWeather(true); await render(true); return state(); },
    setLive: async (on: boolean) => { save({ live: on, error: null }); if (on && cfgOf().enabled) await startLive(); if (!on) { stopLive(); save({ liveHow: null }); } return state(); },
    setWeather: async (on: boolean) => { save({ useWeather: on }); lastKey = ""; if (on) await refreshWeather(true); await render(true); return state(); },
    setFolder: async (folder: string) => { save({ folder, bag: [], current: null }); lastKey = ""; if (cfgOf().enabled) await render(true); return state(); },
    window: () => win,
  };
}

function shuffle<T>(a: T[]) { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
