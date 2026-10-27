import assert from "node:assert/strict";
import { test } from "node:test";
import { digestBody, groupOutbox, isOpenJob, loadByCleaner, openCounts, openRange } from "../assign.ts";

// 2026-10-27 is a Tuesday: this week runs to Sat Oct 31, next week to Sat Nov 7.
const TODAY = "2026-10-27";
const job = (id, dateKey, extra = {}) => ({ id, date: "", dateKey, address: "1 Main St", ...extra });

test("openRange splits by Sunday-Saturday weeks from today", () => {
  assert.equal(openRange("2026-10-26", TODAY), null);
  assert.equal(openRange("2026-10-27", TODAY), "week");
  assert.equal(openRange("2026-10-31", TODAY), "week");
  assert.equal(openRange("2026-11-01", TODAY), "next");
  assert.equal(openRange("2026-11-07", TODAY), "next");
  assert.equal(openRange("2026-11-08", TODAY), "later");
  // On a Saturday, tomorrow is already next week.
  assert.equal(openRange("2026-11-01", "2026-10-31"), "next");
});

test("isOpenJob wants an unassigned, unfinished, real cleaning from today on", () => {
  assert.equal(isOpenJob(job("a", "2026-10-28"), TODAY), true);
  assert.equal(isOpenJob(job("a", "2026-10-27"), TODAY), true);
  assert.equal(isOpenJob(job("a", "2026-10-26"), TODAY), false);
  assert.equal(isOpenJob(job("a", "2026-10-28", { assignedTo: "e1" }), TODAY), false);
  assert.equal(isOpenJob(job("a", "2026-10-28", { done: true }), TODAY), false);
  assert.equal(isOpenJob(job("a", "2026-10-28", { cancelled: true }), TODAY), false);
  assert.equal(isOpenJob(job("a", "2026-10-28", { pending: true }), TODAY), false);
  assert.equal(isOpenJob({ id: "a", date: "someday", address: "x" }, TODAY), false);
});

test("openCounts tallies open jobs per range", () => {
  const counts = openCounts([
    job("a", "2026-10-28"),
    job("b", "2026-10-30"),
    job("c", "2026-11-03"),
    job("d", "2026-12-01"),
    job("e", "2026-12-02", { assignedTo: "e1" }),
  ], TODAY);
  assert.deepEqual(counts, { week: 2, next: 1, later: 1 });
});

test("loadByCleaner counts each cleaner's unfinished jobs in the range", () => {
  const load = loadByCleaner([
    job("a", "2026-10-28", { assignedTo: "e1" }),
    job("b", "2026-10-29", { assignedTo: "e1" }),
    job("c", "2026-10-29", { assignedTo: "e2", done: true }),
    job("d", "2026-11-02", { assignedTo: "e2" }),
    job("e", "2026-10-29"),
  ], "week", TODAY);
  assert.equal(load.get("e1"), 2);
  assert.equal(load.has("e2"), false);
});

test("digestBody lists a few and counts the rest", () => {
  const lines = [
    { house: "Palm", date: "Thu, Oct 29" },
    { house: "Mesa", date: "Fri, Oct 30" },
    { house: "Oak", date: "Sat, Oct 31" },
    { house: "Elm", date: "Sun, Nov 1" },
    { house: "Fig", date: "Mon, Nov 2" },
  ];
  assert.equal(digestBody(lines), "Palm Thu, Oct 29 · Mesa Fri, Oct 30 · Oak Sat, Oct 31 · and 2 more");
  assert.equal(digestBody(lines.slice(0, 2)), "Palm Thu, Oct 29 · Mesa Fri, Oct 30");
  assert.equal(digestBody([]), "");
});

test("groupOutbox notifies whoever ended up with each job", () => {
  const outbox = new Map();
  outbox.set("j1", { employeeId: "e1", job: "J1" });
  outbox.set("j2", { employeeId: "e1", job: "J2" });
  outbox.set("j1", { employeeId: "e2", job: "J1" });
  const grouped = groupOutbox(outbox);
  assert.deepEqual(grouped.get("e1"), ["J2"]);
  assert.deepEqual(grouped.get("e2"), ["J1"]);
});
