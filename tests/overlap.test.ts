// 4.5 overlapping blocks: the day's layout, what's on now and next, and reminders for blocks that start together.
import test from "node:test";
import assert from "node:assert/strict";
import { blocksAt, layoutBlocks, nextBlocks } from "../src/domain/layout";
import { dueNudges, REMINDER_DEFAULTS } from "../src/domain/nudges";
import type { Task } from "../src/lib/types";

const at = (h: number, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d; };
const floating = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:00`;
const task = (id: string, h: number, m: number, min: number): Task => ({ id, content: id, project_id: "p", priority: 1, due: { date: floating(at(h, m)) }, duration: { amount: min, unit: "minute" } });

test("layout: overlapping blocks get separate lanes; a block that only touches another shares its lane", () => {
  const b = layoutBlocks([task("a", 14, 0, 60), task("b", 14, 15, 30), task("c", 14, 30, 60), task("d", 15, 15, 30), task("e", 17, 0, 30)]);
  const by = Object.fromEntries(b.map((x) => [x.task!.id, x]));
  assert.equal(by.a.cols, 3); assert.equal(by.b.cols, 3); assert.equal(by.c.cols, 3); assert.equal(by.d.cols, 3);
  assert.notEqual(by.a.col, by.b.col); assert.notEqual(by.a.col, by.c.col);
  assert.equal(new Set([by.a.col, by.b.col, by.c.col]).size, 3);
  assert.equal(by.d.col, by.a.col);                 // a ends at 15:00, so d (15:15, still overlapping c) reuses its lane
  assert.equal(by.e.cols, 1);                       // on its own later
});

test("now and next: every block on now, and every block starting next, not just the first", () => {
  const b = layoutBlocks([task("a", 14, 0, 60), task("b", 14, 15, 30), task("c", 16, 0, 30), task("d", 16, 0, 45), task("e", 17, 0, 30)]);
  assert.deepEqual(blocksAt(b, 14 * 60 + 20).map((x) => x.task!.id), ["a", "b"]);
  assert.deepEqual(nextBlocks(b, 15 * 60).map((x) => x.task!.id).sort(), ["c", "d"]);
  assert.deepEqual(nextBlocks(b, 18 * 60), []);
});

const input = (now: Date, slots: { id: string; title: string; start: Date; end: Date }[]) => ({
  now, r: { ...REMINDER_DEFAULTS, headsUp: 5 }, shutdownAt: "23:00", windDownAt: "23:30", shutdownDone: false, focus: null, lastNudgeAt: 0, activeSince: +now,
  slots: slots.map((s) => ({ id: s.id, title: s.title, start: +s.start, end: +s.end })),
});

test("reminders: blocks that start together are one reminder naming all of them", () => {
  const sent = new Set<string>();
  const list = dueNudges(input(at(14, 1), [
    { id: "a", title: "Write the report", start: at(14), end: at(15) },
    { id: "b", title: "Call the bank", start: at(14), end: at(14, 30) },
  ]), sent);
  const start = list.filter((n) => n.kind === "start");
  assert.equal(start.length, 1);
  assert.equal(start[0].title, "Write the report + 1 more");
  assert.match(start[0].body, /Also starting: Call the bank \(until/);
  assert.deepEqual(start[0].key.split("|").sort(), [`start:a:${+at(14)}`, `start:b:${+at(14)}`]);
});

test("reminders: a block starting a minute after one already shown still gets its own reminder", () => {
  const slots = [{ id: "a", title: "A", start: at(14), end: at(15) }, { id: "b", title: "B", start: at(14, 2), end: at(14, 30) }];
  const sent = new Set<string>([`start:a:${+at(14)}`]);
  const list = dueNudges(input(at(14, 2), slots), sent).filter((n) => n.kind === "start");
  assert.equal(list.length, 1); assert.equal(list[0].title, "B"); assert.equal(list[0].key, `start:b:${+at(14, 2)}`);
});

test("reminders: heads-ups for blocks starting together name each one", () => {
  const list = dueNudges(input(at(13, 57), [
    { id: "a", title: "A", start: at(14), end: at(15) },
    { id: "b", title: "B", start: at(14), end: at(14, 30) },
  ]), new Set()).filter((n) => n.kind === "heads-up");
  assert.equal(list.length, 1); assert.equal(list[0].title, "A + 1 more"); assert.match(list[0].body, /Then: B at/);
});
