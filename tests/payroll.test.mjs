import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDollars, formatMoney, paymentsOf, weekStartMs, workedBetween } from "../payroll.ts";

test("formatDollars drops empty cents and groups thousands", () => {
  assert.equal(formatDollars(42840), "$42,840");
  assert.equal(formatDollars(180), "$180");
  assert.equal(formatDollars(304.58), "$304.58");
  assert.equal(formatDollars(1234567.5), "$1,234,567.50");
  assert.equal(formatDollars(-12), "-$12");
  assert.equal(formatDollars(0), "$0");
});

test("formatMoney puts the minus sign before the dollar sign", () => {
  assert.equal(formatMoney(150), "$150.00");
  assert.equal(formatMoney(-12.5), "-$12.50");
  assert.equal(formatMoney(0), "$0.00");
});

test("weekStartMs lands on Sunday midnight, local time", () => {
  const tue = new Date(2026, 9, 27, 15, 30).getTime();
  assert.equal(weekStartMs(tue), new Date(2026, 9, 25).getTime());
  assert.equal(weekStartMs(tue, 1), new Date(2026, 9, 18).getTime());
  const sun = new Date(2026, 9, 25, 0, 5).getTime();
  assert.equal(weekStartMs(sun), new Date(2026, 9, 25).getTime());
});

const entry = (endedAt, extra = {}) => ({ minutes: 60, earned: 25, endedAt, paid: false, paidAt: null, method: null, ...extra });

test("workedBetween sums entries that ended in the window", () => {
  const from = new Date(2026, 9, 25).getTime();
  const to = new Date(2026, 10, 1).getTime();
  const w = workedBetween([entry(from), entry(from + 1000, { minutes: 90, earned: 37.555 }), entry(to), entry(from - 1)], from, to);
  assert.deepEqual(w, { minutes: 150, earned: 62.56, count: 2 });
  assert.deepEqual(workedBetween([], from, to), { minutes: 0, earned: 0, count: 0 });
});

test("paymentsOf groups paid entries by the moment they were settled", () => {
  const payments = paymentsOf([
    entry(1, { paid: true, paidAt: 500, method: "Zelle" }),
    entry(2, { paid: true, paidAt: 500, method: "Zelle", earned: 30.1 }),
    entry(3, { paid: true, paidAt: 900, method: "Cash" }),
    entry(4),
  ]);
  assert.deepEqual(payments, [
    { paidAt: 900, amount: 25, count: 1, method: "Cash" },
    { paidAt: 500, amount: 55.1, count: 2, method: "Zelle" },
  ]);
});
