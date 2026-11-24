// Praxis desktop app (Electron).
//   • Runs the local Praxis server inside the app (data in %APPDATA%/Praxis)
//   • One window, no browser bars; closing it keeps Praxis in the system tray
//   • Ctrl+Shift+Space from anywhere → quick add
//   • Opens at login (toggle in the tray menu)
//   • Updates itself from GitHub Releases in the background
import { app, BrowserWindow, dialog, globalShortcut, Menu, nativeImage, nativeTheme, Notification, powerMonitor, screen, shell, Tray } from "electron";
import { autoUpdater } from "electron-updater";
import fs from "fs";
import path from "path";
import { createPraxisServer } from "../server/app";
import { dueNudges, reminderCfg, testNudge, type Nudge, type Slot } from "../src/domain/nudges";
import { createWallpaper } from "./wallpaper";

const QUICK_ADD = "CommandOrControl+Shift+Space";
const UPDATE_EVERY = 30 * 60 * 1000; // plus a check whenever the window is brought up
const rendererDir = path.join(__dirname, "..", "renderer");
const asset = (name: string) => path.join(rendererDir, name);

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let baseUrl = "";
let restoreState: (() => void) | null = null;

// ---------- small persisted desktop settings ----------
const prefsFile = () => path.join(app.getPath("userData"), "desktop.json");
type Bounds = { x: number; y: number; width: number; height: number };
type Prefs = { openAtLogin?: boolean; toldAboutTray?: boolean; bounds?: Bounds; maximized?: boolean; fullscreen?: boolean; zoom?: number; miniBounds?: Bounds; edgeStrip?: boolean };
const readPrefs = (): Prefs => { try { return JSON.parse(fs.readFileSync(prefsFile(), "utf8")); } catch { return {}; } };
const writePrefs = (p: Prefs) => { try { fs.writeFileSync(prefsFile(), JSON.stringify({ ...readPrefs(), ...p }, null, 2)); } catch { /* ignore */ } };
const log = (...a: unknown[]) => { try { fs.appendFileSync(path.join(app.getPath("userData"), "praxis.log"), `${new Date().toISOString()} ${a.map(String).join(" ")}\n`); } catch { /* ignore */ } };

// Tests can point Praxis at a throwaway data folder.
if (process.env.PRAXIS_USER_DATA) app.setPath("userData", process.env.PRAXIS_USER_DATA);

// ---------- single instance ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId("com.quasician.praxis");
  // Launching Praxis again (taskbar jump list, Start menu) reuses this window.
  app.on("second-instance", (_e, argv) => { if (!runArgs(argv)) showWindow(); });
  app.whenReady().then(start).catch((e) => { log("startup failed", e?.stack || e); dialog.showErrorBox("Praxis couldn't start", String(e)); app.quit(); });
  app.on("before-quit", () => { quitting = true; });
  app.on("will-quit", () => globalShortcut.unregisterAll());
  app.on("window-all-closed", () => { /* stay in the tray */ });
}

async function start() {
  const { listen, store } = createPraxisServer({
    dataDir: app.getPath("userData"), staticDir: rendererDir,
    mottosDir: path.join(app.getPath("pictures"), "Mottos"),
    desktop: { nudge: (action, key) => onNudgeAction(action, key), test: () => showNudge(testNudge(), true), miniFit, trayDial, taskbarDark: () => nativeTheme.shouldUseDarkColorsForSystemIntegratedUI ?? nativeTheme.shouldUseDarkColors,
      wallpaper: (action, arg) => wallpaperAction(action, arg) },
  });
  readConfig = store.readConfig;
  wallpaper = createWallpaper({ readConfig: store.readConfig, writeConfig: store.writeConfig, baseUrl: () => baseUrl, log });
  startNudger();
  const port = await listen(Number(process.env.PRAXIS_PORT) || 4321);
  baseUrl = `http://localhost:${port}`;
  log("server on", baseUrl);
  createWindow();
  createTray();
  if (readPrefs().edgeStrip !== false) startStrip();
  wallpaper.start();
  setupJumpList();
  // Started from a jump-list entry: do it once the page is ready to listen.
  if (JUMP.some((j) => process.argv.includes(j.arg))) win?.webContents.once("did-finish-load", () => setTimeout(() => runArgs(process.argv), 1500));
  registerQuickAdd();
  setupOpenAtLogin();
  setupUpdates();
}

// ---------- window ----------
/** The saved window position, if it's still on a connected monitor. */
function savedBounds(): Partial<Bounds> {
  const b = readPrefs().bounds;
  if (!b) return {};
  const visible = screen.getAllDisplays().some(({ workArea: w }) => b.x < w.x + w.width - 100 && b.x + b.width > w.x + 100 && b.y >= w.y - 10 && b.y < w.y + w.height - 100);
  return visible ? b : { width: b.width, height: b.height };
}

const ZOOM_STEPS = [0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
function zoom(dir: -1 | 0 | 1) {
  if (!win) return;
  const cur = win.webContents.getZoomFactor();
  const next = dir === 0 ? 1 : dir > 0 ? ZOOM_STEPS.find((z) => z > cur + 0.01) ?? cur : [...ZOOM_STEPS].reverse().find((z) => z < cur - 0.01) ?? cur;
  win.webContents.setZoomFactor(next);
  writePrefs({ zoom: next });
}

function createWindow() {
  const prefs = readPrefs();
  win = new BrowserWindow({
    width: 1400, height: 920, minWidth: 900, minHeight: 600,
    ...savedBounds(),
    title: "Praxis",
    icon: asset("icon-256.png"),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#171513" : "#f6f3ee",
    autoHideMenuBar: true,
    show: false,
    // Keep running at full speed while tucked in the tray, so today's plan stays fresh for reminders.
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.removeMenu();
  win.loadURL(baseUrl);
  win.webContents.on("did-finish-load", () => win?.webContents.setZoomFactor(readPrefs().zoom ?? 1));
  // Maximizing shows a window, so when Praxis starts hidden (at login) that waits until it's opened.
  restoreState = () => { if (prefs.maximized) win?.maximize(); if (prefs.fullscreen) win?.setFullScreen(true); restoreState = null; };
  win.once("ready-to-show", () => { if (!process.argv.includes("--hidden")) { win?.show(); restoreState?.(); } });

  // Keys the removed menu used to provide: F11 fullscreen, Ctrl +/−/0 zoom.
  win.webContents.on("before-input-event", (e, input) => {
    if (input.type !== "keyDown") return;
    const mod = input.control || input.meta;
    if (input.key === "F11") { e.preventDefault(); toggleFullScreen(); }
    else if (mod && (input.key === "=" || input.key === "+")) { e.preventDefault(); zoom(1); }
    else if (mod && input.key === "-") { e.preventDefault(); zoom(-1); }
    else if (mod && input.key === "0") { e.preventDefault(); zoom(0); }
  });

  // Remember size, position, maximized and fullscreen for next time.
  const save = () => {
    if (!win || win.isMinimized()) return;
    const full = win.isFullScreen(), max = win.isMaximized();
    writePrefs({ fullscreen: full, maximized: max, ...(full || max ? {} : { bounds: win.getBounds() }) });
  };
  let t: NodeJS.Timeout | undefined;
  const saveSoon = () => { clearTimeout(t); t = setTimeout(save, 400); };
  for (const ev of ["resize", "move", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"] as const) win.on(ev as "resize", saveSoon);

  // Links (Todoist, Google Calendar…) open in your normal browser, never inside Praxis.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(baseUrl) && new URL(url).searchParams.has("mini")) { openMini(); return { action: "deny" }; }
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(baseUrl)) { e.preventDefault(); shell.openExternal(url); } });

  // Closing the window keeps Praxis running in the tray (so the hotkey and reminders keep working).
  win.on("close", (e) => {
    save();
    if (quitting) return;
    e.preventDefault();
    win?.hide();
    if (!readPrefs().toldAboutTray && Notification.isSupported()) {
      new Notification({ title: "Praxis is still running", body: "It's in the system tray. Press Ctrl+Shift+Space to quick-add from anywhere." }).show();
      writePrefs({ toldAboutTray: true });
    }
  });
}

// ---------- the Now pop-out: a small always-on-top window ----------
let mini: BrowserWindow | null = null;
function openMini() {
  if (mini && !mini.isDestroyed()) { mini.show(); mini.focus(); return; }
  const wa = screen.getPrimaryDisplay().workArea;
  const saved = readPrefs().miniBounds;
  mini = new BrowserWindow({
    width: 380, height: 116, minWidth: 280, minHeight: 90, x: saved?.x ?? wa.x + wa.width - 400, y: saved?.y ?? wa.y + wa.height - 140,
    ...(saved ? { width: saved.width, height: saved.height } : {}),
    alwaysOnTop: true, frame: false, resizable: true, maximizable: false, minimizable: false, fullscreenable: false,
    skipTaskbar: true, title: "Praxis · Now", icon: asset("icon-256.png"),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1f1c19" : "#fffdf9",
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  mini.setAlwaysOnTop(true, "floating");
  mini.removeMenu();
  mini.loadURL(`${baseUrl}/?mini=1`);
  mini.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  mini.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(baseUrl)) e.preventDefault(); });
  const keep = () => { if (mini && !mini.isDestroyed()) writePrefs({ miniBounds: mini.getBounds() }); };
  mini.on("moved", keep); mini.on("resized", keep);
  mini.on("closed", () => { mini = null; });
}

/** The pop-out keeps the width you gave it; its height follows what it shows. It grows upward when it sits low on the screen. */
function miniFit(height: number) {
  if (!mini || mini.isDestroyed()) return;
  const b = mini.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  const h = Math.max(90, Math.min(height, 420, wa.height));
  if (Math.abs(h - b.height) < 4) return;
  const lowHalf = b.y + b.height / 2 > wa.y + wa.height / 2;
  const y = Math.max(wa.y, Math.min(lowHalf ? b.y + b.height - h : b.y, wa.y + wa.height - h));
  mini.setBounds({ x: b.x, y, width: b.width, height: h });
}

function toggleFullScreen() {
  if (!win) return;
  win.setFullScreen(!win.isFullScreen());
  refreshTrayMenu();
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  restoreState?.();
  win.focus();
}

// ---------- tray ----------
function createTray() {
  const img = nativeImage.createFromPath(asset("tray-32.png")).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip("Praxis");
  tray.on("click", showWindow);
  tray.on("double-click", showWindow);
  refreshTrayMenu();
}

function refreshTrayMenu() {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Praxis", click: showWindow },
    { label: "Quick add…", accelerator: QUICK_ADD, click: quickAdd },
    { label: "Brain dump…", click: () => trigger("brain-dump") },
    { label: "Shut down the day…", click: () => trigger("shutdown") },
    { label: "Now (always on top)", click: () => openMini() },
    { label: "Mark Now done", accelerator: NOW_DONE, click: nowDone },
    { label: "Show a test reminder", click: () => showNudge(testNudge(), true) },
    { label: "Wallpaper…", click: () => trigger("wallpaper") },
    { label: "Edge horizon (top of the screen)", type: "checkbox", checked: readPrefs().edgeStrip !== false, click: (item) => { writePrefs({ edgeStrip: item.checked }); if (item.checked) startStrip(); else stopStrip(); } },
    { label: "Full screen", accelerator: "F11", type: "checkbox", checked: !!win?.isFullScreen(), click: () => { showWindow(); toggleFullScreen(); } },
    { type: "separator" },
    { label: "Open at login", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: (item) => { setOpenAtLogin(item.checked); } },
    { label: "Check for updates…", enabled: app.isPackaged, click: () => checkForUpdates(true) },
    { label: `Version ${app.getVersion()}`, enabled: false },
    { type: "separator" },
    { label: "Quit Praxis", click: () => { quitting = true; app.quit(); } },
  ]));
}

// ---------- the valley wallpaper (3.4) ----------
let wallpaper: ReturnType<typeof createWallpaper>;
async function wallpaperAction(action: string, arg?: string) {
  switch (action) {
    case "enable": return wallpaper.enable(arg);
    case "disable": return wallpaper.disable();
    case "refresh": return wallpaper.refresh();
    case "folder": return arg ? wallpaper.setFolder(arg) : wallpaper.state();
    case "pick-folder": {
      const st = wallpaper.state();
      const r = await dialog.showOpenDialog(win!, { title: "Your mottos folder", defaultPath: st.folder || st.defaultFolder, properties: ["openDirectory"] });
      return r.canceled || !r.filePaths[0] ? st : wallpaper.setFolder(r.filePaths[0]);
    }
    default: return wallpaper.state();
  }
}

// ---------- the tray sundial ----------
// The main window draws the icon (the sun on its arc, the commitments still open) and sends it here.
let lastDial = "";
function trayDial(img16: string, img32: string, tip: string) {
  if (!tray || !img16.startsWith("data:image/png") || !img32.startsWith("data:image/png")) return;
  if (img16 + tip === lastDial) return;
  if (!lastDial) log("tray dial", tip);
  lastDial = img16 + tip;
  const img = nativeImage.createEmpty();
  img.addRepresentation({ scaleFactor: 1, dataURL: img16 });
  img.addRepresentation({ scaleFactor: 2, dataURL: img32 });
  if (!img.isEmpty()) tray.setImage(img);
  tray.setToolTip(tip.slice(0, 127)); // Windows cuts tray tooltips at 127 characters
}

// ---------- the edge horizon ----------
// A strip a few pixels tall along the top of the main screen: the day's sky, your blocks and the sun.
// Clicks always go through it. Rest the mouse on the very top edge and it opens a small card with the next block;
// move away and it closes.
const STRIP_H = 5, STRIP_OPEN_H = 120, DWELL_MS = 450;
let stripWin: BrowserWindow | null = null;
let stripPoll: NodeJS.Timeout | null = null;
function stripArea() { return screen.getPrimaryDisplay().bounds; } // bounds, not workArea: it sits above full-screen apps too
function startStrip() {
  if (stripWin && !stripWin.isDestroyed()) return;
  const a = stripArea();
  stripWin = new BrowserWindow({
    x: a.x, y: a.y, width: a.width, height: STRIP_H, frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, focusable: false, show: false,
    hasShadow: false, alwaysOnTop: true, title: "Edge horizon", backgroundColor: "#00000000",
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  stripWin.setAlwaysOnTop(true, "screen-saver");
  stripWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  stripWin.setIgnoreMouseEvents(true);
  stripWin.on("page-title-updated", (e) => e.preventDefault()); // keep its own name, so it's never mistaken for the main window
  stripWin.removeMenu();
  stripWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  stripWin.webContents.on("will-navigate", (e) => e.preventDefault());
  stripWin.loadURL(`${baseUrl}/?strip=1`);
  stripWin.once("ready-to-show", () => stripWin?.showInactive());
  stripWin.on("closed", () => { stripWin = null; });
  let dwell = 0, open = false, lastX = -1;
  const send = (detail: { open: boolean; x: number }) =>
    stripWin?.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent("praxis:strip", { detail: ${JSON.stringify(detail)} }))`).catch(() => undefined);
  const fit = (h: number) => { const b = stripArea(); stripWin?.setBounds({ x: b.x, y: b.y, width: b.width, height: h }); };
  stripPoll = setInterval(() => {
    if (!stripWin || stripWin.isDestroyed()) return;
    const p = screen.getCursorScreenPoint(), b = stripArea();
    const onEdge = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y <= b.y + STRIP_H + 1;
    if (onEdge) {
      if (!dwell) dwell = Date.now();
      if (!open && Date.now() - dwell >= DWELL_MS) { open = true; fit(STRIP_OPEN_H); stripWin.moveTop(); }
      if (open && Math.abs(p.x - lastX) > 2) { lastX = p.x; send({ open: true, x: p.x - b.x }); }
    } else {
      dwell = 0;
      if (open) { open = false; lastX = -1; send({ open: false, x: 0 }); setTimeout(() => { if (!open) fit(STRIP_H); }, 120); }
    }
  }, 100);
  // Screens change (a monitor plugged in, resolution changed): follow the main screen.
  const refit = () => fit(open ? STRIP_OPEN_H : STRIP_H);
  screen.on("display-metrics-changed", refit);
  screen.on("display-added", refit);
  screen.on("display-removed", refit);
  stripWin.on("closed", () => { screen.off("display-metrics-changed", refit); screen.off("display-added", refit); screen.off("display-removed", refit); });
}
function stopStrip() {
  if (stripPoll) clearInterval(stripPoll);
  stripPoll = null;
  if (stripWin && !stripWin.isDestroyed()) stripWin.destroy();
  stripWin = null;
}

// ---------- quick add from anywhere ----------
/** Opens the window and fires a "praxis:<name>" event in it (quick-add, brain-dump, shutdown). */
function trigger(name: string) {
  showWindow();
  win?.webContents.executeJavaScript(`window.dispatchEvent(new Event("praxis:${name}"))`).catch(() => undefined);
}
const quickAdd = () => trigger("quick-add");
/** Ctrl+Alt+D anywhere: mark the Now task done without bringing Praxis forward. */
const NOW_DONE = "CommandOrControl+Alt+D";
const nowDone = () => win?.webContents.executeJavaScript('window.dispatchEvent(new Event("praxis:now-done"))').catch(() => undefined);

// ---------- reminders that reach you in full-screen apps ----------
// Windows turns on Do Not Disturb automatically while an app is full screen, which hides ordinary
// notifications. So Praxis shows its own small card instead: always on top (above full-screen windows),
// never taking keyboard focus, on the monitor your mouse is on.
let readConfig: () => Record<string, unknown> = () => ({});
let nudgeWin: BrowserWindow | null = null;
let current: Nudge | null = null;
const sent = new Set<string>();
const snoozed: { at: number; nudge: Nudge }[] = [];
let lastNudgeAt = Date.now();
let activeSince = Date.now();
const CARD = { width: 560, height: 176 };
const PILL = { width: 340, height: 60 };
const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function todaySlots(): Promise<Slot[]> {
  if (!win || win.isDestroyed()) return [];
  try {
    const list = await win.webContents.executeJavaScript("window.__praxisSchedule ? window.__praxisSchedule() : []");
    return Array.isArray(list) ? list.filter((x) => x && typeof x.id === "string" && Number.isFinite(x.start) && Number.isFinite(x.end)) : [];
  } catch { return []; }
}

function startNudger() {
  const tick = async () => {
    try {
      const now = new Date();
      // Away from the computer for 5+ minutes resets "how long you've been going".
      if (powerMonitor.getSystemIdleTime() > 300) activeSince = Date.now();
      const cfg = readConfig();
      const r = reminderCfg(cfg.reminders as never);
      const planner = (cfg.planner || {}) as { shutdownAt?: string; dayEnd?: string; lastShutdown?: string | null };
      const list = dueNudges({
        now, slots: await todaySlots(), r,
        shutdownAt: planner.shutdownAt || "21:00", windDownAt: planner.dayEnd || "21:30",
        shutdownDone: planner.lastShutdown === ymdOf(now),
        focus: (cfg.focus as never) || null, lastNudgeAt, activeSince,
      }, sent);
      // Reminders you pushed back ("In 10 min") come back first.
      const due = snoozed.findIndex((x) => x.at <= now.getTime());
      if (due >= 0) list.unshift(snoozed.splice(due, 1)[0].nudge);
      // You're looking at Praxis already: skip the gentle ones.
      const looking = !!win?.isVisible() && win.isFocused();
      const next = list.find((n) => !(looking && (n.kind === "heads-up" || n.kind === "time-check")));
      for (const n of list) sent.add(n.key);
      if (next) showNudge(next, false);
    } catch (e) { log("nudge tick failed", (e as Error)?.message || e); }
  };
  setTimeout(tick, 5000);
  setInterval(tick, 20_000);
  // Coming back from sleep: check straight away.
  powerMonitor.on("resume", () => { activeSince = Date.now(); setTimeout(tick, 3000); });
  powerMonitor.on("unlock-screen", () => { activeSince = Date.now(); setTimeout(tick, 3000); });
}

function showNudge(n: Nudge, test: boolean) {
  const cfg = readConfig();
  const r = reminderCfg(cfg.reminders as never);
  lastNudgeAt = Date.now();
  if (r.style === "windows" && !test) return showToast(n);
  current = n;
  const ui = (cfg.ui || {}) as { theme?: string; warmEvenings?: boolean };
  const theme = ui.theme === "light" || ui.theme === "dark" ? ui.theme : nativeTheme.shouldUseDarkColors ? "dark" : "light";
  const h = new Date().getHours();
  const q = new URLSearchParams({ nudge: JSON.stringify(n), theme });
  if (ui.warmEvenings !== false && (h >= 20 || h < 5)) q.set("evening", "1");
  if (r.sound) q.set("sound", "1");
  const url = `${baseUrl}/?${q.toString()}`;

  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds; // bounds, not workArea: full-screen apps cover the taskbar
  const bounds = { ...CARD, x: Math.round(area.x + (area.width - CARD.width) / 2), y: area.y + 28 };
  if (nudgeWin && !nudgeWin.isDestroyed()) {
    nudgeWin.setBounds(bounds);
    nudgeWin.loadURL(url);
    nudgeWin.showInactive();
  } else {
    nudgeWin = new BrowserWindow({
      ...bounds, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, focusable: false, show: false, hasShadow: false, alwaysOnTop: true,
      title: "Praxis reminder", backgroundColor: "#00000000",
      webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    nudgeWin.setAlwaysOnTop(true, "screen-saver"); // above full-screen windows
    nudgeWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    nudgeWin.removeMenu();
    nudgeWin.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: "deny" }; });
    nudgeWin.webContents.on("will-navigate", (e, u) => { if (!u.startsWith(baseUrl)) e.preventDefault(); });
    nudgeWin.on("closed", () => { nudgeWin = null; current = null; });
    nudgeWin.loadURL(url);
    nudgeWin.once("ready-to-show", () => nudgeWin?.showInactive());
  }
  if (win && !win.isFocused()) win.flashFrame(true); // the taskbar button glows too
  log("nudge", n.kind, n.key);
}

function showToast(n: Nudge) {
  if (!Notification.isSupported()) return;
  const toast = new Notification({ title: n.title, body: n.body, silent: !reminderCfg(readConfig().reminders as never).sound, timeoutType: n.sticky ? "never" : "default" });
  toast.on("click", () => (n.kind === "shutdown" ? trigger("shutdown") : n.kind === "start" ? openMini() : showWindow()));
  toast.show();
}

function closeNudge() {
  if (nudgeWin && !nudgeWin.isDestroyed()) nudgeWin.close();
  nudgeWin = null; current = null;
  win?.flashFrame(false);
}

const emit = (name: string, detail?: string) =>
  win?.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent(${JSON.stringify(`praxis:${name}`)}, { detail: ${JSON.stringify(detail ?? null)} }))`).catch(() => undefined);

function onNudgeAction(action: string, key: string) {
  const n = current;
  if (!n || n.key !== key) { if (action !== "collapse" && action !== "expand") closeNudge(); return; }
  if (action === "collapse" || action === "expand") {
    if (!nudgeWin || nudgeWin.isDestroyed()) return;
    const area = screen.getDisplayMatching(nudgeWin.getBounds()).bounds;
    nudgeWin.setBounds(action === "collapse"
      ? { ...PILL, x: area.x + area.width - PILL.width - 24, y: area.y + 20 }
      : { ...CARD, x: Math.round(area.x + (area.width - CARD.width) / 2), y: area.y + 28 });
    return;
  }
  closeNudge();
  const later = (min: number) => snoozed.push({ at: Date.now() + min * 60_000, nudge: { ...n, key: `${n.key}:later${Date.now()}`, body: n.kind === "start" ? `You pushed this back ${min} minutes. Ready now?` : n.body } });
  switch (action) {
    case "start": if (n.taskId) { emit("start-focus", n.taskId); openMini(); } break;
    case "done": if (n.taskId) emit("complete", n.taskId); break;
    case "more": emit("focus-more"); break;
    case "stop": emit("focus-stop"); break;
    case "later": later(n.kind === "start" ? 10 : 15); break;
    case "shutdown": trigger("shutdown"); break;
    case "open": showWindow(); break;
    default: break; // dismiss
  }
}

// ---------- taskbar jump list (right-click the taskbar button) ----------
const JUMP = [
  { arg: "--quick-add", title: "Quick add", description: "Add a task", run: () => quickAdd() },
  { arg: "--brain-dump", title: "Brain dump", description: "Turn a messy list into tasks with Claude", run: () => trigger("brain-dump") },
  { arg: "--shutdown", title: "Shut down the day", description: "Close out today", run: () => trigger("shutdown") },
  { arg: "--check-updates", title: "Check for updates", description: "Look for a new version of Praxis", run: () => { showWindow(); checkForUpdates(true); } },
];
function runArgs(argv: string[]) {
  const hit = JUMP.find((j) => argv.includes(j.arg));
  hit?.run();
  return !!hit;
}
function setupJumpList() {
  if (process.platform !== "win32") return;
  try {
    app.setUserTasks(JUMP.map((j) => ({ program: process.execPath, arguments: j.arg, title: j.title, description: j.description, iconPath: process.execPath, iconIndex: 0 })));
  } catch (e) { log("jump list failed", e); }
}
function registerQuickAdd() {
  if (!globalShortcut.register(QUICK_ADD, quickAdd)) log("couldn't register", QUICK_ADD, "(another app may be using it)");
  if (!globalShortcut.register(NOW_DONE, nowDone)) log("couldn't register", NOW_DONE, "(another app may be using it)");
}

// ---------- open at login (on by default) ----------
function setOpenAtLogin(on: boolean) {
  if (!app.isPackaged) return; // don't register a dev build
  app.setLoginItemSettings({ openAtLogin: on });
  writePrefs({ openAtLogin: on });
  refreshTrayMenu();
}
function setupOpenAtLogin() {
  const prefs = readPrefs();
  setOpenAtLogin(prefs.openAtLogin ?? true);
}

// ---------- updates (GitHub Releases) ----------
let manualCheck = false;
function setupUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("error", (e) => {
    log("update error", e?.message || e);
    if (manualCheck) { manualCheck = false; dialog.showMessageBox({ type: "warning", message: "Couldn't check for updates", detail: String(e?.message || e) }); }
  });
  autoUpdater.on("update-not-available", () => {
    if (manualCheck) { manualCheck = false; dialog.showMessageBox({ type: "info", message: "Praxis is up to date", detail: `You have the latest version (${app.getVersion()}).` }); }
  });
  let offered = "";
  autoUpdater.on("update-downloaded", async (info) => {
    manualCheck = false;
    if (offered === info.version) return; // already asked about this one
    offered = info.version;
    log("update downloaded", info.version);
    // Sitting in the tray: nobody is using it, so update right away and reopen.
    if (!win || !win.isVisible()) { quitting = true; autoUpdater.quitAndInstall(true, true); return; }
    const { response } = await dialog.showMessageBox({
      type: "info", buttons: ["Restart now", "Later"], defaultId: 0, cancelId: 1,
      message: `Praxis ${info.version} is ready`,
      detail: "Restart to update now, or it will update the next time you quit Praxis.",
    });
    if (response === 0) { quitting = true; autoUpdater.quitAndInstall(); }
  });
  checkForUpdates(false);
  setInterval(() => checkForUpdates(false), UPDATE_EVERY);
  app.on("browser-window-focus", () => { if (Date.now() - lastCheck > 5 * 60_000) checkForUpdates(false); });
}
let lastCheck = 0;
function checkForUpdates(manual: boolean) {
  manualCheck = manual;
  lastCheck = Date.now();
  autoUpdater.checkForUpdates().catch((e) => log("update check failed", e?.message || e));
}
