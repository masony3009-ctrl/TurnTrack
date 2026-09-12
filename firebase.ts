import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, type Auth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBpSJEixry1qJBWrsvS_Azlf40GWnOGCcE",
  authDomain: "cleanerapp-3f196.firebaseapp.com",
  projectId: "cleanerapp-3f196",
  storageBucket: "cleanerapp-3f196.firebasestorage.app",
  messagingSenderId: "396461166521",
  appId: "1:396461166521:web:a5acb7041d796a2da87068"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth: Auth = getAuth(app);

// Anonymous sign-in is what lets the Firestore rules require request.auth.
// It says "someone running this app", not who they are - the app's own PIN
// gate is still what separates the owner from the crew.
//
// Persistence is in-memory (AsyncStorage is not installed, and adding it means
// a new native build), so each launch mints a fresh anonymous user. That is
// fine for a rule that only checks that a caller is authenticated at all.
//
// One shared promise: every caller awaits the same sign-in rather than racing
// to start their own.
let pending: Promise<void> | null = null;

export function ensureSignedIn(): Promise<void> {
  if (auth.currentUser) return Promise.resolve();
  if (!pending) {
    pending = signInAnonymously(auth)
      .then(() => undefined)
      .catch((e) => {
        // Clear it so a later attempt can retry rather than reusing a
        // rejected promise forever.
        pending = null;
        throw e;
      });
  }
  return pending;
}
