import { Stack } from "expo-router";
import * as Updates from "expo-updates";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { ProfileGate } from "../components/ProfileGate";
import { ProfileProvider, useProfile } from "../components/ProfileProvider";
import { colors, type } from "../theme";

function Splash({ message }: { message?: string }) {
  return (
    <View style={styles.splash}>
      <Text style={type.wordmark}>TurnTrack</Text>
      {message ? (
        <Text style={styles.splashMessage}>{message}</Text>
      ) : (
        <ActivityIndicator color={colors.teal} style={{ marginTop: 16 }} />
      )}
    </View>
  );
}

function GatedApp() {
  const { state } = useProfile();

  if (state.status === "loading") return <Splash />;
  if (state.status === "error") {
    return (
      <Splash message="Can't reach the database. Check your connection and the Firestore security rules, then reopen the app." />
    );
  }
  if (state.status === "unset") return <ProfileGate />;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="job" />
      <Stack.Screen name="scan-calendar" />
      <Stack.Screen name="gmail" />
      <Stack.Screen name="scan" />
    </Stack>
  );
}

export default function Layout() {
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

  return (
    <ProfileProvider>
      <GatedApp />
    </ProfileProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 },
  splashMessage: { fontSize: 14.5, color: colors.muted, textAlign: "center", lineHeight: 21, marginTop: 14 },
});
