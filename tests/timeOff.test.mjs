import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blocksOn, buildTimeOff, clashingJobs, clashMessage, conflictFor, conflictText, coversDay, datesLabel, hoursLabel,
  isTimeOff, MAX_DAYS, NOTE_MAX, pastTimeOff, shortHours, timeOffOf, upcomingTimeOff,
} from "../timeOff.ts";

// 2026-11-10 is a Tuesday.
const TODAY = "2026-11-10";
const block = (extra = {}) => ({
  id: "b1", start: "2026-11-13", end: "2026-11-13", weekdays: null, from: null, to: null, note: null, createdAt: 1, ...extra,
});
const form = (extra = {}) => ({
  kind: "day", start: "2026-11-13", end: null, weekdays: [], allDay: true, from: null, to: null, note: "", ...extra,
});

test("isTimeOff accepts the three shapes the form writes", () => {
  assert.equal(isTimeOff(block()), true);
  assert.equal(isTimeOff(block({ end: "2026-11-16" })), true);
  assert.equal(isTimeOff(block({ end: null, weekdays: [2, 4] })), true);
  assert.equal(isTimeOff(block({ from: "08:00", to: "12:00", note: "class" })), true);
});

test("isTimeOff turns away anything malformed", () => {
  assert.equal(isTimeOff(null), false);
  assert.equal(isTimeOff("2026-11-13"), false);
  assert.equal(isTimeOff(block({ start: "Nov 13" })), false);
  assert.equal(isTimeOff(block({ end: "2026-11-12" })), false);
  // Only weekly blocks run on with no last day.
  assert.equal(isTimeOff(block({ end: null })), false);
  assert.equal(isTimeOff(block({ end: null, weekdays: [] })), false);
  assert.equal(isTimeOff(block({ end: null, weekdays: [7] })), false);
  assert.equal(isTimeOff(block({ from: "08:00", to: null })), false);
  assert.equal(isTimeOff(block({ note: 5 })), false);
  assert.equal(isTimeOff(block({ id: undefined })), false);
});

test("timeOffOf keeps the stored objects and drops junk", () => {
  const good = block();
  const list = timeOffOf({ timeOff: [good, { start: "x" }, null] });
  assert.equal(list.length, 1);
  assert.equal(list[0], good);
  assert.deepEqual(timeOffOf({}), []);
  assert.deepEqual(timeOffOf({ timeOff: "nope" }), []);
  assert.deepEqual(timeOffOf(null), []);
});

test("coversDay: one day, a stretch, and weekly", () => {
  assert.equal(coversDay(block(), "2026-11-13"), true);
  assert.equal(coversDay(block(), "2026-11-14"), false);
  const stretch = block({ end: "2026-11-16" });
  assert.equal(coversDay(stretch, "2026-11-12"), false);
  assert.equal(coversDay(stretch, "2026-11-15"), true);
  assert.equal(coversDay(stretch, "2026-11-16"), true);
  assert.equal(coversDay(stretch, "2026-11-17"), false);
  // Every Tuesday from Nov 10.
  const weekly = block({ start: TODAY, end: null, weekdays: [2] });
  assert.equal(coversDay(weekly, "2026-11-03"), false);
  assert.equal(coversDay(weekly, "2026-11-10"), true);
  assert.equal(coversDay(weekly, "2026-11-11"), false);
  assert.equal(coversDay(weekly, "2027-03-02"), true);
});

test("an all-day block makes any cleaning that day blocking", () => {
  const c = conflictFor([block({ note: "doctor" })], "2026-11-13", "10:00");
  assert.equal(c.blocking, true);
  assert.equal(conflictText(c), "Off all day · doctor");
  assert.equal(conflictFor([block()], "2026-11-13", null).blocking, true);
  assert.equal(conflictFor([block()], "2026-11-14", "10:00"), null);
  assert.equal(conflictFor([block()], null, "10:00"), null);
});

test("busy hours block only the cleanings they overlap", () => {
  const busy = [block({ from: "08:00", to: "12:00" })];
  // A 3-hour cleaning at 10 runs into the morning; one at noon doesn't.
  assert.equal(conflictFor(busy, "2026-11-13", "10:00").blocking, true);
  assert.equal(conflictFor(busy, "2026-11-13", "06:00").blocking, true);
  assert.equal(conflictFor(busy, "2026-11-13", "12:00"), null);
  assert.equal(conflictFor(busy, "2026-11-13", "04:30"), null);
  // With no start time we can't tell, so it's a heads-up, not a no.
  const maybe = conflictFor(busy, "2026-11-13", null);
  assert.equal(maybe.blocking, false);
  assert.equal(conflictText(maybe), "Busy 8:00 AM – 12:00 PM");
});

test("all day wins over busy hours on the same day", () => {
  const list = [block({ id: "a", from: "08:00", to: "12:00" }), block({ id: "b" })];
  assert.equal(conflictFor(list, "2026-11-13", "14:00").block.id, "b");
});

test("blocksOn lists a day's blocks in time order", () => {
  const list = [block({ id: "pm", from: "13:00", to: "17:00" }), block({ id: "am", from: "08:00", to: "10:00" }), block({ id: "x", start: "2026-11-20", end: "2026-11-20" })];
  assert.deepEqual(blocksOn(list, "2026-11-13").map(b => b.id), ["am", "pm"]);
});

test("hour labels, long and short", () => {
  assert.equal(hoursLabel(block()), "All day");
  assert.equal(hoursLabel(block({ from: "08:00", to: "12:30" })), "8:00 AM – 12:30 PM");
  assert.equal(shortHours(block()), "off");
  assert.equal(shortHours(block({ from: "08:00", to: "12:00" })), "8–12");
  assert.equal(shortHours(block({ from: "12:30", to: "17:00" })), "12:30–5");
});

test("datesLabel reads like a person would say it", () => {
  assert.equal(datesLabel(block(), TODAY), "Fri, Nov 13");
  assert.equal(datesLabel(block({ end: "2026-11-16" }), TODAY), "Fri, Nov 13 – Mon, Nov 16");
  assert.equal(datesLabel(block({ start: TODAY, end: null, weekdays: [4, 2] }), TODAY), "Every Tue & Thu");
  assert.equal(datesLabel(block({ start: TODAY, end: null, weekdays: [1, 3, 5] }), TODAY), "Every Mon, Wed & Fri");
  assert.equal(datesLabel(block({ start: TODAY, end: null, weekdays: [1, 2, 3, 4, 5] }), TODAY), "Every weekday");
  assert.equal(datesLabel(block({ start: TODAY, end: null, weekdays: [0, 6] }), TODAY), "Every weekend");
  assert.equal(datesLabel(block({ start: "2026-11-20", end: null, weekdays: [5] }), TODAY), "Every Fri, from Nov 20");
});

test("upcoming keeps what hasn't ended; past is what has", () => {
  const list = [
    block({ id: "later", start: "2026-11-20", end: "2026-11-20" }),
    block({ id: "gone", start: "2026-11-01", end: "2026-11-02" }),
    block({ id: "now", start: "2026-11-09", end: "2026-11-11" }),
    block({ id: "weekly", start: "2026-10-01", end: null, weekdays: [2] }),
  ];
  assert.deepEqual(upcomingTimeOff(list, TODAY).map(b => b.id), ["weekly", "now", "later"]);
  assert.deepEqual(pastTimeOff(list, TODAY).map(b => b.id), ["gone"]);
});

test("buildTimeOff: one day off, all day", () => {
  const { block: b } = buildTimeOff(form({ note: "  doctor  " }), "id1", 99, TODAY);
  assert.deepEqual(b, { id: "id1", start: "2026-11-13", end: "2026-11-13", weekdays: null, from: null, to: null, note: "doctor", createdAt: 99 });
  assert.equal(isTimeOff(b), true);
});

test("buildTimeOff: a few days in a row", () => {
  const { block: b } = buildTimeOff(form({ kind: "days", end: "2026-11-16" }), "id1", 1, TODAY);
  assert.equal(b.end, "2026-11-16");
  assert.equal(buildTimeOff(form({ kind: "days" }), "id1", 1, TODAY).error, "Pick the last day.");
  assert.equal(buildTimeOff(form({ kind: "days", end: "2026-11-12" }), "id1", 1, TODAY).error, "The last day can't be before the first.");
  assert.match(buildTimeOff(form({ kind: "days", end: "2027-06-01" }), "id1", 1, TODAY).error, new RegExp(`${MAX_DAYS} days`));
});

test("buildTimeOff: every week, part of the day", () => {
  const { block: b } = buildTimeOff(form({ kind: "weekly", weekdays: [4, 2, 2], allDay: false, from: "08:00", to: "12:00" }), "id1", 1, TODAY);
  assert.deepEqual(b.weekdays, [2, 4]);
  assert.equal(b.end, null);
  assert.equal(b.from, "08:00");
  assert.equal(isTimeOff(b), true);
  assert.equal(buildTimeOff(form({ kind: "weekly" }), "id1", 1, TODAY).error, "Pick at least one day of the week.");
});

test("buildTimeOff: the hours have to make sense", () => {
  assert.equal(buildTimeOff(form({ allDay: false, from: "08:00" }), "id1", 1, TODAY).error, "Pick when you're busy from and until.");
  assert.equal(buildTimeOff(form({ allDay: false, from: "12:00", to: "12:00" }), "id1", 1, TODAY).error, "The end time has to be after the start time.");
  assert.equal(buildTimeOff(form({ allDay: false, from: "12:00", to: "09:00" }), "id1", 1, TODAY).error, "The end time has to be after the start time.");
});

test("buildTimeOff: days already gone are turned away", () => {
  assert.match(buildTimeOff(form({ start: "2026-11-09" }), "id1", 1, TODAY).error, /already passed/);
  assert.match(buildTimeOff(form({ kind: "days", start: "2026-11-01", end: "2026-11-09" }), "id1", 1, TODAY).error, /already passed/);
  // Off since last week and through Friday is still worth saying.
  assert.equal(buildTimeOff(form({ kind: "days", start: "2026-11-05", end: "2026-11-13" }), "id1", 1, TODAY).block.start, "2026-11-05");
  assert.equal(buildTimeOff(form({ start: TODAY }), "id1", 1, TODAY).block.start, TODAY);
  // A weekly block that started earlier just carries on.
  assert.equal(buildTimeOff(form({ kind: "weekly", start: "2026-10-01", weekdays: [2] }), "id1", 1, TODAY).block.end, null);
});

test("buildTimeOff: no day picked, a blank note, and a long note", () => {
  assert.equal(buildTimeOff(form({ start: null }), "id1", 1, TODAY).error, "Pick the day.");
  assert.equal(buildTimeOff(form({ kind: "days", start: null }), "id1", 1, TODAY).error, "Pick the first day.");
  assert.equal(buildTimeOff(form({ note: "   " }), "id1", 1, TODAY).block.note, null);
  assert.equal(buildTimeOff(form({ note: "x".repeat(300) }), "id1", 1, TODAY).block.note.length, NOTE_MAX);
});

test("clashingJobs finds the cleaner's own upcoming cleanings the block runs into", () => {
  const jobs = [
    { id: "hit", dateKey: "2026-11-13", time: "10:00" },
    { id: "untimed", dateKey: "2026-11-13", time: null },
    { id: "done", dateKey: "2026-11-13", time: "10:00", done: true },
    { id: "cancelled", dateKey: "2026-11-13", cancelled: true },
    { id: "other day", dateKey: "2026-11-14", time: "10:00" },
    { id: "no date", dateKey: null },
  ];
  assert.deepEqual(clashingJobs(block(), jobs, TODAY).map(j => j.id), ["hit", "untimed"]);
  // Afternoon cleanings are clear of a morning block; one with no time isn't.
  const morning = block({ from: "08:00", to: "11:00" });
  assert.deepEqual(clashingJobs(morning, [{ id: "pm", dateKey: "2026-11-13", time: "13:00" }, ...jobs], TODAY).map(j => j.id), ["hit", "untimed"]);
  // Already past: nothing to warn about.
  assert.deepEqual(clashingJobs(block(), jobs, "2026-11-14"), []);
});

test("clashMessage tells the owner who, when, and which houses", () => {
  const msg = clashMessage("Pat Doe", block({ note: "doctor" }), [{ id: "j1", house: "Palm House", dateKey: "2026-11-13" }], TODAY);
  assert.equal(msg.title, "Pat blocked out time they're booked for");
  assert.equal(msg.body, "Pat can't work Fri, Nov 13 (doctor). Still on: Palm House (Fri, Nov 13).");
  assert.deepEqual(msg.data, { jobId: "j1" });
  const many = clashMessage("Pat", block({ end: null, start: TODAY, weekdays: [5], from: "08:00", to: "12:00" }), [
    { id: "a", house: "A", dateKey: "2026-11-13" }, { id: "b", house: "B", dateKey: "2026-11-20" },
    { id: "c", house: "C", dateKey: "2026-11-27" }, { id: "d", house: "D", dateKey: "2026-12-04" },
  ], TODAY);
  assert.match(many.body, /^Pat can't work every Fri, 8:00 AM – 12:00 PM\. Still on: A \(Fri, Nov 13\), B .* and 1 more\.$/);
  assert.deepEqual(many.data, {});
});
