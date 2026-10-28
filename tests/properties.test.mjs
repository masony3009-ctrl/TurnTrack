import assert from "node:assert/strict";
import { test } from "node:test";
import { aliasesToLink, findProperty, houseKey, parseProperties, patchRegistry, streetOf, tidyAddress } from "../properties.ts";

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

test("streetOf and tidyAddress clean up what the sources send", () => {
  assert.equal(streetOf({ address: "4 Oak Rd, Mesa, AZ 85201" }), "4 Oak Rd");
  assert.equal(streetOf({ address: "", property: "Pony" }), "Pony");
  assert.equal(streetOf({}), "");
  assert.equal(tidyAddress("4 Oak Rd, Mesa, AZ 85201, USA, Mesa, Mesa"), "4 Oak Rd, Mesa, AZ 85201");
  assert.equal(tidyAddress(null), "");
});

test("aliasesToLink adds only what a job needs to file under the house", () => {
  const oak = { name: "Oak Bend", address: "4 Oak Rd, Mesa, AZ 85201", aliases: [], bedrooms: 0, bathrooms: 0 };
  // Same address: no alias needed.
  assert.deepEqual(aliasesToLink(oak, [{ address: "4 Oak Rd, Mesa, AZ 85201" }]), []);
  // Same street, different tail: the street alone is enough.
  const messy = { property: "4 Oak Rd, Mesa, AZ 85201, USA, Mesa", address: "4 Oak Rd, Mesa, AZ 85201, USA, Mesa, Mesa, Mesa" };
  assert.deepEqual(aliasesToLink(oak, [messy, messy]), ["4 Oak Rd"]);
  assert.equal(findProperty([{ ...oak, aliases: ["4 Oak Rd"] }], messy)?.name, "Oak Bend");
  // A job that only carries a name.
  assert.deepEqual(aliasesToLink(oak, [{ property: "Pony", address: "Pony" }]), ["Pony"]);
  // A neighbour two doors down is not pulled in by the alias.
  assert.equal(findProperty([{ ...oak, aliases: ["4 Oak Rd"] }], { address: "8 Oak Rd" }), null);
  assert.deepEqual(aliasesToLink(oak, []), []);
});

test("patchRegistry adds aliases without dropping or repeating the old ones", () => {
  const raw = [{ name: "Palm", address: "1 Palm Rd", aliases: ["palm cottage"] }];
  const out = patchRegistry(raw, "Palm", {}, ["Palm Cottage", "9 Elm St", " 9 elm st "]);
  assert.deepEqual(out[0].aliases, ["palm cottage", "9 Elm St"]);
  assert.deepEqual(raw[0].aliases, ["palm cottage"]);
  const added = patchRegistry([], "Oak Bend", { address: "4 Oak Rd" }, ["Pony"]);
  assert.deepEqual(added[0].aliases, ["Pony"]);
});
