import { Alert, Linking, Platform } from "react-native";

// Opens the address in the phone's maps app. On iOS the https Apple Maps link
// opens the Maps app directly (no URL scheme to declare); Android's geo: link
// opens whichever maps app is installed; anything else gets Google Maps on the web.
export async function openInMaps(address: string) {
  const q = encodeURIComponent(address.trim());
  const web = `https://www.google.com/maps/search/?api=1&query=${q}`;
  const url = Platform.select({
    ios: `https://maps.apple.com/?q=${q}`,
    android: `geo:0,0?q=${q}`,
    default: web,
  }) as string;
  try {
    await Linking.openURL(url);
  } catch (e) {
    console.warn("open maps failed:", e);
    try {
      await Linking.openURL(web);
    } catch {
      Alert.alert("Couldn't open Maps", address);
    }
  }
}
