import { crewOf, type CrewJob } from "./crew.ts";
import { jobDateKey, type JobLike } from "./turnover.ts";

export function computeEarned(minutes: number, hourlyRate: number): number {
  return Math.round((minutes / 60) * hourlyRate * 100) / 100;
}

// What a cleaner earns for one cleaning, however long it takes, unless the
// house sets its own amount. Every cleaner on the job earns it.
export const DEFAULT_CLEANER_PAY = 80;

// Pay went from hourly to a flat amount per house on Nov 9 2026. From that day
// on, every finished cleaning owes each cleaner on it the house's pay, whether
// or not the timer ran. Earlier cleanings were paid by the hour, mostly
// outside the app, so nothing before it is treated as owed.
export const FLAT_PAY_SINCE = "2026-11-09";

export function cleanerPayFor(house: { cleanerPay?: number } | null | undefined): number {
  return house?.cleanerPay && house.cleanerPay > 0 ? house.cleanerPay : DEFAULT_CLEANER_PAY;
}

type PaidJob = { paidTo?: string[] | null; timeSummary?: { employeeName: string } | null };

// A cleaning pays each cleaner once. Coming back to fix something (a second
// timer session on the same job) adds nothing. Jobs finished before paidTo
// existed only have the names in their time summary.
export function flatPayDue(job: PaidJob, employee: { id: string; name: string }, pay: number): number {
  if (job.paidTo) return job.paidTo.includes(employee.id) ? 0 : pay;
  const names = job.timeSummary ? job.timeSummary.employeeName.split(" & ") : [];
  return names.includes(employee.name) ? 0 : pay;
}

type DoneJob = JobLike & CrewJob & PaidJob & {
  id: string;
  done?: boolean | null;
  cancelled?: boolean | null;
  pending?: boolean | null;
};

// Each cleaner on a finished cleaning (since pay went flat) with no pay
// recorded for it: no time entry, and not marked as settled some other way.
// This is what "Everyone is paid up" used to miss when a job was ticked done
// without the timer. Newest first.
export function payNotRecorded<J extends DoneJob, E extends { id: string; name: string }>(
  jobs: J[],
  employees: E[],
  payFor: (job: J) => number,
): { job: J; employee: E; pay: number }[] {
  const byId = new Map(employees.map((e) => [e.id, e]));
  const out: { job: J; employee: E; pay: number; key: string }[] = [];
  for (const job of jobs) {
    if (!job.done || job.cancelled || job.pending) continue;
    const key = jobDateKey(job);
    if (!key || key < FLAT_PAY_SINCE) continue;
    const pay = payFor(job);
    for (const id of crewOf(job)) {
      const employee = byId.get(id);
      if (employee && flatPayDue(job, employee, pay) > 0) out.push({ job, employee, pay, key });
    }
  }
  out.sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  return out.map(({ job, employee, pay }) => ({ job, employee, pay }));
}

// The id of the pay entry for one cleaner on one cleaning when it's added
// without the timer, so adding it twice (two phones, a retry) can't pay twice.
export function flatEntryId(jobId: string, employeeId: string): string {
  return `${jobId}_pay_${employeeId}`;
}

// That entry: the house's pay, no time worked, owed until marked paid.
export function flatEntry(
  job: { id: string; address: string; date: string },
  employee: { id: string; name: string; hourlyRate?: number | null },
  pay: number,
  endedAt: number,
) {
  return {
    jobId: job.id,
    jobAddress: job.address,
    jobDate: job.date,
    employeeId: employee.id,
    employeeName: employee.name,
    startedAt: endedAt,
    endedAt,
    minutes: 0,
    hourlyRate: employee.hourlyRate || 0,
    flatPay: pay,
    earned: pay,
    paid: false,
    paidAt: null,
    method: null,
    fromDone: true,
  };
}

// "2 cleanings", "1 cleaning".
export function cleaningsLabel(count: number): string {
  return `${count} cleaning${count === 1 ? "" : "s"}`;
}

export function minutesBetween(startMs: number, endMs: number): number {
  return Math.max(1, Math.round((endMs - startMs) / 60000));
}

export function formatMoney(amount: number): string {
  return `${amount < 0 ? "-" : ""}$${Math.abs(amount).toFixed(2)}`;
}

// "$42,840" - totals, where cents are noise. Keeps cents only when there are some.
export function formatDollars(amount: number): string {
  const abs = Math.abs(amount);
  const whole = Math.abs(abs - Math.round(abs)) < 0.005;
  const [int, cents] = (whole ? Math.round(abs).toString() : abs.toFixed(2)).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${amount < 0 ? "-" : ""}$${grouped}${cents ? `.${cents}` : ""}`;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function formatElapsed(startMs: number, nowMs: number): string {
  const totalSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = m.toString().padStart(2, "0");
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function formatEntryDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

// "2:14 PM" - the wall-clock time something happened, for checklist stamps.
export function formatClockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function parseRate(input: string): number | null {
  const cleaned = input.replace(/[^0-9.]/g, "");
  const rate = parseFloat(cleaned);
  if (isNaN(rate) || rate <= 0 || rate > 500) return null;
  return Math.round(rate * 100) / 100;
}

// Midnight on the Sunday that starts this week (weeksBack = 1 for last week),
// local time: pay weeks run Sunday to Saturday like the calendar.
export function weekStartMs(now: number, weeksBack = 0): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay() - 7 * weeksBack);
  return d.getTime();
}

type PayEntry = { minutes: number; earned: number; endedAt: number; paid: boolean; paidAt: number | null; method: string | null };

// Time worked and pay earned for entries that ended in [fromMs, toMs).
export function workedBetween(entries: PayEntry[], fromMs: number, toMs: number): { minutes: number; earned: number; count: number } {
  let minutes = 0;
  let earned = 0;
  let count = 0;
  for (const e of entries) {
    if (e.endedAt < fromMs || e.endedAt >= toMs) continue;
    minutes += e.minutes;
    earned += e.earned;
    count += 1;
  }
  return { minutes, earned: Math.round(earned * 100) / 100, count };
}

export type Payment = { paidAt: number; amount: number; count: number; method: string | null };

// Paid entries grouped into the payments they were settled in. "Mark paid"
// stamps every entry it settles with the same paidAt, so one payment = one
// paidAt. Newest first.
export function paymentsOf(entries: PayEntry[]): Payment[] {
  const byTime = new Map<number, Payment>();
  for (const e of entries) {
    if (!e.paid || !e.paidAt) continue;
    const p = byTime.get(e.paidAt) || { paidAt: e.paidAt, amount: 0, count: 0, method: e.method };
    p.amount = Math.round((p.amount + e.earned) * 100) / 100;
    p.count += 1;
    byTime.set(e.paidAt, p);
  }
  return [...byTime.values()].sort((a, b) => b.paidAt - a.paidAt);
}
