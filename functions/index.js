const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

// The Anthropic key lives ONLY here, server-side. It is set as a Firebase
// secret (see SECURITY_SETUP.md) and never ships to the client app.
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

const PROMPT = (today) => `This is an Airbnb host calendar screenshot.

The calendar shows guest bookings as solid BLACK horizontal bars spanning multiple days. Each bar has a guest name on it.

IMPORTANT RULES:
- A cleaning is needed on the EXACT DAY the black bar ENDS
- The last day of the black bar is the checkout/cleaning day
- Do NOT add a cleaning for days in the MIDDLE of a black bar
- Do NOT add a cleaning if the black bar continues past the visible screen
- Only add cleanings where a black bar visibly ENDS and is followed by empty/white days
- Mark sameDayTurnover true when one guest checks out on a date and another black bar starts on that exact same date

Looking at the screenshot:
- What is the property name at the top?
- What month is shown?
- For each black bar that has a visible END point, what is the last day of that bar?
- For each checkout, does a different booking start on that same date?

Today is ${today}.

Respond ONLY with valid JSON, no markdown:
{
  "property": "exact property name",
  "month": "May 2026",
  "checkouts": [
    {"date": "Sat, May 9 2026", "guest": "Guest Name", "sameDayTurnover": false}
  ]
}

If a booking bar does not have a clear end point visible in the screenshot, do NOT include it.`;

exports.scanCalendar = onCall(
  { secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 60, memory: "256MiB" },
  async (request) => {
    // Only authenticated app users can call this. Stops the wider internet
    // from burning your Anthropic budget through this endpoint.
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be signed in to scan a calendar.");
    }

    const { base64, mimeType, today } = request.data || {};
    if (!base64 || !mimeType) {
      throw new HttpsError("invalid-argument", "An image (base64 + mimeType) is required.");
    }

    let res;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY.value(),
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-opus-4-5",
          max_tokens: 1000,
          messages: [
            {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } },
                { type: "text", text: PROMPT(today || new Date().toDateString()) },
              ],
            },
          ],
        }),
      });
    } catch (e) {
      throw new HttpsError("unavailable", "Could not reach the AI service. Please try again.");
    }

    const data = await res.json();
    if (data.error) {
      throw new HttpsError("internal", data.error.message || "AI request failed.");
    }

    const text = data?.content?.[0]?.text?.trim();
    if (!text) {
      throw new HttpsError("internal", "The AI returned an empty response.");
    }

    try {
      return JSON.parse(text);
    } catch (e) {
      throw new HttpsError("internal", "The AI response could not be parsed as JSON.");
    }
  }
);
