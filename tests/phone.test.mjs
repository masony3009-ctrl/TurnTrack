import assert from "node:assert/strict";
import { test } from "node:test";
import { formatPhone } from "../phone.ts";

test("formatPhone shows ten digits the usual way", () => {
  assert.equal(formatPhone("4805550142"), "(480) 555-0142");
  assert.equal(formatPhone("+1 480-555-0142"), "(480) 555-0142");
  assert.equal(formatPhone("1 (480) 555 0142"), "(480) 555-0142");
  assert.equal(formatPhone(" 480.555.0142 "), "(480) 555-0142");
});

test("formatPhone leaves anything else as typed", () => {
  assert.equal(formatPhone("555-0142"), "555-0142");
  assert.equal(formatPhone("ext 12"), "ext 12");
  assert.equal(formatPhone(""), "");
  assert.equal(formatPhone(null), "");
  assert.equal(formatPhone("+44 20 7946 0958"), "+44 20 7946 0958");
});
