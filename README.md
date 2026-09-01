\# TurnTrack

A cross-platform mobile app (iOS & Android) built to automate job scheduling for an Airbnb cleaning business.

## What it does
- Automatically scans Airbnb and Turno booking emails and adds cleaning jobs to a shared calendar
- Real-time sync between multiple phones via Firebase Firestore
- Push notifications on the day of each cleaning
- Calendar view with job details and completion tracking
- Jobs automatically disappear 24 hours after being marked done

## Crew management (Team, assignments, time tracking, payroll)
- **Team screen** — add cleaners with an hourly rate, phone, and Zelle contact; deactivate or delete them
- **Assignments** — assign any job to a cleaner from the job detail screen; the assignee shows on job cards, the calendar, and day-of notifications
- **Time tracking** — Start cleaning / Finish cleaning timer on each job; finishing logs a time entry (minutes × the cleaner's hourly rate) and marks the job done
- **Checklist** — each job carries its own tappable checklist with progress tracking
- **Payroll screen** — unpaid hours and amount owed per cleaner, mark-paid-via-Zelle (with a copy-Zelle-contact button), manual time corrections, and paid history

Firestore collections: `jobs`, `pushTokens`, `employees`, `timeEntries`. The security rules must allow read/write on all four.

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
3. Copy `firebaseConfig.example.ts` to `firebaseConfig.ts` and add your Firebase credentials
4. Run `npx expo start`