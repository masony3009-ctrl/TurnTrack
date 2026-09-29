/**
 * TurnTrack automation — Turno email -> Firestore cleanings.
 *
 * Runs on a 15-minute trigger. Reads Turno project emails, matches each to a
 * known property, and creates a cleaning in the app. Cancellation emails mark
 * the matching cleaning cancelled instead of deleting it.
 *
 * This file is the source of truth. Paste it into the CleanerAppAutomation
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

// The Firestore rules require request.auth, so every call carries an anonymous
// ID token. WEB_API_KEY is the same public key the app ships with - not a
// secret, it only identifies the Firebase project.
var WEB_API_KEY = "AIzaSyBpSJEixry1qJBWrsvS_Azlf40GWnOGCcE";
var cachedIdToken = null;


// ---- entry point ---------------------------------------------------------

function scanAllEmails() {
  var ctx = loadContext();
  scanCancellationEmails(ctx); // first, so a cancellation is never read as a booking
  scanTurnoEmails(ctx);
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

function loadProperties() {
  var doc = fsGet("/settings/properties");
  if (!doc || !doc.fields || !doc.fields.items) return [];
  return (doc.fields.items.arrayValue.values || []).map(function (v) {
    var f = v.mapValue.fields;
    return {
      name: f.name.stringValue,
      address: f.address.stringValue,
      aliases: ((f.aliases && f.aliases.arrayValue.values) || []).map(function (a) { return a.stringValue; }),
      bedrooms: f.bedrooms ? Number(f.bedrooms.integerValue) : 0,
      bathrooms: f.bathrooms ? Number(f.bathrooms.doubleValue) : 0
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
  var threads = GmailApp.search('from:info@turno.com subject:"New Cleaning project" ' + SEARCH_WINDOW, 0, MAX_THREADS);
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

  var startMatch = text.match(/Start Time:\s*([A-Za-z]{3,9},?\s*[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/);
  if (!startMatch) {
    Logger.log("no Start Time found: " + subject);
    return;
  }
  var dateKey = toDateKey(startMatch[1]);
  if (!dateKey) {
    Logger.log("unreadable Start Time: " + startMatch[1]);
    return;
  }
  if (!property) {
    Logger.log("UNKNOWN PROPERTY (add to settings/properties): " + propertyName);
  }

  createJob(ctx, {
    dateKey: dateKey,
    address: property ? property.address : (propertyName || "Turno job - address in Turno app"),
    property: property ? property.name : propertyName,
    type: "Turno Cleaning",
    source: "turno-email",
    bedrooms: property ? property.bedrooms : 0,
    bathrooms: property ? property.bathrooms : 0
  });
}

// ---- job creation --------------------------------------------------------

// One cleaning per property per day. Turno re-sends the same notification and
// the copies can land in different threads, so the guard has to be the job
// itself, not the message id.
function createJob(ctx, opts) {
  var key = dedupeKey(opts.property, opts.address);
  for (var i = 0; i < ctx.jobs.length; i++) {
    var j = ctx.jobs[i];
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
    sameDayTurnover: bool(false),
    assignedTo: nul(),
    assignedToName: nul(),
    startedAt: nul(),
    cancelled: bool(false),
    cancelledAt: nul(),
    cancelReason: nul(),
    source: str(opts.source),
    createdAt: int(Date.now())
  };
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
  ctx.jobs.push({ dateKey: opts.dateKey, address: opts.address, property: opts.property || "", done: false, cancelled: false });
  Logger.log("created " + opts.dateKey + " - " + opts.address);
  return true;
}

function dedupeKey(property, address) {
  return String(property || address || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// ---- cancellations -------------------------------------------------------

function scanCancellationEmails(ctx) {
  var threads = GmailApp.search('from:info@turno.com (subject:cancel OR subject:canceled OR subject:cancelled) ' + SEARCH_WINDOW, 0, MAX_THREADS);
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

  var startMatch = text.match(/Start Time:\s*([A-Za-z]{3,9},?\s*[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/);
  var dateKey = toDateKey(startMatch ? startMatch[1] : subject);
  if (!dateKey) {
    notifyPhones("Cancellation received", "Couldn't read the date from a Turno cancellation - check the app and your inbox.");
    return;
  }

  var matches = [];
  for (var i = 0; i < ctx.jobs.length; i++) {
    var j = ctx.jobs[i];
    if (j.cancelled || j.done || j.dateKey !== dateKey || !j.name) continue;
    if (property && dedupeKey(j.property, j.address) !== dedupeKey(property.name, property.address)) continue;
    matches.push(j);
  }

  // Only ever act on an unambiguous match: cancelling the wrong cleaning is
  // worse than asking a human to look.
  if (matches.length === 1) {
    cancelJob(matches[0]);
    matches[0].cancelled = true;
    notifyPhones("Cleaning cancelled", matches[0].address + " on " + labelFromKey(dateKey) + " was cancelled and taken off the schedule.");
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

// ---- push ----------------------------------------------------------------

function notifyPhones(title, body) {
  var messages = [];
  var seen = {};
  function add(token) {
    if (token && !seen[token]) {
      seen[token] = true;
      messages.push({ to: token, title: title, body: body, sound: "default" });
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
