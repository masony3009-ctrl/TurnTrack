import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

// Short, rare haptics per Apple's guidance: outcomes and selections only.
const enabled = Platform.OS !== "web";

export function tapSelect() {
  if (!enabled) return;
  Haptics.selectionAsync().catch(() => {});
}

export function tapSuccess() {
  if (!enabled) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export function tapWarning() {
  if (!enabled) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}

export function tapImpact() {
  if (!enabled) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}
