import { Ionicons } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import { router, Stack } from "expo-router";
import * as Updates from "expo-updates";
import { useEffect, useRef } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ProfileGate } from "../components/ProfileGate";
import { ProfileProvider, useProfile } from "../components/ProfileProvider";
import { jobIdFromResponse } from "../notifications";
import { cleanerColor, colors, radius, shadow, type } from "../theme";

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

// Opens the job a tapped notification points at: while the app is running,
// and on cold start from the notification that launched it.
function useNotificationTaps(ready: boolean) {
  const handledCold = useRef(false);

  useEffect(() => {
    if (Platform.OS === "web" || !ready) return;

    // navigate() lands on the existing job screen if it's already on top
    // instead of stacking a second copy.
    const open = (jobId: string | null) => {
      if (jobId) router.navigate({ pathname: "/job", params: { id: jobId } });
    };

    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      open(jobIdFromResponse(response));
    });

    if (!handledCold.current) {
      handledCold.current = true;
      Notifications.getLastNotificationResponseAsync()
        .then(response => open(jobIdFromResponse(response)))
        .catch(() => {});
    }

    return () => sub.remove();
  }, [ready]);
}

function ViewingAsBanner() {
  const { state, viewAs } = useProfile();
  if (state.status !== "cleaner" || !state.ownerViewing) return null;
  const color = cleanerColor(state.employee);
  return (
    <View style={[styles.banner, shadow.raised]}>
      <View style={[styles.bannerDot, { backgroundColor: color }]} />
      <Text style={styles.bannerText} numberOfLines={1}>
        Viewing as {state.employee.name.split(" ")[0]}
      </Text>
      <TouchableOpacity style={styles.bannerBtn} onPress={() => viewAs(null)} hitSlop={6}>
        <Ionicons name="arrow-undo" size={14} color={colors.dark} />
        <Text style={styles.bannerBtnText}>Back to owner</Text>
      </TouchableOpacity>
    </View>
  );
}

function GatedApp() {
  const { state } = useProfile();
  const signedIn = state.status === "owner" || state.status === "cleaner";
  useNotificationTaps(signedIn);

  if (state.status === "loading") return <Splash />;
  if (state.status === "error") {
    return (
      <Splash message="Can't reach the database. Check your connection and the Firestore security rules, then reopen the app." />
    );
  }
  if (state.status === "unset") return <ProfileGate />;

  return (
    <View style={{ flex: 1 }}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="job" />
        <Stack.Screen name="scan-calendar" />
        <Stack.Screen name="gmail" />
        <Stack.Screen name="scan" />
      </Stack>
      <ViewingAsBanner />
    </View>
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
  banner: {
    position: "absolute", left: 16, right: 16, bottom: 96,
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.dark, borderRadius: radius.pill, paddingVertical: 9, paddingHorizontal: 14,
  },
  bannerDot: { width: 10, height: 10, borderRadius: 5 },
  bannerText: { flex: 1, color: colors.white, fontSize: 13.5, fontWeight: "600" },
  bannerBtn: {
    flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: colors.white,
    borderRadius: radius.pill, paddingVertical: 5, paddingHorizontal: 10,
  },
  bannerBtnText: { color: colors.dark, fontSize: 12.5, fontWeight: "700" },
});
