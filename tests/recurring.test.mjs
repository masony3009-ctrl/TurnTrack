import assert from "node:assert/strict";
import { test } from "node:test";
import { fillPlan, newSeriesId, repeatLabel, seriesJobId, slotsBetween } from "../recurring.ts";

const series = (extra = {}) => ({
  id: "s1", every: "2weeks", start: "2026-11-12", property: "Sample House", address: "1 Sample Way", type: "Standard Cleaning", time: "10:00", crew: [], ...extra,
});

test("repeats land every 1, 2 or 4 weeks from the first day", () => {
  assert.deepEqual(slotsBetween(series({ every: "week" }), "2026-11-13", "2026-12-03"), ["2026-11-19", "2026-11-26", "2026-12-03"]);
  assert.deepEqual(slotsBetween(series(), "2026-11-12", "2026-12-24"), ["2026-11-12", "2026-11-26", "2026-12-10", "2026-12-24"]);
  assert.deepEqual(slotsBetween(series({ every: "4weeks" }), "2026-11-01", "2027-01-31"), ["2026-11-12", "2026-12-10", "2027-01-07"]);
  // Nothing before it starts.
  assert.deepEqual(slotsBetween(series(), "2026-10-01", "2026-11-11"), []);
});

test("a monthly repeat keeps its day, moving to the last day in a short month", () => {
  assert.deepEqual(slotsBetween(series({ every: "month", start: "2026-10-28" }), "2026-11-01", "2027-03-31"), ["2026-11-28", "2026-12-28", "2027-01-28", "2027-02-28", "2027-03-28"]);
  assert.deepEqual(slotsBetween(series({ every: "month", start: "2027-01-31" }), "2027-01-01", "2027-04-30"), ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
});

test("skipped days and days after it was stopped are left out", () => {
  assert.deepEqual(slotsBetween(series({ skip: ["2026-11-26"], until: "2026-12-15" }), "2026-11-12", "2027-01-31"), ["2026-11-12", "2026-12-10"]);
});

test("filling makes what's missing, adopts a cleaning already in, and never doubles", () => {
  const s = series();
  const jobs = [
    // Made already (by this phone or another).
    { id: seriesJobId("s1", "2026-11-12"), date: "", dateKey: "2026-11-12", seriesId: "s1", seriesDate: "2026-11-12" },
    // Moved to another day: still its slot.
    { id: seriesJobId("s1", "2026-11-26"), date: "", dateKey: "2026-11-27", seriesId: "s1", seriesDate: "2026-11-26" },
    // Someone put this one in by hand before the repeat existed.
    { id: "hand", date: "", dateKey: "2026-12-10", property: "Sample House", address: "1 Sample Way" },
    // A cancelled one at that house and day isn't adopted.
    { id: "gone", date: "", dateKey: "2026-12-24", property: "Sample House", cancelled: true },
  ];
  const plan = fillPlan([s], jobs, "2026-11-12", 42);
  assert.deepEqual(plan.adopt.map((a) => [a.day, a.jobId]), [["2026-12-10", "hand"]]);
  assert.deepEqual(plan.create.map((c) => c.day), ["2026-12-24"]);
  // Once those are in, there's nothing left to do.
  const after = [...jobs, { id: seriesJobId("s1", "2026-12-24"), date: "", dateKey: "2026-12-24", seriesId: "s1", seriesDate: "2026-12-24" },
    { ...jobs[2], seriesId: "s1", seriesDate: "2026-12-10" }];
  assert.deepEqual(fillPlan([s], after.filter((j) => j.id !== "hand" || j.seriesId), "2026-11-12", 42), { create: [], adopt: [] });
});

test("labels and ids", () => {
  assert.equal(repeatLabel("2weeks"), "Every 2 weeks");
  assert.equal(repeatLabel("month"), "Every month");
  assert.equal(seriesJobId("abc", "2026-11-12"), "abc_2026-11-12");
  assert.match(newSeriesId(1794000000000, 0.5), /^r[0-9a-z]+$/);
});
