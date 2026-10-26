// Timer sessions: the rules that keep pay right when a cleaning is started,
// finished twice, left running, or worked in more than one go.
//
// Pure (no React, no Firebase) so it runs under node --test.

import { formatTime } from "./jobTime.ts";

// One pay entry per timer session. Finishing twice (no signal, or the owner and
// the cleaner both tapping Finish) overwrites the same entry instead of adding
// a second one.
export function sessionEntryId(jobId: string, startedAt: number): string {
  return `${jobId}_${startedAt}`;
}

// Past this, the timer was most likely left running, so ask when they really
// finished instead of paying every hour since it started.
export const LONG_SESSION_MINUTES = 6 * 60;

export function isLongSession(startedAt: number, now: number): boolean {
  return now - startedAt > LONG_SESSION_MINUTES * 60000;
}

export type EndChoice = { time: string; label: string; at: number };

// End times to offer for a long session: every half hour on the day the timer
// started, from 15 minutes after the start until now.
export function endTimeChoices(startedAt: number, now: number): EndChoice[] {
  const out: EndChoice[] = [];
  const day = new Date(startedAt);
  for (let h = 5; h <= 23; h++) {
    for (const m of [0, 30]) {
      const d = new Date(day);
      d.setHours(h, m, 0, 0);
      const at = d.getTime();
      if (at <= startedAt + 15 * 60000 || at >= now) continue;
      const time = `${String(h).padStart(2, "0")}:${m === 0 ? "00" : "30"}`;
      out.push({ time, label: formatTime(time) || time, at });
    }
  }
  return out;
}

export type TimeSummary = { employeeName: string; minutes: number; earned: number };

// A later session on the same job adds to the earlier ones instead of
// replacing them. The job snapshot a finish is computed from still has the
// timer set, so its summary only ever holds earlier sessions.
export function mergeSummary(prev: TimeSummary | null | undefined, next: TimeSummary): TimeSummary {
  if (!prev) return next;
  const names = prev.employeeName.split(" & ");
  if (!names.includes(next.employeeName)) names.push(next.employeeName);
  return {
    employeeName: names.join(" & "),
    minutes: prev.minutes + next.minutes,
    earned: Math.round((prev.earned + next.earned) * 100) / 100,
  };
}

// Why starting the timer needs a second look, if it does.
export type StartCheck = "finished" | "future" | null;

export function startCheck(job: { done?: boolean }, daysFromToday: number | null): StartCheck {
  if (job.done) return "finished";
  if (daysFromToday !== null && daysFromToday > 0) return "future";
  return null;
}

type Timed = { id: string; startedAt?: number | null; assignedTo?: string | null; cancelled?: boolean };

// Another job this cleaner still has a timer running on. Two clocks at once
// would pay the overlap twice.
export function otherRunningJob<T extends Timed>(jobs: T[], employeeId: string, jobId: string): T | null {
  return jobs.find((j) => j.id !== jobId && j.assignedTo === employeeId && !!j.startedAt && !j.cancelled) || null;
}

// Waits a moment for a write to reach the server. With no signal, Firestore
// applies the write on this phone straight away but only settles the promise
// once it uploads, so screens must not sit on "Saving…" until then. A failure
// inside the wait throws; a later one goes to onLateError.
export async function waitBriefly(p: Promise<unknown>, ms: number, onLateError: (e: unknown) => void): Promise<"saved" | "queued"> {
  let settled = false;
  let error: unknown = null;
  let failed = false;
  const tracked = p.then(
    () => { settled = true; },
    (e) => { settled = true; failed = true; error = e; }
  );
  await Promise.race([tracked, new Promise((r) => setTimeout(r, ms))]);
  if (settled) {
    if (failed) throw error;
    return "saved";
  }
  tracked.then(() => { if (failed) onLateError(error); });
  return "queued";
}
