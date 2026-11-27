// 4.7 the block gate and the focus lock: what counts as locked, when the lock is on, and when the gate opens.
import test from "node:test";
import assert from "node:assert/strict";
import { blockedBy, gates, lockCfg, lockedUntil, moveChoices, splitList } from "../src/domain/focuslock";
import { withGate, withUnlock } from "../src/domain/actuals";

const cfg = lockCfg(undefined);
const f = (exe: string, title = "") => blockedBy({ exe, title }, cfg);

test("defaults: the gate and the lock on, Firefox, Steam and Reddit locked", () => {
  assert.deepEqual(cfg, { gate: true, committedOnly: false, lock: true, apps: ["firefox", "steam"], sites: ["reddit"] });
  assert.deepEqual(splitList(" Firefox.exe, steam ,\nreddit.com,, "), ["firefox", "steam", "reddit.com"]);
  assert.deepEqual(lockCfg({ apps: [] }).apps, []);   // you can lock nothing
});

test("apps: by program name; Steam covers its other windows and its games", () => {
  assert.equal(f("C:\\Program Files\\Mozilla Firefox\\firefox.exe", "Todoist — Mozilla Firefox"), "Firefox");
  assert.equal(f("C:\\Program Files (x86)\\Steam\\steam.exe"), "Steam");
  assert.equal(f("C:\\Program Files (x86)\\Steam\\bin\\cef\\cef.win7x64\\steamwebhelper.exe", "Steam"), "Steam");
  assert.equal(f("D:\\SteamLibrary\\steamapps\\common\\Hades\\Hades.exe", "Hades"), "Steam");
  assert.equal(f("C:\\Program Files\\Microsoft VS Code\\Code.exe", "praxis — Visual Studio Code"), null);
  assert.equal(f("C:\\Users\\t\\AppData\\Local\\Programs\\Praxis\\Praxis.exe", "Praxis"), null);
});

test("sites: a word in a browser tab's title, in any browser, not in other programs", () => {
  assert.equal(f("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "Reddit - Dive into anything - Google Chrome"), "Reddit");
  assert.equal(f("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", "r/MechanicalKeyboards on Reddit — Microsoft Edge"), "Reddit");
  assert.equal(f("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "Todoist - Google Chrome"), null);
  assert.equal(f("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "Shredditor docs - Google Chrome"), null);   // whole words only
  assert.equal(f("C:\\Windows\\notepad.exe", "reddit notes.txt - Notepad"), null);
  assert.equal(blockedBy({ exe: "C:\\x\\chrome.exe", title: "youtube.com/watch - Chrome" }, { apps: [], sites: ["youtube.com"] }), "YouTube");
});

test("the lock is on while a locked focus timer runs, off once it ends, once unlocked, or with the setting off", () => {
  const start = Date.parse("2026-11-26T15:00:00"), focus = { taskId: "a", content: "Write", startedAt: new Date(start).toISOString(), minutes: 60, lock: true };
  assert.equal(lockedUntil(focus, start + 10 * 60_000, cfg), start + 60 * 60_000);
  assert.equal(lockedUntil(focus, start + 61 * 60_000, cfg), null);
  assert.equal(lockedUntil({ ...focus, unlockedAt: new Date(start).toISOString() }, start + 60_000, cfg), null);
  assert.equal(lockedUntil({ ...focus, lock: false }, start + 60_000, cfg), null);
  assert.equal(lockedUntil(focus, start + 60_000, { lock: false }), null);
  assert.equal(lockedUntil(null, start, cfg), null);
});

test("the gate: every block, or only committed ones; moves stay today, rounded to 5 minutes", () => {
  assert.equal(gates(cfg, false), true);
  assert.equal(gates({ ...cfg, committedOnly: true }, false), false);
  assert.equal(gates({ ...cfg, committedOnly: true }, true), true);
  assert.equal(gates({ ...cfg, gate: false }, true), false);
  const at = (h: number, m: number) => { const d = new Date(); d.setHours(h, m, 0, 0); return d; };
  assert.deepEqual(moveChoices(at(15, 2)), [15 * 60 + 20, 15 * 60 + 35, 16 * 60 + 5]);
  assert.deepEqual(moveChoices(at(23, 30)), [23 * 60 + 45]);
});

test("the record keeps gate choices and early unlocks; unlocking marks the running timer", () => {
  const day = "2026-11-26";
  let c = withGate({}, day, "a", "skip");
  c = withGate(c, day, "b", "start");
  assert.deepEqual(c.history?.[day]?.gate?.map((g) => [g.id, g.choice]), [["a", "skip"], ["b", "start"]]);
  c = { ...c, focus: { taskId: "b", content: "b", startedAt: "2026-11-26T15:00:00Z", minutes: 30, lock: true } };
  c = withUnlock(c, day, "b", "Firefox");
  assert.ok(c.focus?.unlockedAt);
  assert.deepEqual(c.history?.[day]?.unlocked?.map((u) => [u.id, u.what]), [["b", "Firefox"]]);
});
