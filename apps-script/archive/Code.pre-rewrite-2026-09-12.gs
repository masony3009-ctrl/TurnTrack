function scanAllEmails() {
  scanCancellationEmails(); // must run first so cancellation emails never get ingested as new bookings
  scanAirbnbEmails();
  scanTurnoEmails();
}

function isAlreadyProcessed(messageId) {
  var props = PropertiesService.getScriptProperties();
  return props.getProperty(messageId) !== null;
}

function markAsProcessed(messageId) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty(messageId, 'true');
}

function scanAirbnbEmails() {
  var threads = GmailApp.search('from:automated@airbnb.com subject:reservation', 0, 10);
  
  for (var i = 0; i < threads.length; i++) {
    var message = threads[i].getMessages()[0];
    var messageId = message.getId();
    
    if (isAlreadyProcessed(messageId)) continue;
    
    var body = message.getPlainBody();
    var checkoutMatch = body.match(/Checkout\s*\n\s*([A-Za-z]+,\s+[A-Za-z]+\s+\d+)/);
    var propertyMatch = body.match(/([A-Z][A-Z\s]+(?:ROOM|HOME|HOUSE|SUITE|VILLA|APARTMENT|APT|CONDO))/);
    
    if (checkoutMatch) {
      var checkout = checkoutMatch[1];
      var property = propertyMatch ? propertyMatch[0] : "Unknown Property";
      sendToFirebase(checkout, property, "Airbnb Turnover");
      markAsProcessed(messageId);
    }
  }
}

 function scanTurnoEmails() {
  var threads = GmailApp.search('from:info@turno.com (subject:"New Cleaning project" OR subject:"Cleaning projects available")', 0, 10);
  
  for (var i = 0; i < threads.length; i++) {
    var message = threads[i].getMessages()[0];
    var messageId = message.getId();
    
    if (isAlreadyProcessed(messageId)) continue;
    
    var body = message.getBody();
    var cleaned = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    cleaned = cleaned.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
    
    var dateMatches = cleaned.match(/Start Time:\s*([A-Za-z]+,\s+[A-Za-z]+\s+\d+\s+\d+)/g);
    var addressMatches = cleaned.match(/\d{3,6}\s+[A-Za-z]+(?:\s+[A-Za-z]+){1,4},\s+[A-Za-z\s]+/g);
    // Turno's own HQ address (1003 Bishop St, Honolulu) sits in every email footer - never a property.
    if (addressMatches) { addressMatches = addressMatches.filter(function(a) { return a.indexOf("Bishop St") === -1 && a.indexOf("Honolulu") === -1; }); }
    
    if (dateMatches) {
      for (var j = 0; j < dateMatches.length; j++) {
        var dateMatch = dateMatches[j].match(/Start Time:\s*([A-Za-z]+,\s+[A-Za-z]+\s+\d+\s+\d+)/);
        if (dateMatch) {
          var date = dateMatch[1];
          var address = addressMatches && addressMatches[j] ? addressMatches[j].trim() : "Turno Property";
          address = address.replace(/\s+Host\s*$/, ''); // regex tail swallows the word Host from the next line
          sendToFirebase(date, address, "Turno Cleaning");
        }
      }
      markAsProcessed(messageId);
    }
  }
}

function sendToFirebase(date, address, type) {
  var url = "https://firestore.googleapis.com/v1/projects/cleanerapp-3f196/databases/(default)/documents/jobs";
  
  var payload = {
    fields: {
      date: { stringValue: date },
      address: { stringValue: address },
      type: { stringValue: type },
      done: { booleanValue: false }
    }
  };
  
  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  };
  
  UrlFetchApp.fetch(url, options);
}

function scanCancellationEmails() {
var threads = GmailApp.search('from:(automated@airbnb.com OR info@turno.com) (subject:canceled OR subject:cancelled)', 0, 10);
for (var i = 0; i < threads.length; i++) {
var msgs = threads[i].getMessages();
var message = msgs[msgs.length - 1]; // cancellations often land in the original booking thread
var messageId = message.getId();
if (isAlreadyProcessed(messageId)) continue;
var text = (message.getSubject() + ' ' + message.getPlainBody()).replace(/\s+/g, ' ');
handleCancellation(text);
markAsProcessed(messageId);
}
}

function handleCancellation(text) {
var m = text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})/);
if (!m) { notifyPhones("Cancellation received", "Couldn't read the date from a cancellation email - check TurnTrack and your inbox."); return; }
var key = m[1] + " " + parseInt(m[2], 10);
var res = UrlFetchApp.fetch("https://firestore.googleapis.com/v1/projects/cleanerapp-3f196/databases/(default)/documents/jobs?pageSize=300");
var docs = JSON.parse(res.getContentText()).documents || [];
var matches = [];
for (var i = 0; i < docs.length; i++) { if (jobMatchesKey(docs[i], key)) matches.push(docs[i]); }
if (matches.length > 1) { var narrowed = matches.filter(function(d) { return addressMentioned(text, d); }); if (narrowed.length >= 1) matches = narrowed; }
if (matches.length === 1) {
var f = matches[0].fields;
UrlFetchApp.fetch("https://firestore.googleapis.com/v1/" + matches[0].name + "?updateMask.fieldPaths=cancelled&updateMask.fieldPaths=cancelledAt&updateMask.fieldPaths=cancelReason&updateMask.fieldPaths=startedAt", { method: "patch", contentType: "application/json", payload: JSON.stringify({ fields: { cancelled: { booleanValue: true }, cancelledAt: { integerValue: String(Date.now()) }, cancelReason: { stringValue: "Cancelled by host (email)" }, startedAt: { nullValue: null } } }) }); // hidden in the app, kept for the record
notifyPhones("Cleaning cancelled", f.address.stringValue + " on " + f.date.stringValue + " was cancelled and removed from the schedule.");
return;
}
notifyPhones("Cancellation received", "A cancellation for " + key + " came in but " + (matches.length === 0 ? "no matching job was found" : "more than one job matches") + " - remove it in TurnTrack yourself.");
}

function jobMatchesKey(doc, key) {
var f = doc.fields || {};
if ((f.done && f.done.booleanValue) || (f.cancelled && f.cancelled.booleanValue)) return false;
var date = f.date && f.date.stringValue ? f.date.stringValue : "";
var dm = date.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})/);
return dm !== null && (dm[1] + " " + parseInt(dm[2], 10)) === key;
}

function addressMentioned(text, doc) {
var addr = doc.fields && doc.fields.address && doc.fields.address.stringValue ? doc.fields.address.stringValue : "";
var tokens = addr.split(/[^A-Za-z0-9]+/).filter(function(t) { return t.length > 3; });
var hits = 0;
for (var i = 0; i < tokens.length; i++) { if (text.toLowerCase().indexOf(tokens[i].toLowerCase()) !== -1) hits++; }
return tokens.length > 0 && hits >= Math.min(2, tokens.length);
}

function notifyPhones(title, body) {
  var res = UrlFetchApp.fetch("https://firestore.googleapis.com/v1/projects/cleanerapp-3f196/databases/(default)/documents/pushTokens?pageSize=100");
  var docs = JSON.parse(res.getContentText()).documents || [];
  var messages = [];
  var seen = {};
  for (var i = 0; i < docs.length; i++) { var t = docs[i].fields && docs[i].fields.token ? docs[i].fields.token.stringValue : null; if (t && !seen[t]) { seen[t] = true; messages.push({ to: t, title: title, body: body, sound: "default" }); } }
  // The app now stores each phone's token on its device record (devices/{id}.pushToken); pushTokens is the legacy list.
  var dres = UrlFetchApp.fetch("https://firestore.googleapis.com/v1/projects/cleanerapp-3f196/databases/(default)/documents/devices?pageSize=200");
  var ddocs = JSON.parse(dres.getContentText()).documents || [];
  for (var j = 0; j < ddocs.length; j++) { var dt = ddocs[j].fields && ddocs[j].fields.pushToken ? ddocs[j].fields.pushToken.stringValue : null; if (dt && !seen[dt]) { seen[dt] = true; messages.push({ to: dt, title: title, body: body, sound: "default" }); } }
  if (messages.length === 0) return;
  UrlFetchApp.fetch("https://exp.host/--/api/v2/push/send", { method: "post", contentType: "application/json", payload: JSON.stringify(messages) });
  }
  
  function testCancellationPush() {
  notifyPhones("TurnTrack test", "Cancellation alerts are set up - this is what one will look like.");
  }
  

  function inspectEmails() {
  var sources = [
  { label: "TURNO", query: 'from:info@turno.com newer_than:60d' },
  { label: "AIRBNB", query: 'from:automated@airbnb.com newer_than:60d' }
  ];
  for (var s = 0; s < sources.length; s++) {
  var threads = GmailApp.search(sources[s].query, 0, 4);
  Logger.log("=== " + sources[s].label + ": " + threads.length + " threads ===");
  for (var i = 0; i < threads.length; i++) {
  var msgs = threads[i].getMessages();
  var m = msgs[msgs.length - 1];
  var body = m.getBody().replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  Logger.log("--- " + sources[s].label + " " + i + " | msgs=" + msgs.length + " | SUBJECT: " + m.getSubject());
  Logger.log(body.substring(0, 1100));
  }
  }
  }


function inspectEmails() {
var sources = [
{ label: "TURNO", query: 'from:info@turno.com newer_than:90d' },
{ label: "AIRBNB", query: 'from:automated@airbnb.com newer_than:90d' }
];
for (var s = 0; s < sources.length; s++) {
var threads = GmailApp.search(sources[s].query, 0, 3);
Logger.log("=== " + sources[s].label + " threads: " + threads.length);
for (var i = 0; i < threads.length; i++) {
var msgs = threads[i].getMessages();
var m = msgs[msgs.length - 1];
var body = m.getBody().replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
Logger.log("--- " + sources[s].label + i + " msgs=" + msgs.length + " TO=" + m.getTo() + " SUBJ=" + m.getSubject());
Logger.log(body.substring(0, 900));
}
}
}