/**
 * TurnTrack automation — Turno email -> Firestore cleanings.
 *
 * Runs on a 15-minute trigger. Reads Turno project emails, matches each to a
 * known property, and creates a cleaning in the app. Cancellation emails mark
 * the matching cleaning cancelled instead of deleting it. Projects at houses
 * the registry doesn't know are reported to the owner, not scheduled. The
 * laptop's Turno calendar sync (AirbnbSync/turno.js) is the other half.
 *
 * This file is the source of truth. Paste it into the TurnTrackAutomation
 * Apps Script project (script.google.com) after editing it here.
 *
 * Airbnb scanning was removed 2026-09-10: the account no longer hosts, its
 * last host email was June, and the only recent Airbnb mail was personal
 * travel — which the old parser turned into phantom cleanings.
 */

var PROJECT_ID = "cleanerapp-3f196";
var FS = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents";
var SEARCH_WINDOW = "newer_than:120d";
var MAX_THREADS = 25;

// Turno moved its mail from info@turno.com to donotreply@e.turno.com in fall
// 2026, and Gmail files some of the forwarded copies under Spam. Searching only
// the inbox for the old sender found nothing for a month, so: both senders,
// every folder but the bin.
var TURNO_MAIL = "(from:info@turno.com OR from:donotreply@e.turno.com OR from:e.turno.com) in:anywhere -in:trash";

// "Start time: Sunday, October 25, 2026 11:00 AM" (Turno's casing changed too).
var START_TIME = /Start Time:\s*([A-Za-z]{3,9},?\s*[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i;

// The Firestore rules require request.auth, so every call carries an anonymous
// ID token. WEB_API_KEY is the same public key the app ships with - not a
// secret, it only identifies the Firebase project.
var WEB_API_KEY = "AIzaSyBpSJEixry1qJBWrsvS_Azlf40GWnOGCcE";
var cachedIdToken = null;


// ---- entry point ---------------------------------------------------------

function scanAllEmails() {
  var ctx = loadContext();
  // Everything this run adds or cancels, so one notification can list it.
  ctx.changes = { created: [], cancelled: [] };
  // Offers at houses TurnTrack doesn't know: reported to the owner, not scheduled.
  ctx.offers = [];
  scanCancellationEmails(ctx); // first, so a cancellation is never read as a booking
  scanTurnoEmails(ctx);
  sendDigest(ctx);
  reportOffers(ctx);
  scanIcalFeeds(ctx);          // houses whose hosts gave us an Airbnb calendar link
  checkAirbnbSync(); // notices if the PC-side Airbnb sync has gone quiet
}

// ---- Firestore value helpers ---------------------------------------------

function str(v) { return { stringValue: String(v) }; }
function bool(v) { return { booleanValue: !!v }; }
function int(v) { return { integerValue: String(v) }; }
function nul() { return { nullValue: null }; }

function fsGet(path) {
  var res = UrlFetchApp.fetch(FS + path, { headers: authHeaders(), muteHttpExceptions: true });
  if (res.getResponseCode() >= 300) return null;
  return JSON.parse(res.getContentText());
}

// ---- context: property registry + existing jobs, fetched once per run ----

function loadContext() {
  return { properties: loadProperties(), jobs: loadJobs() };
}

// Counts are stored as whole numbers or decimals (2 vs 2.5); read either.
function numberField(v) {
  if (!v) return 0;
  var n = Number(v.integerValue !== undefined ? v.integerValue : v.doubleValue);
  return isFinite(n) ? n : 0;
}

function loadProperties() {
  var doc = fsGet("/settings/properties");
  if (!doc || !doc.fields || !doc.fields.items) return [];
  return (doc.fields.items.arrayValue.values || []).map(function (v) {
    var f = v.mapValue.fields;
    return {
      name: f.name.stringValue,
      address: f.address.stringValue,
      aliases: ((f.aliases && f.aliases.arrayValue.values) || []).map(function (a) { return a.stringValue; }),
      bedrooms: numberField(f.bedrooms),
      bathrooms: numberField(f.bathrooms),
      short: f.short ? f.short.stringValue : "",
      // A host's Airbnb calendar export link, for houses we aren't co-hosts on.
      icalUrl: f.icalUrl ? f.icalUrl.stringValue : ""
    };
  });
}

function loadJobs() {
  var out = [], token = "";
  do {
    var doc = fsGet("/jobs?pageSize=300" + (token ? "&pageToken=" + token : ""));
    if (!doc) break;
    (doc.documents || []).forEach(function (d) {
      var f = d.fields || {};
      out.push({
        name: d.name,
        dateKey: f.dateKey ? f.dateKey.stringValue : "",
        date: f.date ? f.date.stringValue : "",
        address: f.address ? f.address.stringValue : "",
        property: f.property ? f.property.stringValue : "",
        turnoProjectId: f.turnoProjectId ? String(f.turnoProjectId.stringValue || f.turnoProjectId.integerValue || "") : "",
        source: f.source ? f.source.stringValue : "",
        icalUid: f.icalUid ? f.icalUid.stringValue : "",
        done: !!(f.done && f.done.booleanValue),
        cancelled: !!(f.cancelled && f.cancelled.booleanValue)
      });
    });
    token = doc.nextPageToken || "";
  } while (token);
  return out;
}

// ---- property matching ---------------------------------------------------

function matchProperty(props, text) {
  var t = String(text || "").toLowerCase();
  if (!t) return null;
  for (var i = 0; i < props.length; i++) {
    var p = props[i];
    if (t.indexOf(p.name.toLowerCase()) !== -1) return p;
    for (var j = 0; j < p.aliases.length; j++) {
      if (p.aliases[j] && t.indexOf(String(p.aliases[j]).toLowerCase()) !== -1) return p;
    }
  }
  return null;
}

// ---- dates ---------------------------------------------------------------

var MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
var DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad2(n) { return n < 10 ? "0" + n : "" + n; }

// Today where the houses are. Mail about a day that has already passed is
// history, not news: widening the search on Oct 18 2026 surfaced a month of
// unread Turno mail, and none of it may turn into cleanings or alerts now.
// (Kept below scanAllEmails: the editor's Run button runs the first function.)
function todayKey() {
  return Utilities.formatDate(new Date(), "America/Phoenix", "yyyy-MM-dd");
}

// "Sun, Oct 18 2026" / "Oct 18, 2026" / "Oct 18" -> "2026-10-18"
function toDateKey(text) {
  var m = String(text || "").match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?/);
  if (!m) return "";
  var mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
  if (mi < 0) return "";
  var day = parseInt(m[2], 10);
  if (day < 1 || day > 31) return "";
  var year = m[3] ? parseInt(m[3], 10) : inferYear(mi, day);
  return year + "-" + pad2(mi + 1) + "-" + pad2(day);
}

// A date written without a year means the next occurrence: more than about
// six weeks in the past rolls forward a year.
function inferYear(monthIndex, day) {
  var now = new Date();
  var thisYear = new Date(now.getFullYear(), monthIndex, day);
  var cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 45);
  return thisYear < cutoff ? now.getFullYear() + 1 : now.getFullYear();
}

function labelFromKey(key) {
  var p = String(key).split("-");
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return DAY_LABELS[d.getDay()] + ", " + MONTH_LABELS[d.getMonth()] + " " + d.getDate() + " " + d.getFullYear();
}

// The inverse of labelFromKey. Jobs created before dateKey existed carry only
// the label, and the duplicate guard has to be able to see them - otherwise a
// re-scan writes a second copy of a cleaning that is already on the schedule.
function keyFromLabel(label) {
  var m = String(label || "").match(/[A-Za-z]{3}, ([A-Za-z]{3}) (\d{1,2}) (\d{4})/);
  if (!m) return "";
  var mi = MONTHS.indexOf(m[1].toLowerCase());
  if (mi < 0) return "";
  return m[3] + "-" + pad2(mi + 1) + "-" + pad2(Number(m[2]));
}

function cleanBody(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");
}

// ---- Turno ---------------------------------------------------------------

// Turno reuses one subject line per property, so Gmail threads every project
// at that property into a single conversation. Walk EVERY message: the old
// version read only the first, which silently skipped every later cleaning at
// a repeat property.
function scanTurnoEmails(ctx) {
  var threads = GmailApp.search(TURNO_MAIL + ' subject:"New Cleaning project" ' + SEARCH_WINDOW, 0, MAX_THREADS);
  for (var i = 0; i < threads.length; i++) {
    var msgs = threads[i].getMessages();
    for (var j = 0; j < msgs.length; j++) {
      var id = msgs[j].getId();
      if (isAlreadyProcessed(id)) continue;
      try {
        handleTurnoMessage(ctx, msgs[j]);
      } catch (e) {
        Logger.log("turno message failed: " + e);
      }
      markAsProcessed(id);
    }
  }
}

function handleTurnoMessage(ctx, msg) {
  var subject = msg.getSubject() || "";
  // "Cleaning projects available" (plural) is the marketplace digest - open
  // offers nobody assigned to us. Only "New Cleaning project available at X"
  // is real work.
  if (subject.indexOf("New Cleaning project") === -1) return;

  var text = cleanBody(msg.getBody());
  var nameMatch = subject.match(/available at\s+(.+?)\s*$/i);
  var propertyName = nameMatch ? nameMatch[1].replace(/[.\s]+$/, "") : "";
  var property = matchProperty(ctx.properties, propertyName) || matchProperty(ctx.properties, text);

  var startMatch = text.match(START_TIME);
  if (!startMatch) {
    Logger.log("no Start Time found: " + subject);
    return;
  }
  var dateKey = toDateKey(startMatch[1]);
  if (!dateKey) {
    Logger.log("unreadable Start Time: " + startMatch[1]);
    return;
  }
  if (dateKey < todayKey()) return;
  var idMatch = text.match(/Project\s*#\s*(\d{5,})/i);
  var projectId = idMatch ? idMatch[1] : "";

  // "New Cleaning project available" is worded the same whether a customer
  // assigned the project to us or only offered it. Every current customer
  // assigns directly, so a project at a house we know is ours; one at a house
  // we don't know may be an offer someone else takes (Oct 18 2026: nine at a
  // new house, none of them on our Turno calendar). Ask instead of guessing -
  // the Turno calendar sync adds it once it really is ours.
  if (!property) {
    Logger.log("offer at unknown house, not scheduled: " + propertyName + " " + dateKey);
    ctx.offers.push({ dateKey: dateKey, place: propertyName || "a new house", projectId: projectId });
    return;
  }

  createJob(ctx, {
    dateKey: dateKey,
    address: property.address,
    property: property.name,
    type: "Turno Cleaning",
    source: "turno-email",
    turnoProjectId: projectId,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms
  });
}

// One message per run listing every offer, owner only.
function reportOffers(ctx) {
  if (!ctx.offers || !ctx.offers.length) return;
  ctx.offers.sort(function (a, b) { return a.dateKey < b.dateKey ? -1 : 1; });
  var places = {};
  ctx.offers.forEach(function (o) { places[o.place] = true; });
  var lines = ctx.offers.map(function (o) { return "- " + labelFromKey(o.dateKey) + " · " + o.place; });
  alertOwnerTelegram(
    "Turno offered " + ctx.offers.length + " project" + (ctx.offers.length === 1 ? "" : "s") + " at a house TurnTrack doesn't know",
    lines.join("\n") + "\n\nNot added to the app: Turno hasn't put them on your calendar. " +
    "If they're yours, accept them in Turno and add the house to the property list (" + Object.keys(places).join(", ") + ")."
  );
}

// ---- job creation --------------------------------------------------------

// One cleaning per property per day. Turno re-sends the same notification and
// the copies can land in different threads, so the guard has to be the job
// itself, not the message id.
function createJob(ctx, opts) {
  var key = dedupeKey(opts.property, opts.address);
  for (var i = 0; i < ctx.jobs.length; i++) {
    var j = ctx.jobs[i];
    // Already known by project number - including one Turno cancelled, which
    // must not come back from an older "new project" email.
    if (opts.turnoProjectId && j.turnoProjectId === opts.turnoProjectId) return false;
    var jobKey = j.dateKey || keyFromLabel(j.date);
    if (j.cancelled || jobKey !== opts.dateKey) continue;
    if (dedupeKey(j.property, j.address) === key) return false;
  }

  var fields = {
    date: str(labelFromKey(opts.dateKey)),
    dateKey: str(opts.dateKey),
    address: str(opts.address),
    property: str(opts.property || ""),
    type: str(opts.type),
    done: bool(false),
    completedAt: nul(),
    sameDayTurnover: bool(!!opts.sameDay),
    assignedTo: nul(),
    assignedToName: nul(),
    startedAt: nul(),
    cancelled: bool(false),
    cancelledAt: nul(),
    cancelReason: nul(),
    source: str(opts.source),
    createdAt: int(Date.now())
  };
  // Lets the Turno calendar sync track this job when Turno moves or cancels it.
  if (opts.turnoProjectId) fields.turnoProjectId = str(opts.turnoProjectId);
  // The booking's iCal UID: how a date change or cancellation finds this job.
  if (opts.icalUid) fields.icalUid = str(opts.icalUid);
  if (opts.bedrooms) fields.bedrooms = int(opts.bedrooms);
  if (opts.bathrooms) fields.bathrooms = { doubleValue: opts.bathrooms };

  var res = UrlFetchApp.fetch(FS + "/jobs", {
    method: "post",
    contentType: "application/json",
    headers: authHeaders(),
    payload: JSON.stringify({ fields: fields }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) {
    Logger.log("create failed: " + res.getContentText());
    return false;
  }
  var created = JSON.parse(res.getContentText());
  ctx.jobs.push({
    name: created.name, dateKey: opts.dateKey, address: opts.address, property: opts.property || "",
    turnoProjectId: opts.turnoProjectId || "", source: opts.source, icalUid: opts.icalUid || "", done: false, cancelled: false
  });
  Logger.log("created " + opts.dateKey + " - " + opts.address);
  // Each source reports in its own notification (Turno's, or the iCal one).
  var report = opts.changes || ctx.changes;
  if (report) {
    report.created.push({
      dateKey: opts.dateKey,
      property: opts.property || opts.address,
      jobId: String(created.name || "").split("/").pop()
    });
  }
  return true;
}

function dedupeKey(property, address) {
  return String(property || address || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// ---- cancellations -------------------------------------------------------

function scanCancellationEmails(ctx) {
  var threads = GmailApp.search(TURNO_MAIL + ' (subject:cancel OR subject:canceled OR subject:cancelled) ' + SEARCH_WINDOW, 0, MAX_THREADS);
  for (var i = 0; i < threads.length; i++) {
    var msgs = threads[i].getMessages();
    for (var j = 0; j < msgs.length; j++) {
      var id = msgs[j].getId();
      if (isAlreadyProcessed(id)) continue;
      try {
        handleCancellation(ctx, msgs[j]);
      } catch (e) {
        Logger.log("cancellation failed: " + e);
      }
      markAsProcessed(id);
    }
  }
}

function handleCancellation(ctx, msg) {
  var subject = msg.getSubject() || "";
  var text = cleanBody(msg.getBody());
  var nameMatch = subject.match(/at\s+(.+?)\s*$/i);
  var propertyName = nameMatch ? nameMatch[1].replace(/[.\s]+$/, "") : "";
  var property = matchProperty(ctx.properties, propertyName) || matchProperty(ctx.properties, text);

  var startMatch = text.match(START_TIME);
  var dateKey = toDateKey(startMatch ? startMatch[1] : subject);
  if (!dateKey) {
    notifyPhones("Cancellation received", "Couldn't read the date from a Turno cancellation - check the app and your inbox.");
    return;
  }
  if (dateKey < todayKey()) return;
  var idMatch = text.match(/Project\s*#\s*(\d{5,})/i);
  var projectId = idMatch ? idMatch[1] : "";

  var matches = [];
  var alreadyCancelled = false;
  for (var i = 0; i < ctx.jobs.length; i++) {
    var j = ctx.jobs[i];
    if (!j.name || j.dateKey !== dateKey) continue;
    // The project number, when both sides have it, settles it outright.
    var sameProject = projectId && j.turnoProjectId === projectId;
    if (!sameProject && property && dedupeKey(j.property, j.address) !== dedupeKey(property.name, property.address)) continue;
    if (j.cancelled) { alreadyCancelled = true; continue; }
    if (j.done) continue;
    matches.push(j);
  }
  // The Turno calendar sync (or someone in the app) got there first.
  if (!matches.length && alreadyCancelled) return;

  // Only ever act on an unambiguous match: cancelling the wrong cleaning is
  // worse than asking a human to look.
  if (matches.length === 1) {
    cancelJob(matches[0]);
    matches[0].cancelled = true;
    // Reported in the run's single notification alongside any new cleanings.
    if (ctx.changes) {
      ctx.changes.cancelled.push({
        dateKey: dateKey,
        property: matches[0].property || matches[0].address,
        jobId: String(matches[0].name || "").split("/").pop()
      });
    }
    return;
  }
  notifyPhones("Cancellation received",
    "A Turno cancellation for " + labelFromKey(dateKey) + " came in but " +
    (matches.length === 0 ? "no matching cleaning was found" : "more than one cleaning matches") +
    " - take it off in the app yourself.");
}

function cancelJob(job) {
  var mask = "?updateMask.fieldPaths=cancelled&updateMask.fieldPaths=cancelledAt" +
             "&updateMask.fieldPaths=cancelReason&updateMask.fieldPaths=startedAt";
  UrlFetchApp.fetch("https://firestore.googleapis.com/v1/" + job.name + mask, {
    method: "patch",
    contentType: "application/json",
    headers: authHeaders(),
    payload: JSON.stringify({ fields: {
      cancelled: bool(true),
      cancelledAt: int(Date.now()),
      cancelReason: str("Cancelled by host (Turno email)"),
      startedAt: nul()
    } }),
    muteHttpExceptions: true
  });
}

// ---- Airbnb iCal links -----------------------------------------------------

// Some hosts give us their Airbnb calendar's export link (Calendar >
// Availability > Export calendar) instead of making us co-hosts. A house in the
// registry with an icalUrl is read here every run. The feed lists each booking
// as an all-day event from check-in to checkout and a stable UID, so: a booking
// becomes a cleaning on its checkout day, a date change moves it, a booking that
// disappears cancels it - with the same guards as the laptop Airbnb sync. The
// link is private to the host; it lives in the registry, never in this file.

var ICAL_SOURCE = "airbnb-ical";
var ICAL_JOB_TYPE = "Airbnb Turnover";
var ICAL_ALERT_HOURS = 24;

function scanIcalFeeds(ctx) {
  ctx.icalChanges = { created: [], cancelled: [], moved: [], restored: [] };
  var today = todayKey();
  ctx.properties.forEach(function (house) {
    if (!house.icalUrl) return;
    var res;
    try {
      res = UrlFetchApp.fetch(house.icalUrl, { muteHttpExceptions: true, followRedirects: true });
    } catch (e) {
      icalProblem(house, "Couldn't reach the calendar link (" + String(e).slice(0, 120) + ").");
      return;
    }
    var body = res.getContentText();
    if (res.getResponseCode() !== 200 || body.indexOf("BEGIN:VCALENDAR") === -1) {
      icalProblem(house, "The calendar link answered " + res.getResponseCode() + ". The host may have reset it in Airbnb - ask them for the new export link.");
      return;
    }
    var plan = planIcalHouse(parseIcal(body), ctx.jobs, house, today);
    // A half-loaded feed would look exactly like a wave of cancellations.
    if (plan.badRead) {
      icalProblem(house, "The calendar would have cancelled " + plan.cancel.length + " cleanings at once, which looks like a bad read, so nothing was changed.");
      return;
    }
    clearIcalProblem(house);
    applyIcalPlan(ctx, house, plan, today);
  });
  var d = buildDigest(ctx, "Airbnb", ctx.icalChanges);
  if (d) notifyPhones(d.title, d.body, d.data);
}

// "20261016" (VALUE=DATE) or "20261016T110000Z" -> "2026-10-16". Airbnb writes
// all-day dates, so the first eight digits are the day itself.
function icalDate(value) {
  var m = String(value || "").match(/^(\d{4})(\d{2})(\d{2})/);
  return m ? m[1] + "-" + m[2] + "-" + m[3] : "";
}

// Bookings only: Airbnb also lists dates the host blocked ("Airbnb (Not
// available)"), which are not stays and need no cleaning.
function parseIcal(text) {
  var lines = String(text || "").replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  var out = [], ev = null;
  lines.forEach(function (line) {
    if (line === "BEGIN:VEVENT") { ev = {}; return; }
    if (line === "END:VEVENT") { if (ev) out.push(ev); ev = null; return; }
    if (!ev) return;
    var colon = line.indexOf(":");
    if (colon < 0) return;
    var key = line.slice(0, colon).split(";")[0].toUpperCase();
    var value = line.slice(colon + 1).trim();
    if (key === "DTSTART") ev.checkIn = icalDate(value);
    else if (key === "DTEND") ev.checkOut = icalDate(value);
    else if (key === "UID") ev.uid = value;
    else if (key === "SUMMARY") ev.summary = value;
  });
  return out.filter(function (e) {
    return e.uid && e.checkIn && e.checkOut && e.checkOut > e.checkIn &&
      !/not available|blocked|unavailable/i.test(e.summary || "");
  });
}

// Works out every change for one house before anything is written.
function planIcalHouse(stays, jobs, house, today) {
  var plan = { create: [], move: [], restore: [], cancel: [], badRead: false };
  var checkIns = {};
  stays.forEach(function (s) { checkIns[s.checkIn] = true; });

  // One job per booking; a live one beats a cancelled one.
  var byUid = {};
  jobs.forEach(function (j) {
    if (!j.icalUid) return;
    var cur = byUid[j.icalUid];
    if (!cur || (cur.cancelled && !j.cancelled)) byUid[j.icalUid] = j;
  });

  var listed = {};
  stays.forEach(function (s) {
    listed[s.uid] = true;
    if (s.checkOut < today) return;
    var sameDay = !!checkIns[s.checkOut];
    var mine = byUid[s.uid];
    if (!mine) { plan.create.push({ stay: s, sameDay: sameDay }); return; }
    if (mine.cancelled) plan.restore.push({ job: mine, stay: s, sameDay: sameDay });
    else if (mine.dateKey !== s.checkOut) plan.move.push({ job: mine, stay: s, sameDay: sameDay, from: mine.dateKey });
  });

  // Never cancel a cleaning dated today or earlier: a booking is never
  // cancelled on its own checkout day, so a missing one then is a read gap.
  var upcoming = 0;
  jobs.forEach(function (j) {
    if (j.source !== ICAL_SOURCE || !j.icalUid || j.cancelled || j.done || j.property !== house.name) return;
    if (!(j.dateKey > today)) return;
    upcoming++;
    if (!listed[j.icalUid]) plan.cancel.push(j);
  });
  plan.badRead = plan.cancel.length > 3 && plan.cancel.length >= upcoming / 2;
  return plan;
}

function applyIcalPlan(ctx, house, plan, today) {
  var report = ctx.icalChanges;
  plan.create.forEach(function (c) {
    // A cleaning someone already put in for that house and day is tagged
    // with the booking instead of doubled.
    var existing = liveJobAt(ctx, house, c.stay.checkOut);
    if (existing) {
      if (!existing.icalUid && existing.name) {
        patchJobFields(existing.name, { icalUid: str(c.stay.uid) });
        existing.icalUid = c.stay.uid;
      }
      return;
    }
    createJob(ctx, {
      dateKey: c.stay.checkOut, address: house.address, property: house.name, type: ICAL_JOB_TYPE,
      source: ICAL_SOURCE, icalUid: c.stay.uid, sameDay: c.sameDay,
      bedrooms: house.bedrooms, bathrooms: house.bathrooms, changes: report
    });
  });
  plan.move.forEach(function (m) {
    patchJobFields(m.job.name, { dateKey: str(m.stay.checkOut), date: str(labelFromKey(m.stay.checkOut)), sameDayTurnover: bool(m.sameDay) });
    report.moved.push({ from: m.from, to: m.stay.checkOut, property: house.name, jobId: jobIdOf(m.job) });
    m.job.dateKey = m.stay.checkOut;
  });
  plan.restore.forEach(function (r) {
    patchJobFields(r.job.name, {
      cancelled: bool(false), cancelledAt: nul(), cancelReason: nul(),
      dateKey: str(r.stay.checkOut), date: str(labelFromKey(r.stay.checkOut)), sameDayTurnover: bool(r.sameDay)
    });
    report.restored.push({ dateKey: r.stay.checkOut, property: house.name, jobId: jobIdOf(r.job) });
    r.job.cancelled = false;
  });
  plan.cancel.forEach(function (j) {
    patchJobFields(j.name, { cancelled: bool(true), cancelledAt: int(Date.now()), cancelReason: str("Booking no longer on the host's Airbnb calendar") });
    report.cancelled.push({ dateKey: j.dateKey, property: house.name, jobId: jobIdOf(j) });
    j.cancelled = true;
  });
}

function liveJobAt(ctx, house, dateKey) {
  var key = dedupeKey(house.name, house.address);
  for (var i = 0; i < ctx.jobs.length; i++) {
    var j = ctx.jobs[i];
    if (j.cancelled || (j.dateKey || keyFromLabel(j.date)) !== dateKey) continue;
    if (dedupeKey(j.property, j.address) === key) return j;
  }
  return null;
}

function jobIdOf(job) { return String(job.name || "").split("/").pop(); }

function patchJobFields(jobName, fields) {
  var mask = Object.keys(fields).map(function (k) { return "updateMask.fieldPaths=" + k; }).join("&");
  var res = UrlFetchApp.fetch("https://firestore.googleapis.com/v1/" + jobName + "?" + mask, {
    method: "patch",
    contentType: "application/json",
    headers: authHeaders(),
    payload: JSON.stringify({ fields: fields }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) Logger.log("patch failed: " + res.getContentText());
}

// One owner alert per house per day while a feed is broken, so a revoked
// link is noticed without nagging.
function icalProblem(house, message) {
  Logger.log("ical problem at " + house.name + ": " + message);
  var props = PropertiesService.getScriptProperties();
  var key = "icalAlertAt:" + house.name;
  var last = Number(props.getProperty(key) || 0);
  if (Date.now() - last < ICAL_ALERT_HOURS * 3600 * 1000) return;
  if (alertOwnerTelegram("Airbnb calendar for " + (house.short || house.name) + " isn't working", message + "\n\nNothing changed for that house this time.")) {
    props.setProperty(key, String(Date.now()));
  }
}

function clearIcalProblem(house) {
  var props = PropertiesService.getScriptProperties();
  var key = "icalAlertAt:" + house.name;
  if (props.getProperty(key)) props.deleteProperty(key);
}

// ---- processed message ids ----------------------------------------------

// Script Properties has a hard total size cap. The old version stored one
// property per message id and would eventually fill it and start failing
// silently, so keep a rolling window in a single key instead.
var PROCESSED_KEY = "processedIds";
var PROCESSED_MAX = 500;
var processedCache = null;

function processedIds() {
  if (processedCache) return processedCache;
  var raw = PropertiesService.getScriptProperties().getProperty(PROCESSED_KEY);
  processedCache = raw ? raw.split(",") : [];
  return processedCache;
}

function isAlreadyProcessed(id) {
  return processedIds().indexOf(id) !== -1;
}

function markAsProcessed(id) {
  var ids = processedIds();
  ids.push(id);
  if (ids.length > PROCESSED_MAX) ids = ids.slice(ids.length - PROCESSED_MAX);
  processedCache = ids;
  PropertiesService.getScriptProperties().setProperty(PROCESSED_KEY, ids.join(","));
}

// Run once by hand after pasting this file: clears the old per-message keys so
// the fixed parser re-reads recent Turno mail and picks up every cleaning the
// thread bug skipped. Existing cleanings are protected by createJob's
// duplicate check.
function resetProcessed() {
  // Script Properties also hold the Telegram credentials and the watchdog's
  // last-alert stamp, so this clears the processed-id keys ONLY. It used to
  // call deleteAllProperties(), which would silently kill alerting.
  var props = PropertiesService.getScriptProperties();
  var keep = { TELEGRAM_BOT_TOKEN: 1, TELEGRAM_CHAT_ID: 1, airbnbStaleAlertAt: 1 };
  var all = props.getProperties();
  var removed = 0;
  for (var k in all) {
    if (keep[k]) continue;
    props.deleteProperty(k);
    removed++;
  }
  processedCache = null;
  Logger.log("cleared " + removed + " processed-id keys - next scan re-reads " + SEARCH_WINDOW);
}

// ---- Firestore auth --------------------------------------------------------
function idToken() {
  if (cachedIdToken) return cachedIdToken; // one run is far shorter than the hour a token lasts
  var res = UrlFetchApp.fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=" + WEB_API_KEY,
    { method: "post", contentType: "application/json", payload: JSON.stringify({ returnSecureToken: true }), muteHttpExceptions: true }
  );
  if (res.getResponseCode() >= 300) throw new Error("anonymous sign-in failed: " + res.getContentText());
  cachedIdToken = JSON.parse(res.getContentText()).idToken;
  return cachedIdToken;
}

function authHeaders() {
  return { Authorization: "Bearer " + idToken() };
}

// ---- the "what changed" notification -------------------------------------
//
// Same format as the Airbnb sync's notification (AirbnbSync/lib/digest.js).
// Keep the two in step:
//
//   Turno: 2 new, 1 cancelled
//   New · Tue, Dec 8 · Camina Plata
//   Cancelled · Fri, Oct 30 · Castle Rock

var DIGEST_MAX_LINES = 6;

function shortDate(key) {
  var p = String(key).split("-");
  var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  return DAY_LABELS[d.getDay()] + ", " + MONTH_LABELS[d.getMonth()] + " " + d.getDate();
}

// The registry's `short` wins; otherwise the part after "·", cut at ":".
function shortName(ctx, name) {
  for (var i = 0; i < ctx.properties.length; i++) {
    if (ctx.properties[i].name === name && ctx.properties[i].short) return ctx.properties[i].short;
  }
  var s = String(name || "");
  if (s.indexOf("·") !== -1) s = s.split("·").pop();
  if (s.indexOf(":") !== -1) s = s.split(":")[0];
  s = s.replace(/^\s+|\s+$/g, "");
  if (s.length > 24) s = s.slice(0, 23).replace(/\s+$/, "") + "…";
  return s || "Cleaning";
}

function buildDigest(ctx, source, changes) {
  var rows = [];
  changes.created.forEach(function (c) {
    rows.push({ when: c.dateKey, jobId: c.jobId, text: "New · " + shortDate(c.dateKey) + " · " + shortName(ctx, c.property) });
  });
  changes.cancelled.forEach(function (c) {
    rows.push({ when: c.dateKey, jobId: c.jobId, text: "Cancelled · " + shortDate(c.dateKey) + " · " + shortName(ctx, c.property) });
  });
  // Only the iCal feeds move or restore cleanings; Turno passes neither list.
  var moved = changes.moved || [], restored = changes.restored || [];
  moved.forEach(function (c) {
    rows.push({ when: c.to, jobId: c.jobId, text: "Moved · " + shortName(ctx, c.property) + " · " + shortDate(c.from) + " → " + shortDate(c.to) });
  });
  restored.forEach(function (c) {
    rows.push({ when: c.dateKey, jobId: c.jobId, text: "Back on · " + shortDate(c.dateKey) + " · " + shortName(ctx, c.property) });
  });
  if (!rows.length) return null;
  rows.sort(function (a, b) { return a.when < b.when ? -1 : a.when > b.when ? 1 : 0; });

  var parts = [];
  if (changes.created.length) parts.push(changes.created.length + " new");
  if (restored.length) parts.push(restored.length + " back on");
  if (moved.length) parts.push(moved.length + " moved");
  if (changes.cancelled.length) parts.push(changes.cancelled.length + " cancelled");
  var title = rows.length === 1 && changes.created.length === 1
    ? source + ": new cleaning"
    : source + ": " + parts.join(", ");

  var lines = rows.slice(0, DIGEST_MAX_LINES).map(function (r) { return r.text; });
  var extra = rows.length - DIGEST_MAX_LINES;
  if (extra > 0) lines.push("+" + extra + " more change" + (extra === 1 ? "" : "s") + " in the app");

  // A single change opens straight to that job when tapped.
  var data = rows.length === 1 && rows[0].jobId ? { jobId: rows[0].jobId } : {};
  return { title: title, body: lines.join("\n"), data: data };
}

function sendDigest(ctx) {
  var d = buildDigest(ctx, "Turno", ctx.changes);
  if (d) notifyPhones(d.title, d.body, d.data);
}

// ---- push ----------------------------------------------------------------

// `data` rides along with the push; { jobId } makes tapping it open that job.
function notifyPhones(title, body, data) {
  var messages = [];
  var seen = {};
  function add(token) {
    if (token && !seen[token]) {
      seen[token] = true;
      messages.push({ to: token, title: title, body: body, sound: "default", data: data || {} });
    }
  }
  var legacy = fsGet("/pushTokens?pageSize=100");
  ((legacy && legacy.documents) || []).forEach(function (d) {
    if (d.fields && d.fields.token) add(d.fields.token.stringValue);
  });
  // The app stores each phone's token on its device record.
  var devices = fsGet("/devices?pageSize=200");
  ((devices && devices.documents) || []).forEach(function (d) {
    if (d.fields && d.fields.pushToken) add(d.fields.pushToken.stringValue);
  });
  if (messages.length === 0) return;
  UrlFetchApp.fetch("https://exp.host/--/api/v2/push/send", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(messages),
    muteHttpExceptions: true
  });
}

function testPush() {
  notifyPhones("TurnTrack test", "Push notifications are working.");
}

// ---- Airbnb sync watchdog ------------------------------------------------
//
// The Airbnb calendar sync runs on Mason's PC (C:\Users\mason\AirbnbSync),
// every 3 hours, and alerts on its own when a run fails. It cannot alert when
// it never runs at all - PC off, task deleted, Windows logged out. This runs
// in Google's cloud instead, so it notices exactly that case.
//
// The sync stamps settings/airbnbSync on every run; silence here means the
// Airbnb cleanings have quietly stopped arriving.

var AIRBNB_STALE_HOURS = 30;   // sync runs every 3h; 30h is unambiguous
var AIRBNB_REALERT_HOURS = 24; // do not nag daily forever

function checkAirbnbSync() {
  var doc = fsGet("/settings/airbnbSync");
  var f = (doc && doc.fields) || {};
  var lastSuccess = f.lastSuccessAt ? Number(f.lastSuccessAt.integerValue) : 0;
  var ageHours = lastSuccess ? (Date.now() - lastSuccess) / 3600000 : null;

  if (ageHours !== null && ageHours < AIRBNB_STALE_HOURS) return;

  var props = PropertiesService.getScriptProperties();
  var lastAlert = Number(props.getProperty("airbnbStaleAlertAt") || 0);
  if (Date.now() - lastAlert < AIRBNB_REALERT_HOURS * 3600000) return;

  // Written for someone reading it on a phone, not at a terminal. The sync runs
  // on a laptop, and the realistic causes are all "the laptop was not able to
  // run it" - so say that, and say what it costs: cancellations are missed too,
  // which means a cleaner can drive to a house that no longer needs cleaning.
  var msg = ageHours === null
    ? "The Airbnb calendar sync has never reported a successful run."
    : "The Airbnb calendar sync has not run in " + Math.floor(ageHours / 24 >= 2 ? ageHours / 24 : ageHours) +
      (ageHours / 24 >= 2 ? " days" : " hours") + ".";
  msg += " New Airbnb bookings are not being added, and cancellations are not being removed.";
  if (f.lastError && f.lastError.stringValue) msg += "\n\nLast error: " + f.lastError.stringValue;
  msg += "\n\nMost likely the laptop is asleep, shut, or was unplugged. Open it and plug it in - it catches up by itself within a few minutes.";

  // Only start the 24h quiet period once the alert actually reached someone.
  // Stamping on a failed send would silence the retry for a full day.
  if (alertOwnerTelegram("Airbnb sync has gone quiet", msg)) {
    props.setProperty("airbnbStaleAlertAt", String(Date.now()));
  }
}

// Same bot the website Worker uses. Token and chat id are Script Properties
// (File > Project Settings > Script Properties), never literals in this file -
// this code is mirrored into a git repo.
function alertOwnerTelegram(title, body) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("TELEGRAM_BOT_TOKEN");
  var chatId = props.getProperty("TELEGRAM_CHAT_ID");
  if (!token || !chatId) {
    Logger.log("telegram not configured; pushing to the owner instead");
    return pushToOwnerDevices(title, body);
  }
  var res = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ chat_id: chatId, text: title + "\n\n" + body, disable_web_page_preview: true }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) {
    Logger.log("telegram failed: " + res.getContentText());
    return pushToOwnerDevices(title, body);
  }
  return true;
}

// Fallback channel, and the default until a Telegram bot token is stored.
// Only devices whose role is "owner" - the crew does not need to hear that a
// scraper fell over. Runs in Google's cloud, so it still fires when the PC
// that hosts the Airbnb sync is off, which is the whole point of this watchdog.
function pushToOwnerDevices(title, body) {
  var doc = fsGet("/devices?pageSize=200");
  var messages = [], seen = {};
  ((doc && doc.documents) || []).forEach(function (d) {
    var f = d.fields || {};
    if (!f.role || f.role.stringValue !== "owner") return;
    var t = f.pushToken && f.pushToken.stringValue;
    if (t && !seen[t]) {
      seen[t] = true;
      messages.push({ to: t, title: title, body: body, sound: "default" });
    }
  });
  if (messages.length === 0) {
    Logger.log("no owner device has a push token; alert not delivered: " + title);
    return false;
  }
  var res = UrlFetchApp.fetch("https://exp.host/--/api/v2/push/send", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(messages),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() >= 300) {
    Logger.log("owner push failed: " + res.getContentText());
    return false;
  }
  Logger.log("alerted " + messages.length + " owner device(s)");
  return true;
}

function testAirbnbWatchdog() {
  var doc = fsGet("/settings/airbnbSync");
  Logger.log(doc ? JSON.stringify(doc.fields) : "no heartbeat doc yet");
  Logger.log("telegram configured: " + !!PropertiesService.getScriptProperties().getProperty("TELEGRAM_BOT_TOKEN"));
}
