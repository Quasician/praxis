// Praxis desktop app (Electron).
//   • Runs the local Praxis server inside the app (data in %APPDATA%/Praxis)
//   • One window, no browser bars; closing it keeps Praxis in the system tray
//   • Ctrl+Shift+Space from anywhere → quick add
//   • Opens at login (toggle in the tray menu)
//   • Updates itself from GitHub Releases in the background
import { app, BrowserWindow, dialog, globalShortcut, Menu, nativeImage, nativeTheme, Notification, screen, shell, Tray } from "electron";
import { autoUpdater } from "electron-updater";
import fs from "fs";
import path from "path";
import { createPraxisServer } from "../server/app";

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
type Prefs = { openAtLogin?: boolean; toldAboutTray?: boolean; bounds?: Bounds; maximized?: boolean; fullscreen?: boolean; zoom?: number; miniBounds?: Bounds };
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
  const { listen, store } = createPraxisServer({ dataDir: app.getPath("userData"), staticDir: rendererDir });
  watchShutdown(store.readConfig);
  const port = await listen(Number(process.env.PRAXIS_PORT) || 4321);
  baseUrl = `http://localhost:${port}`;
  log("server on", baseUrl);
  createWindow();
  createTray();
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
    webPreferences: { contextIsolation: true, sandbox: true },
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
    { label: "Full screen", accelerator: "F11", type: "checkbox", checked: !!win?.isFullScreen(), click: () => { showWindow(); toggleFullScreen(); } },
    { type: "separator" },
    { label: "Open at login", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: (item) => { setOpenAtLogin(item.checked); } },
    { label: "Check for updates…", enabled: app.isPackaged, click: () => checkForUpdates(true) },
    { label: `Version ${app.getVersion()}`, enabled: false },
    { type: "separator" },
    { label: "Quit Praxis", click: () => { quitting = true; app.quit(); } },
  ]));
}

// ---------- quick add from anywhere ----------
/** Opens the window and fires a "praxis:<name>" event in it (quick-add, brain-dump, shutdown). */
function trigger(name: string) {
  showWindow();
  win?.webContents.executeJavaScript(`window.dispatchEvent(new Event("praxis:${name}"))`).catch(() => undefined);
}
const quickAdd = () => trigger("quick-add");

// ---------- evening reminder ----------
/** When Praxis is tucked away in the tray at shut-down time, a Windows notification nudges you (once a day). */
function watchShutdown(readConfig: () => Record<string, unknown>) {
  let nudged = "";
  setInterval(() => {
    const planner = (readConfig().planner || {}) as { shutdownAt?: string; lastShutdown?: string | null };
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const [h, m] = (planner.shutdownAt || "21:00").split(":").map(Number);
    if (nudged === today || planner.lastShutdown === today || now.getHours() * 60 + now.getMinutes() < h * 60 + m) return;
    nudged = today;
    if (win?.isVisible() && win.isFocused()) return; // the in-app pill covers it
    const n = new Notification({ title: "Shut down the day", body: "Two minutes: what got done, a home for the leftovers, a look at tomorrow." });
    n.on("click", () => trigger("shutdown"));
    n.show();
  }, 60_000);
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
