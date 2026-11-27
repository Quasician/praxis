// 5.0 the command bar: reading plain sentences, and finding the task you meant.
import test from "node:test";
import assert from "node:assert/strict";
import { findTask, matchScore, parseClock, parseCommand, parseSpan, parseWhen } from "../src/domain/commands";
import type { Task } from "../src/lib/types";

const at2pm = 14 * 60, thu = 4;
const p = (s: string, now = at2pm) => parseCommand(s, now, thu);

test("times: a bare hour is the next one that comes round; spans in minutes or hours", () => {
  assert.equal(parseClock("4", at2pm), 16 * 60);
  assert.equal(parseClock("10", 9 * 60), 10 * 60);
  assert.equal(parseClock("4:30pm", at2pm), 16 * 60 + 30);
  assert.equal(parseClock("16:15", at2pm), 16 * 60 + 15);
  assert.equal(parseClock("9 am", at2pm), 9 * 60);
  assert.equal(parseClock("noon", at2pm), 12 * 60);
  assert.equal(parseClock("tonight", at2pm), 20 * 60);
  assert.equal(parseSpan("45 min"), 45); assert.equal(parseSpan("1.5 hours"), 90); assert.equal(parseSpan("an hour"), 60); assert.equal(parseSpan("half an hour"), 30);
  assert.deepEqual(parseWhen("tomorrow at 9", at2pm, thu), { day: 1, at: 9 * 60 });
  assert.deepEqual(parseWhen("friday", at2pm, thu), { day: 1 });
  assert.deepEqual(parseWhen("monday 10am", at2pm, thu), { day: 4, at: 10 * 60 });
  assert.deepEqual(parseWhen("in 30 min", at2pm, thu), { by: 30 });
});

test("sentences: move, push, done, skip with a reason, focus, add, open, stop", () => {
  assert.deepEqual(p("move groceries to 4"), { kind: "move", q: "groceries", at: 16 * 60 });
  assert.deepEqual(p("Move the report to tomorrow at 9"), { kind: "move", q: "the report", day: 1, at: 9 * 60 });
  assert.deepEqual(p("push the report 30 min"), { kind: "move", q: "the report", by: 30 });
  assert.deepEqual(p("push gym back an hour"), { kind: "move", q: "gym", by: 60 });
  assert.deepEqual(p("gym at 6pm"), { kind: "move", q: "gym", at: 18 * 60 });
  assert.deepEqual(p("move taxes to friday"), { kind: "move", q: "taxes", day: 1 });
  assert.deepEqual(p("done laundry"), { kind: "done", q: "laundry" });
  assert.deepEqual(p("laundry is done"), { kind: "done", q: "laundry" });
  assert.deepEqual(p("skip the report, too tired"), { kind: "skip", q: "the report", why: "too tired" });
  assert.deepEqual(p("skip gym because my knee hurts"), { kind: "skip", q: "gym", why: "my knee hurts" });
  assert.deepEqual(p("skip gym"), { kind: "skip", q: "gym" });
  assert.deepEqual(p("focus on taxes for 45 min"), { kind: "focus", q: "taxes", minutes: 45 });
  assert.deepEqual(p("start the report"), { kind: "focus", q: "the report" });
  assert.deepEqual(p("add Call Mom tomorrow"), { kind: "add", text: "Call Mom tomorrow" });
  assert.deepEqual(p("plan my day"), { kind: "open", what: "plan" });
  assert.deepEqual(p("shutdown"), { kind: "open", what: "shutdown" });
  assert.deepEqual(p("settings"), { kind: "open", what: "settings" });
  assert.deepEqual(p("stop timer"), { kind: "stop" });
  assert.equal(p("what should I do about my career"), null);   // left for Claude
});

const T = (id: string, content: string): Task => ({ id, content, project_id: "p", priority: 1, due: null });
test("finding the task: words in its title, today first, a close call gives choices", () => {
  assert.ok(matchScore("groceries", "Order Whole Foods groceries – Week 3 (Southwest)") >= 1);
  assert.ok(matchScore("the report", "Write the Q4 report") >= 1);
  assert.equal(matchScore("gym", "Write the report"), 0);
  const today = [T("a", "Write the Q4 report"), T("b", "Order Whole Foods groceries")], others = [T("c", "Report the broken lamp"), T("d", "Call the bank")];
  assert.equal(findTask("report", today, others, at2pm, () => null).task?.id, "a");   // today wins
  assert.equal(findTask("bank", today, others, at2pm, () => null).task?.id, "d");
  const two = findTask("call", [T("x", "Call mom"), T("y", "Call the bank")], [], at2pm, () => null);
  assert.deepEqual(two.choices.map((t) => t.id).sort(), ["x", "y"]);
  assert.equal(findTask("piano", today, others, at2pm, () => null).choices.length, 0);
});
