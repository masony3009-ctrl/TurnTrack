import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDaysToKey,
  countsAsCleaning,
  countsByWeek,
  houseLabel,
  monthGrid,
  monthLabel,
  monthTotals,
  monthsBetween,
  scheduleMonths,
  streetName,
  weekRangeLabel,
  weekStartKey,
  weekStatus,
  weekSummary,
} from "../schedule.ts";

const job = (dateKey, extra = {}) => ({ date: "", dateKey, address: "1 Main St", ...extra });

test("weeks start on Sunday", () => {
  assert.equal(weekStartKey("2026-10-25"), "2026-10-25"); // a Sunday
  assert.equal(weekStartKey("2026-10-31"), "2026-10-25"); // Saturday
  assert.equal(weekStartKey("2026-11-02"), "2026-11-01");
  assert.equal(weekStartKey("2027-01-01"), "2026-12-27"); // across the year
});

test("day keys add across months and years", () => {
  assert.equal(addDaysToKey("2026-10-31", 1), "2026-11-01");
  assert.equal(addDaysToKey("2026-12-31", 1), "2027-01-01");
  assert.equal(addDaysToKey("2026-03-01", -1), "2026-02-28");
});

test("a month grid is whole Sunday-Saturday weeks around the month", () => {
  const oct = monthGrid({ year: 2026, month: 9 });
  assert.equal(oct[0][0], "2026-09-27"); // matches the phone calendar
  assert.equal(oct.at(-1)[6], "2026-10-31");
  assert.equal(oct.length, 5);
  assert.ok(oct.every((row) => row.length === 7));
  const nov = monthGrid({ year: 2026, month: 10 });
  assert.equal(nov[0][0], "2026-11-01");
  assert.equal(nov.at(-1)[6], "2026-12-05");
  // February 2026 starts on a Sunday and fits in four rows.
  assert.equal(monthGrid({ year: 2026, month: 1 }).length, 4);
});

test("months run first to last, across the new year", () => {
  const ms = monthsBetween({ year: 2026, month: 10 }, { year: 2027, month: 1 });
  assert.deepEqual(ms.map((m) => monthLabel(m)), ["Nov", "Dec", "Jan", "Feb"]);
  assert.equal(monthLabel({ year: 2027, month: 0 }, true), "January 2027");
});

test("cancelled jobs and unconfirmed website requests don't count", () => {
  assert.equal(countsAsCleaning(job("2026-10-20")), true);
  assert.equal(countsAsCleaning(job("2026-10-20", { cancelled: true })), false);
  assert.equal(countsAsCleaning(job("2026-10-20", { pending: true })), false);
  assert.equal(countsAsCleaning({ date: "someday" }), false);
  // Older jobs only have the written date.
  assert.equal(countsAsCleaning({ date: "Thu, Nov 12 2026" }), true);
});

test("cleanings are counted per Sunday-Saturday week, with done ones", () => {
  const counts = countsByWeek([
    job("2026-10-25", { done: true }),
    job("2026-10-31"),
    job("2026-11-01"),
    job("2026-10-27", { cancelled: true }),
    job("2026-10-28", { pending: true }),
  ]);
  assert.deepEqual(counts.get("2026-10-25"), { total: 2, done: 1 });
  assert.deepEqual(counts.get("2026-11-01"), { total: 1, done: 0 });
  assert.equal(counts.size, 2);
});

test("a week is past, current or future relative to today", () => {
  assert.equal(weekStatus("2026-10-18", "2026-10-25"), "past");
  assert.equal(weekStatus("2026-10-25", "2026-10-25"), "current");
  assert.equal(weekStatus("2026-10-25", "2026-10-31"), "current");
  assert.equal(weekStatus("2026-11-01", "2026-10-31"), "future");
});

test("week rows say what was had, how it's going, or what's booked", () => {
  assert.equal(weekSummary({ total: 9, done: 7 }, "past"), "9 cleanings");
  assert.equal(weekSummary({ total: 1, done: 1 }, "past"), "1 cleaning");
  assert.equal(weekSummary(undefined, "past"), "0 cleanings");
  assert.equal(weekSummary({ total: 8, done: 3 }, "current"), "3 of 8 done");
  assert.equal(weekSummary(undefined, "current"), "None this week");
  assert.equal(weekSummary({ total: 6, done: 0 }, "future"), "6 booked");
  assert.equal(weekSummary(undefined, "future"), "None booked yet");
});

test("week ranges read short, naming the month again only when it changes", () => {
  assert.equal(weekRangeLabel("2026-10-25"), "Oct 25 – 31");
  assert.equal(weekRangeLabel("2026-11-29"), "Nov 29 – Dec 5");
  assert.equal(weekRangeLabel("2026-10-04"), "Oct 4 – 10");
});

test("a month splits into cleanings done and still to do", () => {
  const jobs = [
    job("2026-10-03", { done: true }), job("2026-10-24"), job("2026-10-25", { done: true }),
    job("2026-10-30"), job("2026-11-02", { done: true }), job("2026-10-26", { cancelled: true }),
  ];
  assert.deepEqual(monthTotals(jobs, { year: 2026, month: 9 }), { done: 2, left: 2 });
});

test("the month list spans the first to the last cleaning, always including today", () => {
  const ms = scheduleMonths([job("2026-08-14"), job("2027-01-05"), job("2025-01-01", { cancelled: true })], "2026-10-25");
  assert.equal(ms[0].month, 7);
  assert.equal(ms.at(-1).year, 2027);
  assert.equal(ms.length, 6);
  assert.deepEqual(scheduleMonths([], "2026-10-25"), [{ year: 2026, month: 9 }]);
});

// Made-up addresses only: this repo is public.
test("street names come out of addresses", () => {
  assert.equal(streetName("4821 N Mesquite Dr, San Tan Valley, AZ 85144"), "Mesquite");
  assert.equal(streetName("1200 E Saguaro Ave Mesa, AZ 85212"), "Saguaro");
  assert.equal(streetName("900 E Via Del Sol, Queen Creek"), "Via Del Sol");
  assert.equal(streetName("12 St Andrews Dr"), "St Andrews");
  assert.equal(streetName("77 E Desert Bloom St, Mesa, AZ"), "Desert Bloom");
  assert.equal(streetName("500 S Example Rd #12, Mesa"), "Example");
  assert.equal(streetName("88 W Ocotillo Way"), "Ocotillo Way");
  assert.equal(streetName(""), "");
  assert.equal(streetName(null), "");
});

test("calendar labels use the registry's short name first", () => {
  const houses = [
    { name: "Palm Cottage: Pool and spa", short: "Palm Cottage", address: "1 E Palm Ln, Queen Creek, AZ", aliases: ["palm cottage"], bedrooms: 3, bathrooms: 2 },
    { name: "Ironwood Dr", address: "141 W Ironwood Dr, San Tan Valley, AZ", aliases: [], bedrooms: 0, bathrooms: 2 },
  ];
  assert.equal(houseLabel({ date: "", property: "Palm Cottage: Pool and spa", address: "x" }, houses), "Palm Cottage");
  // In the registry without a short name: its street.
  assert.equal(houseLabel({ date: "", property: "Ironwood Dr", address: "" }, houses), "Ironwood");
  // Not in the registry: the job's own street, then its property, then its type.
  assert.equal(houseLabel({ date: "", address: "8000 E Cactus Wren St, Mesa, AZ" }, houses), "Cactus Wren");
  assert.equal(houseLabel({ date: "", property: "Mountain View: Private Pool", address: "" }, houses), "Mountain View");
  assert.equal(houseLabel({ date: "", address: "", type: "Deep-Cleaning" }, houses), "Deep-Cleaning");
});
