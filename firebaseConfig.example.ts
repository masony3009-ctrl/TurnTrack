import { initializeApp } from "firebase/app";
// getReactNativePersistence is only present in the React Native build of
// @firebase/auth, so it's imported from the package directly (the `firebase/auth`
// umbrella ships web types that omit it). tsconfig's react-native condition
// resolves this correctly.
import { getReactNativePersistence } from "@firebase/auth";
import ReactNativeAsyncStorage from "@react-native-async-storage/async-storage";
import { initializeAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getFunctions } from "firebase/functions";

// Copy this file to `firebase.ts` and fill in your real Firebase web config.
// `firebase.ts` is gitignored so your config stays out of version control.
// NOTE: a real `apiKey` is required for Firebase Auth to work — the blank
// value will fail.
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_AUTH_DOMAIN",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_STORAGE_BUCKET",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
// Persist the signed-in session across app restarts so users log in once.
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(ReactNativeAsyncStorage),
});
export const functions = getFunctions(app);
