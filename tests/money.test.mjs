import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deepCleanStatus,
  groupByHouse,
  hostOwed,
  houseMoney,
  isDeepClean,
  jobLabor,
  jobPrice,
  OTHER_HOUSE,
  parsePrice,
  perCleaning,
  periodRange,
  sumMoney,
  unlinkedClients,
} from "../money.ts";

const house = (name, extra = {}) => ({ name, address: `${name} Rd`, aliases: [], bedrooms: 2, bathrooms: 2, ...extra });
const job = (dateKey, extra = {}) => ({ date: "", dateKey, address: "1 Main St", type: "Turnover", done: true, ...extra });

test("isDeepClean reads the job type", () => {
  assert.equal(isDeepClean({ type: "Deep-Cleaning" }), true);
  assert.equal(isDeepClean({ type: "Turnover deep" }), true);
  assert.equal(isDeepClean({ type: "Airbnb Turnover" }), false);
  assert.equal(isDeepClean({}), false);
});

test("jobPrice prefers the job's own price, then the house price, never for deep cleans", () => {
  const h = house("Palm", { price: 150 });
  assert.equal(jobPrice(job("2026-10-01", { price: 175 }), h), 175);
  assert.equal(jobPrice(job("2026-10-01"), h), 150);
  assert.equal(jobPrice(job("2026-10-01", { type: "Deep Cleaning" }), h), null);
  assert.equal(jobPrice(job("2026-10-01", { type: "Deep Cleaning", price: 400 }), h), 400);
  assert.equal(jobPrice(job("2026-10-01"), house("Bare")), null);
  assert.equal(jobPrice(job("2026-10-01", { price: 0 }), null), null);
});

test("parsePrice reads what an owner would type", () => {
  assert.equal(parsePrice("150"), 150);
  assert.equal(parsePrice("$1,200"), 1200);
  assert.equal(parsePrice(" 175.50 "), 175.5);
  assert.equal(parsePrice(""), null);
  assert.equal(parsePrice("0"), null);
  assert.equal(parsePrice("12.345"), null);
  assert.equal(parsePrice("abc"), null);
  assert.equal(parsePrice("20000"), null);
});

test("jobLabor ignores empty summaries", () => {
  assert.equal(jobLabor(job("2026-10-01")), null);
  assert.equal(jobLabor(job("2026-10-01", { timeSummary: { minutes: 0, earned: 0 } })), null);
  assert.deepEqual(jobLabor(job("2026-10-01", { timeSummary: { minutes: 150, earned: 62.5 } })), { minutes: 150, earned: 62.5 });
});

test("periodRange covers whole months and wraps the year", () => {
  assert.deepEqual(periodRange("month", "2026-02-14"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(periodRange("lastMonth", "2026-01-10"), { from: "2025-12-01", to: "2025-12-31" });
  assert.deepEqual(periodRange("year", "2026-10-27"), { from: "2026-01-01", to: "2026-12-31" });
  assert.equal(periodRange("all", "2026-10-27"), null);
});

test("groupByHouse files jobs under registry houses and the rest under other", () => {
  const props = [house("Palm Cottage", { address: "4821 N Mesquite Dr" }), house("Empty")];
  const groups = groupByHouse([
    job("2026-10-01", { property: "Palm Cottage" }),
    job("2026-10-02", { address: "4821 N Mesquite Dr" }),
    job("2026-10-03", { address: "9 Nowhere Ln" }),
    job("2026-10-04", { property: "Palm Cottage", cancelled: true }),
    job("2026-10-05", { property: "Palm Cottage", pending: true }),
  ], props);
  assert.equal(groups.get("palmcottage").jobs.length, 2);
  assert.equal(groups.get("empty").jobs.length, 0);
  assert.equal(groups.get(OTHER_HOUSE).jobs.length, 1);
  assert.equal(groups.get(OTHER_HOUSE).house, null);
});

test("houseMoney splits finished from booked and counts gaps", () => {
  const h = house("Palm", { price: 150 });
  const group = { key: "palm", house: h, jobs: [
    job("2026-10-01", { timeSummary: { minutes: 120, earned: 50 } }),
    job("2026-10-08", { timeSummary: { minutes: 180, earned: 75 } }),
    job("2026-10-15"),
    job("2026-10-20", { type: "Deep Cleaning" }),
    job("2026-10-30", { done: false }),
    job("2026-09-30", { timeSummary: { minutes: 60, earned: 25 } }),
  ] };
  const m = houseMoney(group, periodRange("month", "2026-10-27"));
  assert.equal(m.cleanings, 4);
  assert.equal(m.revenue, 450);
  assert.equal(m.unpriced, 1);
  assert.equal(m.labor, 125);
  assert.equal(m.timed, 2);
  assert.equal(m.minutes, 300);
  assert.equal(m.booked, 1);
  assert.equal(m.bookedRevenue, 150);
  assert.equal(houseMoney(group, null).cleanings, 5);
});

test("perCleaning averages only timed cleanings", () => {
  const base = { booked: 0, bookedRevenue: 0 };
  assert.deepEqual(perCleaning({ ...base, cleanings: 3, revenue: 450, unpriced: 0, labor: 125, minutes: 300, timed: 2 }), { minutes: 150, labor: 62.5, margin: 87.5 });
  assert.deepEqual(perCleaning({ ...base, cleanings: 3, revenue: 0, unpriced: 3, labor: 50, minutes: 100, timed: 1 }), { minutes: 100, labor: 50, margin: null });
  assert.deepEqual(perCleaning({ ...base, cleanings: 3, revenue: 450, unpriced: 0, labor: 0, minutes: 0, timed: 0 }), { minutes: null, labor: null, margin: null });
});

test("sumMoney adds the rows up and works out profit", () => {
  const a = { cleanings: 2, revenue: 300, unpriced: 0, labor: 100.1, minutes: 240, timed: 2, booked: 1, bookedRevenue: 150 };
  const b = { cleanings: 1, revenue: 0, unpriced: 1, labor: 0, minutes: 0, timed: 0, booked: 0, bookedRevenue: 0 };
  const t = sumMoney([a, b]);
  assert.equal(t.cleanings, 3);
  assert.equal(t.unpriced, 1);
  assert.equal(t.profit, 199.9);
  assert.equal(sumMoney([]).profit, 0);
});

test("deepCleanStatus counts regular cleanings since the last deep clean", () => {
  const regular = Array.from({ length: 12 }, (_, i) => job(`2026-09-${String(i + 1).padStart(2, "0")}`));
  assert.deepEqual(deepCleanStatus(regular, "2026-10-27"), { since: 12, lastDeep: null, booked: null, due: true });

  const withDeep = deepCleanStatus([...regular, job("2026-09-05", { type: "Deep Cleaning" })], "2026-10-27");
  assert.equal(withDeep.lastDeep, "2026-09-05");
  assert.equal(withDeep.since, 7);
  assert.equal(withDeep.due, false);

  const booked = deepCleanStatus([...regular, job("2026-11-12", { type: "Deep-Cleaning", done: false })], "2026-10-27");
  assert.equal(booked.booked, "2026-11-12");
  assert.equal(booked.due, false);

  assert.equal(deepCleanStatus([job("2026-10-01", { done: false })], "2026-10-27").since, 0);
  assert.equal(deepCleanStatus([], "2026-10-27"), null);
  assert.equal(deepCleanStatus([job("2026-10-01", { cancelled: true })], "2026-10-27"), null);
});

test("hostOwed counts finished, priced, unpaid cleanings from the billing date", () => {
  const h = house("Palm", { price: 150, billedFrom: "2026-10-01" });
  const owed = hostOwed([
    job("2026-09-20"),
    job("2026-10-02"),
    job("2026-10-05", { hostPaid: true }),
    job("2026-10-09", { price: 180 }),
    job("2026-10-12", { done: false }),
    job("2026-10-14", { type: "Deep Cleaning" }),
  ], h);
  assert.equal(owed.amount, 330);
  assert.equal(owed.jobs.length, 2);
  assert.deepEqual(hostOwed([job("2026-10-02")], house("Palm", { price: 150 })), { amount: 0, jobs: [] });
  assert.deepEqual(hostOwed([job("2026-10-02")], null), { amount: 0, jobs: [] });
});

test("unlinkedClients groups loose cleanings by place, coming-up first", () => {
  const jobs = [
    job("2026-09-21", { property: "23 Elm St, Mesa, AZ 85201, USA", address: "23 Elm St, Mesa, AZ 85201, USA, Mesa, Mesa", price: 300 }),
    job("2026-10-28", { address: "9 Bean Way", done: false, contact: { name: "Sam Rivera" } }),
    job("2026-10-02", { property: "Pony", address: "Pony", price: 100 }),
    job("2026-09-15", { property: "Pony", address: "Pony", price: 100 }),
    job("2026-08-01", { property: "Pony", address: "Pony", price: 90 }),
    job("2026-10-01", { address: "" }),
  ];
  const out = unlinkedClients(jobs, "2026-10-28");
  assert.deepEqual(out.map(c => c.label), ["9 Bean Way", "Pony", "23 Elm St"]);
  const [bean, pony, elm] = out;
  assert.equal(bean.next, "2026-10-28");
  assert.equal(bean.contact, "Sam Rivera");
  assert.equal(bean.address, "9 Bean Way");
  assert.equal(bean.name, "");
  assert.equal(bean.price, null);
  assert.equal(pony.jobs.length, 3);
  assert.equal(pony.last, "2026-10-02");
  assert.equal(pony.name, "Pony");
  assert.equal(pony.address, "");
  assert.equal(pony.price, 100);
  assert.equal(elm.address, "23 Elm St, Mesa, AZ 85201");
  assert.equal(elm.name, "");
  assert.deepEqual(unlinkedClients([], "2026-10-28"), []);
});
