// 4.2 forecasts: a finish date from a project's own pace, against its deadline.
import test from "node:test";
import assert from "node:assert/strict";
import { behindProjects, forecast, isBehind, whenText } from "../src/domain/forecast";
import { reviewProjects } from "../src/domain/review";
import type { SkyConstellation } from "../src/domain/sky";

const DAY = 864e5, NOW = Date.parse("2026-11-25T12:00:00");
const ago = (d: number) => new Date(NOW - d * DAY).toISOString();
const ymdIn = (d: number) => new Date(NOW + d * DAY).toISOString().slice(0, 10);
/** A project with stars lit `litAgo` days ago and `open` steps still to do. */
const con = (litAgo: number[], open: number, over: Partial<SkyConstellation> = {}): SkyConstellation => ({
  name: "P", since: ago(90),
  steps: [...litAgo.map((d, i) => ({ id: `l${i}`, title: "lit", min: 20, done: ago(d) })), ...Array.from({ length: open }, (_, i) => ({ id: `o${i}`, title: "open", min: 20 }))], ...over });

test("forecast: none until two stars are lit, and none for finished or set-down projects", () => {
  assert.equal(forecast(con([3], 4), NOW), null);
  assert.equal(forecast(con([10, 3], 2, { finished: ago(1) }), NOW), null);
  assert.equal(forecast(con([10, 3], 2, { rest: ago(1) }), NOW), null);
  assert.equal(forecast(con([10, 3], 0), NOW), null);
});

test("forecast: pace is the recent stars over the time since the first of them, so it slows while a project is quiet", () => {
  const steady = forecast(con([14, 7, 0], 3), NOW)!;          // 3 stars in 14 days
  assert.equal(steady.days, 14);
  const quiet = forecast(con([28, 21, 14], 3), NOW)!;         // the same 3 stars, but two weeks ago
  assert.ok(quiet.days > steady.days);
  assert.equal(quiet.days, 28);
  const fast = forecast(con([2, 1, 0], 3), NOW)!;             // a burst counts over at least a week
  assert.equal(fast.days, 7);
});

test("forecast: late is measured against the deadline; behind means more than a week late", () => {
  const onTime = forecast(con([14, 7, 0], 3, { target: ymdIn(20) }), NOW)!;
  assert.ok(onTime.late! < 0); assert.equal(isBehind(onTime), false);
  const late = forecast(con([14, 7, 0], 3, { target: ymdIn(3) }), NOW)!;
  assert.ok(late.late! > 7); assert.equal(isBehind(late), true);
  assert.equal(forecast(con([14, 7, 0], 3), NOW)!.late, null);
});

test("forecast: more than a year away has no date", () => {
  const f = forecast(con([300, 299], 40), NOW)!;
  assert.equal(f.date, null);
  assert.equal(whenText(f), "more than a year");
});

test("when: a date within three weeks, early, mid or late in the month further out", () => {
  assert.match(whenText(forecast(con([14, 7, 0], 3), NOW)!), /^Dec 9$/);
  assert.equal(whenText(forecast(con([28, 21, 14], 6), NOW)!), "mid-January");    // 56 days: January 20
  assert.equal(whenText(forecast(con([28, 21, 14], 7), NOW)!), "late-January");   // 66 days: January 30
});

test("behind projects and the weekly review's group for them", () => {
  const sky = { dust: {}, cons: {
    slow: con([14, 7, 0], 3, { name: "Slow", target: ymdIn(3) }),
    fine: con([14, 7, 0], 3, { name: "Fine", target: ymdIn(30) }),
    stalled: con([60, 50], 3, { name: "Stalled", target: ymdIn(3) }),
  } };
  const b = behindProjects(sky, NOW);
  assert.deepEqual(b.map((x) => x.name), ["Slow"]);
  assert.match(b[0].text, /behind its deadline at this pace/);
  const r = reviewProjects(sky, NOW);
  assert.deepEqual(r.behind.map((p) => p.name), ["Slow"]);
  assert.deepEqual(r.moved.map((p) => p.name), ["Fine"]);
  assert.deepEqual(r.stalled.map((p) => p.name), ["Stalled"]);   // stalled stays stalled: the three-week question comes first
  assert.ok(r.moved[0].pace?.when);
});
