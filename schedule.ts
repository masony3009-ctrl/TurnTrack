// The owner's schedule view: a month grid of cleanings by house, and how many
// cleanings each Sunday-Saturday week had or has booked.
//
// Pure (no React, no Firebase) so it runs under node --test.

import { findProperty, type Property } from "./properties.ts";
import { dateFromKey, jobDateKey, keyFromDate, type JobLike } from "./turnover.ts";

export type ScheduleJob = JobLike & { property?: string | null; address?: string | null; type?: string | null };

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function addDaysToKey(key: string, days: number): string {
  const d = dateFromKey(key);
  if (!d) return key;
  d.setDate(d.getDate() + days);
  return keyFromDate(d);
}

// The Sunday on or before this day.
export function weekStartKey(key: string): string {
  const d = dateFromKey(key);
  if (!d) return key;
  return addDaysToKey(key, -d.getDay());
}

export type Month = { year: number; month: number };

export function monthOfKey(key: string): Month {
  return { year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) - 1 };
}

export function monthKey(m: Month): string {
  return `${m.year}-${String(m.month + 1).padStart(2, "0")}`;
}

export function monthLabel(m: Month, long = false): string {
  return (long ? MONTH_LONG : MONTH_SHORT)[m.month] + (long ? ` ${m.year}` : "");
}

// Every month from the first to the last, inclusive, in order.
export function monthsBetween(first: Month, last: Month): Month[] {
  const out: Month[] = [];
  let { year, month } = first;
  while (year < last.year || (year === last.year && month <= last.month)) {
    out.push({ year, month });
    month += 1;
    if (month > 11) { month = 0; year += 1; }
  }
  return out;
}

// The month's calendar rows: whole Sunday-Saturday weeks, the first holding
// the 1st and the last holding the final day, so days from the neighbouring
// months pad the edges the way a wall calendar does.
export function monthGrid(m: Month): string[][] {
  const first = keyFromDate(new Date(m.year, m.month, 1));
  const last = keyFromDate(new Date(m.year, m.month + 1, 0));
  const rows: string[][] = [];
  for (let start = weekStartKey(first); start <= last; start = addDaysToKey(start, 7)) {
    rows.push(Array.from({ length: 7 }, (_, i) => addDaysToKey(start, i)));
  }
  return rows;
}

// A cleaning that happened or will: not cancelled, not an unconfirmed website
// request, and with a date we can read.
export function countsAsCleaning(job: ScheduleJob): boolean {
  return !job.cancelled && !job.pending && !!jobDateKey(job);
}

// Everything from the street type on goes, which also drops a city written
// without a comma ("Saguaro Ave Mesa").
const FROM_STREET_TYPE = /^(.+?)\s+(st|street|dr|drive|ave|avenue|rd|road|ct|court|cir|circle|ln|lane|blvd|pl|place|trl|trail|pkwy|loop)\b.*$/i;

// The street name alone: "4821 N Mesquite Dr, San Tan Valley" -> "Mesquite".
export function streetName(address: string | null | undefined): string {
  const line = String(address || "")
    .split(",")[0]
    .replace(/#\s*\S+/g, "")
    .trim()
    .replace(/^\d+[a-z]?\s+/i, "")
    .replace(/^(n|s|e|w|north|south|east|west)\.?\s+/i, "");
  return line.replace(FROM_STREET_TYPE, "$1").trim();
}

// What a cleaning is called on the calendar: the house's short name from the
// registry ("Palm Cottage"), else its street, else whatever the job itself says.
export function houseLabel(job: ScheduleJob, properties: Property[]): string {
  const house = findProperty(properties, job);
  if (house) return house.short || streetName(house.address) || house.name;
  const street = streetName(job.address);
  if (street) return street;
  const property = String(job.property || "").split(/[·:]/)[0].trim();
  return property || job.type || "Cleaning";
}

export type WeekCount = { total: number; done: number };

// Week start (Sunday key) -> cleanings dated that week and how many are done.
export function countsByWeek(jobs: ScheduleJob[]): Map<string, WeekCount> {
  const out = new Map<string, WeekCount>();
  for (const job of jobs) {
    if (!countsAsCleaning(job)) continue;
    const start = weekStartKey(jobDateKey(job) as string);
    const c = out.get(start) || { total: 0, done: 0 };
    c.total += 1;
    if (job.done) c.done += 1;
    out.set(start, c);
  }
  return out;
}

export type WeekStatus = "past" | "current" | "future";

export function weekStatus(start: string, today: string): WeekStatus {
  if (addDaysToKey(start, 6) < today) return "past";
  if (start > today) return "future";
  return "current";
}

// "Oct 25 – 31", or "Nov 29 – Dec 5" when the week crosses a month.
export function weekRangeLabel(start: string): string {
  const end = addDaysToKey(start, 6);
  const a = monthOfKey(start);
  const b = monthOfKey(end);
  const left = `${MONTH_SHORT[a.month]} ${Number(start.slice(8))}`;
  const right = a.month === b.month ? `${Number(end.slice(8))}` : `${MONTH_SHORT[b.month]} ${Number(end.slice(8))}`;
  return `${left} – ${right}`;
}

// What a week's row says: what it had, how it's going, or what's booked.
export function weekSummary(count: WeekCount | undefined, status: WeekStatus): string {
  const total = count?.total || 0;
  const done = count?.done || 0;
  const plural = (n: number) => (n === 1 ? "" : "s");
  if (status === "past") return `${total} cleaning${plural(total)}`;
  if (status === "future") return total ? `${total} booked` : "None booked yet";
  return total ? `${done} of ${total} done` : "None this week";
}

// The month's cleanings split into finished and still to do. Done-ness, not
// the date: a cleaning finished this morning is done, and one nobody finished
// last week is still to do.
export function monthTotals(jobs: ScheduleJob[], m: Month): { done: number; left: number } {
  const prefix = monthKey(m);
  let done = 0;
  let left = 0;
  for (const job of jobs) {
    if (!countsAsCleaning(job)) continue;
    if (!(jobDateKey(job) as string).startsWith(prefix)) continue;
    if (job.done) done += 1;
    else left += 1;
  }
  return { done, left };
}

// The months worth offering: from the first cleaning on record to the last
// one booked, always including this month.
export function scheduleMonths(jobs: ScheduleJob[], today: string): Month[] {
  let first = today;
  let last = today;
  for (const job of jobs) {
    if (!countsAsCleaning(job)) continue;
    const key = jobDateKey(job) as string;
    if (key < first) first = key;
    if (key > last) last = key;
  }
  return monthsBetween(monthOfKey(first), monthOfKey(last));
}
