// 5.0 plan next to what happened: the trace of today's blocks, and what the day draws from it.
import test from "node:test";
import assert from "node:assert/strict";
import { noteSeen, traceOf } from "../src/domain/trace";
import type { DayRecord } from "../src/lib/types";

const b = (id: string, start: number, dur = 60) => ({ id, content: id, start, dur, project: "p" });
const T0 = Date.parse("2026-11-26T08:00:00");
const at = (min: number) => { const d = new Date(T0); d.setHours(0, 0, 0, 0); return +d + min * 60_000; };

test("blocks are noted where they sit; moving one before its time just updates it", () => {
  let r = noteSeen(undefined, [b("a", 600), b("b", 720)], 540, new Set(), at(540))!;
  assert.deepEqual(Object.keys(r.seen), ["a", "b"]);
  r = noteSeen(r, [b("a", 630), b("b", 720)], 541, new Set(), at(541))!;
  assert.equal(r.seen.a.s, 630); assert.equal(r.moves.length, 0);
  assert.equal(noteSeen(r, [b("a", 630), b("b", 720)], 542, new Set(), at(542)), null);   // nothing changed: nothing written
});

test("moving a block once its time has come leaves a move (a ghost); leaving the day too, after a grace", () => {
  let r = noteSeen(undefined, [b("a", 600), b("b", 660)], 590, new Set(), at(590))!;
  r = noteSeen(r, [b("a", 720), b("b", 660)], 605, new Set(), at(605))!;
  assert.deepEqual(r.moves.map((m) => [m.id, m.from, m.to]), [["a", 600, 720]]);
  r = noteSeen(r, [b("a", 720)], 665, new Set(), at(665))!;   // b left the day...
  assert.ok(r.seen.b.gone);
  assert.equal(noteSeen(r, [b("a", 720)], 666, new Set(), at(666)), null);   // ...waiting to see if it shows up as done
  r = noteSeen(r, [b("a", 720)], 669, new Set(), at(669))!;
  assert.deepEqual(r.moves.map((m) => [m.id, m.from, m.to]), [["a", 600, 720], ["b", 660, null]]);
  assert.equal(r.seen.b, undefined);
});

test("a finished block stays (no move); a future block taken off the day early leaves no ghost", () => {
  let r = noteSeen(undefined, [b("a", 600), b("c", 900)], 590, new Set(), at(590))!;
  assert.equal(noteSeen(r, [b("c", 900)], 650, new Set(["a"]), at(650)), null);
  r = noteSeen(r, [], 650, new Set(["a"]), at(650))!;
  r = noteSeen(r, [], 660, new Set(["a"]), at(660))!;
  assert.deepEqual(r.moves, []);
  assert.ok(r.seen.a && !r.seen.a.gone);
});

test("the day draws done blocks in place, ghosts for moves, and marks for skipped or partly", () => {
  const rec: DayRecord = { planned: [],
    seen: { a: { c: "Write", s: 600, m: 60 }, b: { c: "Call", s: 720, m: 30 }, c: { c: "Gym", s: 1080, m: 60 }, d: { c: "Read", s: 1200, m: 30 } },
    moves: [{ id: "b", c: "Call", from: 660, m: 30, to: 720, at: "" }, { id: "x", c: "Taxes", from: 540, m: 60, to: null, at: "" }],
    actual: { a: { o: "done", min: 75, at: "" }, c: { o: "skipped", at: "", why: "tired" }, d: { o: "partly", min: 10, at: "" } } };
  const t = traceOf(rec, new Set(["b", "c", "d"]), new Set(["a"]));
  assert.deepEqual(t.done.map((d) => [d.id, d.s, d.took]), [["a", 600, 75]]);
  assert.deepEqual(t.ghosts.map((g) => [g.id, g.s, g.to]), [["b", 660, 720], ["x", 540, null]]);
  assert.equal(t.marks.get("c"), "skipped"); assert.equal(t.marks.get("d"), "partly");
});
