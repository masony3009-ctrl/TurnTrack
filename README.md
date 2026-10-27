\# TurnTrack

A cross-platform mobile app (iOS & Android) built to automate job scheduling for an Airbnb cleaning business.

## What it does
- Automatically scans Airbnb and Turno booking emails and adds cleaning jobs to a shared calendar
- Real-time sync between multiple phones via Firebase Firestore
- Push notifications on the day of each cleaning
- Calendar view with job details and completion tracking
- Jobs drop off the phones 2 days after their cleaning date (they stay in Firestore)

## Crew management (Team, assignments, time tracking, payroll)
- **Team screen** — add cleaners with an hourly rate, phone, and Zelle contact; deactivate or delete them
- **Assignments** — assign any job to a cleaner from the job detail screen; the assignee shows on job cards, the calendar, and day-of notifications
- **Time tracking** — Start cleaning / Finish cleaning timer on each job; finishing logs a time entry (minutes × the cleaner's hourly rate) and marks the job done
- **Checklist by room** — the checklist is a list of rooms (First 10 minutes, Laundry, Bathroom 1, Bathroom 2, Kitchen…). Each room opens to its steps, with a tip under each step and a note for the room. Ticks record the time and who made them; a finished room shows when, by whom and how long it took, and pushes the owner. Bathrooms repeat per the house's bathroom count. Logic lives in `checklist.ts` (`npm test`)
- **Add a room** — a cleaner or the owner can add a bathroom, half bath or bedroom to one cleaning when a house has more rooms than its count, and remove it again until something in it is ticked
- **Finishing early** — finishing with steps unchecked asks for a reason, which the owner sees on the job next to the steps marked "Not done"
- **Give a job back** — a cleaner can hand their own job back to the unassigned pool before starting it; the owner gets a push
- **Payroll screen** — unpaid hours and amount owed per cleaner, mark-paid-via-Zelle (with a copy-Zelle-contact button), manual time corrections, and paid history
- **My pay** — a cleaner's Payroll tab shows only their own pay: what they're owed, this week and last week, unpaid entries, and past payments grouped by the moment they were marked paid (`payroll.ts`)
- **Assign cleanings** — tapping Unassigned on the Jobs tab (or More → Assign cleanings) lists the open cleanings by day for this week, next week and later, with each cleaner's load so far. One tap hands a cleaning out; each cleaner gets one push for everything handed to them in a sitting instead of one per job. "Ask the crew" pushes the open count to every active cleaner, and tapping it opens their Open filter (`assign.ts`)
- **Open cleanings** — cleaners get an Open filter on the Jobs tab: every upcoming cleaning nobody has, to take with "Take this job"
- **Houses tab (owner)** — every house in the registry with its price, rooms and access codes, editable in place (or add a house). Money per period: what finished cleanings paid, the pay logged against them and the profit, plus average time, pay and what's left per cleaning at each house so a house that costs more than it pays stands out. A cleaning's own price (set on the job, for deep cleans and one-offs) beats the house price (`money.ts`)
- **Hosts who pay directly** — a house can be marked as billed directly from a date; the Houses tab totals what that host owes and marks it paid in one tap, and each job can be marked paid on its own
- **Deep-clean nudges** — each house shows the regular cleanings since its last deep clean, and flags it after 10 without one unless a deep clean is already booked
- **Low supplies** — the Finish sheet has chips for supplies running low. They land on the job, push the owner, and add to that house's shopping list at `settings/supplies` (Houses tab, with a badge on the tab) until the owner taps them off as restocked (`supplies.ts`)
- **Assignment pushes** — assigning a job sends a push notification to the cleaner's phone(s); tapping it opens the job. Reassigning tells the previous cleaner, cancelling tells the assignee
- **Checklist pop-up** — tapping Start cleaning opens the checklist as a sheet. The owner edits the template from the list icon on the Jobs tab, stored at `settings/checklist` as `lines` (rooms, `>` room notes, `step | tip`, `Bathroom #:`, `Half bath:`, `Bedroom (optional):`) plus a plain `items` copy for older app versions. A cleaning nobody has ticked yet always shows the current template
- **Cancellations** — the owner can cancel a job from its detail screen (or the email script can set `cancelled: true`). Cancelled jobs are hidden everywhere but kept in Firestore
- **Auto-cleanup** — jobs leave the phones 2 days after their cleaning date (`HIDE_AFTER_DAYS` in `turnover.ts`) but stay in Firestore
- **Calendar** — a month grid of every cleaning by house short name in the cleaner's color; tap a day for its cleanings. Owners also get a Sunday–Saturday count per week: what each past week had, how this week is going, and what later weeks have booked (`schedule.ts`). "N upcoming cleanings" on the Jobs screen links here
- **Cleaner colors** — each cleaner has a color (Team tab). Calendar dots, job cards, and avatars use it, with a legend under the calendar
- **Owner access** — the owner can open any cleaner's view without their PIN: "View as" on the Team tab, or the owner PIN on the sign-in screen
- **Access codes** — the job screen shows the front door, garage and supply-closet codes for that house, tap to copy. They are read from the property registry rather than stored on the job, so changing a code once changes it on every cleaning at that house, past and future

Firestore collections: `jobs`, `pushTokens`, `employees`, `timeEntries`, `devices` (one per phone: role, employee, push token), `settings` (`owner` PIN, `checklist` template, `properties` registry, `airbnbSync` heartbeat). The security rules must allow read/write on all of them.

`settings/properties` is the house registry — one entry per property with its
street address, aliases, beds/baths and access codes. The app, the Apps Script
and the Airbnb sync all read it, and `findProperty()` in `properties.ts` is the
shared matcher. Aliases are deliberately narrow: two houses on the same street
are different houses, so neither may claim the bare street name.

## Tech Stack
- **React Native** + **TypeScript** — cross-platform mobile (iOS & Android)
- **Expo** + **Expo Router** — framework and navigation
- **Firebase Firestore** — real-time cloud database
- **Google Apps Script** — serverless email automation pipeline
- **EAS Build** + **EAS Update** — App Store deployment and OTA updates

## How the automation works
A Google Apps Script runs every 15 minutes and searches Gmail for Airbnb reservation confirmations and Turno cleaning emails. It uses regex to extract checkout dates and property addresses, then sends them directly to Firebase via REST API. New jobs appear on both phones instantly with no manual input.

The same script reads **Airbnb iCal links** for hosts who share their calendar export instead of making us co-hosts: give a house in `settings/properties` an `icalUrl` and every booking becomes a cleaning on its checkout day (`source: "airbnb-ical"`, tracked by the booking's `icalUid`), date changes move it, and vanished bookings cancel it — never on or before today, and never in a wave. The link is private to the host, so it lives only in Firestore. Tests for the script's pure parts run from `apps-script/Code.gs` itself (`tests/apps-script.test.mjs`).

## Published
Available on iOS via TestFlight. Built and deployed using Expo EAS.

## Setup
1. Clone the repo
2. Run `npm install`
3. Run `npx expo start`

## Naming: why some IDs still say "cleanerapp"
The app was called CleanerApp before it was TurnTrack. Everything people see says TurnTrack. These identifiers keep the old name **on purpose** — do not rename them:

| Identifier | Where | Why it stays |
| --- | --- | --- |
| `com.mason.cleanerapp` | `app.json` iOS `bundleIdentifier`, Android `package` | It *is* the app's identity. A new one is a different app: every installed phone stops getting updates and TestFlight starts over. |
| `cleanerapp-3f196` | `firebase.ts`, `apps-script/Code.gs`, `firestore.rules`, the Airbnb sync | Firebase project IDs can never be renamed. |
| `CleanerApp` | `app.json` `slug` | The Expo/EAS project's slug. OTA updates and builds are tied to that project. |
| `cleanerapp` | `app.json` `scheme` | The deep-link URL scheme, compiled into installed builds. Nothing user-facing uses it. |

The App Store Connect record is named **TurnTrack Crew** because another App Store app already holds "TurnTrack". That name only shows in App Store Connect and TestFlight; the phone's home screen uses `app.json` `name` (TurnTrack).

## Security
Current state: every client signs in anonymously and `firestore.rules` requires that sign-in, but anonymous sign-in only proves "some client of this project": the web API key that mints it is public, so anyone who has it can still read and write the database, door codes included. Locking it down properly (roles from a server, PINs checked server-side, App Check) is the open item in [SECURITY_SETUP.md](./SECURITY_SETUP.md). The app no longer calls any AI service: calendar scanning was removed on 2026-10-26 and its Anthropic key deleted.