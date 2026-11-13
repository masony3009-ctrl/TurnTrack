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
  const sent = [];
  const box = vm.createContext({
    Logger: { log() {} },
    // TODAY, moved by however many days the date asked about is from now.
    Utilities: { formatDate: (d) => shiftKey(TODAY, Math.round((d.getTime() - Date.now()) / 86400000)) },
    GmailApp: {
      search(q) {
        searches.push(q);
        if (q.startsWith("(from:(")) return mail.airbnb || [];
        return (q.includes("New Cleaning project") ? mail.turno : mail.cancel) || [];
      },
      sendEmail(to, subject, body) { sent.push({ to, subject, body }); },
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
  const ids = () => (store.processedIds ? store.processedIds.split(",") : []);
  const processed = () => ids().filter((id) => !id.startsWith("receipt:"));
  // Messages that got their "Got it" email, by id.
  const receipted = () => ids().filter((id) => id.startsWith("receipt:")).map((id) => id.slice(8));
  // The jobs query is a POST, but only reads.
  const writes = () => calls.filter((c) => c.method !== "get" && !c.url.includes("identitytoolkit") && !c.url.endsWith(":runQuery"));
  const pushes = () => calls.filter((c) => c.url.startsWith("https://exp.host/")).map((c) => c.body);
  return { gs: box, calls, store, searches, processed, receipted, sent, writes, pushes };
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

// ---- Airbnb emails a host forwards ------------------------------------------

const HOST = "host@example.com";
const REGISTRY_FWD = { fields: { items: { arrayValue: { values: [{ mapValue: { fields: {
  ...REGISTRY.fields.items.arrayValue.values[0].mapValue.fields, forwardsFrom: S(`Host Person <${HOST}>`),
} } }] } } } };
// Laid out like Airbnb's real "Reservation confirmed" email; guest and house made up.
const bookingPlain = ({ checkIn = "Sun, Nov 15", checkOut = "Thu, Nov 19", code = "HMABCDEF12", listing = "Client Getaway Retreat" } = {}) => [
  "New booking confirmed! Pat arrives soon.", "", "Send a message to confirm check-in details or welcome Pat.", "",
  "Pat Example", "Identity verified · 1 review", "Mesa, AZ", "", listing, "", "Entire home/apt", "",
  "Check-in", "", checkIn, "", "3:00 PM", "", "Checkout", "", checkOut, "", "11:00 AM", "", "Guests", "", "1 adult", "",
  "Confirmation code", "", code, "", "View itinerary", "", "Cancellations", "",
  "The penalties for canceling this reservation include a public review.", "", "Airbnb, Inc.", "888 Brannan St.",
].join("\n");
const asHtml = (plain) => plain.split("\n").map((l) => `<p>${l}</p>`).join("");
const forwardedHeader = (subject) => `---------- Forwarded message ---------\nFrom: Airbnb <automated@airbnb.com>\nSubject: ${subject}\nTo: <${HOST}>\n\n`;
// `replies` collects what the script answers this message with.
const mailMsg = (id, { subject, from, to = "Owner <owner@example.com>", plain, date = new Date(), replyFails = false }) => {
  const replies = [];
  return {
    getId: () => id, getSubject: () => subject, getFrom: () => from, getTo: () => to, getCc: () => "",
    getBody: () => asHtml(plain), getPlainBody: () => plain, getDate: () => date, replies,
    reply(body) {
      if (replyFails) throw new Error("Gmail said no");
      replies.push(body);
    },
  };
};
// Forwarded by hand: from the host, with Airbnb's email quoted inside.
const byHand = (id, subject, plain, extra) =>
  mailMsg(id, { subject: `Fwd: ${subject}`, from: `Host Person <${HOST}>`, plain: forwardedHeader(subject) + plain, ...extra });
// Gmail's auto-forward: still from Airbnb, still addressed to the host.
const autoForwarded = (id, subject, plain) => mailMsg(id, { subject, from: "Airbnb <automated@airbnb.com>", to: HOST, plain });
const BOOKED = "Reservation confirmed - Pat Example arrives Nov 15";
const IN = gs.toDateKey("Nov 15");
const OUT = gs.toDateKey("Nov 19");
const created = (s) => s.writes().filter((c) => c.method === "post" && c.url === `${FS_URL}/jobs`);
const patches = (s) => s.writes().filter((c) => c.method === "patch");
const fwdJob = (id, dateKey, extra) => jobDoc(id, dateKey, { source: S("airbnb-email"), airbnbCode: S("HMABCDEF12"), checkIn: S(IN), ...extra });

test("a booking email reads as its check-in, checkout and code", () => {
  assert.deepEqual(plain(gs.parseAirbnbBooking(asHtml(bookingPlain()).replace(/<[^>]+>/g, " "))), { code: "HMABCDEF12", checkIn: IN, checkOut: OUT });
  // A stay over New Year checks out the year after it checks in.
  const ny = plain(gs.parseAirbnbBooking(bookingPlain({ checkIn: "Wed, Dec 30", checkOut: "Sat, Jan 2" }).replace(/\s+/g, " ")));
  assert.equal(Number(ny.checkOut.slice(0, 4)), Number(ny.checkIn.slice(0, 4)) + 1);
  // Missing a code or a date is no booking at all.
  assert.equal(gs.parseAirbnbBooking("Check-in Sun, Nov 15 Checkout Thu, Nov 19"), null);
  assert.equal(gs.parseAirbnbBooking("Checkout Thu, Nov 19 Confirmation code HMABCDEF12"), null);
});

test("a cancellation reads its code and stay from the subject or the body", () => {
  assert.deepEqual(plain(gs.parseAirbnbCancel("Canceled: Reservation HMZYXWVU98 for May 24 – 31, 2026", "")),
    { code: "HMZYXWVU98", checkIn: "2026-05-24", checkOut: "2026-05-31" });
  assert.deepEqual(plain(gs.parseAirbnbCancel("Canceled: Reservation HMZYXWVU98 for May 30 – Jun 2, 2026", "")),
    { code: "HMZYXWVU98", checkIn: "2026-05-30", checkOut: "2026-06-02" });
  assert.deepEqual(plain(gs.parseAirbnbCancel("Canceled: Reservation HMZYXWVU98 for Dec 30 – Jan 2, 2027", "")),
    { code: "HMZYXWVU98", checkIn: "2026-12-30", checkOut: "2027-01-02" });
  assert.equal(gs.parseAirbnbCancel("Fwd: cancelled", "your guest had to cancel reservation HMZYXWVU98 for Jun 10 – 15.").code, "HMZYXWVU98");
  assert.equal(gs.parseAirbnbCancel("Canceled", "nothing useful"), null);
});

test("emails are sorted into bookings, cancellations and changes; the rest is ignored", () => {
  const text = (p) => p.replace(/\s+/g, " ");
  assert.equal(gs.airbnbKind(gs.stripForward(`Fwd: FW: ${BOOKED}`), text(bookingPlain())), "booking");
  assert.equal(gs.airbnbKind("Canceled: Reservation HMZYXWVU98 for May 24 – 31, 2026", ""), "cancel");
  assert.equal(gs.airbnbKind("Reservation updated", "Your reservation with Pat has been updated"), "change");
  assert.equal(gs.airbnbKind("Pat wants to change their reservation", ""), "change");
  for (const s of ["Reservation reminder: Pat is coming soon!", "Reservation HMZYXWVU98 payment successful", "Lunch Friday?"]) {
    assert.equal(gs.airbnbKind(s, "The penalties for canceling this reservation include a fee."), "", s);
  }
});

test("the listing name is the line above the room type", () => {
  assert.equal(gs.listingTitle(bookingPlain()), "Client Getaway Retreat");
  assert.equal(gs.listingTitle("no layout here"), "");
});

test("no house names a forwarding address: Gmail isn't searched for one", () => {
  const s = run({ mail: { airbnb: [thread(byHand("f1", BOOKED, bookingPlain()))] } });
  s.gs.scanAllEmails();
  assert.equal(s.searches.some((q) => q.includes(HOST)), false);
  assert.deepEqual(created(s), []);
});

test("a booking the host forwards by hand becomes a cleaning on the checkout day", () => {
  const s = run({ answer: services({ registry: REGISTRY_FWD }), mail: { airbnb: [thread(byHand("f1", BOOKED, bookingPlain()))] } });
  s.gs.scanAllEmails();
  const q = s.searches.find((x) => x.includes(HOST));
  assert.ok(q.startsWith(`(from:(${HOST}) OR to:(${HOST})) -from:me`), q);
  const made = created(s);
  assert.equal(made.length, 1);
  const f = made[0].body.fields;
  assert.deepEqual(plain([f.dateKey, f.property, f.type, f.source, f.airbnbCode, f.checkIn, f.sameDayTurnover, f.time]),
    [S(OUT), S("Client House"), S("Airbnb Turnover"), S("airbnb-email"), S("HMABCDEF12"), S(IN), B(false), { nullValue: null }]);
  assert.equal(s.pushes().at(-1)[0].title, "Airbnb: new cleaning");
  assert.deepEqual(s.processed(), ["f1"]);
});

test("an auto-forwarded booking counts; Airbnb mail to this inbox itself never does", () => {
  const s = run({
    answer: services({ registry: REGISTRY_FWD }),
    mail: { airbnb: [thread(
      autoForwarded("auto", BOOKED, bookingPlain()),
      // The owner's own trip: from Airbnb, but not addressed to the host.
      mailMsg("trip", { subject: BOOKED, from: "Airbnb <automated@airbnb.com>", plain: bookingPlain({ code: "HMTRIP0001", checkIn: "Fri, Nov 20", checkOut: "Sun, Nov 22" }) }),
      // The host writing about something else.
      mailMsg("chat", { subject: "Reservation confirmed - lunch?", from: HOST, plain: "See you Friday" }),
    )] },
  });
  s.gs.scanAllEmails();
  assert.deepEqual(created(s).map((c) => c.body.fields.airbnbCode.stringValue), ["HMABCDEF12"]);
});

test("the same booking forwarded twice, or one already cancelled, isn't scheduled again", () => {
  for (const cancelled of [false, true]) {
    const s = run({
      answer: services({ registry: REGISTRY_FWD, jobs: [fwdJob("b1", OUT, { cancelled: B(cancelled) })] }),
      mail: { airbnb: [thread(byHand("again", BOOKED, bookingPlain()))] },
    });
    s.gs.scanAllEmails();
    assert.deepEqual(created(s), []);
  }
});

test("a cleaning already in for that day is tagged with the booking, not doubled", () => {
  const s = run({
    answer: services({ registry: REGISTRY_FWD, jobs: [jobDoc("manual", OUT, { source: S("app") })] }),
    mail: { airbnb: [thread(byHand("f1", BOOKED, bookingPlain()))] },
  });
  s.gs.scanAllEmails();
  assert.deepEqual(created(s), []);
  const tag = patches(s).find((c) => c.url.includes("/jobs/manual?"));
  assert.deepEqual(plain(tag.body.fields), { airbnbCode: S("HMABCDEF12"), checkIn: S(IN) });
});

test("a booking arriving the day another guest leaves makes that cleaning same-day", () => {
  const s = run({
    answer: services({ registry: REGISTRY_FWD, jobs: [fwdJob("prev", IN, { airbnbCode: S("HMPREVIOUS"), checkIn: S("2026-11-10"), sameDayTurnover: B(false) })] }),
    mail: { airbnb: [thread(byHand("f1", BOOKED, bookingPlain()))] },
  });
  s.gs.scanAllEmails();
  const flag = patches(s).find((c) => c.url.includes("/jobs/prev?"));
  assert.deepEqual(plain(flag.body.fields), { sameDayTurnover: B(true) });
});

test("a forwarded cancellation cancels that booking's cleaning and clears the same-day flag it set", () => {
  const s = run({
    answer: services({ registry: REGISTRY_FWD, jobs: [
      fwdJob("b1", OUT),
      fwdJob("prev", IN, { airbnbCode: S("HMPREVIOUS"), checkIn: S("2026-11-10"), sameDayTurnover: B(true) }),
    ] }),
    mail: { airbnb: [thread(byHand("c1", "Canceled: Reservation HMABCDEF12 for Nov 15 – 19, 2026",
      "Unfortunately, your guest Pat had to cancel reservation HMABCDEF12 for Nov 15 – 19. Airbnb"))] },
  });
  s.gs.scanAllEmails();
  const cancel = patches(s).find((c) => c.url.includes("/jobs/b1?"));
  assert.deepEqual(plain([cancel.body.fields.cancelled, cancel.body.fields.cancelReason]), [B(true), S("Guest cancelled on Airbnb (forwarded email)")]);
  assert.deepEqual(plain(patches(s).find((c) => c.url.includes("/jobs/prev?")).body.fields), { sameDayTurnover: B(false) });
  assert.equal(s.pushes().at(-1)[0].title, "Airbnb: 1 cancelled");
  assert.deepEqual(s.processed(), ["c1"]);
});

test("a cancellation for a cleaning booked before forwarding started finds it by house and day", () => {
  const s = run({
    answer: services({ registry: REGISTRY_FWD, jobs: [jobDoc("older", OUT, { source: S("app") })] }),
    mail: { airbnb: [thread(autoForwarded("c1", "Canceled: Reservation HMABCDEF12 for Nov 15 – 19, 2026", "your guest had to cancel. Airbnb"))] },
  });
  s.gs.scanAllEmails();
  assert.equal(patches(s).some((c) => c.url.includes("/jobs/older?")), true);
});

test("a cancellation that matches nothing tells the owner and changes nothing", () => {
  const s = run({
    answer: services({ registry: REGISTRY_FWD }),
    mail: { airbnb: [thread(autoForwarded("c1", "Canceled: Reservation HMNOTHING1 for Nov 15 – 19, 2026", "Airbnb"))] },
  });
  s.gs.scanAllEmails();
  assert.deepEqual(patches(s), []);
  const alert = s.pushes().at(-1);
  assert.deepEqual(alert.map((m) => m.to), ["ExponentPushToken[owner]"]);
  assert.match(alert[0].body, /HMNOTHING1.*no matching cleaning/);
  assert.deepEqual(s.processed(), ["c1"]);
});

test("a change notice asks the owner to check, once, and only while it's fresh", () => {
  const fresh = run({
    answer: services({ registry: REGISTRY_FWD }),
    mail: { airbnb: [thread(autoForwarded("u1", "Reservation updated", "Your reservation with Pat has been updated. Airbnb"))] },
  });
  fresh.gs.scanAllEmails();
  assert.equal(fresh.pushes().at(-1)[0].title, "Airbnb booking changed at Client");
  assert.deepEqual(fresh.writes().filter((c) => c.url.includes("firestore")), []);

  const stale = run({
    answer: services({ registry: REGISTRY_FWD }),
    mail: { airbnb: [thread(byHand("u2", "Reservation updated", "Your reservation with Pat has been updated. Airbnb", { date: new Date(Date.now() - 5 * 86400000) }))] },
  });
  stale.gs.scanAllEmails();
  assert.deepEqual(stale.pushes(), []);
  assert.deepEqual(stale.processed(), ["u2"]);
});

// ---- receipts back to the host ---------------------------------------------

// The reply names the house and day, written out with the year: "Thu, Nov 19, 2026".
const day = (key) => gs.labelFromKey(key).replace(/ (\d{4})$/, ", $1");
const GOT_IT = `Got it, thanks! The Client House cleaning is on the schedule for ${day(OUT)}.`;

test("a receipt says which house and day it's about, and whether it's on or cancelled", () => {
  assert.equal(gs.receiptText({ property: "Client House", dateKey: "2027-03-05" }),
    "Got it, thanks! The Client House cleaning is on the schedule for Fri, Mar 5, 2027.");
  assert.equal(gs.receiptText({ property: "Client House", dateKey: "2027-03-05", cancelled: true }),
    "Got it, thanks! The Client House cleaning on Fri, Mar 5, 2027 is cancelled.");
  // An old job with only the label still reads; one with no house falls back to its address.
  assert.equal(gs.receiptText({ property: "", address: "1 Client St", date: "Fri, Mar 5 2027" }),
    "Got it, thanks! The 1 Client St cleaning is on the schedule for Fri, Mar 5, 2027.");
  // Nothing to name, or a cleaning already done: just the thanks.
  for (const job of [undefined, { property: "Client House" }, { dateKey: "2027-03-05" }, { property: "Client House", dateKey: "2027-03-05", done: true }]) {
    assert.equal(gs.receiptText(job), "Got it, thanks!", JSON.stringify(job));
  }
});

test("a booking forwarded by hand is answered in its thread, once", () => {
  const msg = byHand("f1", BOOKED, bookingPlain());
  const s = run({ answer: services({ registry: REGISTRY_FWD }), mail: { airbnb: [thread(msg)] } });
  s.gs.scanAllEmails();
  assert.deepEqual(msg.replies, [GOT_IT]);
  assert.deepEqual(s.receipted(), ["f1"]);
  assert.deepEqual(s.sent, []);
  // Read again (as the one-time recheck does), it isn't answered twice.
  delete s.store.forwardRecheckAt;
  s.gs.scanAllEmails();
  assert.deepEqual(msg.replies, [GOT_IT]);
});

test("an auto-forwarded booking is answered by writing to the host", () => {
  const s = run({ answer: services({ registry: REGISTRY_FWD }), mail: { airbnb: [thread(autoForwarded("auto", BOOKED, bookingPlain()))] } });
  s.gs.scanAllEmails();
  assert.deepEqual(plain(s.sent), [{ to: HOST, subject: `Re: ${BOOKED}`, body: GOT_IT }]);
});

test("a booking already in, or a cancellation, still gets its receipt; mail that isn't one doesn't", () => {
  const again = byHand("again", BOOKED, bookingPlain());
  const cancel = byHand("c1", "Canceled: Reservation HMABCDEF12 for Nov 15 – 19, 2026", "your guest had to cancel reservation HMABCDEF12. Airbnb");
  const chat = mailMsg("chat", { subject: "Lunch?", from: HOST, plain: "See you Friday" });
  const s = run({ answer: services({ registry: REGISTRY_FWD, jobs: [fwdJob("b1", OUT)] }), mail: { airbnb: [thread(again), thread(cancel), thread(chat)] } });
  s.gs.scanAllEmails();
  assert.deepEqual([again.replies, cancel.replies, chat.replies],
    [[GOT_IT], [`Got it, thanks! The Client House cleaning on ${day(OUT)} is cancelled.`], []]);
});

test("a booking that can't be read or placed gets no receipt: the owner is told instead", () => {
  const msg = byHand("f1", BOOKED, "Reservation confirmed but nothing else. Airbnb");
  const s = run({ answer: services({ registry: REGISTRY_FWD }), mail: { airbnb: [thread(msg)] } });
  s.gs.scanAllEmails();
  assert.deepEqual(msg.replies, []);
  assert.equal(s.pushes().at(-1)[0].title, "Couldn't read a forwarded Airbnb booking");
});

test("a receipt that won't send leaves the cleaning in and tells the owner", () => {
  const msg = mailMsg("f1", { subject: `Fwd: ${BOOKED}`, from: `Host Person <${HOST}>`, plain: forwardedHeader(BOOKED) + bookingPlain(), replyFails: true });
  const s = run({ answer: services({ registry: REGISTRY_FWD }), mail: { airbnb: [thread(msg)] } });
  s.gs.scanAllEmails();
  assert.equal(created(s).length, 1);
  assert.ok(s.pushes().some((p) => p[0].title === "Couldn't email the host back"));
  assert.deepEqual([s.processed(), s.receipted()], [["f1"], []]);
});

test("forwarded mail already marked done is read once more, the first run after this change", () => {
  const msg = byHand("old", BOOKED, bookingPlain());
  const first = run({ answer: services({ registry: REGISTRY_FWD }), mail: { airbnb: [thread(msg)] }, props: { processedIds: "old" } });
  first.gs.scanAllEmails();
  assert.equal(created(first).length, 1);
  assert.ok(first.store.forwardRecheckAt);
  assert.deepEqual(first.processed(), ["old"]);

  const later = run({ answer: services({ registry: REGISTRY_FWD }), mail: { airbnb: [thread(byHand("old", BOOKED, bookingPlain()))] },
    props: { processedIds: "old", forwardRecheckAt: "1" } });
  later.gs.scanAllEmails();
  assert.deepEqual(created(later), []);
});

// ---- host emails the script can't read ---------------------------------------

test("a host's own email that isn't a booking tells the owner to read it, once", () => {
  const note = mailMsg("n1", { subject: "Owner stay", from: `Host Person <${HOST}>`, plain: "Owners are staying Mar 7 to 16, clean after they leave." });
  const s = run({ answer: services({ registry: REGISTRY_FWD }), mail: { airbnb: [thread(note)] } });
  s.gs.scanAllEmails();
  const alert = s.pushes().find((p) => p[0].title === "Email from a host to read");
  assert.ok(alert, "owner was alerted");
  assert.deepEqual(alert.map((m) => m.to), ["ExponentPushToken[owner]"]);
  assert.match(alert[0].body, /"Owner stay" came from the host of Client House/);
  assert.match(alert[0].body, /Owners are staying Mar 7 to 16/);
  assert.deepEqual([s.processed(), note.replies, created(s)], [["n1"], [], []]);
});

test("Airbnb's own mail that reaches us by auto-forward stays quiet", () => {
  const payout = autoForwarded("p1", "We sent a payout", "We sent your payout of $500. Airbnb");
  const s = run({ answer: services({ registry: REGISTRY_FWD }), mail: { airbnb: [thread(payout)] } });
  s.gs.scanAllEmails();
  assert.deepEqual(s.pushes().filter((p) => p[0].title === "Email from a host to read"), []);
  assert.deepEqual(s.processed(), ["p1"]);
});

// ---- Vrbo -------------------------------------------------------------------

// Laid out like Vrbo's real "Instant Booking" email; guest, numbers and house made up.
const VRBO_BOOKED = "Instant Booking from Pat Example: Feb 22 - Mar 5, 2027 - Vrbo #1234567";
const vrboPlain = ({ dates = "Feb 22 - Mar 5, 2027, 11 nights", code = "HA-ABC123", property = "#1234567" } = {}) => [
  "Your booking is confirmed", "", "Property", "", property, "", "Unit", "", "unit_1111111", "", "Reservation ID", "", code, "",
  "Dates", "", dates, "", "Guests", "", "4 adults, 0 children", "", "Traveler Name", "", "Pat Example", "",
  "2nd Payment", "", "Due Jan 8, 2027", "", "Owner's Cancellation Policy:", "",
  "100% refund for cancellations more than 60 days before check-in date", "", "© 2026 Vrbo",
].join("\n");
const vrboText = (p) => p.replace(/\s+/g, " ");
// The host types the house above the forward.
const vrboByHand = (id, { note = "Client House", subject = VRBO_BOOKED, body = vrboPlain() } = {}) => mailMsg(id, {
  subject: `Fw: ${subject}`, from: `Host Person <${HOST}>`,
  plain: `${note}\n\n----- Forwarded Message -----\nFrom: Pat Example <sender@messages.homeaway.com>\nTo: Host <${HOST}>\nSubject: ${subject}\n\n${body}`,
});

test("a Vrbo booking reads as its check-in, checkout and reservation ID", () => {
  assert.deepEqual(plain(gs.parseVrboBooking(VRBO_BOOKED, vrboText(vrboPlain()))), { code: "HA-ABC123", checkIn: "2027-02-22", checkOut: "2027-03-05" });
  assert.deepEqual(plain(gs.parseVrboBooking("", vrboText(vrboPlain({ dates: "Feb 4 - 8, 2027, 4 nights" })))),
    { code: "HA-ABC123", checkIn: "2027-02-04", checkOut: "2027-02-08" });
  // Over New Year, with or without the first year written.
  for (const dates of ["Dec 28, 2026 - Jan 3, 2027, 6 nights", "Dec 28 - Jan 3, 2027, 6 nights"]) {
    assert.deepEqual(plain(gs.parseVrboBooking("", vrboText(vrboPlain({ dates })))), { code: "HA-ABC123", checkIn: "2026-12-28", checkOut: "2027-01-03" }, dates);
  }
  // The subject's dates do when the body's don't read.
  assert.equal(gs.parseVrboBooking(VRBO_BOOKED, "Reservation ID HA-ABC123").checkOut, "2027-03-05");
  // A night count that disagrees, or no reservation ID, is no booking.
  assert.equal(gs.parseVrboBooking("", vrboText(vrboPlain({ dates: "Feb 22 - Mar 5, 2027, 9 nights" }))), null);
  assert.equal(gs.parseVrboBooking(VRBO_BOOKED, "Your booking is confirmed Dates Feb 22 - Mar 5, 2027"), null);
});

test("Vrbo mail is told apart from Airbnb's, and sorted like it", () => {
  assert.equal(gs.isVrboMail(VRBO_BOOKED, vrboText(vrboPlain())), true);
  assert.equal(gs.isVrboMail(BOOKED, vrboText(bookingPlain())), false);
  assert.equal(gs.isVrboMail(BOOKED, `${vrboText(bookingPlain())} (it's on Vrbo too)`), false);
  assert.equal(gs.vrboKind(VRBO_BOOKED, vrboText(vrboPlain())), "booking");
  assert.equal(gs.vrboKind("Cancelled: Reservation HA-ABC123", ""), "cancel");
  assert.equal(gs.vrboKind("Booking request from Pat Example", "Respond within 24 hours"), "");
  assert.equal(gs.vrboKind("Pat Example has replied to your message", vrboText(vrboPlain()).replace("Your booking is confirmed", "")), "");
});

test("a Vrbo booking the host forwards becomes a cleaning on the checkout day, and gets a receipt", () => {
  const msg = vrboByHand("v1");
  const s = run({ answer: services({ registry: REGISTRY_FWD }), mail: { airbnb: [thread(msg)] } });
  s.gs.scanAllEmails();
  const made = created(s);
  assert.equal(made.length, 1);
  const f = made[0].body.fields;
  assert.deepEqual(plain([f.dateKey, f.property, f.type, f.source, f.vrboCode, f.checkIn]),
    [S("2027-03-05"), S("Client House"), S("Vrbo Turnover"), S("vrbo-email"), S("HA-ABC123"), S("2027-02-22")]);
  assert.equal(f.airbnbCode, undefined);
  assert.equal(s.pushes().at(-1)[0].title, "Vrbo: new cleaning");
  assert.deepEqual(msg.replies, ["Got it, thanks! The Client House cleaning is on the schedule for Fri, Mar 5, 2027."]);
  assert.deepEqual(s.processed(), ["v1"]);
});

test("which house a Vrbo booking is for comes from the host's note or the property number", () => {
  const two = { fields: { items: { arrayValue: { values: [
    REGISTRY_FWD.fields.items.arrayValue.values[0],
    { mapValue: { fields: { name: S("Second House"), address: S("2 Second St"), aliases: { arrayValue: { values: [S("second"), S("#7654321")] } }, forwardsFrom: S(HOST) } } },
  ] } } } };
  const s = run({ answer: services({ registry: two }), mail: { airbnb: [
    thread(vrboByHand("v1", { note: "Second" })),
    thread(vrboByHand("v2", { note: "", body: vrboPlain({ property: "#7654321", code: "HA-SECOND1", dates: "Mar 6 - Mar 9, 2027, 3 nights" }) })),
    thread(vrboByHand("v3", { note: "", body: vrboPlain({ property: "#9999999", code: "HA-NOWHERE" }) })),
  ] } });
  s.gs.scanAllEmails();
  assert.deepEqual(created(s).map((c) => [c.body.fields.property.stringValue, c.body.fields.vrboCode.stringValue]),
    [["Second House", "HA-ABC123"], ["Second House", "HA-SECOND1"]]);
  assert.ok(s.pushes().some((p) => p[0].title === "Forwarded Vrbo booking for an unknown house" && /Vrbo property number/.test(p[0].body)));
});

test("a forwarded Vrbo cancellation cancels that booking's cleaning by its reservation ID", () => {
  const msg = vrboByHand("vc", { subject: "Cancelled: Reservation HA-ABC123", body: "Pat Example cancelled reservation HA-ABC123. © 2026 Vrbo" });
  const s = run({
    answer: services({ registry: REGISTRY_FWD, jobs: [jobDoc("v", "2027-03-05", { source: S("vrbo-email"), vrboCode: S("HA-ABC123"), checkIn: S("2027-02-22") })] }),
    mail: { airbnb: [thread(msg)] },
  });
  s.gs.scanAllEmails();
  const cancel = patches(s).find((c) => c.url.includes("/jobs/v?"));
  assert.deepEqual(plain([cancel.body.fields.cancelled, cancel.body.fields.cancelReason]), [B(true), S("Guest cancelled on Vrbo (forwarded email)")]);
  assert.equal(s.pushes().at(-1)[0].title, "Vrbo: 1 cancelled");
  assert.deepEqual(msg.replies, ["Got it, thanks! The Client House cleaning on Fri, Mar 5, 2027 is cancelled."]);
});

test("a Vrbo booking forwarded twice isn't scheduled twice", () => {
  const s = run({
    answer: services({ registry: REGISTRY_FWD, jobs: [jobDoc("v", "2027-03-05", { source: S("vrbo-email"), vrboCode: S("HA-ABC123") })] }),
    mail: { airbnb: [thread(vrboByHand("again"))] },
  });
  s.gs.scanAllEmails();
  assert.deepEqual(created(s), []);
});

// The laptop sync's heartbeat, as settings/airbnbSync, `hours` ago.
const HOUR = 3600000;
function watchdog({ successHours, runHours = successHours, error = "", props } = {}) {
  const fields = { lastError: S(error) };
  if (successHours !== undefined) fields.lastSuccessAt = { integerValue: String(Date.now() - successHours * HOUR) };
  if (runHours !== undefined) fields.lastRunAt = { integerValue: String(Date.now() - runHours * HOUR) };
  const s = run({
    answer: services({ override: (c) => (c.url.startsWith(`${FS_URL}/settings/airbnbSync`) ? [200, { fields }] : null) }),
    props,
  });
  s.gs.checkAirbnbSync();
  const sent = s.pushes().flat();
  return { s, sent };
}

test("the watchdog stays quiet while the laptop sync is on its 3-hour schedule", () => {
  assert.deepEqual(watchdog({ successHours: 3.5 }).sent, []);
});

test("one missed run (4 hours quiet) tells the owner, and only the owner", () => {
  const { s, sent } = watchdog({ successHours: 4.2 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "ExponentPushToken[owner]");
  assert.equal(sent[0].title, "Airbnb sync has gone quiet");
  assert.match(sent[0].body, /has not run in 4 hours/);
  assert.match(sent[0].body, /laptop is asleep/);
  assert.ok(s.store.airbnbStaleAlertAt);
});

test("a sync that runs but keeps failing says so, with its error", () => {
  const { sent } = watchdog({ successHours: 7, runHours: 1, error: "Not signed in to dad's Airbnb account." });
  assert.equal(sent[0].title, "Airbnb sync is failing");
  assert.match(sent[0].body, /has been failing for 7 hours/);
  assert.match(sent[0].body, /Last error: Not signed in/);
  assert.doesNotMatch(sent[0].body, /asleep/);
});

test("a long silence reads in days, and the owner is told once a day at most", () => {
  assert.match(watchdog({ successHours: 60 }).sent[0].body, /has not run in 2 days/);
  assert.deepEqual(watchdog({ successHours: 60, props: { airbnbStaleAlertAt: String(Date.now() - 5 * HOUR) } }).sent, []);
  assert.equal(watchdog({ successHours: 60, props: { airbnbStaleAlertAt: String(Date.now() - 25 * HOUR) } }).sent.length, 1);
});
