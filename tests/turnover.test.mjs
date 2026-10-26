import assert from "node:assert/strict";
import { test } from "node:test";
import { daysLeftInWeek, isJobVisible, jobGroup, keyFromDate } from "../turnover.ts";

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return keyFromDate(d);
};

test("an unfinished past cleaning stays visible until it's finished or cancelled", () => {
  assert.equal(isJobVisible({ date: "", dateKey: daysAgo(10) }), true);
  assert.equal(jobGroup({ date: "", dateKey: daysAgo(10) }), "overdue");
  assert.equal(isJobVisible({ date: "", dateKey: daysAgo(10), cancelled: true }), false);
});

test("finished cleanings leave the list two days after their date", () => {
  assert.equal(isJobVisible({ date: "", dateKey: daysAgo(2), done: true }), true);
  assert.equal(isJobVisible({ date: "", dateKey: daysAgo(3), done: true }), false);
  assert.equal(isJobVisible({ date: "", dateKey: daysAgo(30), done: true, startedAt: 5 }), true);
});

test("weeks end on Saturday", () => {
  assert.equal(daysLeftInWeek(new Date(2026, 9, 25)), 6); // Sunday
  assert.equal(daysLeftInWeek(new Date(2026, 9, 28)), 3); // Wednesday
  assert.equal(daysLeftInWeek(new Date(2026, 9, 31)), 0); // Saturday
});

test("days later this week and days past Saturday group apart", () => {
  const today = new Date();
  const left = daysLeftInWeek(today);
  const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return keyFromDate(d); };
  if (left >= 2) assert.equal(jobGroup({ date: "", dateKey: inDays(2) }), "week");
  assert.equal(jobGroup({ date: "", dateKey: inDays(left + 2) }), "later");
});
