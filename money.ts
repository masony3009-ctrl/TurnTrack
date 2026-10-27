// What each house earns us and costs us, when it last had a deep clean, and
// what hosts who pay us directly still owe.
//
// Pure (no React, no Firebase) so it runs under node --test.

import { findProperty, houseKey, type Property } from "./properties.ts";
import { countsAsCleaning, type ScheduleJob } from "./schedule.ts";
import { jobDateKey } from "./turnover.ts";

export type MoneyJob = ScheduleJob & {
  id?: string;
  price?: number | null;
  timeSummary?: { minutes: number; earned: number } | null;
  hostPaid?: boolean | null;
};

export function isDeepClean(job: { type?: string | null }): boolean {
  return /deep/i.test(job.type || "");
}

// What a cleaning pays: its own price if the owner set one, else the house's
// regular price. Deep cleans have no house default; they're quoted one at a time.
export function jobPrice(job: MoneyJob, house: Property | null): number | null {
  if (typeof job.price === "number" && job.price > 0) return job.price;
  if (isDeepClean(job)) return null;
  return house?.price && house.price > 0 ? house.price : null;
}

// A typed price ("$150", "175.50") -> dollars, or null for empty or nonsense.
export function parsePrice(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return n > 0 && n <= 10000 ? n : null;
}

// Pay logged against the cleaning by the timer, if anyone ran it.
export function jobLabor(job: MoneyJob): { minutes: number; earned: number } | null {
  const t = job.timeSummary;
  return t && t.minutes > 0 ? { minutes: t.minutes, earned: t.earned || 0 } : null;
}

export type Period = "month" | "lastMonth" | "year" | "all";

export const PERIOD_LABELS: Record<Period, string> = {
  month: "This month",
  lastMonth: "Last month",
  year: "This year",
  all: "All time",
};

// Inclusive "YYYY-MM-DD" bounds; null means no limit.
export function periodRange(period: Period, today: string): { from: string; to: string } | null {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();
  if (period === "month") return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${lastDay(year, month)}` };
  if (period === "lastMonth") {
    const y = month === 1 ? year - 1 : year;
    const m = month === 1 ? 12 : month - 1;
    return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${lastDay(y, m)}` };
  }
  if (period === "year") return { from: `${year}-01-01`, to: `${year}-12-31` };
  return null;
}

function inRange(key: string, range: { from: string; to: string } | null): boolean {
  return !range || (key >= range.from && key <= range.to);
}

export const OTHER_HOUSE = "other";

export type HouseJobs<J extends MoneyJob = MoneyJob> = { key: string; house: Property | null; jobs: J[] };

// Real cleanings (not cancelled, not unconfirmed) filed under their house.
// Addresses that aren't in the registry share one "other" bucket.
export function groupByHouse<J extends MoneyJob>(jobs: J[], properties: Property[]): Map<string, HouseJobs<J>> {
  const out = new Map<string, HouseJobs<J>>();
  for (const p of properties) out.set(houseKey(p.name), { key: houseKey(p.name), house: p, jobs: [] });
  for (const job of jobs) {
    if (!countsAsCleaning(job)) continue;
    const house = findProperty(properties, job);
    const key = house ? houseKey(house.name) : OTHER_HOUSE;
    if (!out.has(key)) out.set(key, { key, house, jobs: [] });
    out.get(key)!.jobs.push(job);
  }
  return out;
}

export type HouseMoney = {
  // Finished cleanings in the period.
  cleanings: number;
  // What the finished ones paid, where we know the price.
  revenue: number;
  // Finished cleanings with no price, house or job.
  unpriced: number;
  // Pay logged by the timer on the finished ones.
  labor: number;
  minutes: number;
  // Finished cleanings that had the timer run.
  timed: number;
  // Still to do in the period, and what the priced ones will pay.
  booked: number;
  bookedRevenue: number;
};

export function houseMoney(group: HouseJobs, range: { from: string; to: string } | null): HouseMoney {
  const m: HouseMoney = { cleanings: 0, revenue: 0, unpriced: 0, labor: 0, minutes: 0, timed: 0, booked: 0, bookedRevenue: 0 };
  for (const job of group.jobs) {
    if (!inRange(jobDateKey(job) as string, range)) continue;
    const price = jobPrice(job, group.house);
    if (!job.done) {
      m.booked += 1;
      m.bookedRevenue += price || 0;
      continue;
    }
    m.cleanings += 1;
    if (price === null) m.unpriced += 1;
    else m.revenue += price;
    const labor = jobLabor(job);
    if (labor) {
      m.timed += 1;
      m.labor += labor.earned;
      m.minutes += labor.minutes;
    }
  }
  m.labor = Math.round(m.labor * 100) / 100;
  return m;
}

export function sumMoney(rows: HouseMoney[]): HouseMoney & { profit: number } {
  const t: HouseMoney = { cleanings: 0, revenue: 0, unpriced: 0, labor: 0, minutes: 0, timed: 0, booked: 0, bookedRevenue: 0 };
  for (const r of rows) {
    (Object.keys(t) as (keyof HouseMoney)[]).forEach((k) => { t[k] += r[k]; });
  }
  t.labor = Math.round(t.labor * 100) / 100;
  return { ...t, profit: Math.round((t.revenue - t.labor) * 100) / 100 };
}

// The averages that say whether a house is worth it: how long a cleaning takes,
// what it costs in pay, and what's left of its price. Only cleanings that had
// the timer run count toward time and pay; null until there's one.
export function perCleaning(m: HouseMoney): { minutes: number | null; labor: number | null; margin: number | null } {
  if (m.timed === 0) return { minutes: null, labor: null, margin: null };
  const labor = Math.round((m.labor / m.timed) * 100) / 100;
  const priced = m.cleanings - m.unpriced;
  const price = priced > 0 ? m.revenue / priced : null;
  return {
    minutes: Math.round(m.minutes / m.timed),
    labor,
    margin: price === null ? null : Math.round((price - labor) * 100) / 100,
  };
}

// Regular cleanings between deep cleans before the app suggests pitching one.
export const DEEP_CLEAN_EVERY = 10;

export type DeepCleanStatus = {
  // Finished regular cleanings since the last deep clean (or ever, if none).
  since: number;
  lastDeep: string | null;
  // The next deep clean on the schedule, if one is booked.
  booked: string | null;
  due: boolean;
};

export function deepCleanStatus(jobs: MoneyJob[], today: string): DeepCleanStatus | null {
  let lastDeep: string | null = null;
  let booked: string | null = null;
  for (const job of jobs) {
    if (!countsAsCleaning(job) || !isDeepClean(job)) continue;
    const key = jobDateKey(job) as string;
    if (job.done) {
      if (!lastDeep || key > lastDeep) lastDeep = key;
    } else if (key >= today && (!booked || key < booked)) {
      booked = key;
    }
  }
  let since = 0;
  let regular = 0;
  for (const job of jobs) {
    if (!countsAsCleaning(job) || isDeepClean(job)) continue;
    regular += 1;
    if (job.done && (!lastDeep || (jobDateKey(job) as string) > lastDeep)) since += 1;
  }
  if (regular === 0 && !lastDeep && !booked) return null;
  return { since, lastDeep, booked, due: since >= DEEP_CLEAN_EVERY && !booked };
}

// For a house whose host pays us directly: finished, priced cleanings from the
// billing start date that haven't been marked paid.
export function hostOwed<J extends MoneyJob>(jobs: J[], house: Property | null): { amount: number; jobs: J[] } {
  if (!house?.billedFrom) return { amount: 0, jobs: [] };
  const owed: J[] = [];
  let amount = 0;
  for (const job of jobs) {
    if (!countsAsCleaning(job) || !job.done || job.hostPaid) continue;
    if ((jobDateKey(job) as string) < house.billedFrom) continue;
    const price = jobPrice(job, house);
    if (price === null) continue;
    owed.push(job);
    amount += price;
  }
  return { amount: Math.round(amount * 100) / 100, jobs: owed };
}
