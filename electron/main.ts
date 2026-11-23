// Praxis desktop app (Electron).
//   • Runs the local Praxis server inside the app (data in %APPDATA%/Praxis)
//   • One window, no browser bars; closing it keeps Praxis in the system tray
//   • Ctrl+Shift+Space from anywhere → quick add
//   • Opens at login (toggle in the tray menu)
//   • Updates itself from GitHub Releases in the background
import { app, BrowserWindow, dialog, globalShortcut, Menu, nativeImage, nativeTheme, Notification, shell, Tray } from "electron";
import { autoUpdater } from "electron-updater";
import fs from "fs";
import path from "path";
import { createPraxisServer } from "../server/app";

const QUICK_ADD = "CommandOrControl+Shift+Space";
const UPDATE_EVERY = 4 * 60 * 60 * 1000;
const rendererDir = path.join(__dirname, "..", "renderer");
const asset = (name: string) => path.join(rendererDir, name);

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let baseUrl = "";

// ---------- small persisted desktop settings ----------
const prefsFile = () => path.join(app.getPath("userData"), "desktop.json");
type Prefs = { openAtLogin?: boolean; toldAboutTray?: boolean };
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
  app.on("second-instance", () => showWindow());
  app.whenReady().then(start).catch((e) => { log("startup failed", e?.stack || e); dialog.showErrorBox("Praxis couldn't start", String(e)); app.quit(); });
  app.on("before-quit", () => { quitting = true; });
  app.on("will-quit", () => globalShortcut.unregisterAll());
  app.on("window-all-closed", () => { /* stay in the tray */ });
}

async function start() {
  const { listen } = createPraxisServer({ dataDir: app.getPath("userData"), staticDir: rendererDir });
  const port = await listen(Number(process.env.PRAXIS_PORT) || 4321);
  baseUrl = `http://localhost:${port}`;
  log("server on", baseUrl);
  createWindow();
  createTray();
  registerQuickAdd();
  setupOpenAtLogin();
  setupUpdates();
}

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 920, minWidth: 900, minHeight: 600,
    title: "Praxis",
    icon: asset("icon-256.png"),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#171513" : "#f6f3ee",
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.removeMenu();
  win.loadURL(baseUrl);
  win.once("ready-to-show", () => { if (!process.argv.includes("--hidden")) win?.show(); });

  // Links (Todoist, Google Calendar…) open in your normal browser, never inside Praxis.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(baseUrl)) { e.preventDefault(); shell.openExternal(url); } });

  // Closing the window keeps Praxis running in the tray (so the hotkey and reminders keep working).
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    win?.hide();
    if (!readPrefs().toldAboutTray && Notification.isSupported()) {
      new Notification({ title: "Praxis is still running", body: "It's in the system tray. Press Ctrl+Shift+Space to quick-add from anywhere." }).show();
      writePrefs({ toldAboutTray: true });
    }
  });
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
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
    { type: "separator" },
    { label: "Open at login", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: (item) => { setOpenAtLogin(item.checked); } },
    { label: "Check for updates…", enabled: app.isPackaged, click: () => checkForUpdates(true) },
    { label: `Version ${app.getVersion()}`, enabled: false },
    { type: "separator" },
    { label: "Quit Praxis", click: () => { quitting = true; app.quit(); } },
  ]));
}

// ---------- quick add from anywhere ----------
function quickAdd() {
  showWindow();
  win?.webContents.executeJavaScript('window.dispatchEvent(new Event("praxis:quick-add"))').catch(() => undefined);
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
  autoUpdater.on("update-downloaded", async (info) => {
    manualCheck = false;
    log("update downloaded", info.version);
    const { response } = await dialog.showMessageBox({
      type: "info", buttons: ["Restart now", "Later"], defaultId: 0, cancelId: 1,
      message: `Praxis ${info.version} is ready`,
      detail: "Restart to update now, or it will update the next time you quit Praxis.",
    });
    if (response === 0) { quitting = true; autoUpdater.quitAndInstall(); }
  });
  checkForUpdates(false);
  setInterval(() => checkForUpdates(false), UPDATE_EVERY);
}
function checkForUpdates(manual: boolean) {
  manualCheck = manual;
  autoUpdater.checkForUpdates().catch((e) => log("update check failed", e?.message || e));
}
