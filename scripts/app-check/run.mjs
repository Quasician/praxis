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
  await check("a block that ended asks how it went; Done ticks it off and keeps the real length", async () => {
    const card = page.locator("#check-in", { hasText: "Morning pages" });
    await card.waitFor();
    await page.click("#ci-done"); await tick(1500);
    await page.click('#check-in [data-min="45"]'); await tick(1500);
    await waitFor(() => fake.sent.some((c) => c.type === "close" && c.id === "e0"), "the block ticked off in Todoist");
    const c = await waitFor(async () => { const x = await config(); return x.history?.[today]?.actual?.e0?.min === 45 ? x : null; }, "the answer saved");
    if (c.history[today].actual.e0.o !== "done") throw new Error(`saved as ${c.history[today].actual.e0.o}`);
    const s = (c.samples || []).at(-1);
    if (!s || s.est !== 30 || s.actual !== 45) throw new Error(`no sample for the real length: ${JSON.stringify(s)}`);
    if (await page.locator("#check-in").count()) throw new Error("the check-in didn't go away");
  });
  await check("a task ticked off in Todoist (on your phone) shows as done within a minute", async () => {
    await waitFor(async () => (await page.locator("#list li.task", { hasText: "Order the groceries" }).count()) === 1, "the repeating task in today's list");
    fake.completeOutside("r0");
    await tick(31_000);   // one look at Todoist's activity log
    await waitFor(async () => (await page.locator("#list li.task", { hasText: "Order the groceries" }).count()) === 0, "the task gone from the open list");
    await waitFor(async () => (await page.locator("#done-today li", { hasText: "Order the groceries" }).count()) === 1, "the task under Done today");
  });
  await check("the block gate asks start, move or skip; the lock card makes unlocking slow", async () => {
    const g = await ctx.newPage();
    await g.clock.install({ time: new Date(+now + 3 * 3600e3) });   // 1 PM
    g.on("pageerror", (e) => pageErrors.push(`gate: ${e.message}`));
    await g.setViewportSize({ width: 1600, height: 900 });
    const posts = [];
    await g.route("**/api/desktop/**", async (r) => { posts.push({ url: new URL(r.request().url()).pathname, body: JSON.parse(r.request().postData() || "{}") }); await r.fulfill({ status: 200, contentType: "application/json", body: "{\"ok\":true}" }); });
    const start = +now + 3 * 3600e3, job = { key: "start:x", taskId: "t0", title: "Write the report", start, end: start + 3600e3, main: true };
    await g.goto(`${BASE}/?gate=${encodeURIComponent(JSON.stringify(job))}&theme=dark`); await g.clock.runFor(500);
    if (!(await g.locator("#gate-title").textContent()).includes("Write the report")) throw new Error("the gate doesn't name the block");
    for (const id of ["#gate-start", "#gate-move", "#gate-skip"]) await g.locator(id).waitFor();
    if (SHOTS) await g.screenshot({ path: path.join(SHOTS, "gate.png") });
    await g.click("#gate-skip");
    if (!(await g.locator("#gate-skip-go").isDisabled())) throw new Error("skipping needs a reason");
    await g.fill("#gate-why", "the call ran over"); await g.click("#gate-skip-go"); await g.clock.runFor(300);
    await waitFor(() => posts.some((p) => p.url === "/api/desktop/gate" && p.body.action === "skip" && p.body.reason === "the call ran over"), "the skip sent with its reason");
    await g.goto(`${BASE}/?gate=${encodeURIComponent(JSON.stringify(job))}&theme=dark`); await g.clock.runFor(500);
    await g.click("#gate-move"); await g.click("[data-at]");
    await waitFor(() => posts.some((p) => p.body.action === "move" && p.body.at === 13 * 60 + 15), "the move sent with a new time");
    await g.goto(`${BASE}/?gate=${encodeURIComponent(JSON.stringify({ ...job, main: false }))}&theme=dark`); await g.clock.runFor(300);
    if (await g.locator("#gate-start").count()) throw new Error("the other screens shouldn't have the buttons");
    const lock = { what: "Firefox", title: "Write the report", until: start + 3600e3 };
    await g.goto(`${BASE}/?lock=${encodeURIComponent(JSON.stringify(lock))}&theme=dark`); await g.clock.runFor(500);
    if (!(await g.locator("#lock").textContent()).includes("Firefox is locked")) throw new Error("the lock card doesn't say what's locked");
    if (SHOTS) await g.screenshot({ path: path.join(SHOTS, "lock.png") });
    await g.click("#lock-ask");
    if (!(await g.locator("#lock-phrase").isDisabled())) throw new Error("unlocking should make you wait first");
    await g.clock.runFor(61_000);
    await g.fill("#lock-phrase", "I'm choosing to stop");
    await g.click("#lock-unlock");
    await waitFor(() => posts.some((p) => p.url === "/api/desktop/lock" && p.body.action === "unlock"), "the unlock sent");
    await g.close();
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
    // 4.6: one of the planned tasks gets ticked off "on your phone" while the plan is open: the commit must leave it alone.
    const ids = await page.$$eval('.ritual-panel[data-ritual="morning"] .mc-row', (els) => els.map((e) => e.dataset.id));
    if (ids.length < 2) throw new Error(`only ${ids.length} block in the plan`);
    const gone = ids[ids.length - 1];
    fake.completeOutside(gone);
    await page.click("#mc-commit"); await tick(3000);
    await waitFor(async () => (await config()).history?.[today]?.committedAt, "today's commitment in the settings");
    if (!fake.sent.some((c) => c.type === "item_update" && c.args?.due?.date?.startsWith(today))) throw new Error("no block was sent to Todoist");
    if (fake.sent.some((c) => c.type === "item_update" && c.args?.id === gone)) throw new Error("the commit rescheduled a task finished meanwhile");
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
  await check("overlapping blocks: separate rows on the day, lanes on the edge strip, all of them named", async () => {
    await page.click('[data-view="day"]'); await tick(1000);
    const tops = await page.$$eval("#timeline .tl-block:not(.proposed)", (els) => Object.fromEntries(els.map((e) => [e.textContent.replace(/\s+/g, " ").trim().slice(0, 18), Math.round(e.getBoundingClientRect().top)])));
    const rows = ["Write the report", "Call the bank", "Review the slides"].map((t) => Object.entries(tops).find(([k]) => k.includes(t.slice(0, 12)))?.[1]);
    if (rows.some((r) => r === undefined)) throw new Error(`blocks missing on the day: ${JSON.stringify(tops)}`);
    if (new Set(rows).size !== 3) throw new Error(`overlapping blocks share a row: ${JSON.stringify(rows)}`);
    const strip = await ctx.newPage();
    await strip.clock.install({ time: now });
    strip.on("pageerror", (e) => pageErrors.push(`strip: ${e.message}`));
    await strip.setViewportSize({ width: 1920, height: 168 });   // the strip window's open height (electron/main.ts STRIP_OPEN_H)
    await strip.goto(`${BASE}/?strip=1`); await strip.clock.runFor(3000); await strip.waitForTimeout(300);
    const lanes = await strip.$$eval(".es-block", (els) => els.map((e) => e.dataset.lane));
    if (!lanes.includes("3/3")) throw new Error(`no three-lane blocks on the strip: ${lanes.join(" ")}`);
    const x = Math.round(((14 * 60 + 20 - 6 * 60) / (18 * 60)) * 1920);
    await strip.evaluate((x) => window.dispatchEvent(new CustomEvent("praxis:strip", { detail: { open: true, x } })), x); await strip.clock.runFor(300); await strip.waitForTimeout(200);
    const card = await strip.locator("#es-card").textContent();
    // Two titles per line, then "+N more": the three at 2 PM show as two names and "+1 more".
    for (const t of ["Stand-up notes", "Inbox zero", "Write the report", "Call the bank", "+1 more"]) if (!card.includes(t)) throw new Error(`the strip's card doesn't name "${t}": ${card}`);
    const fits = await strip.$eval("#es-card", (e) => e.getBoundingClientRect().bottom <= window.innerHeight);
    if (!fits) throw new Error("the strip's card is cut off at the bottom");
    if (SHOTS) await strip.screenshot({ path: path.join(SHOTS, "strip-card.png") });
    await strip.close();
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
