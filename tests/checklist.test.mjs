// Run with `npm test`. Node strips the types from checklist.ts on import.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildChecklist,
  checklistForJob,
  checklistProgress,
  currentRoom,
  DEFAULT_CHECKLIST,
  hasHalfBath,
  isHeadingLine,
  ownsList,
  checkAll,
  addableRooms,
  addRoom,
  removeRoom,
  legacyItems,
  parseStepLine,
  repeatTitles,
  roomMinutes,
  roomSections,
  templateFromDoc,
  templateStats,
  toggleStep,
  unfinishedByRoom,
} from "../checklist.ts";

const TEMPLATE = [
  "First 10 minutes:",
  "> Start the slow things first.",
  "Walk the house | Count the used beds.",
  "Check the dishwasher",
  "Bathroom #:",
  "> Vacuum the hair out first.",
  "Toilet | Paper towels, never a microfiber.",
  "Shower",
  "Half bath:",
  "Toilet",
  "Kitchen:",
  "Counters | Wipe every crumb.",
];

const titles = list => list.filter(i => i.heading).map(i => i.text);
const MIN = 60000;

test("heading lines end in a colon, but never notes or steps with a tip", () => {
  assert.equal(isHeadingLine("Kitchen:"), true);
  assert.equal(isHeadingLine("Kitchen:  "), true);
  assert.equal(isHeadingLine("Restock | Toilet paper:"), false);
  assert.equal(isHeadingLine("> Watch for:"), false);
  assert.equal(isHeadingLine("Counters"), false);
});

test("a step's tip comes after the bar", () => {
  assert.deepEqual(parseStepLine("Oven | Wipe the door glass "), { text: "Oven", note: "Wipe the door glass" });
  assert.deepEqual(parseStepLine("Oven"), { text: "Oven", note: null });
  assert.deepEqual(parseStepLine("Oven |  "), { text: "Oven", note: null });
});

test("bathroom rooms repeat per full bathroom", () => {
  assert.deepEqual(repeatTitles("Bathroom #", 3), ["Bathroom 1", "Bathroom 2", "Bathroom 3"]);
  assert.deepEqual(repeatTitles("Bathroom #", 2.5), ["Bathroom 1", "Bathroom 2"]);
  assert.deepEqual(repeatTitles("Bathroom #", 1), ["Bathroom"]);
});

test("an unknown bathroom count gives one room covering all of them", () => {
  assert.deepEqual(repeatTitles("Bathroom #", 0), ["Bathrooms (all)"]);
  assert.deepEqual(repeatTitles("Bathroom #", null), ["Bathrooms (all)"]);
  assert.deepEqual(repeatTitles("Bathroom #", Number.NaN), ["Bathrooms (all)"]);
});

test("only a .5 bathroom count has a half bath", () => {
  assert.equal(hasHalfBath(2.5), true);
  assert.equal(hasHalfBath(2), false);
  assert.equal(hasHalfBath(0), false);
  assert.equal(hasHalfBath(null), false);
});

test("a 2.5-bath house gets two bathrooms and the half bath", () => {
  const list = buildChecklist(TEMPLATE, { bathrooms: 2.5 });
  assert.deepEqual(titles(list), ["First 10 minutes", "Bathroom 1", "Bathroom 2", "Half bath", "Kitchen"]);
});

test("a house with no bathroom count skips the half bath", () => {
  const list = buildChecklist(TEMPLATE, { bathrooms: 0 });
  assert.deepEqual(titles(list), ["First 10 minutes", "Bathrooms (all)", "Kitchen"]);
});

test("room notes land on the heading and tips on the step", () => {
  const list = buildChecklist(TEMPLATE, { bathrooms: 2 });
  const bath2 = list.find(i => i.text === "Bathroom 2");
  assert.equal(bath2.note, "Vacuum the hair out first.");
  const toilets = list.filter(i => i.text === "Toilet");
  assert.equal(toilets.length, 2);
  assert.equal(toilets[0].note, "Paper towels, never a microfiber.");
});

test("built items never carry undefined fields (Firestore rejects them)", () => {
  for (const item of buildChecklist(TEMPLATE, { bathrooms: 2.5 })) {
    for (const [k, v] of Object.entries(item)) assert.notEqual(v, undefined, `${item.text}.${k}`);
    if (!item.heading) assert.equal("heading" in item, false);
  }
  const plain = buildChecklist(["Kitchen:", "Counters"]);
  assert.equal("note" in plain[0], false);
  assert.equal("note" in plain[1], false);
});

test("an old plain template still builds the same list as before", () => {
  const list = buildChecklist(["General:", "Arrive on time", "Kitchen:", "Wash dishes"]);
  assert.deepEqual(list, [
    { text: "General", done: false, heading: true },
    { text: "Arrive on time", done: false },
    { text: "Kitchen", done: false, heading: true },
    { text: "Wash dishes", done: false },
  ]);
});

test("an empty template falls back to the default list", () => {
  assert.equal(buildChecklist([]).length, DEFAULT_CHECKLIST.length);
  assert.equal(buildChecklist(null).length, DEFAULT_CHECKLIST.length);
});

test("older app versions get a plain list with one shared bathroom room", () => {
  assert.deepEqual(legacyItems(TEMPLATE), [
    "First 10 minutes:",
    "Walk the house",
    "Check the dishwasher",
    "Bathrooms (all):",
    "Toilet",
    "Shower",
    "Kitchen:",
    "Counters",
  ]);
});

test("the stored template prefers lines, then items, then the default", () => {
  assert.deepEqual(templateFromDoc({ lines: ["A:", "b"], items: ["x"] }), ["A:", "b"]);
  assert.deepEqual(templateFromDoc({ items: ["x", "  ", 3] }), ["x"]);
  assert.deepEqual(templateFromDoc(undefined), DEFAULT_CHECKLIST);
  assert.deepEqual(templateFromDoc({ lines: [] }), DEFAULT_CHECKLIST);
});

test("template stats count each room once", () => {
  assert.deepEqual(templateStats(TEMPLATE), { rooms: 4, steps: 6 });
});

test("rooms report progress, timing and who ticked last", () => {
  let list = buildChecklist(TEMPLATE, { bathrooms: 1 });
  const t0 = 1_000_000;
  const idx = text => list.findIndex(i => i.text === text);
  list = toggleStep(list, idx("Walk the house"), "Marcus", t0).items;
  list = toggleStep(list, idx("Check the dishwasher"), "Marcus", t0 + 17 * MIN).items;
  const [first, bath] = roomSections(list);
  assert.equal(first.complete, true);
  assert.equal(first.lastBy, "Marcus");
  assert.equal(roomMinutes(first), 17);
  assert.equal(bath.title, "Bathroom");
  assert.equal(bath.complete, false);
  assert.equal(roomMinutes(bath), null);
});

test("finishing a room stamps it once and reports it once", () => {
  let list = buildChecklist(TEMPLATE, { bathrooms: 2 });
  const steps = roomSections(list).find(r => r.title === "Bathroom 1").steps.map(s => s.index);
  let r = toggleStep(list, steps[0], "Marcus", 1);
  assert.equal(r.finishedRoom, null);
  r = toggleStep(r.items, steps[1], "Marcus", 2);
  assert.equal(r.finishedRoom.title, "Bathroom 1");
  assert.equal(r.items[r.finishedRoom.headingIndex].notifiedAt, 2);
  // Untick and finish again: already reported, so no second notification.
  list = toggleStep(r.items, steps[1], "Marcus", 3).items;
  r = toggleStep(list, steps[1], "Marcus", 4);
  assert.equal(r.finishedRoom, null);
  assert.equal(r.items[steps[1]].done, true);
});

test("unticking clears the stamp", () => {
  const list = buildChecklist(["Kitchen:", "Counters"]);
  const ticked = toggleStep(list, 1, "Marcus", 5).items;
  assert.deepEqual(ticked[1], { text: "Counters", done: true, doneAt: 5, doneBy: "Marcus" });
  const unticked = toggleStep(ticked, 1, "Marcus", 6).items;
  assert.deepEqual(unticked[1], { text: "Counters", done: false, doneAt: null, doneBy: null });
});

test("headings and out-of-range taps change nothing", () => {
  const list = buildChecklist(["Kitchen:", "Counters"]);
  assert.equal(toggleStep(list, 0, "M", 1).items, list);
  assert.equal(toggleStep(list, 9, "M", 1).items, list);
});

test("steps before any heading form their own room", () => {
  const sections = roomSections(buildChecklist(["Arrive", "Kitchen:", "Counters"]));
  assert.deepEqual(sections.map(s => [s.key, s.title]), [["start", "Checklist"], ["h1", "Kitchen"]]);
});

test("an empty room is dropped", () => {
  assert.deepEqual(roomSections(buildChecklist(["Empty:", "Kitchen:", "Counters"])).map(s => s.title), ["Kitchen"]);
});

test("an untouched job shows the current template for its house", () => {
  const stale = buildChecklist(["General:", "Arrive on time"]);
  const shown = checklistForJob({ stored: stale, done: false, template: TEMPLATE, bathrooms: 2 });
  assert.deepEqual(titles(shown), ["First 10 minutes", "Bathroom 1", "Bathroom 2", "Kitchen"]);
});

test("a job keeps its own list once anything is ticked, or once finished", () => {
  const stale = buildChecklist(["General:", "Arrive on time"]);
  const ticked = toggleStep(stale, 1, "M", 1).items;
  assert.equal(checklistForJob({ stored: ticked, done: false, template: TEMPLATE, bathrooms: 2 }), ticked);
  assert.equal(checklistForJob({ stored: stale, done: true, template: TEMPLATE, bathrooms: 2 }), stale);
});

test("while the template is still loading, a stored list is kept", () => {
  const stale = buildChecklist(["General:", "Arrive on time"]);
  assert.equal(checklistForJob({ stored: stale, done: false, template: null }), stale);
  assert.equal(checklistForJob({ stored: null, done: false, template: null }).length, DEFAULT_CHECKLIST.length);
});

test("the current room is wherever the latest tick landed", () => {
  let list = buildChecklist(TEMPLATE, { bathrooms: 1 });
  assert.equal(currentRoom(list), null);
  assert.equal(ownsList(list), false);
  const kitchen = list.findIndex(i => i.text === "Counters");
  const walk = list.findIndex(i => i.text === "Walk the house");
  list = toggleStep(list, kitchen, "M", 10).items;
  list = toggleStep(list, walk, "M", 5).items;
  assert.equal(currentRoom(list), "Kitchen");
  assert.equal(ownsList(list), true);
});

const WITH_BEDROOM = [...TEMPLATE.slice(0, 10), "Bedroom (optional):", "Make the bed", "Vacuum the floor", ...TEMPLATE.slice(10)];

test("optional rooms are left out until added", () => {
  assert.deepEqual(titles(buildChecklist(WITH_BEDROOM, { bathrooms: 2 })), ["First 10 minutes", "Bathroom 1", "Bathroom 2", "Kitchen"]);
  assert.equal(legacyItems(WITH_BEDROOM).includes("Bedroom:"), false);
});

test("bathrooms, half baths and optional rooms can be added by hand", () => {
  assert.deepEqual(addableRooms(WITH_BEDROOM).map(r => [r.base, r.steps.length]), [["Bathroom", 2], ["Half bath", 1], ["Bedroom", 2]]);
  assert.deepEqual(addableRooms([]), []);
});

test("adding a bathroom numbers it after the others", () => {
  const list = addRoom(buildChecklist(WITH_BEDROOM, { bathrooms: 2 }), WITH_BEDROOM, "Bathroom", "Marcus", 9);
  assert.deepEqual(titles(list), ["First 10 minutes", "Bathroom 1", "Bathroom 2", "Bathroom 3", "Kitchen"]);
  const added = list.find(i => i.text === "Bathroom 3");
  assert.equal(added.addedAt, 9);
  assert.equal(added.addedBy, "Marcus");
  assert.equal(added.note, "Vacuum the hair out first.");
  const room = roomSections(list).find(r => r.title === "Bathroom 3");
  assert.equal(room.added, true);
  assert.equal(room.addedBy, "Marcus");
  assert.equal(room.total, 2);
});

test("adding a bathroom splits a shared or single bathroom room", () => {
  const all = addRoom(buildChecklist(WITH_BEDROOM, { bathrooms: 0 }), WITH_BEDROOM, "Bathroom", null, 1);
  assert.deepEqual(titles(all), ["First 10 minutes", "Bathroom 1", "Bathroom 2", "Kitchen"]);
  const one = addRoom(buildChecklist(WITH_BEDROOM, { bathrooms: 1 }), WITH_BEDROOM, "Bathroom", null, 1);
  assert.deepEqual(titles(one), ["First 10 minutes", "Bathroom 1", "Bathroom 2", "Kitchen"]);
});

test("a new kind of room goes where the template puts it", () => {
  const list = buildChecklist(WITH_BEDROOM, { bathrooms: 2 });
  assert.deepEqual(titles(addRoom(list, WITH_BEDROOM, "Half bath", null, 1)), ["First 10 minutes", "Bathroom 1", "Bathroom 2", "Half bath", "Kitchen"]);
  const twoBeds = addRoom(addRoom(list, WITH_BEDROOM, "Bedroom", null, 1), WITH_BEDROOM, "Bedroom", null, 2);
  assert.deepEqual(titles(twoBeds), ["First 10 minutes", "Bathroom 1", "Bathroom 2", "Bedroom 1", "Bedroom 2", "Kitchen"]);
});

test("an unknown kind of room changes nothing", () => {
  const list = buildChecklist(WITH_BEDROOM, { bathrooms: 2 });
  assert.equal(addRoom(list, WITH_BEDROOM, "Kitchen", null, 1), list);
});

test("an added room makes the job keep its own list", () => {
  const added = addRoom(buildChecklist(WITH_BEDROOM, { bathrooms: 2 }), WITH_BEDROOM, "Bedroom", null, 1);
  assert.equal(ownsList(added), true);
  assert.equal(checklistForJob({ stored: added, done: false, template: WITH_BEDROOM, bathrooms: 2 }), added);
});

test("an added room can be removed until something in it is ticked", () => {
  const base = buildChecklist(WITH_BEDROOM, { bathrooms: 2 });
  const added = addRoom(base, WITH_BEDROOM, "Bedroom", null, 1);
  const h = added.findIndex(i => i.text === "Bedroom");
  assert.deepEqual(removeRoom(added, h), base);
  const ticked = toggleStep(added, h + 1, "M", 2).items;
  assert.equal(removeRoom(ticked, h), ticked);
  // Template rooms can't be removed.
  assert.equal(removeRoom(base, 0), base);
});

test("unfinished steps are listed by room", () => {
  let list = buildChecklist(TEMPLATE, { bathrooms: 1 });
  list = toggleStep(list, list.findIndex(i => i.text === "Walk the house"), "M", 1).items;
  list = toggleStep(list, list.findIndex(i => i.text === "Check the dishwasher"), "M", 2).items;
  assert.deepEqual(unfinishedByRoom(list), [
    { title: "Bathroom", steps: ["Toilet", "Shower"] },
    { title: "Kitchen", steps: ["Counters"] },
  ]);
});

test("progress ignores headings", () => {
  const list = toggleStep(buildChecklist(TEMPLATE, { bathrooms: 1 }), 2, "Marcus", 7).items;
  assert.deepEqual(checklistProgress(list), { done: 1, total: 5, lastAt: 7, lastBy: "Marcus" });
});

test("check all ticks every open step at once and leaves the rest alone", () => {
  let list = buildChecklist(TEMPLATE, { bathrooms: 1 });
  const walk = list.findIndex(i => i.text === "Walk the house");
  list = toggleStep(list, walk, "Marcus", 5).items;
  const all = checkAll(list, "Marcus", 99);
  assert.deepEqual(checklistProgress(all), { done: 5, total: 5, lastAt: 99, lastBy: "Marcus" });
  // The step ticked earlier keeps its own time; headings are untouched.
  assert.equal(all[walk].doneAt, 5);
  assert.deepEqual(all.filter(i => i.heading), list.filter(i => i.heading));
  assert.equal(unfinishedByRoom(all).length, 0);
});
