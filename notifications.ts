import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { addDoc, collection, getDocs, query, where } from "firebase/firestore";
import { db } from "./firebase";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
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

export async function scheduleTodaysJobNotifications(jobs: any[]) {
  await Notifications.cancelAllScheduledNotificationsAsync();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const next30Days = jobs.filter(job => {
    const jobDate = parseJobDate(job.date);
    if (!jobDate) return false;
    jobDate.setHours(0, 0, 0, 0);
    const daysAhead = (jobDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
    return daysAhead >= 0 && daysAhead <= 30;
  });

  for (const job of next30Days) {
    const jobDate = parseJobDate(job.date);
    if (!jobDate) continue;

    const jobSummary = `${job.address} — ${job.type}`;

    const morningNotif = new Date(jobDate);
    morningNotif.setHours(8, 0, 0, 0);

    const now = new Date();
    const isToday = jobDate.toDateString() === now.toDateString();

    if (isToday && morningNotif <= now) {
      const soonNotif = new Date(now.getTime() + 5 * 60 * 1000);
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Cleaning today!",
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
          title: "Cleaning today!",
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
          title: "Cleaning scheduled today",
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
export async function debugNotifications(jobs: any[]) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  console.log("Today is:", today.toDateString());
  console.log("Total jobs:", jobs.length);
  
  jobs.forEach(job => {
    const parsed = parseJobDate(job.date);
    console.log(`Job: "${job.date}" → parsed: ${parsed ? parsed.toDateString() : "NULL"}`);
    if (parsed) {
      parsed.setHours(0, 0, 0, 0);
      const daysAhead = (parsed.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
      console.log(`  Days ahead: ${daysAhead}`);
    }
  });
}
export async function sendTestNotification() {
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