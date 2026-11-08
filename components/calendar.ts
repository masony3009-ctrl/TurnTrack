import { requireOptionalNativeModule } from "expo";
import { Alert, Linking, Platform } from "react-native";
import { calendarLink, type CleaningEvent } from "../calendarEvent";

// Opens the phone's calendar with the cleaning filled in and ready to save,
// the way tapping the address opens Maps. App builds from before the calendar
// module was added don't have it, so those open the calendar at that day.
export async function addToCalendar(event: CleaningEvent) {
  if (Platform.OS !== "web" && requireOptionalNativeModule("ExpoCalendar")) {
    try {
      const Calendar = await import("expo-calendar");
      await Calendar.createEventInCalendarAsync({
        title: event.title,
        startDate: event.startDate,
        endDate: event.endDate,
        allDay: event.allDay,
        timeZone: event.timeZone,
        location: event.location,
        notes: event.notes,
      });
      return;
    } catch (e) {
      console.warn("add to calendar failed:", e);
    }
  }
  try {
    await Linking.openURL(calendarLink(Platform.OS, event));
  } catch (e) {
    console.warn("open calendar failed:", e);
    Alert.alert("Couldn't open your calendar", "Add this cleaning to your calendar by hand for now.");
  }
}
