import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { addDoc, collection, getDocs, query, where } from "firebase/firestore";
import { Platform } from "react-native";
import { db } from "./firebase";
import { hasSameDayTurnover, parseJobDateToDate } from "./turnover";

const isWeb = Platform.OS === "web";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotifications() {
  if (isWeb) return null;
  if (!Device.isDevice) return null;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") return null;

  const token = (await Notifications.getExpoPushTokenAsync()).data;

  const tokensRef = collection(db, "pushTokens");
  const existing = await getDocs(query(tokensRef, where("token", "==", token)));
  if (existing.empty) {
    await addDoc(tokensRef, { token });
  }

  return token;
}

export async function scheduleTodaysJobNotifications(jobs: any[]) {
  if (isWeb) return;
  await Notifications.cancelAllScheduledNotificationsAsync();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const next30Days = jobs.filter(job => {
    const jobDate = parseJobDateToDate(job.date);
    if (!jobDate) return false;
    jobDate.setHours(0, 0, 0, 0);
    const daysAhead = (jobDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
    return daysAhead >= 0 && daysAhead <= 30;
  });

  for (const job of next30Days) {
    const jobDate = parseJobDateToDate(job.date);
    if (!jobDate) continue;

    const sameDay = hasSameDayTurnover(job);
    const assignee = job.assignedToName ? ` (${job.assignedToName})` : " (unassigned)";
    const jobSummary = sameDay
      ? `${job.address} — same-day checkout and check-in${assignee}`
      : `${job.address} — ${job.type}${assignee}`;

    const morningNotif = new Date(jobDate);
    morningNotif.setHours(8, 0, 0, 0);

    const now = new Date();
    const isToday = jobDate.toDateString() === now.toDateString();

    if (isToday && morningNotif <= now) {
      const soonNotif = new Date(now.getTime() + 5 * 60 * 1000);
      await Notifications.scheduleNotificationAsync({
        content: {
          title: sameDay ? "Same-day turnover today!" : "Cleaning today!",
          body: jobSummary,
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: soonNotif,
        },
      });
    } else if (morningNotif > now) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: sameDay ? "Same-day turnover today!" : "Cleaning today!",
          body: jobSummary,
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: morningNotif,
        },
      });
    }

    const midnightNotif = new Date(jobDate);
    midnightNotif.setHours(0, 1, 0, 0);
    if (midnightNotif > now) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: sameDay ? "Same-day turnover scheduled today" : "Cleaning scheduled today",
          body: jobSummary,
          sound: true,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: midnightNotif,
        },
      });
    }
  }
}
export async function sendTestNotification() {
  if (isWeb) return;
  await Notifications.scheduleNotificationAsync({
    content: {
      title: "Test notification!",
      body: "TurnTrack notifications are working!",
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 5,
    },
  });
}
