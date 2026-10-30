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

test("a stale same-day flag on a booking already on the right day is corrected", () => {
  // The Oct 27-30 stay checks out the day the Oct 30 stay checks in.
  const jobs = [
    job("a", "2026-10-30", "1418fb94e984-aaa111@airbnb.com", { sameDayTurnover: false }),
    job("b", "2026-11-05", "1418fb94e984-bbb222@airbnb.com", { sameDayTurnover: true }),
  ];
  const p = planIcalHouse(parseIcal(FEED), jobs, HOUSE, TODAY);
  assert.deepEqual(counts(p), [0, 0, 0, 0]);
  assert.deepEqual(p.flag.map((f) => [f.job.dateKey, f.sameDay]), [["2026-10-30", true], ["2026-11-05", false]]);
});

test("a correct same-day flag, or a finished cleaning, is left alone", () => {
  const jobs = [
    job("a", "2026-10-30", "1418fb94e984-aaa111@airbnb.com", { sameDayTurnover: true }),
    job("b", "2026-11-05", "1418fb94e984-bbb222@airbnb.com", { sameDayTurnover: true, done: true }),
  ];
  assert.deepEqual(planIcalHouse(parseIcal(FEED), jobs, HOUSE, TODAY).flag, []);
});

test("Turno start times read as 24-hour HH:MM", () => {
  const cases = { "11:00 AM": "11:00", "2:30 pm": "14:30", "12:00 AM": "00:00", "12 PM": "12:00", "9 a.m.": "09:00", "14:00": "14:00", "7:05PM": "19:05" };
  for (const [text, want] of Object.entries(cases)) assert.equal(gs.toTime(text), want, text);
  for (const bad of ["", undefined, "25:00", "13:00 PM", "0 AM", "7", "11:75 AM", "noon"]) assert.equal(gs.toTime(bad), "", String(bad));
});

test("the Start time line gives the date and, when there is one, the time", () => {
  const m = "Project #40000123 Start time: Sunday, November 1, 2026 2:30 PM End time: later".match(gs.START_TIME);
  assert.equal(m[1], "Sunday, November 1, 2026");
  assert.equal(gs.toTime(m[2]), "14:30");
  const old = "Start Time: Sun, Nov 1 2026 Address".match(gs.START_TIME);
  assert.equal(old[1], "Sun, Nov 1 2026");
  assert.equal(gs.toTime(old[2]), "");
});

// ---- whole runs, against stubbed Google services ---------------------------

const DOCS = "projects/cleanerapp-3f196/databases/(default)/documents";
const FS_URL = `https://firestore.googleapis.com/v1/${DOCS}`;
const S = (v) => ({ stringValue: v });
const B = (v) => ({ booleanValue: v });
const doc = (path, fields, extra) => ({ name: `${DOCS}/${path}`, fields, updateTime: "2026-10-20T01:02:03.456789Z", ...extra });
const REGISTRY = { fields: { items: { arrayValue: { values: [{ mapValue: { fields: {
  name: S("Client House"), address: S("1 Client St"), short: S("Client"),
  aliases: { arrayValue: { values: [S("Client Getaway")] } }, bedrooms: { integerValue: "3" }, bathrooms: { doubleValue: 2 },
} } }] } } } };
const OWNER = doc("devices/owner-phone", { role: S("owner"), pushToken: S("ExponentPushToken[owner]") });
const CREW = doc("devices/crew-phone", { role: S("cleaner"), employeeId: S("e1"), pushToken: S("ExponentPushToken[crew]") });
const EMPLOYEES = [doc("employees/e1", { name: S("Pat Example"), active: B(true) })];
const jobDoc = (id, dateKey, extra) => doc(`jobs/${id}`, {
  dateKey: S(dateKey), property: S("Client House"), address: S("1 Client St"), source: S("turno-email"),
  done: B(false), cancelled: B(false), ...extra,
});

const shiftKey = (key, days) => new Date(Date.parse(`${key}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

// Answers like Firestore, Expo and Telegram; `override` returns [code, body]
// to replace any single answer.
function services({ registry = REGISTRY, jobs = [], devices = [OWNER, CREW], employees = EMPLOYEES, override } = {}) {
  let made = 0;
  return (c) => {
    const o = override && override(c);
    if (o) return o;
    if (c.url.includes("identitytoolkit")) return [200, { idToken: "test-token" }];
    if (c.url.startsWith("https://exp.host/")) return [200, { data: c.body.map(() => ({ status: "ok", id: "ticket" })) }];
    if (c.url.startsWith(`${FS_URL}/settings/properties`)) return registry ? [200, registry] : [404, { error: { code: 404 } }];
    // The laptop sync reported in just now, so the watchdog stays quiet.
    if (c.url.startsWith(`${FS_URL}/settings/airbnbSync`)) return [200, { fields: { lastSuccessAt: { integerValue: String(Date.now()) } } }];
    if (c.url.startsWith(`${FS_URL}/settings/`)) return [404, { error: { code: 404 } }];
    if (c.method === "post" && c.url === `${FS_URL}:runQuery`) {
      // Like Firestore: only jobs with a dateKey at or after the asked-for day.
      const since = c.body.structuredQuery.where.fieldFilter.value.stringValue;
      const hits = jobs.filter((d) => d.fields.dateKey && d.fields.dateKey.stringValue >= since);
      return [200, hits.length ? hits.map((d) => ({ document: d, readTime: "t" })) : [{ readTime: "t" }]];
    }
    if (c.method === "get" && c.url.startsWith(`${FS_URL}/devices?`)) return [200, { documents: devices }];
    if (c.method === "get" && c.url.startsWith(`${FS_URL}/employees?`)) return [200, { documents: employees }];
    if (c.method === "post" && c.url === `${FS_URL}/jobs`) return [200, { name: `${DOCS}/jobs/new${++made}` }];
    if (c.method === "patch" && c.url.startsWith("https://firestore.googleapis.com/v1/")) return [200, { name: c.url.split("?")[0] }];
    return [500, `unexpected ${c.method} ${c.url}`];
  };
}

// A fresh copy of the script per scenario, so its per-run caches start empty.
function run({ answer = services(), mail = {}, props = {} } = {}) {
  const calls = [];
  const store = { ...props };
  const searches = [];
  const box = vm.createContext({
    Logger: { log() {} },
    // TODAY, moved by however many days the date asked about is from now.
    Utilities: { formatDate: (d) => shiftKey(TODAY, Math.round((d.getTime() - Date.now()) / 86400000)) },
    GmailApp: {
      search(q) {
        searches.push(q);
        return (q.includes("New Cleaning project") ? mail.turno : mail.cancel) || [];
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in store ? store[k] : null),
        setProperty: (k, v) => { store[k] = String(v); },
        deleteProperty: (k) => { delete store[k]; },
        getProperties: () => ({ ...store }),
      }),
    },
    UrlFetchApp: {
      fetch(url, opts = {}) {
        const c = { url, method: String(opts.method || "get").toLowerCase(), body: opts.payload ? JSON.parse(opts.payload) : null };
        calls.push(c);
        const [code, body] = answer(c);
        return { getResponseCode: () => code, getContentText: () => (typeof body === "string" ? body : JSON.stringify(body)) };
      },
    },
  });
  vm.runInContext(code, box);
  const processed = () => (store.processedIds ? store.processedIds.split(",") : []);
  // The jobs query is a POST, but only reads.
  const writes = () => calls.filter((c) => c.method !== "get" && !c.url.includes("identitytoolkit") && !c.url.endsWith(":runQuery"));
  const pushes = () => calls.filter((c) => c.url.startsWith("https://exp.host/")).map((c) => c.body);
  return { gs: box, calls, store, searches, processed, writes, pushes };
}

const message = (id, subject, body) => ({ getId: () => id, getSubject: () => subject, getBody: () => body });
const thread = (...msgs) => ({ getMessages: () => msgs });
const newProject = (id, { project = "40000123", start = "Sunday, November 1, 2026 11:00 AM", house = "Client House" } = {}) =>
  message(id, `New Cleaning project available at ${house}`, `<p>Project # ${project}</p><p>Start time: ${start}</p>`);
const cancelled = (id, { project = "40000123", house = "Client House" } = {}) =>
  message(id, `Cleaning project cancelled at ${house}`, `<p>Project #${project}</p><p>Start time: Sunday, November 1, 2026 11:00 AM</p>`);

test("a missing document reads as null, but a failed read throws", () => {
  const { gs } = run({ answer: services({ override: (c) => (c.url.includes("/settings/busy") ? [503, "unavailable"] : null) }) });
  assert.equal(gs.fsGet("/settings/nothing-here"), null);
  assert.throws(() => gs.fsGet("/settings/busy"), /503/);
});

test("a run that can't read the jobs stops before reading mail or writing anything", () => {
  const s = run({
    answer: services({ override: (c) => (c.url.endsWith(":runQuery") ? [429, "quota"] : null) }),
    mail: { turno: [thread(newProject("m1"))] },
  });
  assert.throws(() => s.gs.scanAllEmails(), /429/);
  assert.deepEqual(s.searches, []);
  assert.deepEqual(s.writes(), []);
  assert.deepEqual(s.processed(), []);
});

test("a run stops the same way when the registry, devices or employees can't be read", () => {
  const failing = [
    [(c) => c.url.includes("/settings/properties") && [500, "boom"], /500/],
    [(c) => c.url.includes("/devices?") && [503, "boom"], /503/],
    [(c) => c.url.includes("/employees?") && [401, "boom"], /401/],
  ];
  for (const [override, want] of failing) {
    const s = run({ answer: services({ override }), mail: { turno: [thread(newProject("m1"))] } });
    assert.throws(() => s.gs.scanAllEmails(), want);
    assert.deepEqual([s.searches, s.writes(), s.processed()], [[], [], []]);
  }
  // A registry that doesn't exist at all is no better than an unreadable one.
  const s = run({ answer: services({ registry: null }), mail: { turno: [thread(newProject("m1"))] } });
  assert.throws(() => s.gs.scanAllEmails(), /registry/);
  assert.deepEqual(s.searches, []);
});

test("a run reads the jobs from two weeks back on, never the whole collection", () => {
  const { gs, calls } = run({
    answer: services({ jobs: [jobDoc("old", "2026-10-08"), jobDoc("edge", "2026-10-09"), jobDoc("soon", "2026-11-01")] }),
  });
  assert.deepEqual(plain(gs.loadJobs().map((j) => j.name.split("/").pop())), ["edge", "soon"]);
  const q = calls.filter((c) => c.url.endsWith(":runQuery"));
  assert.equal(q.length, 1);
  assert.equal(q[0].body.structuredQuery.where.fieldFilter.value.stringValue, "2026-10-09");
  assert.equal(calls.some((c) => c.url.includes("/jobs?")), false);
});

test("a Turno email becomes a cleaning with its start time, then a push", () => {
  const s = run({ mail: { turno: [thread(newProject("m1"))] } });
  s.gs.scanAllEmails();
  const created = s.writes().filter((c) => c.method === "post" && c.url === `${FS_URL}/jobs`);
  assert.equal(created.length, 1);
  const f = created[0].body.fields;
  assert.deepEqual(plain([f.dateKey, f.time, f.turnoTime, f.property, f.turnoProjectId, f.source]),
    [S("2026-11-01"), S("11:00"), S("11:00"), S("Client House"), S("40000123"), S("turno-email")]);
  assert.deepEqual(s.processed(), ["m1"]);
  assert.equal(s.pushes().length, 1);
  assert.equal(s.pushes()[0][0].title, "Turno: new cleaning");
});

test("a Turno email without a time makes a cleaning with no set time", () => {
  const s = run({ mail: { turno: [thread(newProject("m1", { start: "Sunday, November 1, 2026" }))] } });
  s.gs.scanAllEmails();
  const f = s.writes().find((c) => c.method === "post").body.fields;
  assert.deepEqual(plain(f.time), { nullValue: null });
  assert.equal("turnoTime" in f, false);
});

test("a cleaning that fails to save leaves its email for the next run, unannounced", () => {
  const refuse = services({ override: (c) => (c.method === "post" && c.url.includes("/jobs") ? [503, "unavailable"] : null) });
  const first = run({ answer: refuse, mail: { turno: [thread(newProject("m1"))] } });
  first.gs.scanAllEmails();
  assert.deepEqual(first.processed(), []);
  assert.deepEqual(first.pushes(), []);
  // Next run, Firestore is back: the same email is read again and saved.
  const second = run({ props: first.store, mail: { turno: [thread(newProject("m1"))] } });
  second.gs.scanAllEmails();
  assert.equal(second.writes().filter((c) => c.url === `${FS_URL}/jobs`).length, 1);
  assert.deepEqual(second.processed(), ["m1"]);
});

test("a cancellation for a different project number never falls back to house and date", () => {
  const jobs = [jobDoc("j1", "2026-11-01", { turnoProjectId: S("40000999") })];
  const s = run({ answer: services({ jobs }), mail: { cancel: [thread(cancelled("c1", { project: "40000123" }))] } });
  s.gs.scanAllEmails();
  assert.equal(s.writes().filter((c) => c.url.includes("/jobs/j1")).length, 0);
  // The owner is asked to look - and only the owner.
  assert.deepEqual(s.pushes().map((p) => p.map((m) => [m.to, m.title])), [[["ExponentPushToken[owner]", "Cancellation received"]]]);
  assert.deepEqual(s.processed(), ["c1"]);
});

test("a matching project number, or a house and date when the job has none, cancels it", () => {
  for (const extra of [{ turnoProjectId: S("40000123") }, {}]) {
    const s = run({ answer: services({ jobs: [jobDoc("j1", "2026-11-01", extra)] }), mail: { cancel: [thread(cancelled("c1"))] } });
    s.gs.scanAllEmails();
    const patch = s.writes().find((c) => c.url.includes("/jobs/j1"));
    assert.equal(patch.body.fields.cancelled.booleanValue, true);
    assert.deepEqual(s.pushes().map((p) => p[0].title), ["Turno: 1 cancelled"]);
    assert.deepEqual(s.processed(), ["c1"]);
  }
});

test("a cancellation at a house the email can't name matches nothing by house", () => {
  const s = run({
    answer: services({ jobs: [jobDoc("j1", "2026-11-01")] }),
    mail: { cancel: [thread(cancelled("c1", { house: "Somewhere Unlisted", project: "40000555" }))] },
  });
  s.gs.scanAllEmails();
  assert.equal(s.writes().filter((c) => c.url.includes("/jobs/j1")).length, 0);
  assert.equal(s.pushes()[0][0].title, "Cancellation received");
});

test("a cancellation that fails to save stays unread and is never announced", () => {
  const s = run({
    answer: services({ jobs: [jobDoc("j1", "2026-11-01", { turnoProjectId: S("40000123") })], override: (c) => (c.method === "patch" ? [500, "no"] : null) }),
    mail: { cancel: [thread(cancelled("c1"))] },
  });
  s.gs.scanAllEmails();
  assert.deepEqual(s.processed(), []);
  assert.deepEqual(s.pushes(), []);
});

test("an owner notice that reaches no owner phone leaves the email for the next run", () => {
  const s = run({ answer: services({ devices: [CREW] }), mail: { cancel: [thread(cancelled("c1"))] } });
  s.gs.scanAllEmails();
  assert.deepEqual(s.processed(), []);
  assert.deepEqual(s.pushes(), []);
});

test("an offer email is marked read only once the owner has been told", () => {
  const offer = () => ({ turno: [thread(newProject("o1", { house: "Brand New Place" }))] });
  const nobody = run({ answer: services({ devices: [CREW] }), mail: offer() });
  nobody.gs.scanAllEmails();
  assert.deepEqual(nobody.processed(), []);
  const told = run({ mail: offer() });
  told.gs.scanAllEmails();
  assert.deepEqual(told.processed(), ["o1"]);
  assert.deepEqual(told.pushes().map((p) => p.map((m) => m.to)), [["ExponentPushToken[owner]"]]);
});

test("pushes go to owners and current crew only, at high priority", () => {
  const devices = [
    OWNER,
    CREW,
    doc("devices/old-crew", { role: S("cleaner"), employeeId: S("e2"), pushToken: S("ExponentPushToken[former]") }),
    doc("devices/gone-crew", { role: S("cleaner"), employeeId: S("e9"), pushToken: S("ExponentPushToken[deleted]") }),
    doc("devices/new-crew", { role: S("cleaner"), employeeId: S("e3"), pushToken: S("ExponentPushToken[new]") }),
    doc("devices/no-token", { role: S("owner") }),
    doc("devices/nobody", { pushToken: S("ExponentPushToken[stray]") }),
    doc("devices/owner-tablet", { role: S("owner"), pushToken: S("ExponentPushToken[owner]") }),
  ];
  const employees = [...EMPLOYEES, doc("employees/e2", { active: B(false) }), doc("employees/e3", { name: S("Sam Example") })];
  const s = run({ answer: services({ devices, employees }) });
  assert.equal(s.gs.notifyPhones("Turno: new cleaning", "New · Sun, Nov 1 · Client", { jobId: "j1" }), 3);
  const [sent] = s.pushes();
  assert.deepEqual(sent.map((m) => m.to), ["ExponentPushToken[owner]", "ExponentPushToken[crew]", "ExponentPushToken[new]"]);
  for (const m of sent) assert.deepEqual([m.priority, m.channelId, m.sound, m.data.jobId], ["high", "default", "default", "j1"]);
  assert.equal(s.calls.some((c) => c.url.includes("/pushTokens")), false, "the legacy token list is never read");
});

test("a DeviceNotRegistered ticket clears that phone's token; other failures are only counted", () => {
  const tickets = [
    { status: "ok", id: "t1" },
    { status: "error", message: "not a registered push recipient", details: { error: "DeviceNotRegistered" } },
  ];
  const s = run({ answer: services({ override: (c) => (c.url.startsWith("https://exp.host/") ? [200, { data: tickets }] : null) }) });
  assert.equal(s.gs.notifyPhones("t", "b"), 1);
  const cleared = s.writes().filter((c) => c.method === "patch");
  assert.equal(cleared.length, 1);
  assert.ok(cleared[0].url.startsWith(`${FS_URL}/devices/crew-phone?`));
  assert.ok(cleared[0].url.includes("currentDocument.updateTime=2026-10-20T01%3A02%3A03.456789Z"));
  assert.deepEqual(plain(cleared[0].body.fields.pushToken), { nullValue: null });
  // The dead token isn't tried again in the same run.
  s.gs.notifyPhones("t2", "b2");
  assert.deepEqual(s.pushes()[1].map((m) => m.to), ["ExponentPushToken[owner]"]);
});

test("a push Expo refuses outright counts as none sent, without throwing", () => {
  const s = run({ answer: services({ override: (c) => (c.url.startsWith("https://exp.host/") ? [500, "down"] : null) }) });
  assert.equal(s.gs.notifyPhones("t", "b"), 0);
  assert.equal(s.gs.pushToOwnerDevices("t", "b"), false);
});

test("iCal cleanings are created with their same-day flag and no set time", () => {
  const s = run();
  const ctx = { properties: [], jobs: [], icalChanges: { created: [], cancelled: [], moved: [], restored: [] } };
  const house = { ...HOUSE, bedrooms: 3, bathrooms: 2 };
  s.gs.applyIcalPlan(ctx, house, planRaw(gs.parseIcal(FEED), [], house, TODAY), TODAY);
  const made = s.writes().filter((c) => c.method === "post").map((c) => c.body.fields);
  assert.deepEqual(plain(made.map((f) => [f.dateKey.stringValue, f.sameDayTurnover.booleanValue, f.time])),
    [["2026-10-30", true, { nullValue: null }], ["2026-11-05", false, { nullValue: null }]]);
  assert.equal(ctx.icalChanges.created.length, 2);
});

test("iCal changes are reported only once Firestore has taken them", () => {
  const moving = job("a", "2026-10-29", "1418fb94e984-aaa111@airbnb.com");
  const stale = job("b", "2026-11-05", "1418fb94e984-bbb222@airbnb.com", { sameDayTurnover: true });
  const s = run({ answer: services({ override: (c) => (c.method === "patch" && c.url.includes("/jobs/a?") ? [503, "busy"] : null) }) });
  const ctx = { properties: [], jobs: [moving, stale], icalChanges: { created: [], cancelled: [], moved: [], restored: [] } };
  s.gs.applyIcalPlan(ctx, HOUSE, planRaw(gs.parseIcal(FEED), ctx.jobs, HOUSE, TODAY), TODAY);
  assert.deepEqual(plain(ctx.icalChanges.moved), []);
  assert.equal(moving.dateKey, "2026-10-29");
  const flag = s.writes().find((c) => c.url.includes("/jobs/b?"));
  assert.ok(flag.url.endsWith("?updateMask.fieldPaths=sameDayTurnover"));
  assert.equal(flag.body.fields.sameDayTurnover.booleanValue, false);
  assert.equal(stale.sameDayTurnover, false);
});

test("a hand-added cleaning tagged with its booking gets the booking's same-day flag", () => {
  const manual = { name: `${DOCS}/jobs/m`, dateKey: "2026-10-30", property: HOUSE.name, address: HOUSE.address, source: "", icalUid: "", sameDayTurnover: false };
  const s = run();
  const ctx = { properties: [], jobs: [manual], icalChanges: { created: [], cancelled: [], moved: [], restored: [] } };
  s.gs.applyIcalPlan(ctx, HOUSE, planRaw(gs.parseIcal(FEED), ctx.jobs, HOUSE, TODAY), TODAY);
  const tag = s.writes().find((c) => c.url.includes("/jobs/m?"));
  assert.deepEqual(plain(tag.body.fields), { icalUid: S("1418fb94e984-aaa111@airbnb.com"), sameDayTurnover: B(true) });
});

test("the job read asks for two weeks back on, never the whole collection", () => {
  assert.equal(gs.JOB_LOOKBACK_DAYS, 14);
  assert.deepEqual(plain(gs.jobsQuery("2026-10-15")), {
    structuredQuery: {
      from: [{ collectionId: "jobs" }],
      where: { fieldFilter: { field: { fieldPath: "dateKey" }, op: "GREATER_THAN_OR_EQUAL", value: { stringValue: "2026-10-15" } } },
    },
  });
});

test("query rows become jobs; an empty answer is no jobs, a strange one throws", () => {
  const rows = [
    { document: { name: "projects/x/databases/(default)/documents/jobs/a", fields: {
      dateKey: { stringValue: "2026-10-20" }, property: { stringValue: "Client House" },
      turnoProjectId: { integerValue: "123456" }, cancelled: { booleanValue: true },
    } }, readTime: "t" },
    { document: { name: "projects/x/databases/(default)/documents/jobs/b", fields: { icalUid: { stringValue: "u1" } } }, readTime: "t" },
  ];
  const jobs = plain(gs.jobsFromRows(rows));
  assert.deepEqual(jobs.map((j) => [j.name.split("/").pop(), j.dateKey, j.turnoProjectId, j.icalUid, j.cancelled, j.done]), [
    ["a", "2026-10-20", "123456", "", true, false],
    ["b", "", "", "u1", false, false],
  ]);
  assert.deepEqual(plain(gs.jobsFromRows([{ readTime: "t" }])), []);
  assert.throws(() => gs.jobsFromRows({ error: { code: 429 } }), /unexpected answer/);
});
