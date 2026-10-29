import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { collection, deleteField, doc, getDocs, query, setDoc, where } from "firebase/firestore";
import { Platform } from "react-native";
import { db } from "./firebase";
import { digestBody } from "./assign";
import { reminderAt, withTime } from "./jobTime";
import { formatClockTime } from "./payroll";
import { finishReportText } from "./supplies";
import { formatShortDate, hasSameDayTurnover, jobDate, jobDateKey, sortByDate } from "./turnover";
import { Job } from "./types";

const isWeb = Platform.OS === "web";
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

// The token for this phone, once registered. Used to avoid pushing a
// notification back to the phone that triggered it.
let ownToken: string | null = null;

// True once this phone's device record holds its token and says
// serverReminders. From then on the morning "Cleaning today!" reminders come
// from the website Worker (src/reminders.js there), which reads the schedule
// as each one goes out, so a cleaning moved overnight never announces itself
// on its old day. A phone that can't get a token keeps scheduling its own.
let serverReminders = false;

// What a device record needs for pushes, and the server's reminders, to reach
// this phone. Rewriting the record (switching profiles) must carry these over.
export function pushRecordFields(): { pushToken?: string; serverReminders?: true } {
  return ownToken && serverReminders ? { pushToken: ownToken, serverReminders: true } : {};
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// How signing this phone up for pushes went. "unsupported" is web or a
// simulator, where there is nothing to fix.
export type PushRegistration =
  | { status: "registered"; token: string }
  | { status: "unsupported" }
  | { status: "denied" }
  | { status: "failed"; reason: string };

const DENIED_REASON = "Notifications are turned off for TurnTrack in this phone's settings.";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Registers for push and records the token on this phone's device record,
// so jobs can be pushed to whichever cleaner is signed in on this phone.
// Never fails quietly: a phone that can't get a token says why, both to the
// caller (to show on screen) and on its device record as pushError, so a
// phone that never hears anything can be diagnosed from Firestore.
export async function registerForPushNotifications(deviceId?: string | null): Promise<PushRegistration> {
  if (isWeb || !Device.isDevice) return { status: "unsupported" };

  const result = await obtainPushToken();
  if (result.status === "registered") ownToken = result.token;
  if (!deviceId) return result;
  return recordRegistration(deviceId, result);
}

async function obtainPushToken(): Promise<PushRegistration> {
  try {
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
    if (finalStatus !== "granted") return { status: "denied" };

    // On Android this throws when the build has no FCM config
    // (android.googleServicesFile) - the reason the dad's phone never had a token.
    const token = (await Notifications.getExpoPushTokenAsync()).data;
    return { status: "registered", token };
  } catch (e) {
    console.warn("push registration failed:", e);
    return { status: "failed", reason: errorText(e) };
  }
}

async function recordRegistration(deviceId: string, result: PushRegistration): Promise<PushRegistration> {
  const ref = doc(db, "devices", deviceId);
  if (result.status === "registered") {
    try {
      await setDoc(ref, { pushToken: result.token, serverReminders: true, pushError: deleteField(), pushErrorAt: deleteField() }, { merge: true });
      if (!serverReminders) {
        serverReminders = true;
        // Drop the reminders this phone scheduled before it knew.
        await clearScheduledReminders();
      }
      return result;
    } catch (e) {
      console.warn("saving push token failed:", e);
      return { status: "failed", reason: `Couldn't save this phone's push token: ${errorText(e)}` };
    }
  }
  if (result.status === "unsupported") return result;

  const pushError = result.status === "denied" ? DENIED_REASON : result.reason;
  try {
    await setDoc(ref, { pushError, pushErrorAt: Date.now(), serverReminders: deleteField() }, { merge: true });
  } catch (e) {
    // The caller still shows the problem on screen.
    console.warn("saving push error failed:", e);
  }
  return result;
}

export type PushMessage = {
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

// Sends a push to every phone currently signed in as this cleaner. Never
// throws: a failed notification must not block the assignment itself.
export async function sendPushToEmployee(employeeId: string, message: PushMessage): Promise<number> {
  return sendPushToDevices(where("employeeId", "==", employeeId), message);
}

// Sends a push to every phone signed in as the owner. Never throws: a failed
// notification must not block the checklist tick that triggered it.
export async function sendPushToOwners(message: PushMessage): Promise<number> {
  return sendPushToDevices(where("role", "==", "owner"), message);
}

// Sends a push to every phone signed in as one of these cleaners (the active
// crew). Returns how many phones took it. Never throws.
export async function sendPushToCrew(employeeIds: string[], message: PushMessage): Promise<number> {
  const crew = new Set(employeeIds);
  return sendPushToDevices(where("role", "==", "cleaner"), message, data => crew.has(data.employeeId));
}

async function sendPushToDevices(
  filter: ReturnType<typeof where>,
  message: PushMessage,
  keep: (data: Record<string, any>) => boolean = () => true
): Promise<number> {
  try {
    const snap = await getDocs(query(collection(db, "devices"), filter));
    const tokens = snap.docs
      .map(d => d.data())
      .filter(keep)
      .map(data => data.pushToken)
      .filter((t): t is string => typeof t === "string" && t.startsWith("ExponentPushToken") && t !== ownToken);
    if (tokens.length === 0) return 0;

    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(tokens.map(to => ({
        to,
        sound: "default",
        channelId: "default",
        // Android holds normal-priority pushes while the phone dozes.
        priority: "high",
        title: message.title,
        body: message.body,
        data: message.data || {},
      }))),
    });
    if (!res.ok) {
      console.warn("push send failed:", res.status);
      return 0;
    }
    // Expo answers 200 even when single messages fail; count only the ones it took.
    const body = await res.json().catch(() => null);
    const tickets: { status?: string; message?: string }[] = Array.isArray(body?.data) ? body.data : [];
    tickets.filter(t => t.status !== "ok").forEach(t => console.warn("push not accepted:", t.message));
    return tickets.length ? tickets.filter(t => t.status === "ok").length : tokens.length;
  } catch (e) {
    console.warn("push send failed:", e);
    return 0;
  }
}

function jobLine(job: Job): string {
  const sameDay = hasSameDayTurnover(job) ? " · same-day turnover" : "";
  return `${job.address} — ${withTime(job.date, job.time)}${sameDay}`;
}

// The owner changed when a cleaning happens; tell whoever is on it.
export function movedMessage(job: Job): PushMessage {
  return {
    title: "Cleaning moved",
    body: `${job.address} is now ${withTime(job.date, job.time)}.`,
    data: { jobId: job.id },
  };
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

// "Bathroom 1 done" / "Marcus · Desert Oasis · 10:58 AM · 17 min"
export function roomDoneMessage(job: Job, room: { title: string; minutes: number | null; by: string | null; at: number; house: string }): PushMessage {
  const who = room.by ? room.by.split(" ")[0] : null;
  const parts = [who, room.house, formatClockTime(room.at), room.minutes ? `${room.minutes} min` : null];
  return {
    title: `${room.title} done`,
    body: parts.filter(Boolean).join(" · "),
    data: { jobId: job.id },
  };
}

// "Cleaning needs a cleaner" / "Marcus gave back Ranger Trail · Sat, Oct 17 2026"
export function givenBackMessage(job: Job, by: string | null, house: string): PushMessage {
  const who = by ? by.split(" ")[0] : "A cleaner";
  return {
    title: "Cleaning needs a cleaner",
    body: `${who} gave back ${house} · ${job.date}`,
    data: { jobId: job.id },
  };
}

// A cleaner threw a running timer away; the owner should know time went unlogged.
export function discardedMessage(job: Job, by: string | null, minutes: number, house: string): PushMessage {
  const who = by ? by.split(" ")[0] : "A cleaner";
  return {
    title: "Timer discarded",
    body: `${who} discarded ${minutes} min on ${house} · ${job.date}. No time was logged.`,
    data: { jobId: job.id },
  };
}

// What a cleaner left at the finish: a note (damage, skipped steps) and/or
// supplies running low.
export function finishReportMessage(
  job: Job,
  report: { by: string | null; note: { text: string; skipped: number } | null; supplies: string[] },
  house: string
): PushMessage {
  const who = report.by ? report.by.split(" ")[0] : "The cleaner";
  return { ...finishReportText(who, house, report.note, report.supplies), data: { jobId: job.id } };
}

// Several cleanings handed to one cleaner in one sitting: one notification,
// not one per job. Tapping it opens their jobs.
export function assignmentDigestMessage(jobs: Job[], houseOf: (job: Job) => string): PushMessage {
  return {
    title: `${jobs.length} new cleanings assigned to you`,
    body: digestBody(sortByDate(jobs).map(j => {
      const key = jobDateKey(j);
      return { house: houseOf(j), date: key ? formatShortDate(key) : j.date };
    })),
    data: { screen: "mine" },
  };
}

// The owner asking the crew to pick up cleanings nobody has yet.
export function openJobsMessage(counts: { week: number; next: number; later: number }): PushMessage {
  const parts = [
    counts.week ? `${counts.week} this week` : null,
    counts.next ? `${counts.next} next week` : null,
    counts.later ? `${counts.later} after that` : null,
  ].filter(Boolean);
  return {
    title: "Open cleanings need someone",
    body: `${parts.join(", ")}. Tap to see them and take one.`,
    data: { screen: "open" },
  };
}

export function cancellationMessage(job: Job): PushMessage {
  return {
    title: "Cleaning cancelled",
    body: `${job.address} on ${job.date} was cancelled. No need to go.`,
    data: { jobId: job.id },
  };
}

// Local reminders for upcoming jobs, only on a phone the server doesn't
// remind (see serverReminders). Reschedules only when the set of relevant
// jobs actually changes (not on every checklist tick), and a newer run always
// wins over one still in flight so cancelAll can't race.
let scheduleGeneration = 0;
let lastScheduleFingerprint = "";
const MAX_REMINDER_JOBS = 30; // iOS keeps at most 64 pending local notifications

// Clears this phone's scheduled reminders, for a sign-out or a removed cleaner:
// a phone nobody uses for TurnTrack shouldn't keep announcing cleanings.
export async function clearScheduledReminders() {
  if (isWeb) return;
  lastScheduleFingerprint = "";
  scheduleGeneration++;
  await Notifications.cancelAllScheduledNotificationsAsync().catch(e => console.warn("clearing reminders failed:", e));
}

export async function scheduleTodaysJobNotifications(jobs: Job[]) {
  if (isWeb || serverReminders) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcoming = jobs
    .filter(job => !job.cancelled && !job.done && !job.pending)
    .map(job => ({ job, date: jobDate(job) }))
    .filter((x): x is { job: Job; date: Date } => {
      if (!x.date) return false;
      const daysAhead = (x.date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
      return daysAhead >= 0 && daysAhead <= 30;
    })
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, MAX_REMINDER_JOBS);

  const fingerprint = upcoming
    .map(({ job }) => [job.id, jobDateKey(job), job.time || "", job.address, job.type, job.assignedToName || "", job.sameDayTurnover ? 1 : 0].join("|"))
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

    const morning = reminderAt(date, job.time);
    if (morning > now) {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: sameDay ? "Same-day turnover today!" : "Cleaning today!",
          body: jobSummary,
          sound: true,
          data,
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: morning },
      });
      // Cleared (or rescheduled) while this one was being set: take it back.
      if (generation !== scheduleGeneration) {
        await Notifications.cancelScheduledNotificationAsync(id).catch(e => console.warn("cancelling a stale reminder failed:", e));
        return;
      }
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

// A notification about a list rather than one job: which Jobs filter it opens.
export type JobsFilter = "open" | "mine";

export function filterFromResponse(response: Notifications.NotificationResponse | null | undefined): JobsFilter | null {
  const screen = response?.notification?.request?.content?.data?.screen;
  return screen === "open" || screen === "mine" ? screen : null;
}
