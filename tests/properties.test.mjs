import assert from "node:assert/strict";
import { test } from "node:test";
import { houseKey, parseProperties, patchRegistry } from "../properties.ts";

test("parseProperties reads price and billing start, ignoring junk", () => {
  const [a, b] = parseProperties([
    { name: "Palm", address: "1 Palm Rd", price: 150, billedFrom: "2026-10-01" },
    { name: "Mesa", price: "abc", billedFrom: "Oct 1" },
  ]);
  assert.equal(a.price, 150);
  assert.equal(a.billedFrom, "2026-10-01");
  assert.equal(b.price, undefined);
  assert.equal(b.billedFrom, undefined);
});

test("houseKey is stable and map-key safe", () => {
  assert.equal(houseKey("Golf & Pool"), "golfpool");
  assert.equal(houseKey(null), "");
});

test("patchRegistry edits one house and keeps fields it doesn't know", () => {
  const raw = [
    { name: "Palm", address: "1 Palm Rd", aliases: ["palm"], doorCode: "1111", scriptOnly: "keep me" },
    { name: "Mesa", address: "2 Mesa Rd" },
  ];
  const out = patchRegistry(raw, "Palm", { price: 150, doorCode: "", short: "Palm C", name: "Renamed" });
  assert.equal(out[0].price, 150);
  assert.equal(out[0].doorCode, undefined);
  assert.equal(out[0].scriptOnly, "keep me");
  assert.equal(out[0].short, "Palm C");
  assert.equal(out[0].name, "Palm");
  assert.deepEqual(out[1], raw[1]);
  // The input isn't mutated.
  assert.equal(raw[0].doorCode, "1111");
});

test("patchRegistry adds a house it doesn't have", () => {
  const out = patchRegistry([{ name: "Palm" }], "Oak Bend", { address: "3 Oak Rd", price: 175 });
  assert.equal(out.length, 2);
  assert.deepEqual(out[1], { name: "Oak Bend", address: "3 Oak Rd", aliases: [], bedrooms: 0, bathrooms: 0, price: 175 });
  assert.equal(patchRegistry(null, "Solo", {}).length, 1);
});
