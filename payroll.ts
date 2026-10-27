export function computeEarned(minutes: number, hourlyRate: number): number {
  return Math.round((minutes / 60) * hourlyRate * 100) / 100;
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
