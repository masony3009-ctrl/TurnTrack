import assert from "node:assert/strict";
import { test } from "node:test";
import {
  endTimeChoices,
  isLongSession,
  LONG_SESSION_MINUTES,
  mergeSummary,
  otherRunningJob,
  sessionEntryId,
  startCheck,
  waitBriefly,
} from "../session.ts";

const at = (h, m = 0) => new Date(2026, 9, 26, h, m).getTime();

test("one pay entry per session, whoever finishes it", () => {
  assert.equal(sessionEntryId("job1", 1792990000000), "job1_1792990000000");
  assert.equal(sessionEntryId("job1", 1792990000000), sessionEntryId("job1", 1792990000000));
  assert.notEqual(sessionEntryId("job1", 1), sessionEntryId("job1", 2));
});

test("a session over six hours counts as left running", () => {
  assert.equal(LONG_SESSION_MINUTES, 360);
  assert.equal(isLongSession(at(9), at(14)), false);
  assert.equal(isLongSession(at(9), at(15)), false);
  assert.equal(isLongSession(at(9), at(15, 1)), true);
});

test("end times run every half hour from just after the start until now", () => {
  const choices = endTimeChoices(at(9, 10), at(13, 5));
  assert.equal(choices[0].time, "09:30");
  assert.equal(choices.at(-1).time, "13:00");
  assert.equal(choices[0].label, "9:30 AM");
  assert.ok(choices.every((c) => c.at > at(9, 10) && c.at < at(13, 5)));
  // Started this morning, finished tomorrow: only this morning's day is offered.
  const overnight = endTimeChoices(at(10), at(10) + 20 * 3600000);
  assert.equal(overnight.at(-1).time, "23:30");
  // Nothing fits when it has barely started.
  assert.deepEqual(endTimeChoices(at(9), at(9, 20)), []);
});

test("a second session adds to the first", () => {
  const first = { employeeName: "Shane Stewart", minutes: 120, earned: 50 };
  assert.deepEqual(mergeSummary(null, first), first);
  assert.deepEqual(mergeSummary(first, { employeeName: "Shane Stewart", minutes: 30, earned: 12.5 }), {
    employeeName: "Shane Stewart", minutes: 150, earned: 62.5,
  });
  const two = mergeSummary(first, { employeeName: "Ana Diaz", minutes: 60, earned: 20.1 });
  assert.equal(two.employeeName, "Shane Stewart & Ana Diaz");
  assert.equal(two.earned, 70.1);
  assert.equal(mergeSummary(two, { employeeName: "Ana Diaz", minutes: 1, earned: 0.3 }).employeeName, "Shane Stewart & Ana Diaz");
});

test("starting a finished or future cleaning needs a second look", () => {
  assert.equal(startCheck({ done: true }, 0), "finished");
  assert.equal(startCheck({ done: false }, 3), "future");
  assert.equal(startCheck({}, 0), null);
  assert.equal(startCheck({}, -1), null);
  assert.equal(startCheck({}, null), null);
});

test("another running timer for the same cleaner is found", () => {
  const jobs = [
    { id: "a", assignedTo: "e1", startedAt: 5 },
    { id: "b", assignedTo: "e1", startedAt: null },
    { id: "c", assignedTo: "e2", startedAt: 7 },
    { id: "d", assignedTo: "e1", startedAt: 9, cancelled: true },
  ];
  assert.equal(otherRunningJob(jobs, "e1", "b")?.id, "a");
  assert.equal(otherRunningJob(jobs, "e1", "a"), null);
  assert.equal(otherRunningJob(jobs, "e3", "a"), null);
});

test("a write that lands quickly is saved, a slow one is queued", async () => {
  assert.equal(await waitBriefly(Promise.resolve(), 50, () => {}), "saved");
  await assert.rejects(waitBriefly(Promise.reject(new Error("denied")), 50, () => {}), /denied/);
  let late = null;
  let fail;
  const slow = new Promise((_, reject) => { fail = reject; });
  assert.equal(await waitBriefly(slow, 20, (e) => { late = e; }), "queued");
  fail(new Error("later"));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(late?.message, "later");
});
