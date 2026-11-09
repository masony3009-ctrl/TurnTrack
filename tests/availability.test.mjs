import assert from "node:assert/strict";
import { test } from "node:test";
import {
  availabilityDetail, availabilityFor, availabilityShort, availabilityTone, availabilityWarning, bookingsOf,
} from "../availability.ts";

// 2026-11-13 is a Friday.
const DAY = "2026-11-13";
const block = (extra = {}) => ({
  id: "b1", start: DAY, end: DAY, weekdays: null, from: null, to: null, note: null, createdAt: 1, ...extra,
});
const job = (extra = {}) => ({
  id: "j1", date: "Fri, Nov 13 2026", dateKey: DAY, time: "11:00", assignedTo: "pat", property: "Palm House", ...extra,
});
const pat = (timeOff = []) => ({ id: "pat", timeOff });
const house = (j) => j.property;

test("bookingsOf groups each cleaner's unfinished cleanings by day", () => {
  const map = bookingsOf([
    job(),
    job({ id: "j2", time: "15:00" }),
    job({ id: "j3", assignedTo: "sam" }),
    job({ id: "j4", done: true }),
    job({ id: "j5", cancelled: true }),
    job({ id: "j6", pending: true }),
    job({ id: "j7", assignedTo: null }),
    job({ id: "j8", dateKey: "2026-11-14", date: "Sat, Nov 14 2026" }),
  ]);
  assert.deepEqual(map.get(`pat|${DAY}`).map(j => j.id), ["j1", "j2"]);
  assert.deepEqual(map.get(`sam|${DAY}`).map(j => j.id), ["j3"]);
  assert.deepEqual(map.get("pat|2026-11-14").map(j => j.id), ["j8"]);
  assert.equal(map.size, 3);
});

test("no day yet means nothing to say", () => {
  assert.equal(availabilityFor(pat(), { id: null, key: null, time: "11:00" }, new Map()), null);
});

test("nothing in the way is free", () => {
  const a = availabilityFor(pat(), { id: null, key: DAY, time: "11:00" }, new Map());
  assert.deepEqual(a, { kind: "free", sameDay: 0 });
  assert.equal(availabilityShort(a), "Free");
  assert.equal(availabilityDetail(a, house, true), "Free then");
  assert.equal(availabilityDetail(a, house, false), "Free that day");
  assert.equal(availabilityTone(a), "free");
  assert.equal(availabilityWarning(a, "Pat Doe", house), null);
});

test("time off all day comes first, even over a booking", () => {
  const bookings = bookingsOf([job()]);
  const a = availabilityFor(pat([block({ note: "doctor" })]), { id: "new", key: DAY, time: "11:00" }, bookings);
  assert.equal(a.kind, "off");
  assert.equal(availabilityShort(a), "Off");
  assert.equal(availabilityDetail(a, house, true), "Off all day · doctor");
  assert.equal(availabilityTone(a), "off");
  assert.deepEqual(availabilityWarning(a, "Pat Doe", house), {
    title: "Pat can't work then",
    body: "Off all day · doctor. Give them this cleaning anyway?",
  });
});

test("busy hours that overlap the cleaning are off", () => {
  const a = availabilityFor(pat([block({ from: "08:00", to: "12:00" })]), { id: null, key: DAY, time: "10:00" }, new Map());
  assert.equal(a.kind, "off");
  assert.equal(availabilityShort(a), "Busy 8–12");
  assert.equal(availabilityDetail(a, house, true), "Busy 8:00 AM – 12:00 PM");
  // Part of the day reads differently from a whole day off.
  assert.equal(availabilityTone(a), "partial");
});

test("busy hours that miss the cleaning leave them free", () => {
  const a = availabilityFor(pat([block({ from: "08:00", to: "12:00" })]), { id: null, key: DAY, time: "13:00" }, new Map());
  assert.deepEqual(a, { kind: "free", sameDay: 0 });
});

test("busy part of the day with no cleaning time is worth a look, not a stop", () => {
  const a = availabilityFor(pat([block({ from: "08:00", to: "12:00" })]), { id: null, key: DAY, time: null }, new Map());
  assert.equal(a.kind, "partly");
  assert.equal(availabilityShort(a), "Busy 8–12");
  assert.equal(availabilityTone(a), "partial");
  assert.equal(availabilityWarning(a, "Pat Doe", house), null);
});

test("another cleaning starting within three hours is a double booking", () => {
  const bookings = bookingsOf([job({ time: "11:00" })]);
  const a = availabilityFor(pat(), { id: "new", key: DAY, time: "12:30" }, bookings);
  assert.equal(a.kind, "booked");
  assert.equal(availabilityShort(a), "Booked 11 AM");
  assert.equal(availabilityDetail(a, house, true), "Already on Palm House at 11:00 AM");
  assert.equal(availabilityTone(a), "warn");
  assert.deepEqual(availabilityWarning(a, "Pat", house), {
    title: "Pat is already booked then",
    body: "They're on Palm House at 11:00 AM. Give them this one too?",
  });
  // Earlier starts count too, and half hours show as-is.
  const before = availabilityFor(pat(), { id: "new", key: DAY, time: "09:00" }, bookingsOf([job({ time: "10:30" })]));
  assert.equal(availabilityShort(before), "Booked 10:30 AM");
});

test("three hours apart is back to back, not a clash", () => {
  const a = availabilityFor(pat(), { id: "new", key: DAY, time: "14:00" }, bookingsOf([job({ time: "11:00" })]));
  assert.deepEqual(a, { kind: "free", sameDay: 1 });
  assert.equal(availabilityShort(a), "Has 1 that day");
  assert.equal(availabilityDetail(a, house, true), "Free then · has 1 other cleaning that day");
  assert.equal(availabilityTone(a), "neutral");
});

test("with a time missing on either side it just counts the other cleanings", () => {
  const bookings = bookingsOf([job({ time: null }), job({ id: "j2", time: "11:00" })]);
  const a = availabilityFor(pat(), { id: "new", key: DAY, time: null }, bookings);
  assert.deepEqual(a, { kind: "free", sameDay: 2 });
  assert.equal(availabilityDetail(a, house, false), "Free that day · has 2 other cleanings that day");
});

test("the cleaning being handed out never clashes with itself", () => {
  const bookings = bookingsOf([job({ id: "this" })]);
  assert.deepEqual(availabilityFor(pat(), { id: "this", key: DAY, time: "11:00" }, bookings), { kind: "free", sameDay: 0 });
});

test("the earliest clashing cleaning is the one named", () => {
  const bookings = bookingsOf([job({ id: "late", time: "13:00", property: "Late" }), job({ id: "early", time: "10:00", property: "Early" })]);
  const a = availabilityFor(pat(), { id: "new", key: DAY, time: "11:30" }, bookings);
  assert.equal(a.job.id, "early");
});

test("someone else's cleanings and other days don't count", () => {
  const bookings = bookingsOf([job({ assignedTo: "sam" }), job({ id: "j2", dateKey: "2026-11-14", date: "Sat, Nov 14 2026" })]);
  assert.deepEqual(availabilityFor(pat(), { id: null, key: DAY, time: "11:00" }, bookings), { kind: "free", sameDay: 0 });
});

test("a blank name still reads as a sentence", () => {
  const a = availabilityFor(pat([block()]), { id: null, key: DAY, time: null }, new Map());
  assert.equal(availabilityWarning(a, "", house).title, "This cleaner can't work then");
});
