import assert from "node:assert/strict";
import { test } from "node:test";
import { canEditDate, formatTime, isTime, syncedFrom, TIME_CHOICES, withTime } from "../jobTime.ts";

test("times read as 24-hour HH:MM only", () => {
  assert.equal(isTime("14:00"), true);
  assert.equal(isTime("07:30"), true);
  assert.equal(isTime("7:30"), false);
  assert.equal(isTime("24:00"), false);
  assert.equal(isTime("14:60"), false);
  assert.equal(isTime(null), false);
  assert.equal(isTime(1400), false);
});

test("times show as 12-hour with AM/PM", () => {
  assert.equal(formatTime("14:00"), "2:00 PM");
  assert.equal(formatTime("09:30"), "9:30 AM");
  assert.equal(formatTime("12:00"), "12:00 PM");
  assert.equal(formatTime("00:15"), "12:15 AM");
  assert.equal(formatTime(""), null);
  assert.equal(formatTime(undefined), null);
});

test("the picker runs 7 AM to 7 PM in half hours", () => {
  assert.equal(TIME_CHOICES[0], "07:00");
  assert.equal(TIME_CHOICES[1], "07:30");
  assert.equal(TIME_CHOICES.at(-1), "19:00");
  assert.equal(TIME_CHOICES.length, 25);
  assert.ok(TIME_CHOICES.every(isTime));
  assert.ok(TIME_CHOICES.includes("14:00"));
});

test("a date reads with its time, or alone without one", () => {
  assert.equal(withTime("Thu, Oct 29", "14:00"), "Thu, Oct 29 · 2:00 PM");
  assert.equal(withTime("Thu, Oct 29", null), "Thu, Oct 29");
  assert.equal(withTime("Thu, Oct 29", "2pm"), "Thu, Oct 29");
});

test("only jobs no calendar sync follows can have their date changed", () => {
  for (const s of ["website", "recurring", "app", "manual", undefined, null, ""]) assert.equal(canEditDate(s), true, String(s));
  for (const s of ["airbnb-calendar", "airbnb-ical", "turno-calendar", "turno-email"]) assert.equal(canEditDate(s), false, s);
  assert.equal(syncedFrom("airbnb-ical"), "Airbnb");
  assert.equal(syncedFrom("turno-email"), "Turno");
  assert.equal(syncedFrom("website"), null);
});

test("same-day jobs sort by time, untimed ones last", async () => {
  const { sortByDate } = await import("../turnover.ts");
  const jobs = [
    { date: "", dateKey: "2026-10-29", address: "C", time: null },
    { date: "", dateKey: "2026-10-29", address: "B", time: "14:00" },
    { date: "", dateKey: "2026-10-28", address: "Z", time: "18:00" },
    { date: "", dateKey: "2026-10-29", address: "A", time: "09:30" },
  ];
  assert.deepEqual(sortByDate(jobs).map((j) => j.address), ["Z", "A", "B", "C"]);
});

test("the day-of reminder rings at 8, or an hour before an earlier start", async () => {
  const { reminderAt } = await import("../jobTime.ts");
  const day = new Date(2026, 9, 29);
  const hm = (d) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  assert.equal(hm(reminderAt(day, null)), "8:00");
  assert.equal(hm(reminderAt(day, "14:00")), "8:00");
  assert.equal(hm(reminderAt(day, "09:00")), "8:00");
  assert.equal(hm(reminderAt(day, "08:30")), "7:30");
  assert.equal(hm(reminderAt(day, "07:00")), "6:00");
  assert.equal(reminderAt(day, "07:00").getDate(), 29);
});
