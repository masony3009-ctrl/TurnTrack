import { initializeApp } from "firebase/app";
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