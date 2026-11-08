// A cleaning as an event for the phone's own calendar app, so a cleaner can
// tap the date on a job and keep it with the rest of their week.
// Nothing here imports app code, so `npm test` runs it straight under Node.
import { isTime } from "./jobTime.ts";

// How long a cleaning with a start time blocks out. The calendar's own
// sheet opens before anything is saved, so the cleaner can change it.
export const CLEANING_HOURS = 3;

// Job times are Phoenix time, which never shifts for daylight saving.
const PHOENIX = "America/Phoenix";
const PHOENIX_UTC_OFFSET_HOURS = 7;

export type CleaningEvent = {
  title: string;
  startDate: Date;
  endDate: Date;
  allDay: boolean;
  timeZone?: string;
  location: string;
  notes: string;
};

export type CleaningInfo = {
  dateKey: string | null;
  time?: string | null;
  house: string;
  address?: string | null;
  type?: string | null;
  sameDay?: boolean;
};

// The event for one cleaning: at its start time when it has one, otherwise
// all day. Door codes stay out of it, since calendars sync to other accounts.
export function cleaningEvent(c: CleaningInfo): CleaningEvent | null {
  const m = String(c.dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const notes = [
    c.type || "Cleaning",
    c.sameDay ? "Same-day turnover: clean between checkout and check-in." : null,
    "Codes and the checklist are in TurnTrack.",
  ].filter(Boolean).join("\n");
  const base = { title: `Cleaning · ${c.house}`, location: String(c.address || "").trim(), notes };
  if (isTime(c.time)) {
    const [h, min] = c.time.split(":").map(Number);
    const startDate = new Date(Date.UTC(y, mo, d, h + PHOENIX_UTC_OFFSET_HOURS, min));
    const endDate = new Date(startDate.getTime() + CLEANING_HOURS * 3600000);
    return { ...base, startDate, endDate, allDay: false, timeZone: PHOENIX };
  }
  const day = new Date(y, mo, d);
  return { ...base, startDate: day, endDate: day, allDay: true };
}

// Seconds from 2001-01-01 UTC, the date iOS's calshow: link counts from.
const APPLE_EPOCH_SECONDS = 978307200;

// "20261111T180000Z", or "20261111" for an all-day event.
function googleStamp(d: Date, allDay: boolean): string {
  if (allDay) {
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  }
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// A link that opens the phone's calendar at the cleaning's day. It's for app
// builds made before the add-event sheet, and for the web: there it's
// Google Calendar's new-event page with the cleaning filled in.
export function calendarLink(platform: string, e: CleaningEvent): string {
  if (platform === "ios") return `calshow:${Math.floor(e.startDate.getTime() / 1000) - APPLE_EPOCH_SECONDS}`;
  if (platform === "android") return `content://com.android.calendar/time/${e.startDate.getTime()}`;
  const end = e.allDay ? new Date(e.startDate.getFullYear(), e.startDate.getMonth(), e.startDate.getDate() + 1) : e.endDate;
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${googleStamp(e.startDate, e.allDay)}/${googleStamp(end, e.allDay)}`,
    location: e.location,
    details: e.notes,
  });
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}
