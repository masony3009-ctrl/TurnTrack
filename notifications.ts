import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { addDoc, collection, getDocs, query, where } from "firebase/firestore";
import { db } from "./firebaseConfig";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPushNotifications() {
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

function parseJobDate(dateStr: string): Date | null {
  const months: { [key: string]: number } = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
  };
  const m1 = dateStr.match(/([A-Za-z]+)\s+(\d+)\s+(\d{4})/);
  if (m1) return new Date(parseInt(m1[3]), months[m1[1].substring(0, 3)], parseInt(m1[2]));
  const m2 = dateStr.match(/([A-Za-z]+),\s+([A-Za-z]+)\s+(\d+)/);
  if (m2) return new Date(new Date().getFullYear(), months[m2[2].substring(0, 3)], parseInt(m2[3]));
  return null;
}

function parseStartTime(dateStr: string): { hours: number, minutes: number } | null {
  const match = dateStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return null;
  let hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const period = match[3].toUpperCase();
  if (period === "PM" && hours !== 12) hours += 12;
  if (period === "AM" && hours === 12) hours = 0;
  return { hours, minutes };
}

export async function scheduleTodaysJobNotifications(jobs: any[]) {
  await Notifications.cancelAllScheduledNotificationsAsync();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const next7Days = jobs.filter(job => {
    const jobDate = parseJobDate(job.date);
    if (!jobDate) return false;
    jobDate.setHours(0, 0, 0, 0);
    const daysAhead = (jobDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
    return daysAhead >= 0 && daysAhead <= 7;
  });

  for (const job of next7Days) {
    const jobDate = parseJobDate(job.date);
    if (!jobDate) continue;

    const jobSummary = `${job.address} — ${job.type}`;

    // 8:00 AM notification on the day of the job
    const morningNotif = new Date(jobDate);
    morningNotif.setHours(8, 0, 0, 0);
    if (morningNotif > new Date()) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Cleaning today!",
          body: jobSummary,
          sound: true,
        },
        trigger: {
          date: morningNotif,
        },
      });
    }

    // Also notify at midnight (12:01 AM)
    const midnightNotif = new Date(jobDate);
    midnightNotif.setHours(0, 1, 0, 0);
    if (midnightNotif > new Date()) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Cleaning scheduled today",
          body: jobSummary,
          sound: true,
        },
        trigger: {
          date: midnightNotif,
        },
      });
    }
  }
}