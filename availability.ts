// Whether each cleaner can take a cleaning, shown under their name wherever
// the owner hands cleanings out: time they blocked out comes first, then
// other cleanings they're already on that day.
//
// Pure (no React, no Firebase) so it runs under node --test.

import { CLEANING_HOURS } from "./calendarEvent.ts";
import { crewOf } from "./crew.ts";
import { formatTime, isTime } from "./jobTime.ts";
import { countsAsCleaning, type ScheduleJob } from "./schedule.ts";
import { conflictFor, conflictText, isAllDay, minutesOf, shortHours, timeOffOf, type Conflict } from "./timeOff.ts";
import { jobDateKey } from "./turnover.ts";

export type BookedJob = ScheduleJob & { id: string; assignedTo?: string | null; crew?: string[] | null; done?: boolean; time?: string | null };

export type Availability<J extends BookedJob = BookedJob> =
  // They said they can't work then.
  | { kind: "off"; conflict: Conflict }
  // Already on a cleaning whose hours run into this one.
  | { kind: "booked"; job: J }
  // Busy part of the day, and this cleaning has no set time to check against.
  | { kind: "partly"; conflict: Conflict }
  // Nothing in the way. sameDay = other cleanings they already have that day.
  | { kind: "free"; sameDay: number };

// off = blocked out all day, partial = blocked out part of the day,
// warn = on another cleaning then.
export type AvailabilityTone = "off" | "partial" | "warn" | "free" | "neutral";

// The cleaning being handed out. id is null for one not saved yet.
export type Slot = { id: string | null; key: string | null; time?: string | null };

const bookingKey = (employeeId: string, key: string) => `${employeeId}|${key}`;

// "cleaner|YYYY-MM-DD" -> that cleaner's unfinished cleanings that day.
// Built once per screen so each name doesn't scan every job.
export function bookingsOf<J extends BookedJob>(jobs: J[]): Map<string, J[]> {
  const out = new Map<string, J[]>();
  for (const job of jobs) {
    const key = jobDateKey(job);
    if (!job.assignedTo || job.done || !key || !countsAsCleaning(job)) continue;
    // Everyone on it is booked, not only the main cleaner.
    for (const id of crewOf(job)) {
      const k = bookingKey(id, key);
      if (!out.has(k)) out.set(k, []);
      out.get(k)!.push(job);
    }
  }
  return out;
}

// Null until the cleaning has a day.
export function availabilityFor<J extends BookedJob>(
  employee: { id: string; timeOff?: unknown },
  slot: Slot,
  bookings: Map<string, J[]>,
  hours = CLEANING_HOURS,
): Availability<J> | null {
  if (!slot.key) return null;
  const conflict = conflictFor(timeOffOf(employee), slot.key, slot.time, hours);
  if (conflict?.blocking) return { kind: "off", conflict };
  const sameDay = (bookings.get(bookingKey(employee.id, slot.key)) || []).filter(j => j.id !== slot.id);
  // Two cleanings clash when they start closer together than one takes.
  const start = isTime(slot.time) ? minutesOf(slot.time) : null;
  const clash = start === null ? undefined : sameDay
    .filter(j => isTime(j.time) && Math.abs(minutesOf(j.time) - start) < hours * 60)
    .sort((a, b) => (a.time as string).localeCompare(b.time as string))[0];
  if (clash) return { kind: "booked", job: clash };
  if (conflict) return { kind: "partly", conflict };
  return { kind: "free", sameDay: sameDay.length };
}

// "11 AM" / "12:30 PM"
function clock(time: string): string {
  return (formatTime(time) as string).replace(":00 ", " ");
}

// Fits under a name on a chip: "Free", "Off", "Busy 8–12", "Booked 11 AM",
// "Has 1 that day".
export function availabilityShort(a: Availability): string {
  if (a.kind === "off") return isAllDay(a.conflict.block) ? "Off" : `Busy ${shortHours(a.conflict.block)}`;
  if (a.kind === "booked") return `Booked ${clock(a.job.time as string)}`;
  if (a.kind === "partly") return `Busy ${shortHours(a.conflict.block)}`;
  return a.sameDay ? `Has ${a.sameDay} that day` : "Free";
}

// A full line for a list: "Off all day · doctor", "Already on Palm House at
// 11:00 AM", "Free then · has 1 other cleaning that day".
export function availabilityDetail<J extends BookedJob>(a: Availability<J>, houseOf: (job: J) => string, timed: boolean): string {
  if (a.kind === "off" || a.kind === "partly") return conflictText(a.conflict);
  if (a.kind === "booked") return `Already on ${houseOf(a.job)} at ${formatTime(a.job.time)}`;
  const free = timed ? "Free then" : "Free that day";
  if (!a.sameDay) return free;
  return `${free} · has ${a.sameDay} other cleaning${a.sameDay === 1 ? "" : "s"} that day`;
}

export function availabilityTone(a: Availability): AvailabilityTone {
  if (a.kind === "off" || a.kind === "partly") return isAllDay(a.conflict.block) ? "off" : "partial";
  if (a.kind === "booked") return "warn";
  return a.sameDay ? "neutral" : "free";
}

// What the owner is asked before giving a cleaning to someone who can't take
// it. Null when nothing's in the way.
export function availabilityWarning<J extends BookedJob>(
  a: Availability<J> | null,
  name: string,
  houseOf: (job: J) => string,
): { title: string; body: string } | null {
  const first = name.split(" ")[0] || "This cleaner";
  if (a?.kind === "off") {
    return { title: `${first} can't work then`, body: `${conflictText(a.conflict)}. Give them this cleaning anyway?` };
  }
  if (a?.kind === "booked") {
    return { title: `${first} is already booked then`, body: `They're on ${houseOf(a.job)} at ${formatTime(a.job.time)}. Give them this one too?` };
  }
  return null;
}
