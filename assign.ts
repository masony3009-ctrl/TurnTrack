// Handing out the week: which upcoming cleanings still need a cleaner, how
// much each cleaner already has, and the one notification a cleaner gets for
// a batch of new assignments.
//
// Pure (no React, no Firebase) so it runs under node --test.

import { addDaysToKey, countsAsCleaning, weekStartKey, type ScheduleJob } from "./schedule.ts";
import { jobDateKey } from "./turnover.ts";

export type AssignJob = ScheduleJob & { id: string; assignedTo?: string | null; done?: boolean };

export type OpenRange = "week" | "next" | "later";

export const RANGE_LABELS: Record<OpenRange, string> = {
  week: "This week",
  next: "Next week",
  later: "Later",
};

// Which Sunday-Saturday stretch a day falls in, counted from today. Null
// before today.
export function openRange(key: string, today: string): OpenRange | null {
  if (key < today) return null;
  const saturday = addDaysToKey(weekStartKey(today), 6);
  if (key <= saturday) return "week";
  if (key <= addDaysToKey(saturday, 7)) return "next";
  return "later";
}

// Today or later, not finished, and nobody on it.
export function isOpenJob(job: AssignJob, today: string): boolean {
  if (!countsAsCleaning(job) || job.done || job.assignedTo) return false;
  return (jobDateKey(job) as string) >= today;
}

export function openCounts(jobs: AssignJob[], today: string): Record<OpenRange, number> {
  const out: Record<OpenRange, number> = { week: 0, next: 0, later: 0 };
  for (const job of jobs) {
    if (!isOpenJob(job, today)) continue;
    out[openRange(jobDateKey(job) as string, today) as OpenRange] += 1;
  }
  return out;
}

// Cleaner id -> how many unfinished cleanings they already have in the range,
// so the owner can spread the work.
export function loadByCleaner(jobs: AssignJob[], range: OpenRange, today: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const job of jobs) {
    if (!countsAsCleaning(job) || job.done || !job.assignedTo) continue;
    if (openRange(jobDateKey(job) as string, today) !== range) continue;
    out.set(job.assignedTo, (out.get(job.assignedTo) || 0) + 1);
  }
  return out;
}

// "Desert Oasis Thu, Oct 29 · Golf & Pool Fri, Oct 30 · and 3 more"
export function digestBody(lines: { house: string; date: string }[], max = 3): string {
  const shown = lines.slice(0, max).map((l) => `${l.house} ${l.date}`);
  const extra = lines.length - shown.length;
  return extra > 0 ? `${shown.join(" · ")} · and ${extra} more` : shown.join(" · ");
}

// One message per cleaner for everything assigned to them in one sitting:
// the outbox holds job id -> cleaner, so a job moved twice only notifies the
// cleaner who ended up with it.
export function groupOutbox<J>(outbox: Map<string, { employeeId: string; job: J }>): Map<string, J[]> {
  const out = new Map<string, J[]>();
  for (const { employeeId, job } of outbox.values()) {
    if (!out.has(employeeId)) out.set(employeeId, []);
    out.get(employeeId)!.push(job);
  }
  return out;
}
