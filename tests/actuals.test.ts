// 4.6 Better actuals and keeping in step with Todoist: which ended blocks are asked about, how answers are saved,
// what the record makes of them, and the reminder when a block ends.
import test from "node:test";
import assert from "node:assert/strict";
import { actualsOf, endedBlocks, lengthChoices, withActual } from "../src/domain/actuals";
import { recordDays } from "../src/domain/record";
import { dueNudges, REMINDER_DEFAULTS } from "../src/domain/nudges";
import { addDays, startOfToday, ymd } from "../src/lib/dates";
import type { Config, Task } from "../src/lib/types";

const at = (h: number, m = 0, base = new Date()) => { const d = new Date(base); d.setHours(h, m, 0, 0); return d; };
const floating = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:00`;
const task = (id: string, h: number, m: number, min: number, labels: string[] = []): Task => ({ id, content: id, project_id: "p", priority: 1, labels, due: { date: floating(at(h, m)) }, duration: { amount: min, unit: "minute" } });

test("ended blocks: timed, ended in the last four hours, unanswered, and not the one a timer is on", () => {
  const now = at(15, 0);
  const ts = [task("early", 9, 0, 60), task("a", 13, 0, 60), task("b", 14, 0, 30), task("running", 14, 30, 60), task("timer", 13, 30, 30), { ...task("untimed", 0, 0, 30), due: { date: ymd(now) } }];
  assert.deepEqual(endedBlocks(ts, now).map((b) => b.id), ["a", "timer", "b"]);
  assert.deepEqual(endedBlocks(ts, now, { a: { o: "done", at: "" } }, "timer").map((b) => b.id), ["b"]);
});

test("length choices: around the plan for done, shorter for partly, rounded to 5 minutes", () => {
  assert.deepEqual(lengthChoices(60, "done"), [30, 60, 90, 120]);
  assert.deepEqual(lengthChoices(30, "partly"), [10, 15, 25, 30]);
  assert.deepEqual(lengthChoices(10, "done"), [5, 10, 15, 20]);
});

test("an answer is written into the day (made if there was no plan); done with a length becomes a sample", () => {
  const day = ymd(new Date()), b = { id: "a", min: 60 };
  let c: Config = {};
  c = withActual(c, day, b, "done", 90, 3);
  assert.deepEqual(actualsOf(c, day).a.o, "done");
  assert.equal(actualsOf(c, day).a.min, 90);
  assert.deepEqual(c.history?.[day]?.planned, []);
  assert.equal(c.samples?.length, 1);
  assert.deepEqual({ wp: c.samples![0].wp, est: c.samples![0].est, actual: c.samples![0].actual }, { wp: 3, est: 60, actual: 90 });
  c = withActual(c, day, { id: "b", min: 30 }, "partly", 15, 2);
  c = withActual(c, day, { id: "x", min: 30 }, "skipped", 20, 2);
  assert.equal(c.samples?.length, 1);                 // partly and didn't-happen teach nothing about full length
  assert.equal(actualsOf(c, day).x.min, undefined);
  assert.equal(actualsOf(c, day).b.min, 15);
});

test("the record uses the real minutes: a done block counts what it took, a partly-done one the time put in", () => {
  const day = ymd(addDays(startOfToday(), -1));
  const cfg: Config = { history: { [day]: { planned: [
    { id: "a", content: "a", wp: 2, project: "p", committed: true, min: 60 },
    { id: "b", content: "b", wp: 2, project: "p", committed: false, min: 60 },
    { id: "c", content: "c", wp: 2, project: "p", committed: false, min: 30 },
  ], actual: { a: { o: "done", min: 90, at: "" }, b: { o: "partly", min: 20, at: "" }, c: { o: "skipped", at: "" } } } } };
  const done: Task[] = [{ id: "a", content: "a", project_id: "p", priority: 1, due: null, completed_at: at(12, 0, addDays(startOfToday(), -1)).toISOString() }];
  const [r] = recordDays(cfg, done, [], 3);
  assert.equal(r.planned, 3); assert.equal(r.done, 1);
  assert.equal(r.plannedMin, 150);
  assert.equal(r.doneMin, 110);                       // 90 real + 20 of the partly one
});

test("reminder: a block that just ended asks how it went, once; a timer on it or the setting off means no ask", () => {
  const now = at(15, 1), slot = { id: "a", title: "Write", start: +at(14, 0), end: +at(15, 0) };
  const base = { now, slots: [slot], r: { ...REMINDER_DEFAULTS }, shutdownAt: "23:00", windDownAt: "23:30", shutdownDone: false, focus: null, lastNudgeAt: 0, activeSince: +now };
  const n = dueNudges(base, new Set()).find((x) => x.kind === "block-end");
  assert.ok(n); assert.equal(n!.taskId, "a"); assert.equal(n!.key, `end:a:${slot.end}`);
  assert.equal(dueNudges(base, new Set([n!.key])).filter((x) => x.kind === "block-end").length, 0);
  assert.equal(dueNudges({ ...base, r: { ...REMINDER_DEFAULTS, blockEnd: false } }, new Set()).filter((x) => x.kind === "block-end").length, 0);
  assert.equal(dueNudges({ ...base, focus: { taskId: "a", content: "Write", startedAt: new Date(+at(14, 0)).toISOString(), minutes: 60 } }, new Set()).filter((x) => x.kind === "block-end").length, 0);
  assert.equal(dueNudges({ ...base, now: at(15, 10) }, new Set()).filter((x) => x.kind === "block-end").length, 0);   // only in its first minutes
});

test("committing a plan leaves out a task finished or moved on elsewhere since it was drafted", async () => {
  const { stillToPlan } = await import("../src/domain/planner");
  const now = at(15, 0), today = ymd(now), next = ymd(addDays(startOfToday(), 21));
  const rec = (id: string, date: string, recurring = false): Task => ({ id, content: id, project_id: "p", priority: 1, due: { date, is_recurring: recurring } });
  const items = [{ task: rec("groceries", today, true) }, { task: rec("done", today) }, { task: rec("same", today) }, { task: rec("undated", "") }];
  items[3].task.due = null;
  const fresh = [rec("groceries", next, true), { ...rec("same", today), content: "same, renamed" }, rec("undated", "")];
  fresh[2].due = null;
  const { kept, dropped } = stillToPlan(items, fresh, now);
  assert.deepEqual(dropped.map((x) => x.task.id), ["groceries", "done"]);
  assert.deepEqual(kept.map((x) => x.task.id), ["same", "undated"]);
  assert.equal(kept[0].task.content, "same, renamed");
  assert.equal(stillToPlan(items, null, now).kept.length, 4);   // couldn't look: keep the plan
});
