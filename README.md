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
- **Checklist** — each job carries its own tappable checklist with progress tracking
- **Payroll screen** — unpaid hours and amount owed per cleaner, mark-paid-via-Zelle (with a copy-Zelle-contact button), manual time corrections, and paid history
- **Assignment pushes** — assigning a job sends a push notification to the cleaner's phone(s); tapping it opens the job. Reassigning tells the previous cleaner, cancelling tells the assignee
- **Checklist pop-up** — tapping Start cleaning opens the checklist as a sheet. The owner edits the template from the list icon on the Jobs tab (one item per line, stored at `settings/checklist`)
- **Cancellations** — the owner can cancel a job from its detail screen (or the email script can set `cancelled: true`). Cancelled jobs are hidden everywhere but kept in Firestore
- **Auto-cleanup** — jobs leave the phones 2 days after their cleaning date (`HIDE_AFTER_DAYS` in `turnover.ts`) but stay in Firestore
- **Cleaner colors** — each cleaner has a color (Team tab). Calendar dots, job cards, and avatars use it, with a legend under the calendar
- **Owner access** — the owner can open any cleaner's view without their PIN: "View as" on the Team tab, or the owner PIN on the sign-in screen

Firestore collections: `jobs`, `pushTokens`, `employees`, `timeEntries`, `devices` (one per phone: role, employee, push token), `settings` (`owner` PIN, `checklist` template). The security rules must allow read/write on all of them.

## Tech Stack
- **React Native** + **TypeScript** — cross-platform mobile (iOS & Android)
- **Expo** + **Expo Router** — framework and navigation
- **Firebase Firestore** — real-time cloud database
- **Google Apps Script** — serverless email automation pipeline
- **EAS Build** + **EAS Update** — App Store deployment and OTA updates

## How the automation works
A Google Apps Script runs every 15 minutes and searches Gmail for Airbnb reservation confirmations and Turno cleaning emails. It uses regex to extract checkout dates and property addresses, then sends them directly to Firebase via REST API. New jobs appear on both phones instantly with no manual input.

## Published
Available on iOS via TestFlight. Built and deployed using Expo EAS.

## Setup
1. Clone the repo
2. Run `npm install`
3. Run `npx expo start`

## Security
Current state: Firestore rules are open per-collection (no Firebase Auth; roles and PINs are enforced in the app UI), and the calendar-scan Anthropic key ships as an `EXPO_PUBLIC_` env var managed in EAS. A hardened setup — Anthropic key server-side in a Cloud Function, Firestore locked behind authentication — is drafted in [SECURITY_SETUP.md](./SECURITY_SETUP.md) and `functions/`, but is **not yet deployed** (it needs the Blaze plan, anonymous auth enabled, and the auth-required rules published together with an app build that signs in). `firestore.rules` in this repo mirrors what is actually deployed.