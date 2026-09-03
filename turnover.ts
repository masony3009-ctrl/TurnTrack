export type JobLike = {
  date: string;
  sameDayTurnover?: boolean;
};

const monthsByName: { [key: string]: number } = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

const monthsByNumber: { [key: string]: string } = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

export function parseJobDateToDate(dateStr: string): Date | null {
  const m1 = dateStr.match(/([A-Za-z]+)\s+(\d+)\s+(\d{4})/);
  if (m1) {
    const month = monthsByName[m1[1].substring(0, 3)];
    if (month === undefined) return null;
    return new Date(parseInt(m1[3], 10), month, parseInt(m1[2], 10));
  }

  const m2 = dateStr.match(/([A-Za-z]+),\s+([A-Za-z]+)\s+(\d+)(?:\s+(\d{4}))?/);
  if (m2) {
    const month = monthsByName[m2[2].substring(0, 3)];
    if (month === undefined) return null;
    const year = m2[4] ? parseInt(m2[4], 10) : new Date().getFullYear();
    return new Date(year, month, parseInt(m2[3], 10));
  }

  return null;
}

export function parseJobDateToKey(dateStr: string): string | null {
  const m1 = dateStr.match(/([A-Za-z]+)\s+(\d+)\s+(\d{4})/);
  if (m1) {
    const month = monthsByNumber[m1[1].substring(0, 3)];
    const day = m1[2].padStart(2, "0");
    if (month) return `${m1[3]}-${month}-${day}`;
  }

  const m2 = dateStr.match(/([A-Za-z]+),\s+([A-Za-z]+)\s+(\d+)(?:\s+(\d{4}))?/);
  if (m2) {
    const month = monthsByNumber[m2[2].substring(0, 3)];
    const day = m2[3].padStart(2, "0");
    const year = m2[4] || new Date().getFullYear().toString();
    if (month) return `${year}-${month}-${day}`;
  }

  return null;
}

export function hasSameDayTurnover(job: JobLike): boolean {
  return job.sameDayTurnover === true;
}

export function daysFromToday(dateStr: string): number | null {
  const date = parseJobDateToDate(dateStr);
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

// Jobs leave the app this many days after the cleaning date. They stay in
// Firestore; this only controls what the phones show.
export const HIDE_AFTER_DAYS = 2;

export function isJobVisible(job: { date: string; cancelled?: boolean }): boolean {
  if (job.cancelled) return false;
  const days = daysFromToday(job.date);
  if (days === null) return true;
  return days >= -HIDE_AFTER_DAYS;
}
