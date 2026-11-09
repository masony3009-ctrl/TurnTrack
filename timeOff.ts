// Time a cleaner has blocked out: whole days, a few days in a row, or the
// same days every week, either all day or just part of it. Stored on the
// cleaner's own employee record, so every phone already has it and the owner
// can see who can't work before handing a cleaning out.
//
// Pure (no React, no Firebase) so it runs under node --test.

import { CLEANING_HOURS } from "./calendarEvent.ts";
import { formatTime, isTime } from "./jobTime.ts";
import { addDaysToKey } from "./schedule.ts";
import { dateFromKey, formatShortDate } from "./turnover.ts";

export type TimeOff = {
  id: string;
  // First day off, "YYYY-MM-DD".
  start: string;
  // Last day off, inclusive. Null only for a weekly block, which repeats
  // until it's removed.
  end: string | null;
  // Set for a weekly block: the days of the week it repeats on (0 = Sunday).
  weekdays: number[] | null;
  // Part of the day, "HH:MM" to "HH:MM". Both null = all day.
  from: string | null;
  to: string | null;
  // The cleaner's reason, if they gave one. Only they and the owner see it.
  note: string | null;
  createdAt: number;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: unknown): v is string => typeof v === "string" && DAY.test(v) && dateFromKey(v) !== null;
const isWeekday = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 6;

export function isTimeOff(value: unknown): value is TimeOff {
  if (typeof value !== "object" || value === null) return false;
  const t = value as Record<string, unknown>;
  if (typeof t.id !== "string" || !isDay(t.start)) return false;
  const days = t.weekdays;
  const weekly = Array.isArray(days) && days.length > 0 && days.every(isWeekday);
  if (days !== null && !weekly) return false;
  // Only a weekly block may run on with no last day.
  if (t.end === null ? !weekly : !isDay(t.end) || t.end < t.start) return false;
  const timed = isTime(t.from) && isTime(t.to);
  if (!timed && (t.from !== null || t.to !== null)) return false;
  return t.note === null || typeof t.note === "string";
}

// A cleaner's blocks, with anything malformed dropped. Returns the stored
// objects themselves, so they can be handed straight to arrayRemove.
export function timeOffOf(employee: { timeOff?: unknown } | null | undefined): TimeOff[] {
  const list = employee?.timeOff;
  return Array.isArray(list) ? list.filter(isTimeOff) : [];
}

export function isAllDay(t: TimeOff): boolean {
  return t.from === null || t.to === null;
}

function weekdayOf(key: string): number {
  return (dateFromKey(key) as Date).getDay();
}

export function coversDay(t: TimeOff, key: string): boolean {
  if (key < t.start || (t.end !== null && key > t.end)) return false;
  return t.weekdays ? t.weekdays.includes(weekdayOf(key)) : true;
}

export function blocksOn(list: TimeOff[], key: string): TimeOff[] {
  return list.filter(t => coversDay(t, key)).sort(byStart);
}

export function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function byStart(a: TimeOff, b: TimeOff): number {
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  return (a.from || "").localeCompare(b.from || "");
}

// Whether a cleaning on this day (at this start time, if it has one) runs into
// the cleaner's time off. "blocking" means they said they can't work then: an
// all-day block, or hours that overlap the cleaning. A cleaning with no set
// time on a day they're busy for part of it isn't blocking, just worth a look.
export type Conflict = { block: TimeOff; blocking: boolean };

export function conflictFor(list: TimeOff[], key: string | null, time?: string | null, hours = CLEANING_HOURS): Conflict | null {
  if (!key) return null;
  const blocks = blocksOn(list, key);
  const allDay = blocks.find(isAllDay);
  if (allDay) return { block: allDay, blocking: true };
  if (blocks.length === 0) return null;
  if (!isTime(time)) return { block: blocks[0], blocking: false };
  const start = minutesOf(time);
  const end = start + hours * 60;
  const overlap = blocks.find(t => start < minutesOf(t.to as string) && minutesOf(t.from as string) < end);
  return overlap ? { block: overlap, blocking: true } : null;
}

// "All day" / "8:00 AM – 12:00 PM"
export function hoursLabel(t: TimeOff): string {
  if (isAllDay(t)) return "All day";
  return `${formatTime(t.from)} – ${formatTime(t.to)}`;
}

// "8–12" / "12:30–5": fits a calendar cell. All day -> "off".
export function shortHours(t: TimeOff): string {
  if (isAllDay(t)) return "off";
  const short = (time: string) => {
    const [h, m] = time.split(":").map(Number);
    return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
  };
  return `${short(t.from as string)}–${short(t.to as string)}`;
}

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function listWords(words: string[]): string {
  if (words.length <= 2) return words.join(" & ");
  return `${words.slice(0, -1).join(", ")} & ${words[words.length - 1]}`;
}

function weekdaysLabel(days: number[]): string {
  const set = [...new Set(days)].sort((a, b) => a - b);
  if (set.length === 7) return "Every day";
  if (set.join() === "1,2,3,4,5") return "Every weekday";
  if (set.join() === "0,6") return "Every weekend";
  return `Every ${listWords(set.map(d => DAY_SHORT[d]))}`;
}

// "Fri, Nov 13" / "Fri, Nov 13 – Mon, Nov 16" / "Every Tue & Thu" (with
// "from Nov 20" when a weekly block hasn't started yet).
export function datesLabel(t: TimeOff, today: string): string {
  if (t.weekdays) {
    const base = weekdaysLabel(t.weekdays);
    return t.start > today ? `${base}, from ${formatShortDate(t.start).slice(5)}` : base;
  }
  if (t.end === null || t.end === t.start) return formatShortDate(t.start);
  return `${formatShortDate(t.start)} – ${formatShortDate(t.end)}`;
}

// "Off all day · doctor" / "Busy 8:00 AM – 12:00 PM"
export function conflictText(c: Conflict): string {
  const what = isAllDay(c.block) ? "Off all day" : `Busy ${hoursLabel(c.block)}`;
  return c.block.note ? `${what} · ${c.block.note}` : what;
}

// Blocks that haven't ended yet, soonest first.
export function upcomingTimeOff(list: TimeOff[], today: string): TimeOff[] {
  return list.filter(t => t.end === null || t.end >= today).sort(byStart);
}

// Blocks that ended before today: dropped from the record whenever the
// cleaner removes one, so the list doesn't grow forever.
export function pastTimeOff(list: TimeOff[], today: string): TimeOff[] {
  return list.filter(t => t.end !== null && t.end < today);
}

export type TimeOffKind = "day" | "days" | "weekly";

export type TimeOffInput = {
  kind: TimeOffKind;
  start: string | null;
  end: string | null;
  weekdays: number[];
  allDay: boolean;
  from: string | null;
  to: string | null;
  note: string;
};

export const NOTE_MAX = 120;
// Longer than this is a leave of absence, not time off: deactivate them instead.
export const MAX_DAYS = 120;

// Turns the form into a block, or says what's missing.
export function buildTimeOff(input: TimeOffInput, id: string, now: number, today: string): { block: TimeOff } | { error: string } {
  if (!input.start) return { error: input.kind === "days" ? "Pick the first day." : "Pick the day." };
  let end: string | null = input.start;
  let weekdays: number[] | null = null;
  if (input.kind === "days") {
    if (!input.end) return { error: "Pick the last day." };
    if (input.end < input.start) return { error: "The last day can't be before the first." };
    if (input.end > addDaysToKey(input.start, MAX_DAYS)) return { error: `That's more than ${MAX_DAYS} days. Pick a shorter stretch.` };
    end = input.end;
  } else if (input.kind === "weekly") {
    if (input.weekdays.filter(isWeekday).length === 0) return { error: "Pick at least one day of the week." };
    weekdays = [...new Set(input.weekdays.filter(isWeekday))].sort((a, b) => a - b);
    end = null;
  }
  if (end !== null && end < today) return { error: "That's already passed. Pick today or a later day." };
  let from: string | null = null;
  let to: string | null = null;
  if (!input.allDay) {
    if (!isTime(input.from) || !isTime(input.to)) return { error: "Pick when you're busy from and until." };
    if (minutesOf(input.to) <= minutesOf(input.from)) return { error: "The end time has to be after the start time." };
    from = input.from;
    to = input.to;
  }
  const note = input.note.trim().slice(0, NOTE_MAX);
  return { block: { id, start: input.start, end, weekdays, from, to, note: note || null, createdAt: now } };
}

// The cleaner's own unfinished cleanings that the new block runs into, so
// they (and the owner) know blocking time didn't take them off anything.
export type ClashJob = { id: string; dateKey?: string | null; time?: string | null; done?: boolean; cancelled?: boolean };

export function clashingJobs<J extends ClashJob>(block: TimeOff, jobs: J[], today: string): J[] {
  return jobs.filter(j => {
    if (j.done || j.cancelled || !j.dateKey || j.dateKey < today) return false;
    return conflictFor([block], j.dateKey, j.time) !== null;
  });
}

// What the owner's phone says when a cleaner blocks time they're already
// booked for. Same shape as notifications.ts PushMessage.
export function clashMessage(cleaner: string, block: TimeOff, clashes: { id: string; house: string; dateKey: string }[], today: string) {
  const first = cleaner.split(" ")[0] || "A cleaner";
  const dates = datesLabel(block, today);
  // "can't work every Fri", not "can't work Every Fri".
  const when = `${block.weekdays ? dates[0].toLowerCase() + dates.slice(1) : dates}${isAllDay(block) ? "" : `, ${hoursLabel(block)}`}`;
  const houses = clashes.slice(0, 3).map(c => `${c.house} (${formatShortDate(c.dateKey)})`);
  const extra = clashes.length - houses.length;
  return {
    title: `${first} blocked out time they're booked for`,
    body: `${first} can't work ${when}${block.note ? ` (${block.note})` : ""}. Still on: ${houses.join(", ")}${extra > 0 ? ` and ${extra} more` : ""}.`,
    data: clashes.length === 1 ? { jobId: clashes[0].id } : {},
  };
}
