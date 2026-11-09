import assert from "node:assert/strict";
import { test } from "node:test";
import { addToCrew, crewLabel, crewOf, isOnCrew, removeFromCrew } from "../crew.ts";

const names = { pat: "Pat Doe", sam: "Sam Lee", kim: "Kim Ray" };
const nameOf = (id) => names[id];
const pat = { id: "pat", name: "Pat Doe" };
const sam = { id: "sam", name: "Sam Lee" };

test("crewOf lists the main cleaner first, without repeats or blanks", () => {
  assert.deepEqual(crewOf({}), []);
  assert.deepEqual(crewOf({ assignedTo: "pat" }), ["pat"]);
  assert.deepEqual(crewOf({ assignedTo: "pat", crew: ["sam", "pat", "", "kim"] }), ["pat", "sam", "kim"]);
  // A crew with no main cleaner still counts.
  assert.deepEqual(crewOf({ assignedTo: null, crew: ["sam"] }), ["sam"]);
});

test("isOnCrew covers the main cleaner and the rest", () => {
  const job = { assignedTo: "pat", crew: ["sam"] };
  assert.equal(isOnCrew(job, "pat"), true);
  assert.equal(isOnCrew(job, "sam"), true);
  assert.equal(isOnCrew(job, "kim"), false);
  assert.equal(isOnCrew(job, null), false);
});

test("the first cleaner added becomes the main one", () => {
  assert.deepEqual(addToCrew({}, pat, nameOf), { assignedTo: "pat", assignedToName: "Pat Doe", crew: null });
});

test("adding a second cleaner keeps the first as the main one", () => {
  const job = { assignedTo: "pat", assignedToName: "Pat D.", crew: null };
  assert.deepEqual(addToCrew(job, sam, nameOf), { assignedTo: "pat", assignedToName: "Pat D.", crew: ["sam"] });
  // Adding someone already on it changes nothing.
  assert.deepEqual(addToCrew({ assignedTo: "pat", assignedToName: "Pat D.", crew: ["sam"] }, sam, nameOf),
    { assignedTo: "pat", assignedToName: "Pat D.", crew: ["sam"] });
});

test("taking the main cleaner off hands the job to the next one", () => {
  const job = { assignedTo: "pat", assignedToName: "Pat Doe", crew: ["sam", "kim"] };
  assert.deepEqual(removeFromCrew(job, "pat", nameOf), { assignedTo: "sam", assignedToName: "Sam Lee", crew: ["kim"] });
  assert.deepEqual(removeFromCrew(job, "kim", nameOf), { assignedTo: "pat", assignedToName: "Pat Doe", crew: ["sam"] });
});

test("taking the last cleaner off leaves it unassigned", () => {
  assert.deepEqual(removeFromCrew({ assignedTo: "pat", assignedToName: "Pat Doe" }, "pat", nameOf),
    { assignedTo: null, assignedToName: null, crew: null });
});

test("a cleaner no longer on the team still gets a name", () => {
  const job = { assignedTo: "pat", assignedToName: "Pat Doe", crew: ["gone"] };
  assert.equal(removeFromCrew(job, "pat", nameOf).assignedToName, "Cleaner");
  assert.equal(crewLabel(job, nameOf), "Pat & Cleaner");
});

test("crewLabel uses the full name for one and first names for more", () => {
  assert.equal(crewLabel({}, nameOf), null);
  assert.equal(crewLabel({ assignedTo: "pat", assignedToName: "Pat Doe" }, nameOf), "Pat Doe");
  assert.equal(crewLabel({ assignedTo: "pat", assignedToName: "Pat Doe", crew: ["sam"] }, nameOf), "Pat & Sam");
  assert.equal(crewLabel({ assignedTo: "pat", assignedToName: "Pat Doe", crew: ["sam", "kim"] }, nameOf), "Pat, Sam & Kim");
});
