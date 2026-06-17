const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

// The Anthropic key lives ONLY here, server-side. It is set as a Firebase
// secret (see SECURITY_SETUP.md) and never ships to the client app.
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

const PROMPT = (today) => `This is a screenshot of an Airbnb host calendar.

The calendar shows guest bookings as dark/black horizontal bars spanning multiple days. Each bar has the guest's name on it.

Please identify:
1. The property name shown at the top of the screen
2. The month shown
3. For each booking bar, identify the CHECKOUT date which is the day AFTER the booking bar ends

For example if a booking bar ends on the 9th, the checkout/cleaning date is the 9th (the last day of the bar is checkout day).

Today is ${today}.

Respond ONLY with valid JSON, no markdown, no explanation:
{
  "property": "exact property name from top of screen",
  "month": "May 2026",
  "checkouts": [
    {"date": "Sat, May 9 2026", "guest": "Guest Name"},
    {"date": "Tue, May 19 2026", "guest": "Guest Name"}
  ]
}`;

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
