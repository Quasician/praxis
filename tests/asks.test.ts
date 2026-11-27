// 5.0 one thing asking at a time, and the short what's-new card.
import test from "node:test";
import assert from "node:assert/strict";
import { pickAsk, pickNudge, GENTLE_GAP } from "../src/domain/asks";
import { NEWS, newer, newsSince } from "../src/data/news";

test("in the app: the most important ask shows, the rest wait; nothing while a ritual is open", () => {
  assert.deepEqual(pickAsk({ "whats-new": true, "check-in": true, "heal-note": true }), { now: "check-in", waiting: 2 });
  assert.deepEqual(pickAsk({ "whats-new": true }), { now: "whats-new", waiting: 0 });
  assert.deepEqual(pickAsk({ "check-in": true }, true), { now: null, waiting: 1 });
  assert.deepEqual(pickAsk({}), { now: null, waiting: 0 });
});

test("on the desktop: one reminder at a time, gentle ones spaced out, nothing while the gate is up", () => {
  const start = { kind: "start" }, ended = { kind: "block-end" }, heads = { kind: "heads-up" };
  assert.equal(pickNudge([heads, start], { looking: false, gateOpen: false, sinceLast: 1e9 }).show, start);   // tied to a moment: first
  assert.equal(pickNudge([ended], { looking: false, gateOpen: false, sinceLast: GENTLE_GAP - 1 }).show, null);   // too soon after the last
  assert.equal(pickNudge([ended], { looking: false, gateOpen: false, sinceLast: GENTLE_GAP }).show, ended);
  const r = pickNudge([ended, start], { looking: true, gateOpen: false, sinceLast: 1e9 });
  assert.equal(r.show, start); assert.deepEqual(r.settle, [ended]);   // looking at Praxis: the check-in asks there
  assert.equal(pickNudge([start], { looking: false, gateOpen: true, sinceLast: 1e9 }).show, null);
});

test("what's new: the versions since the one you saw, newest first, at most three", () => {
  assert.equal(newer("5.0.0", "4.7.0"), true); assert.equal(newer("4.10.0", "4.9.1"), true); assert.equal(newer("4.7.0", "4.7.0"), false);
  assert.deepEqual(newsSince("4.6.0", "5.0.0").map((n) => n.v), ["5.0.0", "4.7.0"]);
  assert.deepEqual(newsSince("5.0.0", "5.0.0"), []);
  assert.deepEqual(newsSince(undefined, "5.0.0"), []);   // a fresh install has nothing to announce
  assert.ok(NEWS.every((n) => n.lines.length >= 1 && n.lines.every((l) => l.length < 160)), "keep each line short");
});
