import assert from "node:assert/strict";
import { test } from "node:test";
import { calendarLink, cleaningEvent, CLEANING_HOURS } from "../calendarEvent.ts";

const timed = { dateKey: "2026-11-11", time: "11:00", house: "Palm House", address: "1 Palm Rd, Mesa, AZ", type: "Turno Cleaning" };

test("a cleaning with a start time is a Phoenix-time event that long", () => {
  const e = cleaningEvent(timed);
  assert.equal(e.title, "Cleaning · Palm House");
  assert.equal(e.allDay, false);
  assert.equal(e.timeZone, "America/Phoenix");
  // 11 AM in Phoenix is 6 PM UTC, all year.
  assert.equal(e.startDate.toISOString(), "2026-11-11T18:00:00.000Z");
  assert.equal(e.endDate.getTime() - e.startDate.getTime(), CLEANING_HOURS * 3600000);
  assert.equal(e.location, "1 Palm Rd, Mesa, AZ");
});

test("summer dates use the same offset, since Phoenix has no daylight saving", () => {
  const e = cleaningEvent({ ...timed, dateKey: "2026-07-04", time: "09:30" });
  assert.equal(e.startDate.toISOString(), "2026-07-04T16:30:00.000Z");
});

test("no set time makes an all-day event on that day", () => {
  const e = cleaningEvent({ ...timed, time: null });
  assert.equal(e.allDay, true);
  assert.equal(e.timeZone, undefined);
  assert.equal(e.startDate.getFullYear(), 2026);
  assert.equal(e.startDate.getMonth(), 10);
  assert.equal(e.startDate.getDate(), 11);
  assert.equal(e.startDate.getHours(), 0);
});

test("a time that isn't HH:MM is treated as no time", () => {
  assert.equal(cleaningEvent({ ...timed, time: "11am" }).allDay, true);
});

test("no date, or a junk date, is no event", () => {
  assert.equal(cleaningEvent({ ...timed, dateKey: null }), null);
  assert.equal(cleaningEvent({ ...timed, dateKey: "Nov 11" }), null);
});

test("notes say what kind of cleaning and flag same-day, with no codes", () => {
  const plain = cleaningEvent(timed);
  assert.match(plain.notes, /^Turno Cleaning/);
  assert.doesNotMatch(plain.notes, /Same-day/);
  const sameDay = cleaningEvent({ ...timed, sameDay: true });
  assert.match(sameDay.notes, /Same-day turnover/);
  assert.equal(cleaningEvent({ ...timed, type: null }).notes.split("\n")[0], "Cleaning");
});

test("a missing address leaves the location empty", () => {
  assert.equal(cleaningEvent({ ...timed, address: null }).location, "");
});

test("the iPhone link opens Calendar at the start, counted from 2001", () => {
  const e = cleaningEvent(timed);
  const seconds = Date.parse("2026-11-11T18:00:00Z") / 1000 - Date.parse("2001-01-01T00:00:00Z") / 1000;
  assert.equal(calendarLink("ios", e), `calshow:${seconds}`);
});

test("the Android link opens the calendar app at the start", () => {
  const e = cleaningEvent(timed);
  assert.equal(calendarLink("android", e), `content://com.android.calendar/time/${Date.parse("2026-11-11T18:00:00Z")}`);
});

test("the web link is a filled-in Google Calendar event", () => {
  const url = new URL(calendarLink("web", cleaningEvent(timed)));
  assert.equal(url.hostname, "calendar.google.com");
  assert.equal(url.searchParams.get("action"), "TEMPLATE");
  assert.equal(url.searchParams.get("text"), "Cleaning · Palm House");
  assert.equal(url.searchParams.get("dates"), "20261111T180000Z/20261111T210000Z");
  assert.equal(url.searchParams.get("location"), "1 Palm Rd, Mesa, AZ");
});

test("an all-day web link runs to the next day, as Google expects", () => {
  const url = new URL(calendarLink("web", cleaningEvent({ ...timed, dateKey: "2026-12-31", time: null })));
  assert.equal(url.searchParams.get("dates"), "20261231/20270101");
});
