import { Linking, Platform } from "react-native";

// Opens the address in the phone's maps app. Apple Maps on iOS, Google Maps
// on Android, a Google Maps web link everywhere else.
export async function openInMaps(address: string) {
  const q = encodeURIComponent(address.trim());
  const url = Platform.select({
    ios: `maps:0,0?q=${q}`,
    android: `geo:0,0?q=${q}`,
    default: `https://www.google.com/maps/search/?api=1&query=${q}`,
  }) as string;
  try {
    const ok = await Linking.canOpenURL(url);
    await Linking.openURL(ok ? url : `https://www.google.com/maps/search/?api=1&query=${q}`);
  } catch (e) {
    console.warn("open maps failed:", e);
  }
}
