// 4.7 The gate and the focus lock, on the desktop.
//
// The gate: when a planned block starts, every screen is covered by a card that stays until you choose: start it (a focus
// timer runs for the rest of the block, with the lock on), move it (15, 30 or 60 minutes later) or skip it (with a reason).
// It closes by itself when the block's time is over, when you start a timer for it from Praxis, and after three hours at most.
// 5.0.1: it can't be alt-tabbed (or clicked, or Win-keyed) away: whenever another window takes the screen, the gate comes
// straight back in front with the keyboard. The tray's "Close the block gate" stays the way out if something goes wrong.
//
// The lock: while a focus timer with the lock runs, a small helper says which window is in front. When it's an app or site
// you locked (Firefox, Steam and its games, Reddit), that window is minimised and a full-screen card says what you're on and
// how long is left. "Back to work" closes the card; unlocking early takes a minute's wait and a typed sentence, and is noted
// in the day's record. Everything you didn't lock stays usable, so the work itself is never in the way.
import { BrowserWindow, screen, shell } from "electron";
import { spawn, type ChildProcess } from "child_process";
import { blockedBy, gates, lockCfg, lockedUntil, type LockFocus } from "../src/domain/focuslock";
import type { Nudge } from "../src/domain/nudges";
import { helper, helperExe } from "./wallpaper";

export interface FocusDeps {
  readConfig(): Record<string, unknown>;
  baseUrl(): string;
  theme(): "light" | "dark";
  emit(name: string, detail?: string): void;
  log(...a: unknown[]): void;
}

const isWin = process.platform === "win32";
const MAX_GATE = 3 * 60 * 60_000;
const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

interface GateJob { key: string; taskId: string; title: string; start: number; end: number; opened: number }

export function createFocusGuard(deps: FocusDeps) {
  let gate: GateJob | null = null;
  let gateWins: BrowserWindow[] = [];
  let lockWin: BrowserWindow | null = null;
  let lockShown: { what: string } | null = null;
  let watcher: ChildProcess | null = null;
  let unlockedFor: string | null = null;   // the timer (startedAt) you unlocked early: stays unlocked even before the settings catch up
  let lastBlocked = 0;
  let gateMain: BrowserWindow | null = null;  // the gate on the screen you're on: the one that holds the keyboard
  let gateHold: ReturnType<typeof setInterval> | null = null;
  let heldUntil = 0;                          // the tray menu is open: leave it in front so you can close the gate from it
  let lastRaise = 0;
  const shown = new WeakSet<BrowserWindow>();

  const focusOf = () => (deps.readConfig().focus as LockFocus | null | undefined) || null;
  const cfgOf = () => lockCfg(deps.readConfig().focusLock as never);

  function card(query: Record<string, string>, bounds: Electron.Rectangle, focusable: boolean) {
    const w = new BrowserWindow({
      ...bounds, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false, closable: false,
      fullscreenable: false, skipTaskbar: true, focusable, show: false, hasShadow: false, alwaysOnTop: true,
      title: "Praxis", backgroundColor: deps.theme() === "light" ? "#eef1f8" : "#0b1020",
      webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    w.setAlwaysOnTop(true, "screen-saver");
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    w.removeMenu();
    w.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
    w.webContents.on("will-navigate", (e, u) => { if (!u.startsWith(deps.baseUrl())) e.preventDefault(); });
    w.webContents.on("before-input-event", (e, input) => { if (input.alt && input.key === "F4") e.preventDefault(); });
    w.loadURL(`${deps.baseUrl()}/?${new URLSearchParams({ ...query, theme: deps.theme() }).toString()}`);
    w.once("ready-to-show", () => { if (w.isDestroyed()) return; shown.add(w); w.show(); if (focusable) w.focus(); });
    return w;
  }
  const destroy = (w: BrowserWindow | null) => { if (w && !w.isDestroyed()) { w.setClosable(true); w.destroy(); } };

  // ---- the gate ----
  /** A block is starting: open the gate instead of the small reminder. False when the gate is off for this block. */
  function maybeGate(n: Nudge, slot: { start: number; end: number } | undefined): boolean {
    if (n.kind !== "start" || !n.taskId) return false;
    const cfg = deps.readConfig(), lc = lockCfg(cfg.focusLock as never);
    const day = ymdOf(new Date());
    const planned = ((cfg.history as Record<string, { planned?: { id: string; committed?: boolean }[] }> | undefined)?.[day]?.planned) || [];
    if (!gates(lc, !!planned.find((p) => p.id === n.taskId)?.committed)) return false;
    openGate({ key: n.key, taskId: n.taskId, title: n.title, start: slot?.start ?? n.at ?? Date.now(), end: slot?.end ?? Date.now() + 30 * 60_000, opened: Date.now() });
    return true;
  }

  function openGate(job: GateJob) {
    closeGate();
    gate = job;
    const main = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const payload = { key: job.key, taskId: job.taskId, title: job.title, start: job.start, end: job.end };
    gateWins = screen.getAllDisplays().map((d) => {
      const w = card({ gate: JSON.stringify({ ...payload, main: d.id === main.id }) }, d.bounds, d.id === main.id);
      if (d.id === main.id) gateMain = w;
      return w;
    });
    // Alt+Tab, a click on another window, the Windows key: the moment the gate loses the keyboard it takes it back,
    // and a quick check twice a second catches anything that slipped past (or a gate that never got the keyboard at all).
    gateMain?.on("blur", () => setTimeout(raiseGate, 60));
    gateHold = setInterval(raiseGate, 500);
    deps.log("gate", job.key);
  }

  const hwndOf = (w: BrowserWindow) => { const h = w.getNativeWindowHandle(); return h.length >= 8 ? h.readBigUInt64LE(0).toString() : String(h.readUInt32LE(0)); };

  /** Puts the gate back over everything and gives it the keyboard, unless the tray menu is open. */
  function raiseGate() {
    if (!gate || Date.now() < heldUntil) return;
    for (const w of gateWins) {
      if (w.isDestroyed() || !shown.has(w)) continue;
      if (w.isMinimized()) w.restore();
      if (!w.isVisible()) w.showInactive();
      w.setAlwaysOnTop(true, "screen-saver");
      w.moveTop();
    }
    const m = gateMain;
    if (!m || m.isDestroyed() || !shown.has(m) || m.isFocused()) return;
    m.focus();
    // Windows often refuses to hand the keyboard over to a window that asks for it itself; the helper insists.
    if (isWin && Date.now() - lastRaise > 400) {
      lastRaise = Date.now();
      helper(["raise", hwndOf(m)], deps.log).then((r) => { if (r !== "ok") deps.log("gate: couldn't take the front back", r); }).catch(() => undefined);
    }
  }

  function closeGate() {
    if (gateHold) { clearInterval(gateHold); gateHold = null; }
    for (const w of gateWins) destroy(w);
    gateWins = []; gateMain = null; gate = null;
  }

  /** The tray menu opening (ms > 0) or closing (0): the gate lets it stay in front meanwhile. */
  function hold(ms: number) {
    heldUntil = ms > 0 ? Date.now() + ms : 0;
    if (!ms) setTimeout(raiseGate, 60);
  }

  /** The gate's buttons. */
  function gateAction(action: string, body: Record<string, unknown>) {
    if (!gate) return;
    const g = gate;
    if (action === "start") deps.emit("gate-start", JSON.stringify({ taskId: g.taskId, end: g.end }));
    else if (action === "move") deps.emit("gate-move", JSON.stringify({ taskId: g.taskId, at: Number(body.at) }));
    else if (action === "skip") deps.emit("gate-skip", JSON.stringify({ taskId: g.taskId, reason: String(body.reason || "").slice(0, 300) }));
    else return;
    deps.log("gate", action, g.key);
    closeGate();
  }

  // ---- the lock ----
  function showLock(what: string, until: number) {
    const f = focusOf();
    if (lockWin && !lockWin.isDestroyed()) { if (lockShown?.what === what) { lockWin.moveTop(); return; } destroy(lockWin); }
    lockShown = { what };
    const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    lockWin = card({ lock: JSON.stringify({ what, title: f?.content || "your block", until }) }, d.bounds, true);
    lockWin.on("closed", () => { lockWin = null; lockShown = null; });
  }
  function hideLock() { destroy(lockWin); lockWin = null; lockShown = null; }

  function onFront(line: string) {
    const [hwnd, pid, exe = "", title = ""] = line.split("\t");
    const f = focusOf(), until = lockedUntil(f, Date.now(), cfgOf());
    if (!until || (f && unlockedFor === f.startedAt)) { stopWatch(); return; }
    if (Number(pid) === process.pid || !exe) return;          // our own card (or nothing in front)
    const what = blockedBy({ exe, title }, cfgOf());
    if (what) {
      if (Number(hwnd)) helper(["minimize", hwnd], deps.log).catch(() => undefined);
      if (Date.now() - lastBlocked > 5000) deps.log("lock", what);
      lastBlocked = Date.now();
      showLock(what, until);
    } else if (lockWin) hideLock();                       // you went back to something allowed
  }

  async function startWatch() {
    if (watcher || !isWin) return;
    try {
      const exe = await helperExe(deps.log);
      if (watcher) return;
      const p = spawn(exe, ["frontwatch", String(process.pid)], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
      watcher = p;
      let buf = "";
      p.stdout?.on("data", (b: Buffer) => {
        buf += b.toString();
        let i;
        while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1); if (line) onFront(line); }
      });
      p.on("exit", () => { if (watcher === p) watcher = null; });
      deps.log("lock on");
    } catch (e) { deps.log("lock: couldn't watch the window in front", (e as Error)?.message || e); }
  }
  function stopWatch() {
    if (lockWin) hideLock();   // even if the helper already ended: a lock card never outlives the lock
    if (!watcher) return;
    try { watcher.kill(); } catch { /* gone */ }
    watcher = null;
    deps.log("lock off");
  }

  /** The lock card's buttons: back to work, or unlock early (after the wait and the sentence, checked in the card). */
  function lockAction(action: string) {
    const f = focusOf();
    if (action === "unlock" && f) {
      unlockedFor = f.startedAt;
      deps.emit("lock-unlock", JSON.stringify({ taskId: f.taskId, what: lockShown?.what || "" }));
      deps.log("lock unlocked early", lockShown?.what || "");
      stopWatch();
    } else hideLock();
  }

  /** Every couple of seconds: start or stop watching, and close a gate whose moment has passed. */
  function tick() {
    const now = Date.now(), f = focusOf();
    if (gate && (now > gate.end || now - gate.opened > MAX_GATE || f?.taskId === gate.taskId)) { deps.log("gate closed by itself", gate.key); closeGate(); }
    const until = lockedUntil(f, now, cfgOf());
    if (until && !(f && unlockedFor === f.startedAt)) startWatch(); else stopWatch();
  }
  const timer = setInterval(tick, 2000);

  return {
    maybeGate, gateAction, lockAction, hold,
    gateOpen: () => !!gate,
    stop() { clearInterval(timer); closeGate(); stopWatch(); },
    /** For the tray: get out of a gate if something went wrong. */
    closeGate,
  };
}
