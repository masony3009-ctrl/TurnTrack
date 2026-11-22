import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blankForm, buildEvent, daysBefore, dropEvent, EVENT_TIMES, eventsByDay, eventsOf, formOfEvent, isOwnerEvent, KEEP_DAYS, keepRecent, newEventId, putEvent,
} from "../ownerEvents.ts";

const TODAY = "2026-11-22";
const ev = (extra = {}) => ({ id: "e1", dateKey: "2026-11-23", time: "10:00", title: "Meet the owner", place: "Palm Rd", note: null, createdAt: 1, ...extra });

test("isOwnerEvent wants an id, a day and a name", () => {
  assert.equal(isOwnerEvent(ev()), true);
  assert.equal(isOwnerEvent(ev({ time: null })), true);
  assert.equal(isOwnerEvent(ev({ title: "  " })), false);
  assert.equal(isOwnerEvent(ev({ dateKey: "Nov 23" })), false);
  assert.equal(isOwnerEvent(ev({ time: "9am" })), false);
  assert.equal(isOwnerEvent(ev({ id: "" })), false);
  assert.equal(isOwnerEvent(null), false);
});

test("eventsOf drops junk, tidies fields and sorts by day then time", () => {
  const list = eventsOf([
    ev({ id: "b", dateKey: "2026-11-24", time: "09:00" }),
    ev({ id: "a", time: "14:00", place: "  ", note: " bring the contract " }),
    ev({ id: "c", time: undefined, createdAt: 5 }),
    "junk",
    ev({ id: "d", title: "" }),
  ]);
  assert.deepEqual(list.map((e) => e.id), ["c", "a", "b"]);
  assert.equal(list[1].place, null);
  assert.equal(list[1].note, "bring the contract");
  assert.equal(list[0].time, null);
  assert.deepEqual(eventsOf(undefined), []);
});

test("eventsByDay groups each day's events in order", () => {
  const map = eventsByDay([ev({ id: "x", time: "15:00" }), ev({ id: "y", time: "08:30" }), ev({ id: "z", dateKey: "2026-11-30" })]);
  assert.deepEqual(map.get("2026-11-23").map((e) => e.id), ["y", "x"]);
  assert.equal(map.get("2026-11-30").length, 1);
  assert.equal(map.get("2026-11-24"), undefined);
});

test("buildEvent checks the form and trims it", () => {
  const made = buildEvent({ ...blankForm("2026-11-23"), title: " Walkthrough ", place: " 12 Oak Rd ", time: "16:30" }, "id1", 99);
  assert.deepEqual(made, { id: "id1", dateKey: "2026-11-23", time: "16:30", title: "Walkthrough", place: "12 Oak Rd", note: null, createdAt: 99 });
  assert.ok("error" in buildEvent(blankForm("2026-11-23"), "id1", 1));
  assert.ok("error" in buildEvent({ ...blankForm(""), title: "x" }, "id1", 1));
  assert.ok("error" in buildEvent({ ...blankForm("2026-11-23"), title: "x", time: "25:00" }, "id1", 1));
  assert.ok("error" in buildEvent({ ...blankForm("2026-11-23"), title: "x".repeat(81) }, "id1", 1));
});

test("formOfEvent round-trips through buildEvent", () => {
  const e = ev({ note: "gate opens from the box" });
  assert.deepEqual(buildEvent(formOfEvent(e), e.id, e.createdAt), e);
});

test("putEvent adds or replaces; dropEvent removes; old ones fall off", () => {
  const old = ev({ id: "old", dateKey: daysBefore(TODAY, KEEP_DAYS + 1) });
  const kept = ev({ id: "kept", dateKey: daysBefore(TODAY, KEEP_DAYS) });
  let list = putEvent([old, kept], ev(), TODAY);
  assert.deepEqual(list.map((e) => e.id), ["kept", "e1"]);
  list = putEvent(list, ev({ title: "Moved", time: "11:00" }), TODAY);
  assert.equal(list.length, 2);
  assert.equal(list[1].title, "Moved");
  assert.deepEqual(dropEvent(list, "e1", TODAY).map((e) => e.id), ["kept"]);
  assert.deepEqual(keepRecent([], TODAY), []);
});

test("daysBefore counts calendar days across months and years", () => {
  assert.equal(daysBefore("2026-03-01", 1), "2026-02-28");
  assert.equal(daysBefore("2026-01-01", 1), "2025-12-31");
  assert.equal(daysBefore("2026-11-22", 0), "2026-11-22");
});

test("event times run 7 AM to 8 PM on the half hour", () => {
  assert.equal(EVENT_TIMES[0], "07:00");
  assert.equal(EVENT_TIMES.at(-1), "20:00");
  assert.equal(EVENT_TIMES.length, 27);
  assert.match(newEventId(1792000000000, 0.5), /^ev[a-z0-9]+$/);
});
