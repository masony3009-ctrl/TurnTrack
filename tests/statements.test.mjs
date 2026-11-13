import assert from "node:assert/strict";
import { test } from "node:test";
import { monthName, statementsFor, statementText } from "../statements.ts";

const house = (name, extra = {}) => ({ name, address: `${name} Rd`, aliases: [], bedrooms: 3, bathrooms: 2, price: 180, billedFrom: "2026-10-01", ...extra });
const job = (id, dateKey, extra = {}) => ({ id, date: "", dateKey, address: "x", type: "Turnover", done: true, ...extra });

test("one statement per host, this month's cleanings, paid and owed", () => {
  const a = house("Sample A", { forwardsFrom: "Host@Example.com" });
  const b = house("Sample B", { forwardsFrom: "host@example.com", price: 200 });
  const c = house("Solo", { short: "Solo House" });
  const notBilled = house("Turno House", { billedFrom: undefined });
  const groups = [
    { key: "a", house: a, jobs: [
      job("1", "2026-11-03", { hostPaid: true }),
      job("2", "2026-11-10"),
      job("3", "2026-10-20"), // earlier, unpaid
      job("4", "2026-11-12", { done: false }), // not done
      job("5", "2026-11-14", { cancelled: true }),
      job("6", "2026-09-30"), // before billing started
    ] },
    { key: "b", house: b, jobs: [job("7", "2026-11-05", { price: 250 }), job("8", "2026-11-06", { type: "Deep Cleaning" })] },
    { key: "c", house: c, jobs: [job("9", "2026-11-01")] },
    { key: "d", house: notBilled, jobs: [job("10", "2026-11-01")] },
  ];
  const [host, solo] = statementsFor(groups, "2026-11");
  assert.equal(host.label, "Sample A + 1 more");
  assert.deepEqual(host.lines.map((l) => [l.dateKey, l.house, l.price, l.paid]), [
    ["2026-11-03", "Sample A", 180, true],
    ["2026-11-05", "Sample B", 250, false],
    ["2026-11-06", "Sample B", null, false],
    ["2026-11-10", "Sample A", 180, false],
  ]);
  assert.deepEqual([host.total, host.paid, host.owed, host.unpriced, host.earlierOwed], [610, 180, 430, 1, 180]);
  assert.deepEqual([solo.label, solo.total, solo.owed], ["Solo House", 180, 180]);
  assert.equal(statementsFor(groups, "2026-12").length, 2); // only earlier debts left
});

test("the statement reads as a message", () => {
  const groups = [{ key: "a", house: house("Sample A"), jobs: [job("1", "2026-11-03", { hostPaid: true }), job("2", "2026-11-10"), job("3", "2026-10-20")] }];
  const [st] = statementsFor(groups, "2026-11");
  const text = statementText(st, "2026-11", { name: "Handyman Cleaners", phone: "(000) 000-0000" });
  assert.equal(text, [
    "Handyman Cleaners · statement for November 2026",
    "Sample A",
    "",
    "Tue, Nov 3 · Turnover · $180 · paid",
    "Tue, Nov 10 · Turnover · $180",
    "",
    "Total for November 2026: $360",
    "Paid: $180",
    "Still owed: $180",
    "Also owed from earlier months: $180",
    "",
    "Questions? (000) 000-0000",
  ].join("\n"));
  assert.equal(monthName("2027-01"), "January 2027");
});
