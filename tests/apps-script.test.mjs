// The Apps Script's pure parts, run straight from apps-script/Code.gs in a
// sandbox: the file is plain ES5, so its function declarations become globals.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const code = readFileSync(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
const gs = vm.createContext({ Logger: { log() {} } });
vm.runInContext(code, gs);
const { planIcalHouse: planRaw, buildDigest, numberField, icalDate, ICAL_SOURCE } = gs;
// Values made inside the sandbox carry its own Array/Object prototypes, which
// strict deep-equality rejects; compare plain copies instead.
const plain = (v) => JSON.parse(JSON.stringify(v));
const parseIcal = (t) => plain(gs.parseIcal(t));
const planIcalHouse = (...a) => plain(planRaw(...a));

// Airbnb's export format, CRLF line endings, one folded line.
const FEED = [
  "BEGIN:VCALENDAR",
  "PRODID;X-RICAL-TZSOURCE=TZINFO:-//Airbnb Inc//Hosting Calendar 1.0//EN",
  "CALSCALE:GREGORIAN",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "DTEND;VALUE=DATE:20261030",
  "DTSTART;VALUE=DATE:20261027",
  "UID:1418fb94e984-aaa111@airbnb.com",
  "DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/de",
  " tails/HMABCDEF12\\nPhone Number (Last 4 Digits): 1234",
  "SUMMARY:Reserved",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTEND;VALUE=DATE:20261105",
  "DTSTART;VALUE=DATE:20261030",
  "UID:1418fb94e984-bbb222@airbnb.com",
  "SUMMARY:Reserved",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTEND;VALUE=DATE:20261120",
  "DTSTART;VALUE=DATE:20261110",
  "UID:1418fb94e984-ccc333@airbnb.com",
  "SUMMARY:Airbnb (Not available)",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

const HOUSE = { name: "Client House", address: "1 Client St", short: "Client" };
const TODAY = "2026-10-23";
const job = (id, dateKey, uid, extra) => ({
  name: `projects/x/databases/(default)/documents/jobs/${id}`, dateKey, icalUid: uid, source: ICAL_SOURCE,
  property: HOUSE.name, address: HOUSE.address, cancelled: false, done: false, ...extra,
});
const counts = (p) => [p.create.length, p.move.length, p.restore.length, p.cancel.length];

test("bookings come out of the feed, blocked dates don't", () => {
  const stays = parseIcal(FEED);
  assert.deepEqual(stays.map((s) => [s.checkIn, s.checkOut, s.uid]), [
    ["2026-10-27", "2026-10-30", "1418fb94e984-aaa111@airbnb.com"],
    ["2026-10-30", "2026-11-05", "1418fb94e984-bbb222@airbnb.com"],
  ]);
});

test("garbage and empty feeds give no bookings", () => {
  assert.deepEqual(parseIcal(""), []);
  assert.deepEqual(parseIcal("<html>Page not found</html>"), []);
  // A booking that ends before it starts is dropped rather than guessed at.
  assert.deepEqual(parseIcal("BEGIN:VEVENT\nUID:x\nDTSTART;VALUE=DATE:20261105\nDTEND;VALUE=DATE:20261101\nEND:VEVENT"), []);
});

test("iCal dates read with or without a time", () => {
  assert.equal(icalDate("20261016"), "2026-10-16");
  assert.equal(icalDate("20261016T110000Z"), "2026-10-16");
  assert.equal(icalDate("soon"), "");
});

test("each booking becomes a cleaning on its checkout day, same-day flagged", () => {
  const p = planIcalHouse(parseIcal(FEED), [], HOUSE, TODAY);
  assert.deepEqual(p.create.map((c) => [c.stay.checkOut, c.sameDay]), [["2026-10-30", true], ["2026-11-05", false]]);
});

test("a checkout already past makes nothing", () => {
  assert.deepEqual(counts(planIcalHouse(parseIcal(FEED), [], HOUSE, "2026-11-06")), [0, 0, 0, 0]);
});

test("a booking already scheduled on the right day is left alone", () => {
  const jobs = [job("a", "2026-10-30", "1418fb94e984-aaa111@airbnb.com"), job("b", "2026-11-05", "1418fb94e984-bbb222@airbnb.com")];
  assert.deepEqual(counts(planIcalHouse(parseIcal(FEED), jobs, HOUSE, TODAY)), [0, 0, 0, 0]);
});

test("a date change moves the cleaning", () => {
  const jobs = [job("a", "2026-10-29", "1418fb94e984-aaa111@airbnb.com"), job("b", "2026-11-05", "1418fb94e984-bbb222@airbnb.com")];
  const p = planIcalHouse(parseIcal(FEED), jobs, HOUSE, TODAY);
  assert.deepEqual(counts(p), [0, 1, 0, 0]);
  assert.equal(p.move[0].from, "2026-10-29");
  assert.equal(p.move[0].stay.checkOut, "2026-10-30");
});

test("a cancelled cleaning whose booking is back is restored", () => {
  const jobs = [job("a", "2026-10-30", "1418fb94e984-aaa111@airbnb.com", { cancelled: true }), job("b", "2026-11-05", "1418fb94e984-bbb222@airbnb.com")];
  assert.deepEqual(counts(planIcalHouse(parseIcal(FEED), jobs, HOUSE, TODAY)), [0, 0, 1, 0]);
});

test("a future booking that vanished from the feed is cancelled", () => {
  const jobs = [job("gone", "2026-11-12", "gone@airbnb.com")];
  assert.deepEqual(planIcalHouse(parseIcal(FEED), jobs, HOUSE, TODAY).cancel.map((j) => j.dateKey), ["2026-11-12"]);
});

test("nothing dated today, at another house, or from another source is cancelled", () => {
  const jobs = [
    job("today", TODAY, "gone1@airbnb.com"),
    job("other", "2026-11-12", "gone2@airbnb.com", { property: "Another House" }),
    job("manual", "2026-11-13", "gone3@airbnb.com", { source: "turno-email" }),
    job("done", "2026-11-14", "gone4@airbnb.com", { done: true }),
  ];
  assert.deepEqual(planIcalHouse(parseIcal(FEED), jobs, HOUSE, TODAY).cancel, []);
});

test("a wave of cancellations is treated as a bad read", () => {
  const jobs = [1, 2, 3, 4].map((n) => job(`g${n}`, `2026-12-0${n}`, `gone${n}@airbnb.com`));
  assert.equal(planIcalHouse(parseIcal(FEED), jobs, HOUSE, TODAY).badRead, true);
  assert.equal(planIcalHouse([], jobs.slice(0, 3), HOUSE, TODAY).badRead, false);
});

test("the notification lists moves and returns, soonest first", () => {
  const d = buildDigest({ properties: [{ name: HOUSE.name, short: "Client" }] }, "Airbnb", {
    created: [{ dateKey: "2026-11-05", property: HOUSE.name, jobId: "n" }],
    cancelled: [],
    moved: [{ from: "2026-10-29", to: "2026-10-30", property: HOUSE.name, jobId: "m" }],
    restored: [],
  });
  assert.equal(d.title, "Airbnb: 1 new, 1 moved");
  assert.equal(d.body, "Moved · Client · Thu, Oct 29 → Fri, Oct 30\nNew · Thu, Nov 5 · Client");
});

test("the Turno notification is unchanged without moves", () => {
  const d = buildDigest({ properties: [] }, "Turno", { created: [{ dateKey: "2026-11-05", property: "Village House", jobId: "x" }], cancelled: [] });
  assert.equal(d.title, "Turno: new cleaning");
  assert.deepEqual(JSON.parse(JSON.stringify(d.data)), { jobId: "x" });
});

test("house counts read as whole numbers or decimals", () => {
  assert.equal(numberField({ integerValue: "2" }), 2);
  assert.equal(numberField({ doubleValue: 2.5 }), 2.5);
  assert.equal(numberField(undefined), 0);
  assert.equal(numberField({ stringValue: "x" }), 0);
});
