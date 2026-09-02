# Security Setup

This document covers everything you must do to deploy the security fixes. Until
these steps are done, the app will not function (the calendar scan calls a Cloud
Function that doesn't exist yet, and Firestore reads require auth).

## 0. Rotate the old Anthropic key first

If any build that contained `EXPO_PUBLIC_ANTHROPIC_API_KEY` was ever distributed
(TestFlight, an APK, anyone's phone), **treat that key as compromised.** Go to the
[Anthropic Console](https://console.anthropic.com/settings/keys), delete the old
key, and create a new one. Use the new key in step 2 below. Also remove
`EXPO_PUBLIC_ANTHROPIC_API_KEY` from any `.env`, EAS secrets, or build config —
it is no longer used by the app.

## 1. Install the Firebase CLI and log in

```bash
npm install -g firebase-tools
firebase login
firebase use cleanerapp-3f196   # or: firebase use --add
```

## 2. Set the Anthropic key as a server-side secret

```bash
cd functions
npm install
cd ..
firebase functions:secrets:set ANTHROPIC_API_KEY
# paste your NEW key when prompted
```

The key now lives only in Google Cloud Secret Manager and is injected into the
function at runtime. It is never in the repo and never in the app bundle.

## 3. Deploy the Cloud Function

```bash
firebase deploy --only functions
```

This deploys `scanCalendar`, a callable function that proxies the Anthropic
request. The app calls it via `httpsCallable(functions, "scanCalendar")`.

## 4. Enable Anonymous Authentication

In the [Firebase Console](https://console.firebase.google.com/) →
**Authentication** → **Sign-in method** → enable **Anonymous**.

The app signs in anonymously on launch (`app/_layout.tsx`). This is what lets the
Firestore rules require `request.auth != null`. Note: anonymous auth means
"someone running this app", not per-user accounts — it closes the open-to-the-
internet hole but does not separate users from each other. If you later want a
real login (e.g. a shared business account), swap `signInAnonymously` for an
email/password sign-in screen.

> A real `apiKey` must be present in `firebase.ts` for auth to work. The
> committed config has a blank `apiKey` — fill in the real one locally.

## 5. Publish the Firestore security rules

```bash
firebase deploy --only firestore:rules
```

`firestore.rules` denies all unauthenticated access and only allows the `jobs`
and `pushTokens` collections for signed-in clients. Everything else is denied.

## 6. Update the Google Apps Script ingestion (IMPORTANT)

Your README describes an Apps Script that writes jobs to Firestore via the REST
API every 15 minutes. **Once the rules above are live, unauthenticated REST
writes will be rejected (403)** and new jobs will stop appearing.

Pick one of these:

**Option A — Authenticate the Apps Script with a service account (smallest change).**
1. Firebase Console → Project Settings → Service accounts → generate a new
   private key (JSON).
2. In Apps Script, store the JSON in Script Properties and mint an OAuth2 access
   token for scope `https://www.googleapis.com/auth/datastore` (the
   [apps-script-oauth2](https://github.com/googleworkspace/apps-script-oauth2)
   library handles this).
3. Send the token on every Firestore REST call:
   `Authorization: Bearer <access_token>`.
   Service-account requests bypass security rules (they use Admin privileges), so
   writes will succeed while the public stays locked out.

**Option B — Add an authenticated ingestion Cloud Function.**
Add an HTTPS function that checks a shared secret header, then writes with the
Admin SDK. Point the Apps Script at that URL instead of the raw Firestore REST
endpoint. (Not included here because it requires changing your Apps Script code,
which isn't in this repo.)

## 7. Build a fresh app binary

Rebuild and redistribute so users get the version that calls the Cloud Function
instead of Anthropic directly:

```bash
eas build --platform ios --profile production
```

## Checklist

- [ ] Old Anthropic key rotated/deleted
- [ ] `ANTHROPIC_API_KEY` secret set
- [ ] `scanCalendar` function deployed
- [ ] Anonymous auth enabled + real `apiKey` in `firebase.ts`
- [ ] Firestore rules published
- [ ] Apps Script updated to authenticate
- [ ] New app build shipped
