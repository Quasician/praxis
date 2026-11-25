// 4.3 the settings file's version and its upgrade steps, and what happens to a file that can't be read.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { CONFIG_VERSION, migrate } from "../server/migrate";
import { createStore } from "../server/store";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "praxis-cfg-"));

test("migrate: a file with no version is brought up to the current one, and nothing in it is lost", () => {
  const old = { planner: { commitCount: 3 }, history: { "2026-11-24": { planned: [] } }, sky: { cons: {}, dust: {} }, somethingNew: [1, 2] };
  const m = migrate(old);
  assert.equal(m.from, 0); assert.equal(m.changed, true);
  assert.equal(m.config.configVersion, CONFIG_VERSION);
  for (const k of Object.keys(old)) assert.deepEqual(m.config[k], (old as Record<string, unknown>)[k]);
});
test("migrate: a current file is left as it is; a newer one (after going back a version) is untouched", () => {
  const cur = { configVersion: CONFIG_VERSION, ui: { canvas: true } };
  assert.equal(migrate(cur).changed, false);
  const newer = { configVersion: CONFIG_VERSION + 5, future: true };
  const m = migrate(newer);
  assert.equal(m.newer, true); assert.equal(m.changed, false); assert.equal(m.config, newer);
});
test("store: reading an old file upgrades it on disk", () => {
  const dir = tmp(), file = path.join(dir, "praxis.config.json");
  fs.writeFileSync(file, JSON.stringify({ planner: { fill: 70 } }));
  const s = createStore(dir);
  assert.equal(s.readConfig().configVersion, CONFIG_VERSION);
  const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(onDisk.configVersion, CONFIG_VERSION); assert.equal(onDisk.planner.fill, 70);
});
test("store: a file that can't be read is moved aside, not overwritten", () => {
  const dir = tmp(), file = path.join(dir, "praxis.config.json");
  fs.writeFileSync(file, "{ this is not json");
  const s = createStore(dir);
  const warn = console.warn; console.warn = () => undefined;
  try { assert.deepEqual(s.readConfig(), {}); } finally { console.warn = warn; }
  assert.equal(fs.existsSync(file), false);
  const aside = fs.readdirSync(dir).filter((n) => n.startsWith("praxis.config.unreadable-"));
  assert.equal(aside.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, aside[0]), "utf8"), "{ this is not json");
});
test("store: no file yet means empty settings, and nothing is created by reading", () => {
  const dir = tmp();
  assert.deepEqual(createStore(dir).readConfig(), {});
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith(".json")), []);
});

test("migrate 2 (4.4): the canvas becomes the default and a valley wallpaper moves to the city", () => {
  const m = migrate({ configVersion: 1, ui: { theme: "dark", canvas: false }, wallpaper: { enabled: true, scene: "valley", live: true } });
  assert.deepEqual(m.config.ui, { theme: "dark", canvas: true });
  assert.deepEqual(m.config.wallpaper, { enabled: true, scene: "city", live: true });
  const none = migrate({ configVersion: 1 });
  assert.deepEqual(none.config.ui, { canvas: true });
  assert.equal("wallpaper" in none.config, false);   // no wallpaper settings: none are made up
});
