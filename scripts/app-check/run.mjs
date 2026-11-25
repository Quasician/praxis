// Release checks (4.3): starts the built app against a stand-in Todoist, opens it in a real browser, and clicks through the
// main screens and rituals the way you would. Every release waits for these to pass (.github/workflows).
//
//   npm run build && npm run check:app
//
// Set PRAXIS_CHECK_CHANNEL=chrome to use an installed Chrome instead of Playwright's own Chromium,
// and PRAXIS_CHECK_SHOTS=folder to keep a screenshot of each step.
process.env.TZ = "America/Los_Angeles";
import { chromium } from "playwright";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { startFakeTodoist } from "./fake-todoist.mjs";

const PKG = JSON.parse(fs.readFileSync("package.json", "utf8"));
const FAKE_PORT = Number(process.env.PRAXIS_CHECK_FAKE_PORT) || 4998;
const APP_PORT = Number(process.env.PRAXIS_CHECK_PORT) || 4597;
const BASE = `http://localhost:${APP_PORT}`;
const SHOTS = process.env.PRAXIS_CHECK_SHOTS || "";
const DAY = 864e5;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// The checks run at 10 in the morning of today, whatever time it really is.
const now = new Date(); now.setHours(10, 0, 0, 0);
const today = ymd(now);

// ---------- a data folder with ten days of history and settings from before 4.3 (no version number) ----------
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "praxis-check-"));
const history = {};
for (let n = 1; n <= 10; n++) history[ymd(new Date(+now - n * DAY))] = { committedAt: "x", planned: [
  { id: `h${n}-0`, content: "Morning block", wp: 3, project: "work", committed: true, min: 60, start: 540 },
  { id: `h${n}-1`, content: "Evening block", wp: 2, project: "home", committed: true, min: 60, start: 1140 },
] };
fs.writeFileSync(path.join(dataDir, "praxis.config.json"), JSON.stringify({
  areas: [{ id: "a1", name: "Home", color: "blue", projects: ["home"] }, { id: "a2", name: "Music", color: "violet", projects: ["music"] }, { id: "a3", name: "Work", color: "green", projects: ["work"] }],
  planner: { lastAuto: today, morningCommit: true, selfHeal: false, sundayLetter: false, workDays: [], dayStart: "07:00", dayEnd: "21:30" },
  history, lastOpen: today, lastSeenVersion: PKG.version, ui: { theme: "light" },
  // The projects have been in the sky for two months (a project Praxis has only just seen counts as brand new, never as stalled).
  sky: { dust: {}, cons: Object.fromEntries(["m1", "m2", "m3"].map((id) => [id, { name: id, since: new Date(+now - 60 * DAY).toISOString(), steps: [] }])) },
}));

const fake = startFakeTodoist(FAKE_PORT, now);
const app = spawn(process.execPath, ["dist/server/standalone.cjs"], {
  env: { ...process.env, PORT: String(APP_PORT), PRAXIS_DATA_DIR: dataDir, TODOIST_TOKEN: "check", TODOIST_BASE: `http://127.0.0.1:${FAKE_PORT}` },
  stdio: ["ignore", "pipe", "pipe"],
});
let appLog = "";
app.stdout.on("data", (b) => (appLog += b)); app.stderr.on("data", (b) => (appLog += b));

const config = async () => (await fetch(`${BASE}/api/config`, { headers: { "X-Planner": "1" } })).json();
async function waitFor(fn, what, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* not yet */ }
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

const results = [];
let browser, page;
const pageErrors = [];
async function check(name, fn) {
  try { await fn(); results.push([true, name]); console.log(`  ✓ ${name}`); }
  catch (e) { results.push([false, name, e.message]); console.log(`  ✗ ${name}\n      ${String(e.message).split("\n")[0]}`); }
  if (SHOTS && page) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${results.length}-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`) }).catch(() => undefined); }
}
const tick = async (ms = 1500) => { await page.clock.runFor(ms); await page.waitForTimeout(250); };

try {
  await waitFor(async () => (await fetch(`${BASE}/api/status`, { headers: { "X-Planner": "1" } })).ok, "the app's server");
  browser = await chromium.launch({ ...(process.env.PRAXIS_CHECK_CHANNEL ? { channel: process.env.PRAXIS_CHECK_CHANNEL } : {}), args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1000 }, timezoneId: "America/Los_Angeles", colorScheme: "light" });
  page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.clock.install({ time: now });
  page.setDefaultTimeout(10000);
  console.log(`Praxis ${PKG.version}: release checks`);

  await check("settings from before 4.3 are upgraded (versioned, the canvas on)", async () => {
    const c = await config();
    if (!(c.configVersion >= 2)) throw new Error(`configVersion is ${c.configVersion}`);
    if (c.ui?.canvas !== true) throw new Error("the canvas wasn't switched on");
    if (Object.keys(c.history || {}).length !== 10) throw new Error("history was not kept");
  });
  await check("the day opens on the canvas with today's tasks", async () => {
    await page.goto(BASE); await page.waitForSelector("#canvas"); await tick(3000);
    await waitFor(async () => (await page.locator("#list li.task").count()) >= 4, "four tasks in the list");
  });
  await check("the week view drafts the week", async () => {
    await page.click('[data-view="week"]'); await tick();
    await page.waitForSelector("#week-view .week-board");
  });
  await check("the sky shows the projects as constellations", async () => {
    await page.click('[data-view="areas"]'); await tick();
    await waitFor(async () => (await page.locator(".cvs-con, .sky-con").count()) >= 2, "two constellations");
  });
  await check("progress leads with what the record says", async () => {
    await page.click('[data-view="progress"]'); await tick();
    await waitFor(async () => (await page.locator("#pv-says li").count()) >= 1, "a finding");
  });
  await check("the morning commit opens in the ritual panel and commits", async () => {
    await page.click('[data-view="day"]'); await tick(500);
    await page.keyboard.press("m"); await tick(3000);
    await page.waitForSelector('.ritual-panel[data-ritual="morning"] #mc-commit:not([disabled])');
    await page.click("#mc-commit"); await tick(3000);
    await waitFor(async () => (await config()).history?.[today]?.committedAt, "today's commitment in the settings");
    if (!fake.sent.some((c) => c.type === "item_update" && c.args?.due?.date?.startsWith(today))) throw new Error("no block was sent to Todoist");
  });
  await check("the weekly review sets a stalled project down", async () => {
    await page.click("#menu-btn"); await page.click("#review-btn"); await tick(2000);
    const card = page.locator(".rv-stalled", { hasText: "Learn the piano piece" });
    await card.locator('[data-do="rest"]').click(); await tick(2000);
    await card.locator(".rv-answer").waitFor();
    await page.click("#review-done"); await tick(1000);
    const c = await waitFor(async () => { const x = await config(); return x.sky?.cons?.m2?.rest && Object.keys(x.reviews || {}).length ? x : null; }, "the review saved");
    if (!c.sky.cons.m2.rest) throw new Error("project not set down");
  });
  await check("the shutdown opens with S and closes with Esc", async () => {
    await page.keyboard.press("s"); await tick();
    await page.waitForSelector('.ritual-panel[data-ritual="shutdown"]');
    await page.keyboard.press("Escape"); await tick(500);
    if (await page.locator(".ritual-panel").count()) throw new Error("the panel didn't close");
  });
  await check("the canvas zooms, and the four tabs are still there when it's switched off", async () => {
    await page.click('[data-view="week"]'); await tick(); await page.waitForSelector(".cv-bottom.week #week-view");
    await page.click('[data-view="areas"]'); await tick(); await page.waitForSelector('#canvas[data-zoom="sky"]');
    await page.click('[data-view="progress"]'); await tick(); await page.waitForSelector("#cv-drawer #pv-says");
    await page.keyboard.press("Escape"); await tick(500);
    if (await page.locator("#cv-drawer").count()) throw new Error("the numbers didn't close");
    await page.click('[data-view="day"]'); await tick(500);
    await page.click("#menu-btn"); await page.click("#canvas-layout"); await tick(1500);   // off: the tabs
    await page.waitForSelector("main.layout #list li.task");
    await page.click('[data-view="areas"]'); await tick(); await waitFor(async () => (await page.locator(".sky-con").count()) >= 2, "the Sky tab");
    await page.click("#menu-btn"); await page.click("#canvas-layout"); await tick(1500);   // and back on
    await page.waitForSelector("#canvas");
  });
  await check("diagnostics gather nothing private", async () => {
    const d = await (await fetch(`${BASE}/api/diagnostics`, { headers: { "X-Planner": "1" } })).json();
    if (!d.settings || !(d.settings.configVersion >= 2)) throw new Error("no settings in the diagnostics");
    const text = JSON.stringify(d);
    for (const secret of ["check", "Learn the piano piece", "Morning block"]) if (text.includes(`"${secret}"`) || text.includes(secret + "\"")) throw new Error(`diagnostics include "${secret}"`);
  });
  await check("no errors in the page", async () => { if (pageErrors.length) throw new Error(pageErrors.slice(0, 3).join(" | ")); });
} catch (e) {
  results.push([false, "setup", e.message]); console.log(`  ✗ setup: ${e.message}`);
} finally {
  await browser?.close().catch(() => undefined);
  app.kill(); fake.server.close();
}
const failed = results.filter((r) => !r[0]);
console.log(failed.length ? `\n${failed.length} of ${results.length} checks failed.` : `\nAll ${results.length} checks passed.`);
if (failed.length && appLog) console.log("\nApp output:\n" + appLog.slice(-3000));
process.exit(failed.length ? 1 : 0);
