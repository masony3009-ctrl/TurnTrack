import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { collection, doc, getDocs, query, setDoc, where } from "firebase/firestore";
import { Platform } from "react-native";
import { db } from "./firebase";
import { hasSameDayTurnover, jobDate, jobDateKey } from "./turnover";
import { Job } from "./types";

const isWeb = Platform.OS === "web";
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// The token for this phone, once registered. Used to avoid pushing a
// notification back to the phone that triggered it.
let ownToken: string | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Registers for push and records the token on this phone's device record,
// so jobs can be pushed to whichever cleaner is signed in on this phone.
export async function registerForPushNotifications(deviceId?: string | null) {
  if (isWeb) return null;
  if (!Device.isDevice) return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "Cleanings",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") return null;

  let token: string;
  try {
    token = (await Notifications.getExpoPushTokenAsync()).data;
  } catch (e) {
    console.warn("push token failed:", e);
    return null;
  }
  ownToken = token;

  try {
    if (deviceId) {
      await setDoc(doc(db, "devices", deviceId), { pushToken: token }, { merge: true });
    }
  } catch (e) {
    console.warn("saving push token failed:", e);
  }

  return token;
}

export type PushMessage = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

// Sends a push to every phone currently signed in as this cleaner. Never
// throws: a failed notification must not block the assignment itself.
export async function sendPushToEmployee(employeeId: string, message: PushMessage): Promise<number> {
  try {
    const snap = await getDocs(query(collection(db, "devices"), where("employeeId", "==", employeeId)));
    const tokens = snap.docs
      .map(d => d.data().pushToken)
      .filter((t): t is string => typeof t === "string" && t.startsWith("ExponentPushToken") && t !== ownToken);
    if (tokens.length === 0) return 0;

    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(tokens.map(to => ({
        to,
        sound: "default",
        channelId: "default",
        title: message.title,
        body: message.body,
        data: message.data || {},
      }))),
    });
    if (!res.ok) console.warn("push send failed:", res.status);
    return tokens.length;
  } catch (e) {
    console.warn("push send failed:", e);
    return 0;
  }
}

function jobLine(job: Job): string {
  const sameDay = hasSameDayTurnover(job) ? " · same-day turnover" : "";
  return `${job.address} — ${job.date}${sameDay}`;
}

export function assignmentMessage(job: Job): PushMessage {
  return {
    title: "New cleaning assigned to you",
    body: jobLine(job),
    data: { jobId: job.id },
  };
}

export function unassignedMessage(job: Job): PushMessage {
  return {
    title: "Cleaning reassigned",
    body: `You're no longer on ${job.address} (${job.date}).`,
    data: { jobId: job.id },
  };
}

export function cancellationMessage(job: Job): PushMessage {
  return {
    title: "Cleaning cancelled",
    body: `${job.address} on ${job.date} was cancelled. No need to go.`,
    data: { jobId: job.id },
  };
}

// Local reminders for upcoming jobs. Reschedules only when the set of
// relevant jobs actually changes (not on every checklist tick), and a newer
// run always wins over one still in flight so cancelAll can't race.
let scheduleGeneration = 0;
let lastScheduleFingerprint = "";
const MAX_REMINDER_JOBS = 30; // iOS keeps at most 64 pending local notifications

export async function scheduleTodaysJobNotifications(jobs: Job[]) {
  if (isWeb) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcoming = jobs
    .filter(job => !job.cancelled && !job.done)
    .map(job => ({ job, date: jobDate(job) }))
    .filter((x): x is { job: Job; date: Date } => {
      if (!x.date) return false;
      const daysAhead = (x.date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
      return daysAhead >= 0 && daysAhead <= 30;
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, MAX_REMINDER_JOBS);

  const fingerprint = upcoming
    .map(({ job }) => [job.id, jobDateKey(job), job.address, job.type, job.assignedToName || "", job.sameDayTurnover ? 1 : 0].join("|"))
    .join("\n");
  if (fingerprint === lastScheduleFingerprint) return;
  lastScheduleFingerprint = fingerprint;

  const generation = ++scheduleGeneration;
  await Notifications.cancelAllScheduledNotificationsAsync();

  const now = new Date();
  for (const { job, date } of upcoming) {
    if (generation !== scheduleGeneration) return;

    const sameDay = hasSameDayTurnover(job);
    const assignee = job.assignedToName ? ` (${job.assignedToName})` : " (unassigned)";
    const jobSummary = sameDay
      ? `${job.address} — same-day checkout and check-in${assignee}`
      : `${job.address} — ${job.type}${assignee}`;
    const data = { jobId: job.id };

    const morning = new Date(date);
    morning.setHours(8, 0, 0, 0);
    if (morning > now) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: sameDay ? "Same-day turnover today!" : "Cleaning today!",
          body: jobSummary,
          sound: true,
          data,
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: morning },
      });
    }

    const midnight = new Date(date);
    midnight.setHours(0, 1, 0, 0);
    if (midnight > now) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: sameDay ? "Same-day turnover scheduled today" : "Cleaning scheduled today",
          body: jobSummary,
          sound: true,
          data,
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: midnight },
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

// Pulls the job id out of a tapped notification, if it carried one.
export function jobIdFromResponse(response: Notifications.NotificationResponse | null | undefined): string | null {
  const jobId = response?.notification?.request?.content?.data?.jobId;
  return typeof jobId === "string" && jobId ? jobId : null;
}
