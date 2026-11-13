// When the next guests arrive at a house after a cleaning, and how many, for
// the crew working a turnover. Every stay the Airbnb sync or a forwarded
// booking email knows about is a cleaning on its checkout day that also
// records the day its guests arrived (checkIn) and how many came (guests).
// So the next guests after a cleaning are the stay at the same house with the
// first arrival on or after that cleaning's day.
//
// Pure (no React, no Firebase) so it runs under node --test.

import { formatTime } from "./jobTime.ts";
import { formatShortDate, jobDateKey, type JobLike } from "./turnover.ts";

export type StayJob = JobLike & {
  id?: string;
  checkIn?: string | null;
  guests?: number | null;
  pending?: boolean | null;
};

export type NextStay = { checkIn: string; guests: number | null };

const KEY = /^\d{4}-\d{2}-\d{2}$/;

// houseOf: the same house key for two cleanings at the same house.
export function nextStay<J extends StayJob>(job: J, jobs: J[], houseOf: (j: J) => string): NextStay | null {
  const day = jobDateKey(job);
  const house = houseOf(job);
  if (!day || !house) return null;
  let best: J | null = null;
  for (const j of jobs) {
    if (j === job || (job.id && j.id === job.id)) continue;
    if (j.cancelled || j.pending) continue;
    const arrives = j.checkIn;
    if (!arrives || !KEY.test(arrives) || arrives < day) continue;
    if (houseOf(j) !== house) continue;
    if (!best || arrives < (best.checkIn as string)) best = j;
  }
  if (best) return { checkIn: best.checkIn as string, guests: typeof best.guests === "number" && best.guests > 0 ? best.guests : null };
  // A same-day turnover whose next stay isn't on record still has guests coming today.
  if (job.sameDayTurnover) return { checkIn: day, guests: null };
  return null;
}

// Minutes from now until "HH:MM" on that day, Arizona time on the phone. Negative once it's passed.
export function minutesUntil(dateKey: string, time: string, nowMs: number): number | null {
  const d = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!d || !t) return null;
  const at = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2])).getTime();
  return Math.round((at - nowMs) / 60000);
}

function left(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h === 0 ? `${m}m left` : m === 0 ? `${h}h left` : `${h}h ${m}m left`;
}

// "Next guests arrive today at 4:00 PM · 2h 10m left · 6 guests"
// "Next guests arrive Sun, Nov 22 · 4 guests"
export function nextGuestsLine(job: StayJob, stay: NextStay | null, checkInTime: string | null | undefined, nowMs: number, todayKey: string): string | null {
  if (!stay) return null;
  const day = jobDateKey(job);
  const sameDay = !!day && stay.checkIn === day;
  const when = stay.checkIn === todayKey ? "today" : sameDay ? "the same day" : formatShortDate(stay.checkIn);
  const at = checkInTime ? ` at ${formatTime(checkInTime) || checkInTime}` : "";
  const parts = [`Next guests arrive ${when}${at}`];
  if (stay.checkIn === todayKey && checkInTime) {
    const mins = minutesUntil(stay.checkIn, checkInTime, nowMs);
    if (mins !== null && mins > 0) parts.push(left(mins));
  }
  if (stay.guests) parts.push(`${stay.guests} guest${stay.guests === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
