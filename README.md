\# TurnTrack

A cross-platform mobile app (iOS & Android) built to automate job scheduling for an Airbnb cleaning business.

## What it does
- Automatically scans Airbnb and Turno booking emails and adds cleaning jobs to a shared calendar
- Real-time sync between multiple phones via Firebase Firestore
- Push notifications on the day of each cleaning
- Calendar view with job details and completion tracking
- Jobs automatically disappear 24 hours after being marked done

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