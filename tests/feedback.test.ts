// 4.0 the feedback loop: the record, the planner's use of it, and the weekly review's sorting.
import test from "node:test";
import assert from "node:assert/strict";
import { adjustment, bands, capacity, insights, recordDays, weakHours } from "../src/domain/record";
import { buildPlan, PLANNER_DEFAULTS } from "../src/domain/planner";
import { dimOf, quietDays, reviewDue, reviewProjects, reviewWeek, standing } from "../src/domain/review";
import { mergeSky, type SkyConstellation } from "../src/domain/sky";
import { addDays, startOfToday, ymd } from "../src/lib/dates";
import type { Config, DayRecord, PlannedItem, Task } from "../src/lib/types";

const DAY = 864e5;
const ago = (n: number) => ymd(addDays(startOfToday(), -n));
const doneOn = (id: string, n: number, hour = 12): Task => ({ id, content: id, project_id: "p", priority: 1, due: null, completed_at: new Date(+addDays(startOfToday(), -n) + hour * 3600e3).toISOString() });
const item = (id: string, min: number, start: number, committed = true): PlannedItem => ({ id, content: id, wp: 2, project: "p", committed, min, start });

/** `n` past days, each with a morning block and an evening block; mornings get done, evenings mostly don't. */
function history(n: number, eveningDoneEvery = 0) {
  const h: Record<string, DayRecord> = {}, completed: Task[] = [];
  for (let i = 1; i <= n; i++) {
    h[ago(i)] = { planned: [item(`am${i}`, 60, 9 * 60), item(`pm${i}`, 90, 18 * 60, false)] };
    completed.push(doneOn(`am${i}`, i));
    if (eveningDoneEvery && i % eveningDoneEvery === 0) completed.push(doneOn(`pm${i}`, i, 19));
  }
  return { config: { history: h } as Config, completed };
}

test("record: planned and done minutes per day, and nothing for days without a plan", () => {
  const { config, completed } = history(6);
  const days = recordDays(config, completed);
  assert.equal(days.length, 6);
  assert.deepEqual(days.map((d) => [d.plannedMin, d.doneMin, d.planned, d.done]), Array(6).fill([150, 60, 2, 1]));
  assert.equal(days[0].day, ago(6));           // oldest first
});

test("record: plans from before 4.0 take a block's length from the task", () => {
  const config = { history: { [ago(1)]: { planned: [{ id: "a", content: "a", wp: 2, project: "p", committed: true }, { id: "b", content: "b", wp: 2, project: "p", committed: true }] } } } as Config;
  const days = recordDays(config, [{ ...doneOn("a", 1), duration: { amount: 45, unit: "minute" } }]);
  assert.equal(days[0].plannedMin, 45 + 30);   // b: no duration anywhere, so the default block
  assert.equal(days[0].doneMin, 45);
});

test("capacity: needs five planned days, then says what a typical day finishes", () => {
  const few = history(4);
  assert.equal(capacity(recordDays(few.config, few.completed), PLANNER_DEFAULTS), null);
  const enough = history(12);
  const c = capacity(recordDays(enough.config, enough.completed), PLANNER_DEFAULTS);
  assert.ok(c);
  assert.equal(c!.min, 60);
});

test("capacity: never below 45 minutes, however the days went", () => {
  const { config } = history(8);
  assert.equal(capacity(recordDays(config, []), PLANNER_DEFAULTS)!.min, 45);
});

test("weak hours: found when late blocks rarely get done, with enough blocks either side", () => {
  const { config, completed } = history(10);
  const w = weakHours(bands(config, completed));
  assert.ok(w);
  assert.ok(w!.from > 9 * 60 && w!.from <= 18 * 60);
  assert.equal(w!.rate, 0);
  assert.equal(w!.before, 1);
});
test("weak hours: not claimed from too few blocks, or when late blocks do get done", () => {
  const few = history(5);
  assert.equal(weakHours(bands(few.config, few.completed)), null);
  const fine = history(12, 1);
  assert.equal(weakHours(bands(fine.config, fine.completed)), null);
});

test("insights: silent with too little history, specific with enough", () => {
  const few = history(3);
  assert.deepEqual(insights(recordDays(few.config, few.completed), null, few.config), []);
  const { config, completed } = history(10);
  const says = insights(recordDays(config, completed), weakHours(bands(config, completed)), config);
  const load = says.find((s) => s.id === "load")!;
  assert.match(load.text, /plan about 2h 30m a day and finish about 1h\./);
  assert.ok(says.some((s) => s.id === "late"));
});

test("adjustment: fewer commitments when they're rarely all kept, more when they always are", () => {
  const h: Record<string, DayRecord> = {}; const completed: Task[] = [];
  for (let i = 1; i <= 8; i++) { h[ago(i)] = { planned: [item(`a${i}`, 30, 600), item(`b${i}`, 30, 660), item(`c${i}`, 30, 720)] }; completed.push(doneOn(`a${i}`, i)); }
  const a = adjustment(recordDays({ history: h } as Config, completed), { commitCount: 3 });
  assert.equal(a?.id, "fewer"); assert.equal(a?.commitCount, 1);
  for (let i = 1; i <= 8; i++) completed.push(doneOn(`b${i}`, i), doneOn(`c${i}`, i));
  assert.equal(adjustment(recordDays({ history: h } as Config, completed), { commitCount: 3 })?.commitCount, 4);
});

// ---------- the planner ----------
const cfg = { ...PLANNER_DEFAULTS, dayStart: "00:00", dayEnd: "23:59", workDays: [] as number[], fill: 100, milestoneSteps: 0, gap: 0 };
const todayTask = (id: string, min: number): Task => ({ id, content: id, project_id: "p", priority: 1, due: { date: ymd(new Date()) }, duration: { amount: min, unit: "minute" } });
const plan = (extra: object) => buildPlan({ cfg, today: [todayTask("a", 60), todayTask("b", 60), todayTask("c", 60)], events: [], active: [], tray: new Set(), slips: () => 0, ...extra });

/** The planner plans from "now" on, so these run at 8 in the morning. */
const at8 = (t: import("node:test").TestContext) => t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 10, 25, 8, 0) });

test("planner: commitments stop at what you usually finish; the rest is bonus", (t) => {
  at8(t);
  const free = plan({});
  assert.equal(free.items.length, 3);
  assert.equal(free.items.filter((i) => i.committed).length, 3);
  const capped = plan({ capacityMin: 120 });
  assert.equal(capped.items.filter((i) => i.committed).length, 2);
  assert.equal(capped.items.length, 3);
  assert.equal(plan({ capacityMin: 20 }).items.filter((i) => i.committed).length, 1);   // always at least one
  assert.equal(buildPlan({ cfg: { ...cfg, learn: false }, today: [todayTask("a", 60), todayTask("b", 60), todayTask("c", 60)], events: [], active: [], tray: new Set(), slips: () => 0, capacityMin: 60 }).items.filter((i) => i.committed).length, 3);
});

test("planner: work goes before your weak hours when it fits; what doesn't is marked late and isn't a commitment", (t) => {
  at8(t);
  const some = plan({ weakFrom: 10 * 60 });       // blocks start at 8:15, 9:15 and 10:15: the third starts in the weak hours
  assert.deepEqual(some.items.map((i) => !!i.late), [false, false, true]);
  assert.deepEqual(some.items.map((i) => !!i.committed), [true, true, false]);
  const p = plan({ weakFrom: 0 });               // no free time before the weak hours: nothing is singled out, the plan says so once
  assert.equal(p.weakAll, true);
  assert.ok(p.items.every((i) => !i.late));
  assert.equal(p.items.filter((i) => i.committed).length, 3);
});

test("planner: a project that's been set down doesn't feed steps into the plan", (t) => {
  at8(t);
  const m: Task = { id: "m", content: "Project", project_id: "p", priority: 1, due: null, labels: ["milestone"] };
  const step: Task = { id: "s", content: "Step", project_id: "p", priority: 1, due: null, parent_id: "m", duration: { amount: 15, unit: "minute" } };
  const base = { cfg: { ...cfg, milestoneSteps: 2 }, today: [], events: [], active: [m, step], tray: new Set<string>(), slips: () => 0 };
  const a = buildPlan(base), b = buildPlan({ ...base, resting: new Set(["m"]) });
  assert.equal(b.items.length + b.unplaced.length, 0);
  assert.equal(a.items.length + a.unplaced.length, 1);
});

// ---------- the weekly review ----------
const con = (over: Partial<SkyConstellation>): SkyConstellation => ({ name: "P", since: new Date(Date.now() - 60 * DAY).toISOString(), steps: [{ id: "1", title: "one", min: 20 }, { id: "2", title: "two", min: 20 }], ...over });
const lit = (daysAgo: number) => ({ id: "1", title: "one", min: 20, done: new Date(Date.now() - daysAgo * DAY).toISOString() });

test("standing: moving, quiet after ten days, stalled after three weeks, and a kept decision restarts the clock", () => {
  assert.equal(standing(con({ steps: [lit(2), { id: "2", title: "two", min: 20 }] })), "moving");
  assert.equal(standing(con({ steps: [lit(12), { id: "2", title: "two", min: 20 }] })), "quiet");
  assert.equal(standing(con({})), "stalled");
  assert.equal(quietDays(con({})), 60);
  assert.equal(standing(con({ kept: new Date().toISOString() })), "moving");
  assert.equal(standing(con({ rest: new Date().toISOString() })), "resting");
});
test("fading: none while moving, more the longer it's quiet, most when set down", () => {
  const a = dimOf(con({ steps: [lit(2)] })), b = dimOf(con({ steps: [lit(12)] })), c = dimOf(con({})), d = dimOf(con({ rest: "2026-01-01" }));
  assert.equal(a, 0);
  assert.ok(b > 0 && b < c && c < d && d < 1);
});
test("review: projects sorted into moved, quiet, stalled and resting, with the next step", () => {
  const r = reviewProjects({ dust: {}, cons: {
    moved: con({ name: "Moved", steps: [lit(1), { id: "2", title: "two", min: 20 }] }),
    quiet: con({ name: "Quiet", steps: [lit(12), { id: "2", title: "two", min: 20 }] }),
    stalled: con({ name: "Stalled" }),
    resting: con({ name: "Resting", rest: new Date().toISOString() }),
  } });
  assert.deepEqual([r.moved, r.quiet, r.stalled, r.resting].map((x) => x.map((p) => p.name)), [["Moved"], ["Quiet"], ["Stalled"], ["Resting"]]);
  assert.equal(r.stalled[0].next?.title, "one");
  assert.equal(r.moved[0].litWeek, 1);
});
test("review: offered from Sunday 9:00 through Monday, until that week is reviewed", () => {
  const sun = new Date(2026, 10, 29, 10), sunEarly = new Date(2026, 10, 29, 7), mon = new Date(2026, 10, 30, 8), tue = new Date(2026, 11, 1, 8);
  assert.equal(reviewWeek(sun), "2026-11-29"); assert.equal(reviewWeek(mon), "2026-11-29");
  assert.equal(reviewDue({}, sun), true); assert.equal(reviewDue({}, sunEarly), false);
  assert.equal(reviewDue({}, mon), true); assert.equal(reviewDue({}, tue), false);
  assert.equal(reviewDue({ "2026-11-29": { week: "2026-11-29", at: "", decisions: {} } }, mon), false);
});
test("sky: a project's rest and kept marks survive syncing with Todoist, and rest ends when it's finished", () => {
  const m: Task = { id: "m", content: "Project", project_id: "p", priority: 1, due: null, labels: ["milestone"] };
  const s: Task = { id: "s", content: "Step", project_id: "p", priority: 1, due: null, parent_id: "m" };
  const first = mergeSky(undefined, [m, s], [], []);
  const marked = { ...first, cons: { m: { ...first.cons.m, rest: "2026-11-01T00:00:00Z", kept: "2026-10-01T00:00:00Z" } } };
  const again = mergeSky(marked, [m, { ...s, content: "Step renamed" }], [], []);
  assert.equal(again.cons.m.rest, "2026-11-01T00:00:00Z"); assert.equal(again.cons.m.kept, "2026-10-01T00:00:00Z");
  const done = mergeSky(again, [], [{ ...m, completed_at: new Date().toISOString() }, { ...s, completed_at: new Date().toISOString() }], []);
  assert.ok(done.cons.m.finished); assert.equal(done.cons.m.rest, undefined);
});
