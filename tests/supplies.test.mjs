import assert from "node:assert/strict";
import { test } from "node:test";
import { finishReportText, parseSupplies, SUPPLY_CHOICES, supplyList } from "../supplies.ts";

test("parseSupplies keeps houses that still need something, newest first", () => {
  const reports = parseSupplies({
    houses: {
      palm: { name: "Palm Cottage", items: ["Coffee", "Coffee", "Trash bags"], at: 100, by: "Sam", jobId: "j1" },
      mesa: { name: "Mesa", items: [], at: 300 },
      oak: { items: ["Toilet paper"], at: 200 },
      junk: "nope",
    },
  });
  assert.equal(reports.length, 2);
  assert.equal(reports[0].key, "oak");
  assert.equal(reports[0].name, "oak");
  assert.deepEqual(reports[1].items, ["Coffee", "Trash bags"]);
  assert.equal(reports[1].by, "Sam");
  assert.deepEqual(parseSupplies(null), []);
  assert.deepEqual(parseSupplies({}), []);
});

test("supplyList reads like a sentence", () => {
  assert.equal(supplyList([]), "");
  assert.equal(supplyList(["Coffee"]), "Coffee");
  assert.equal(supplyList(["Toilet paper", "Coffee"]), "Toilet paper and coffee");
  assert.equal(supplyList(["Toilet paper", "Coffee", "Trash bags"]), "Toilet paper, coffee and trash bags");
});

test("finishReportText covers notes, supplies and both", () => {
  assert.deepEqual(finishReportText("Sam", "Palm", null, ["Coffee"]), { title: "Sam flagged low supplies · Palm", body: "Low on coffee." });
  assert.deepEqual(finishReportText("Sam", "Palm", { text: "Lamp broke", skipped: 0 }, []), { title: "Note from Sam · Palm", body: "Lamp broke" });
  assert.deepEqual(
    finishReportText("Sam", "Palm", { text: "Out of time", skipped: 2 }, ["Coffee", "Sponges"]),
    { title: "Note from Sam · Palm · 2 steps not done", body: "Low on coffee and sponges. Out of time" }
  );
});

test("the supply chips have no duplicates", () => {
  assert.equal(new Set(SUPPLY_CHOICES).size, SUPPLY_CHOICES.length);
});
