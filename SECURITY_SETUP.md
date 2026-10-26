# Security Setup

> **Status (2026-10-26).** Anonymous auth is on and every client signs in
> (the app, the Gmail scraper, the Airbnb/Turno laptop sync, the website
> bridge); `firestore.rules` rejects unauthenticated requests. Calendar
> scanning, the only thing that used an AI API, was removed from the app, and
> its `EXPO_PUBLIC_ANTHROPIC_API_KEY` was deleted from EAS and `app/.env`.
>
> **Still open, and it matters: the database is not private.** Anonymous auth
> means "some client of this project", not who. The web API key that mints
> those tokens is public (it ships in the app and sits in this repo), so anyone
> who has it can read and write every collection, including
> `settings/properties` (every house's door, garage and supply codes and the
> hosts' iCal links), PINs, payroll and push tokens. Nothing stops a delete,
> and the free plan has no backups.

## 1. Revoke the old Anthropic key

Every app build and over-the-air update published before 2026-10-26 carried
the key in its JavaScript bundle, and those bundles stay on Expo's servers and
people's phones. Deleting it from EAS stops new copies; only revoking it in the
[Anthropic Console](https://console.anthropic.com/settings/keys) makes the old
copies useless.

## 2. Lock the database down (not done)

All four clients have to change together, or one of them gets locked out:

1. **Roles from a server.** A small endpoint (the website's Cloudflare Worker
   can host it, no Blaze plan needed) checks a PIN and returns a Firebase
   custom token with a `role` claim (`owner` or `cleaner`, plus the
   employee id). The app signs in with `signInWithCustomToken` instead of
   anonymously.
2. **PINs leave readable documents.** Store only salted hashes, somewhere the
   rules deny to every client; the endpoint is the only reader. Rate-limit
   wrong guesses there.
3. **Scripts use a service account.** The Apps Script and the laptop sync
   mint OAuth tokens from a service-account key (kept in Script Properties and
   a gitignored file) instead of anonymous sign-up. Service accounts bypass the
   rules.
4. **Rules check roles.** Cleaners read jobs, the registry minus codes they
   don't need, and their own employee record; only owners write employees,
   settings and payroll; nobody deletes jobs or time entries from a client.
   Then turn anonymous sign-in off.
5. **App Check** (DeviceCheck / App Attest on iOS, Play Integrity on Android)
   needs a native build; do it with the next one.
6. **Backups:** scheduled exports need the Blaze plan; until then, a periodic
   export from the laptop sync's service account.
