import { Ionicons } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import { type ErrorBoundaryProps, router, Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as Updates from "expo-updates";
import { useEffect, useRef } from "react";
import { ActivityIndicator, AppState, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { ProfileGate } from "../components/ProfileGate";
import { ProfileProvider, useProfile } from "../components/ProfileProvider";
import { filterFromResponse, jobIdFromResponse } from "../notifications";
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
    // instead of stacking a second copy. A notification about several
    // cleanings opens the Jobs list on the matching filter instead.
    const open = (response: Notifications.NotificationResponse | null) => {
      const jobId = jobIdFromResponse(response);
      const filter = filterFromResponse(response);
      if (jobId) router.navigate({ pathname: "/job", params: { id: jobId } });
      else if (filter) router.navigate({ pathname: "/", params: { filter, at: String(Date.now()) } });
    };

    const sub = Notifications.addNotificationResponseReceivedListener(open);

    if (!handledCold.current) {
      handledCold.current = true;
      Notifications.getLastNotificationResponseAsync()
        .then(open)
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
        <Stack.Screen name="assign" />
      </Stack>
      <ViewingAsBanner />
    </View>
  );
}

// A crash anywhere below shows this instead of a dead white screen, with a way
// back in. One bad record must not take the app down for the whole crew.
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View style={styles.splash}>
      <Text style={type.wordmark}>TurnTrack</Text>
      <Text style={styles.splashMessage}>Something on this screen broke. Your saved work is safe on the server.</Text>
      <Text style={styles.errorDetail} numberOfLines={3}>{error.message}</Text>
      <TouchableOpacity style={styles.retryBtn} onPress={retry} accessibilityRole="button">
        <Text style={styles.retryText}>Try again</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function Layout() {
  // Download updates quietly and apply one when the app next comes back to
  // the front, not seconds after opening it, mid-tap or mid-save.
  useEffect(() => {
    let ready = false;
    let wentAway = false;
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background") wentAway = true;
      if (next === "active" && wentAway && ready) {
        Updates.reloadAsync().catch((e) => console.log("Applying update failed:", e));
      }
    });
    (async () => {
      try {
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          await Updates.fetchUpdateAsync();
          ready = true;
        }
      } catch (e) {
        console.log("Update check failed:", e);
      }
    })();
    return () => sub.remove();
  }, []);

  return (
    <ProfileProvider>
      {/* The app is light-only, so status bar text stays dark even in dark mode. */}
      <StatusBar style="dark" />
      <GatedApp />
    </ProfileProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 },
  splashMessage: { fontSize: 14.5, color: colors.muted, textAlign: "center", lineHeight: 21, marginTop: 14 },
  errorDetail: { fontSize: 12, color: colors.faint, textAlign: "center", marginTop: 8 },
  retryBtn: { marginTop: 18, minHeight: 44, paddingHorizontal: 22, borderRadius: radius.pill, backgroundColor: colors.teal, justifyContent: "center" },
  retryText: { color: colors.white, fontSize: 15, fontWeight: "700" },
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
