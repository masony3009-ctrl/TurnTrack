import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, StyleSheet, Text, View } from "react-native";
import { PushRegistration, registerForPushNotifications } from "../notifications";
import { colors } from "../theme";
import { alertSoon, BrandButton, Card } from "./ui";

// Signs this phone up for pushes once its device id is known, and again
// whenever the app comes back to the foreground while that hasn't worked -
// so turning notifications on in Settings clears the warning by itself.
export function usePushRegistration(deviceId: string | null) {
  const [result, setResult] = useState<PushRegistration | null>(null);
  const [checking, setChecking] = useState(false);
  // A newer attempt wins over one still in flight.
  const generation = useRef(0);

  const register = useCallback(async () => {
    const attempt = ++generation.current;
    setChecking(true);
    const next = await registerForPushNotifications(deviceId);
    if (attempt !== generation.current) return;
    setResult(next);
    setChecking(false);
  }, [deviceId]);

  useEffect(() => {
    register();
  }, [register]);

  const broken = result?.status === "denied" || result?.status === "failed";
  useEffect(() => {
    if (!broken) return;
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") register();
    });
    return () => sub.remove();
  }, [broken, register]);

  return { result, checking, retry: register };
}

function openSettings() {
  Linking.openSettings().catch(() => {
    alertSoon("Couldn't open Settings", "Open the phone's Settings app, then Apps → TurnTrack → Notifications, and turn them on.");
  });
}

// Shown at the top of the Jobs screen while this phone can't receive pushes,
// so nobody assumes they'll hear about a new or changed cleaning.
export function PushProblemCard({ result, checking, onRetry }: {
  result: PushRegistration | null;
  checking: boolean;
  onRetry: () => void;
}) {
  if (result?.status !== "denied" && result?.status !== "failed") return null;
  const denied = result.status === "denied";
  return (
    <Card tone="danger" style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="notifications-off" size={18} color={colors.danger} />
        <Text style={styles.title}>This phone won&apos;t get TurnTrack alerts</Text>
      </View>
      <Text style={styles.body} numberOfLines={5}>
        {denied
          ? "Notifications are turned off for TurnTrack. Turn them on so you hear about new, changed and finished cleanings."
          : `Signing up for alerts failed: ${result.reason}`}
      </Text>
      {denied ? (
        <BrandButton label="Open settings" icon="settings-outline" variant="outline" compact onPress={openSettings} style={styles.button} />
      ) : (
        <BrandButton
          label={checking ? "Trying again…" : "Try again"}
          icon="refresh"
          variant="outline"
          compact
          onPress={onRetry}
          disabled={checking}
          style={styles.button}
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.danger },
  body: { fontSize: 13.5, color: colors.muted, lineHeight: 19, marginTop: 6 },
  button: { marginTop: 12, alignSelf: "flex-start" },
});
