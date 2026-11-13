import assert from "node:assert/strict";
import { test } from "node:test";
import { cardTitle, matchesSearch, weekLabel, weeksOf } from "../jobList.ts";

const house = (name, extra = {}) => ({ name, address: "1 Palm Rd, Mesa, AZ 85201", aliases: [], bedrooms: 2, bathrooms: 2, ...extra });

test("a card leads with the house name, or the street when it isn't a listed house", () => {
  assert.deepEqual(cardTitle({ address: "1 Palm Rd, Mesa, AZ 85201, USA" }, house("Palm Listing", { short: "Palm" })), { title: "Palm", subtitle: "1 Palm Rd, Mesa, AZ 85201" });
  assert.deepEqual(cardTitle({ address: "1 Palm Rd, Mesa" }, house("Palm Listing")), { title: "Palm Listing", subtitle: "1 Palm Rd, Mesa" });
  assert.deepEqual(cardTitle({ address: "9 Oak Ln, Gilbert, AZ 85297" }, null), { title: "9 Oak Ln", subtitle: "Gilbert, AZ 85297" });
  assert.deepEqual(cardTitle({ address: "9 Oak Ln Gilbert" }, null), { title: "9 Oak Ln Gilbert", subtitle: null });
  assert.deepEqual(cardTitle({ address: "", property: "Some Place", type: "Turnover" }, null), { title: "Some Place", subtitle: null });
  assert.deepEqual(cardTitle({ address: "", type: "Turnover" }, null), { title: "Turnover", subtitle: null });
});

test("weeks run Sunday to Saturday; next week says so", () => {
  const today = "2026-11-13"; // a Friday
  assert.equal(weekLabel("2026-11-15", today), "Next week");
  assert.equal(weekLabel("2026-11-22", today), "Week of Nov 22");
  assert.equal(weekLabel("2027-01-03", today), "Week of Jan 3, 2027");
  const job = (dateKey) => ({ date: "", dateKey });
  const groups = weeksOf([job("2026-11-23"), job("2026-11-16"), job("2026-11-21"), job("2026-11-29"), { date: "whenever" }], today);
  assert.deepEqual(groups.map((g) => [g.start, g.label, g.jobs.map((j) => j.dateKey || "none")]), [
    ["2026-11-15", "Next week", ["2026-11-16", "2026-11-21"]],
    ["2026-11-22", "Week of Nov 22", ["2026-11-23"]],
    ["2026-11-29", "Week of Nov 29", ["2026-11-29"]],
    ["", "Later", ["none"]],
  ]);
});

test("a search matches every word typed, anywhere on the card", () => {
  const fields = ["Desert Oasis", "1 Palm Rd, Mesa", "Jewel & Shane", "Airbnb Turnover"];
  assert.equal(matchesSearch(fields, ""), true);
  assert.equal(matchesSearch(fields, "  "), true);
  assert.equal(matchesSearch(fields, "oasis"), true);
  assert.equal(matchesSearch(fields, "jew mesa"), true);
  assert.equal(matchesSearch(fields, "PALM rd"), true);
  assert.equal(matchesSearch(fields, "oasis gilbert"), false);
  assert.equal(matchesSearch([null, undefined, "Crismon #3098"], "#3098"), true);
});
