// Cleanings that repeat: a regular client every week, every other Thursday,
// once a month. Each repeat is one entry in settings/recurring, and the
// owner's phone keeps its cleanings filled in a couple of months ahead.
//
// Each cleaning it makes has a fixed id (series + the day it was meant for),
// so two owner phones filling at once can't double it, and one moved to
// another day keeps its slot and isn't made again. One deleted by hand goes on
// the repeat's skip list for the same reason. A cleaning someone already put
// in for that house and day is adopted instead of doubled.
//
// Pure (no React, no Firebase) so it runs under node --test.

import { addDaysToKey } from "./schedule.ts";
import { dateFromKey, jobDateKey, keyFromDate, type JobLike } from "./turnover.ts";

export type Repeat = "week" | "2weeks" | "4weeks" | "month";

export const REPEATS: { value: Repeat; label: string }[] = [
  { value: "week", label: "Every week" },
  { value: "2weeks", label: "Every 2 weeks" },
  { value: "4weeks", label: "Every 4 weeks" },
  { value: "month", label: "Every month" },
];

export type Series = {
  id: string;
  every: Repeat;
  // The first day it happens; every later one follows from it.
  start: string;
  // Stopped: nothing is made after this day.
  until?: string | null;
  property: string | null;
  address: string;
  type: string;
  time: string | null;
  // Who goes, the main cleaner first.
  crew: string[];
  // Days deleted by hand, so they aren't made again.
  skip?: string[];
  createdAt?: number;
};

export type SeriesJob = JobLike & {
  id: string;
  property?: string | null;
  address?: string | null;
  seriesId?: string | null;
  seriesDate?: string | null;
};

// How far ahead the cleanings are kept filled.
export const FILL_DAYS = 56;

export function repeatLabel(every: Repeat): string {
  return REPEATS.find((r) => r.value === every)?.label || "Repeats";
}

export function seriesJobId(seriesId: string, day: string): string {
  return `${seriesId}_${day}`;
}

// The same day in a month later; the 31st becomes the 30th (or 28th) in a short month.
function addMonths(key: string, months: number, dayOfMonth: number): string {
  const d = dateFromKey(key) as Date;
  const first = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  first.setDate(Math.min(dayOfMonth, last));
  return keyFromDate(first);
}

// The days this repeat falls on between from and to (inclusive), minus the
// skipped ones and anything after it was stopped.
export function slotsBetween(series: Series, from: string, to: string): string[] {
  const start = dateFromKey(series.start);
  if (!start || to < series.start) return [];
  const end = series.until && series.until < to ? series.until : to;
  const skip = new Set(series.skip || []);
  const out: string[] = [];
  const step = series.every === "week" ? 7 : series.every === "2weeks" ? 14 : series.every === "4weeks" ? 28 : 0;
  for (let i = 0; i < 1000; i++) {
    const day = step ? addDaysToKey(series.start, step * i) : addMonths(series.start, i, start.getDate());
    if (day > end) break;
    if (day >= from && !skip.has(day)) out.push(day);
  }
  return out;
}

function houseKeyOf(v: { property?: string | null; address?: string | null }): string {
  return String(v.property || v.address || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export type FillPlan = {
  create: { series: Series; day: string }[];
  adopt: { series: Series; day: string; jobId: string }[];
};

// What has to happen to keep every repeat filled from today to FILL_DAYS out.
export function fillPlan<J extends SeriesJob>(series: Series[], jobs: J[], today: string, days = FILL_DAYS): FillPlan {
  const plan: FillPlan = { create: [], adopt: [] };
  const ids = new Set(jobs.map((j) => j.id));
  const slotted = new Set(jobs.filter((j) => j.seriesId && j.seriesDate).map((j) => `${j.seriesId}|${j.seriesDate}`));
  const to = addDaysToKey(today, days);
  const taken = new Set<string>();
  for (const s of series) {
    const house = houseKeyOf(s);
    for (const day of slotsBetween(s, today, to)) {
      if (ids.has(seriesJobId(s.id, day)) || slotted.has(`${s.id}|${day}`)) continue;
      const already = jobs.find((j) =>
        !j.cancelled && !j.seriesId && !taken.has(j.id) && jobDateKey(j) === day && houseKeyOf(j) === house);
      if (already) {
        taken.add(already.id);
        plan.adopt.push({ series: s, day, jobId: already.id });
      } else {
        plan.create.push({ series: s, day });
      }
    }
  }
  return plan;
}

// A fresh id for a new repeat: short, and safe in a document id.
export function newSeriesId(now: number, random: number): string {
  return `r${now.toString(36)}${Math.floor(random * 1e6).toString(36)}`;
}
