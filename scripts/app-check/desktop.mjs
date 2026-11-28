// 5.0 The desktop check: starts the real Praxis desktop app (Electron, the built dist/), not just its pages in a browser,
// against the stand-in Todoist, and checks the parts only the desktop app has:
//   1. a block starting opens the full-screen gate (a window per screen), and skipping it with a reason closes the gate
//      and lands in the day's record;
//      (on Windows, a window coming up in front of the gate — as Alt+Tab would — loses the front straight back to it);
//   2. on Windows, the focus lock: an app you locked (here Notepad) is covered by the lock card while a timer runs.
// Run: npm run build && npm run check:desktop   (on Linux, under xvfb-run).
import { _electron as electron } from "playwright";
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { startFakeTodoist } from "./fake-todoist.mjs";

const PKG = JSON.parse(fs.readFileSync("package.json", "utf8"));
const FAKE_PORT = 4791, APP_PORT = 4792, BASE = `http://localhost:${APP_PORT}`;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const isWin = process.platform === "win32";

async function waitFor(fn, what, ms = 30000) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* not yet */ }
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 400));
  }
}
const api = async (p, body) => (await fetch(`${BASE}${p}`, { method: body ? "POST" : "GET", headers: { "X-Planner": "1", ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();

// A block that starts on the next whole minute (the reminders run on the real clock here).
const now = new Date();
const start = new Date(now); start.setSeconds(0, 0); start.setMinutes(start.getMinutes() + 1);
if (start.getDate() !== now.getDate()) { console.log("Skipping the desktop check right at midnight."); process.exit(0); }
const fake = startFakeTodoist(FAKE_PORT, now, { bare: true });
fake.addTask({ id: "g1", content: "Gate check block", project_id: "home", due: { date: `${ymd(start)}T${hm(start)}:00` }, duration: { amount: 30, unit: "minute" } });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "praxis-desktop-"));
fs.writeFileSync(path.join(dir, "praxis.config.json"), JSON.stringify({
  configVersion: 2, lastOpen: ymd(now), lastSeenVersion: PKG.version,
  planner: { lastAuto: ymd(now), morningCommit: false, selfHeal: false, sundayLetter: false, weeklyAuto: false, dayStart: "00:00", dayEnd: "23:59" },
  ui: { theme: "dark", canvas: true }, reminders: { style: "overlay", sound: false, timeChecks: 0, shutdown: false, windDown: false },
  focusLock: { gate: true, lock: true, apps: ["notepad"], sites: ["reddit"] },
  wallpaper: { enabled: false },
}));
fs.writeFileSync(path.join(dir, "desktop.json"), JSON.stringify({ edgeStrip: false }));

const results = [];
let app, fail = false;
async function check(name, fn) {
  try { await fn(); results.push(["✓", name]); console.log(`  ✓ ${name}`); }
  catch (e) { fail = true; results.push(["✗", name, e.message]); console.log(`  ✗ ${name}\n      ${e.message}`); }
}

try {
  app = await electron.launch({
    args: [...(isWin ? [] : ["--no-sandbox"]), "dist/electron/main.cjs"],
    env: { ...process.env, PRAXIS_USER_DATA: dir, PRAXIS_PORT: String(APP_PORT), TODOIST_TOKEN: "check", TODOIST_BASE: `http://127.0.0.1:${FAKE_PORT}`, PRAXIS_NO_UPDATES: "1" },
    timeout: 60000,
  });
  const main = await app.firstWindow();
  main.on("pageerror", (e) => { fail = true; console.log(`  page error: ${e.message}`); });

  await check("the desktop app starts and shows today", async () => {
    await waitFor(async () => (await main.locator("#list li.task", { hasText: "Gate check block" }).count()) === 1, "the block in today's list", 45000);
  });

  await check("a block starting opens the gate on every screen; skipping it closes the gate and goes in the record", async () => {
    console.log(`    (waiting for ${start.toLocaleTimeString()})`);
    const gate = await waitFor(async () => app.windows().find((w) => w.url().includes("gate=") && w.url().includes("%22main%22%3Atrue")), "the gate window", 150000);
    await gate.waitForSelector("#gate-title");
    if (!(await gate.locator("#gate-title").textContent()).includes("Gate check block")) throw new Error("the gate names another block");
    const screens = app.windows().filter((w) => w.url().includes("gate=")).length;
    if (screens < 1) throw new Error("no gate windows");
    // Always on top and not closable (Linux has neither without a window manager, so only Windows and macOS are held to it).
    const flags = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.getURL().includes("gate=")).map((w) => ({ top: w.isAlwaysOnTop(), closable: w.isClosable(), full: w.getBounds() })));
    console.log(`    (gate windows: ${JSON.stringify(flags)})`);
    if (process.platform !== "linux" && !flags.every((f) => f.top && !f.closable)) throw new Error("the gate isn't always on top, or can be closed");
    if (isWin) {
      // 5.0.1: another window taking the screen (as Alt+Tab would) doesn't get rid of the gate: it comes back in front.
      const np = spawn("notepad.exe", [], { detached: true, stdio: "ignore" });
      try {
        const pid = await app.evaluate(() => process.pid);
        const helper = fs.readdirSync("native-build").find((f) => /^praxis-wall-.*\.exe$/.test(f));
        const front = () => new Promise((res) => { const p = spawn(path.join("native-build", helper), ["front"]); let out = ""; p.stdout.on("data", (b) => (out += b)); p.on("close", () => res(out.trim())); });
        await new Promise((r) => setTimeout(r, 3000));   // Notepad opens and takes the front (if this machine lets it)
        const back = await waitFor(async () => { const f = await front(); return f.split("\t")[1] === String(pid) ? f : null; }, "the gate back in front", 10000).catch(() => null);
        if (!back) {
          const f = await front();
          if (/notepad\.exe/i.test(f)) throw new Error(`Notepad stayed in front of the gate (${f})`);
          console.log(`    (nothing could take the front on this machine (${f}); the gate holding the screen isn't checked here)`);
        }
        const stillOpen = app.windows().some((w) => w.url().includes("gate="));
        if (!stillOpen) throw new Error("the gate closed when another window came up");
      } finally { try { process.kill(np.pid); } catch { /* gone */ } spawn("taskkill", ["/IM", "notepad.exe", "/F"], { stdio: "ignore" }); }
    }
    await gate.click("#gate-skip");
    await gate.fill("#gate-why", "checking the gate");
    await gate.click("#gate-skip-go", { noWaitAfter: true }).catch((e) => { if (!/closed/i.test(e.message)) throw e; });   // the gate closes as it's answered
    await waitFor(async () => !app.windows().some((w) => w.url().includes("gate=")), "the gate to close");
    const c = await waitFor(async () => { const x = await api("/api/config"); return x.history?.[ymd(now)]?.actual?.g1?.o === "skipped" ? x : null; }, "the skip in the record");
    if (c.history[ymd(now)].actual.g1.why !== "checking the gate") throw new Error(`the reason wasn't kept: ${c.history[ymd(now)].actual.g1.why}`);
    if (!c.history[ymd(now)].gate?.some((g) => g.id === "g1" && g.choice === "skip")) throw new Error("the gate choice isn't in the record");
  });

  if (isWin) {
    await check("the focus lock covers a locked app while a timer runs", async () => {
      const cfg = await api("/api/config");
      await api("/api/config", { ...cfg, focus: { taskId: "g1", content: "Gate check block", startedAt: new Date().toISOString(), minutes: 10, lock: true } });
      const np = spawn("notepad.exe", [], { detached: true, stdio: "ignore" });
      try {
        // Which window is in front, as the lock sees it (the helper built next to the app).
        const helper = fs.readdirSync("native-build").find((f) => /^praxis-wall-.*\.exe$/.test(f));
        const front = () => new Promise((res) => { const p = spawn(path.join("native-build", helper), ["front"]); let out = ""; p.stdout.on("data", (b) => (out += b)); p.on("close", () => res(out.trim())); });
        const inFront = await waitFor(async () => /notepad\.exe/i.test(await front()), "Notepad in front", 15000).catch(() => false);
        if (!inFront) { console.log(`    (Notepad couldn't come to the front on this machine (${await front()}); the lock card isn't checked here)`); return; }
        const lock = await waitFor(async () => app.windows().find((w) => w.url().includes("lock=")), "the lock card over Notepad", 30000);
        await lock.waitForSelector("#lock");
        if (!(await lock.locator("#lock").textContent()).includes("locked")) throw new Error("the lock card doesn't say what's locked");
        await lock.click("#lock-back", { noWaitAfter: true }).catch((e) => { if (!/closed/i.test(e.message)) throw e; });
      } finally { try { process.kill(np.pid); } catch { /* gone */ } spawn("taskkill", ["/IM", "notepad.exe", "/F"], { stdio: "ignore" }); }
      await api("/api/config", { ...(await api("/api/config")), focus: null });
    });
  }
} catch (e) {
  fail = true;
  console.log(`  ✗ the desktop app: ${e.message}`);
} finally {
  try { const log = fs.readFileSync(path.join(dir, "praxis.log"), "utf8"); if (fail) console.log("\n--- praxis.log ---\n" + log.split("\n").slice(-40).join("\n")); } catch { /* no log */ }
  await app?.close().catch(() => undefined);
  fake.server.close();
}
console.log(fail ? `${results.filter((r) => r[0] === "✗").length || 1} desktop check(s) failed.` : `All ${results.length} desktop checks passed.`);
process.exit(fail ? 1 : 0);
