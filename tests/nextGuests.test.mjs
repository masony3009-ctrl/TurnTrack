import assert from "node:assert/strict";
import { test } from "node:test";
import { minutesUntil, nextGuestsLine, nextStay } from "../nextGuests.ts";

const job = (id, dateKey, extra = {}) => ({ id, date: "", dateKey, property: "Palm", ...extra });
const house = (j) => j.property || "";

test("the next stay is the first arrival at the same house on or after the cleaning", () => {
  const clean = job("a", "2026-11-15");
  const jobs = [
    clean,
    job("b", "2026-11-22", { checkIn: "2026-11-18", guests: 4 }),
    job("c", "2026-11-19", { checkIn: "2026-11-16", guests: 2 }),
    job("d", "2026-11-17", { checkIn: "2026-11-15", guests: 6, property: "Other" }),
    job("e", "2026-11-14", { checkIn: "2026-11-10", guests: 3 }),
    job("f", "2026-11-25", { checkIn: "2026-11-15", guests: 5, cancelled: true }),
  ];
  assert.deepEqual(nextStay(clean, jobs, house), { checkIn: "2026-11-16", guests: 2 });
});

test("a same-day turnover finds the guests arriving that day, or still knows they come", () => {
  const clean = job("a", "2026-11-15", { sameDayTurnover: true });
  assert.deepEqual(nextStay(clean, [clean, job("b", "2026-11-20", { checkIn: "2026-11-15", guests: 4 })], house), { checkIn: "2026-11-15", guests: 4 });
  assert.deepEqual(nextStay(clean, [clean], house), { checkIn: "2026-11-15", guests: null });
  assert.equal(nextStay(job("x", "2026-11-15"), [], house), null);
  // No house, no guess.
  assert.equal(nextStay(job("y", "2026-11-15", { property: "" }), [job("z", "2026-11-20", { checkIn: "2026-11-16", property: "" })], house), null);
});

test("minutesUntil counts to a time on a day, local time", () => {
  const now = new Date(2026, 10, 15, 13, 50).getTime();
  assert.equal(minutesUntil("2026-11-15", "16:00", now), 130);
  assert.equal(minutesUntil("2026-11-15", "13:00", now), -50);
  assert.equal(minutesUntil("bad", "16:00", now), null);
  assert.equal(minutesUntil("2026-11-15", "4pm", now), null);
});

test("nextGuestsLine says when, how long is left today, and how many", () => {
  const now = new Date(2026, 10, 15, 13, 50).getTime();
  const today = "2026-11-15";
  const clean = job("a", today);
  assert.equal(nextGuestsLine(clean, { checkIn: today, guests: 6 }, "16:00", now, today), "Next guests arrive today at 4:00 PM · 2h 10m left · 6 guests");
  assert.equal(nextGuestsLine(clean, { checkIn: today, guests: null }, null, now, today), "Next guests arrive today");
  assert.equal(nextGuestsLine(clean, { checkIn: "2026-11-22", guests: 1 }, "15:00", now, today), "Next guests arrive Sun, Nov 22 at 3:00 PM · 1 guest");
  // A same-day turnover days ahead.
  assert.equal(nextGuestsLine(job("b", "2026-11-20"), { checkIn: "2026-11-20", guests: 4 }, null, now, today), "Next guests arrive the same day · 4 guests");
  // After check-in time there's no countdown.
  assert.equal(nextGuestsLine(clean, { checkIn: today, guests: null }, "13:00", now, today), "Next guests arrive today at 1:00 PM");
  assert.equal(nextGuestsLine(clean, null, "16:00", now, today), null);
});
