// Job dates: parsing, canonical keys, labels, and the visibility rule.
//
// Jobs arrive from several producers (manual entry, calendar scan, email
// script, legacy scanners) with dates in whatever shape the source used.
// Everything downstream should go through jobDateKey() and treat
// "YYYY-MM-DD" as the one true form. New jobs also store that key directly.

export type JobLike = {
  date: string;
  dateKey?: string | null;
  sameDayTurnover?: boolean;
  cancelled?: boolean;
  startedAt?: number | null;
  done?: boolean;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function monthIndex(word: string): number {
  return MONTHS.indexOf(word.slice(0, 3).toLowerCase());
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

export function todayKey(): string {
  return keyFromDate(new Date());
}

export function keyFromDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dateFromKey(key: string): Date | null {
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  return isNaN(d.getTime()) ? null : d;
}

// A date written without a year almost always means the next occurrence.
// Anything more than ~6 weeks in the past rolls forward a year.
function resolveYear(month: number, day: number): number {
  const now = new Date();
  const thisYear = new Date(now.getFullYear(), month, day);
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 45);
  return thisYear < cutoff ? now.getFullYear() + 1 : now.getFullYear();
}

type Parts = { y: number; m: number; d: number };

function partsFrom(y: number, m: number, d: number): Parts | null {
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  const probe = new Date(y, m, d);
  if (probe.getMonth() !== m || probe.getDate() !== d) return null;
  return { y, m, d };
}

// Accepts: 2026-05-09 · 5/9/2026 · 5/9/26 · May 9 2026 · May 9, 2026 ·
// May. 9, 2026 · Sat, May 9 2026 · Saturday May 9 · May 9 · 9 May 2026 · 9th May
export function parseJobDateParts(input: string | null | undefined): Parts | null {
  if (!input) return null;
  const text = input.trim();

  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return partsFrom(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10));

  const numeric = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (numeric) {
    let y = parseInt(numeric[3], 10);
    if (numeric[3].length <= 2) y += 2000;
    return partsFrom(y, parseInt(numeric[1], 10) - 1, parseInt(numeric[2], 10));
  }

  // "May 9", "May 9, 2026", "Sat, May 9 2026", "May. 9th 2026"
  const wordFirst = /([A-Za-z]{3,})\.?,?\s+(\d{1,2})(?!\d)(?:st|nd|rd|th)?,?(?:\s+(\d{4}))?/g;
  let match: RegExpExecArray | null;
  while ((match = wordFirst.exec(text)) !== null) {
    const m = monthIndex(match[1]);
    if (m === -1) continue;
    const d = parseInt(match[2], 10);
    const y = match[3] ? parseInt(match[3], 10) : resolveYear(m, d);
    return partsFrom(y, m, d);
  }

  // "9 May 2026", "9th May"
  const dayFirst = /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\.?,?(?:\s+(\d{4}))?/g;
  while ((match = dayFirst.exec(text)) !== null) {
    const m = monthIndex(match[2]);
    if (m === -1) continue;
    const d = parseInt(match[1], 10);
    const y = match[3] ? parseInt(match[3], 10) : resolveYear(m, d);
    return partsFrom(y, m, d);
  }

  return null;
}

export function parseJobDateToDate(dateStr: string): Date | null {
  const p = parseJobDateParts(dateStr);
  return p ? new Date(p.y, p.m, p.d) : null;
}

export function parseJobDateToKey(dateStr: string): string | null {
  const p = parseJobDateParts(dateStr);
  return p ? `${p.y}-${pad(p.m + 1)}-${pad(p.d)}` : null;
}

// The canonical key for a job: the stored dateKey when present, otherwise
// parsed from the label. Null only when the label is unreadable.
export function jobDateKey(job: JobLike): string | null {
  if (job.dateKey && /^\d{4}-\d{2}-\d{2}$/.test(job.dateKey)) return job.dateKey;
  return parseJobDateToKey(job.date);
}

export function jobDate(job: JobLike): Date | null {
  const key = jobDateKey(job);
  return key ? dateFromKey(key) : null;
}

// "Sat, May 9 2026" — the label format the calendar scan already writes.
export function formatDateLabel(key: string): string {
  const d = dateFromKey(key);
  if (!d) return key;
  return `${DAY_LABELS[d.getDay()]}, ${MONTH_LABELS[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
}

// "Saturday, May 9" — for headings, with the year only when it isn't this year.
export function formatDayHeading(key: string): string {
  const d = dateFromKey(key);
  if (!d) return key;
  const year = d.getFullYear() === new Date().getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${DAY_LONG[d.getDay()]}, ${MONTH_LONG[d.getMonth()]} ${d.getDate()}${year}`;
}

// "Sat, May 9" — compact, for cards.
export function formatShortDate(key: string): string {
  const d = dateFromKey(key);
  if (!d) return key;
  return `${DAY_LABELS[d.getDay()]}, ${MONTH_LABELS[d.getMonth()]} ${d.getDate()}`;
}

export function daysFromTodayKey(key: string | null): number | null {
  if (!key) return null;
  const d = dateFromKey(key);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function daysFromToday(job: JobLike): number | null {
  return daysFromTodayKey(jobDateKey(job));
}

// "Today" / "Tomorrow" / "Yesterday" / "In 3 days" / "3 days ago" / weekday
export function relativeDayLabel(days: number | null): string {
  if (days === null) return "Date unclear";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 1 && days <= 6) return `In ${days} days`;
  if (days < -1) return `${-days} days ago`;
  return "";
}

export function hasSameDayTurnover(job: JobLike): boolean {
  return job.sameDayTurnover === true;
}

// Jobs leave the phones this many days after the cleaning date. They stay
// in Firestore; this only controls what the app shows.
export const HIDE_AFTER_DAYS = 2;

// Visible unless cancelled or long past. A job with a running timer never
// hides: somebody still needs to finish or discard it so the hours get logged.
export function isJobVisible(job: JobLike): boolean {
  if (job.cancelled) return false;
  if (job.startedAt) return true;
  const days = daysFromToday(job);
  if (days === null) return true;
  return days >= -HIDE_AFTER_DAYS;
}

export type JobGroup = "running" | "overdue" | "today" | "tomorrow" | "week" | "later" | "past" | "unknown";

export const GROUP_ORDER: JobGroup[] = ["running", "overdue", "today", "tomorrow", "week", "later", "past", "unknown"];

export const GROUP_TITLES: Record<JobGroup, string> = {
  running: "Timer running",
  overdue: "Needs attention",
  today: "Today",
  tomorrow: "Tomorrow",
  week: "This week",
  later: "Later",
  past: "Recently finished",
  unknown: "Date unclear",
};

export function jobGroup(job: JobLike): JobGroup {
  if (job.startedAt) return "running";
  const days = daysFromToday(job);
  if (days === null) return "unknown";
  if (days < 0) return job.done ? "past" : "overdue";
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days <= 6) return "week";
  return "later";
}

export function sortByDate<T extends JobLike>(jobs: T[]): T[] {
  return [...jobs].sort((a, b) => {
    const ka = jobDateKey(a) || "9999";
    const kb = jobDateKey(b) || "9999";
    if (ka !== kb) return ka < kb ? -1 : 1;
    return (a as any).address?.localeCompare?.((b as any).address || "") || 0;
  });
}
