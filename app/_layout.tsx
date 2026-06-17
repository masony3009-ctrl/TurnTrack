import { Stack } from "expo-router";
import * as Updates from "expo-updates";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { auth } from "../firebase";

export default function Layout() {
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    async function checkForUpdates() {
      try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          await Updates.fetchUpdateAsync();
          await Updates.reloadAsync();
        }
      } catch (e) {
        console.log("Update check failed:", e);
      }
    }
    checkForUpdates();
  }, []);

  // Sign in anonymously before rendering any screen, so every Firestore
  // request is authenticated (required by firestore.rules). We wait for the
  // first auth state before showing the app to avoid permission-denied reads.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) setAuthReady(true);
    });
    signInAnonymously(auth).catch((e) => console.log("Anonymous sign-in failed:", e));
    return unsub;
  }, []);

  if (!authReady) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#E8F4FD" }}>
        <ActivityIndicator color="#1A7ABF" />
      </View>
    );
  }

  return (
    <Stack>
      <Stack.Screen name="scan-calendar" options={{ headerShown: false }} />
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="job" options={{ headerShown: false }} />
      <Stack.Screen name="gmail" options={{ headerShown: false }} />
      <Stack.Screen name="scan" options={{ headerShown: false }} />
      <Stack.Screen name="calendar" options={{ headerShown: false }} />
    </Stack>
  );
}
