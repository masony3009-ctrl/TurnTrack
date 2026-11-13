import { buildChecklist, type ChecklistItem } from "./checklist";
import { isTime } from "./jobTime";
import type { TimeOff } from "./timeOff";
import { formatDateLabel, parseJobDateToKey } from "./turnover";

// The checklist lives in checklist.ts (pure, so it can be tested under Node);
// these re-exports keep the older `from "../types"` imports working.
export { buildChecklist, checklistProgress, DEFAULT_CHECKLIST, isHeadingLine } from "./checklist";
export type { ChecklistItem, ChecklistProgress } from "./checklist";

// Written when a cleaner finishes with steps still unchecked: they have to
// say why, and the owner sees it on the job.
// The kinds of cleaning picked from a list, so the same kind is always spelled
// the same way. Synced cleanings may carry their own ("Airbnb Turnover").
export const JOB_TYPES = ["Turnover", "Standard Cleaning", "Deep Cleaning", "Move-out Cleaning", "Handyman"];

export type FinishNote = {
  text: string;
  by: string | null;
  at: number;
  skipped: number;
};

export type Job = {
  id: string;
  // Human label, e.g. "Sat, May 9 2026". Kept for the email script and
  // older records; the app reads dateKey first.
  date: string;
  // Canonical "YYYY-MM-DD". Set on every job the app creates.
  dateKey?: string | null;
  // Start time, "HH:MM" 24-hour (see jobTime.ts). Absent or null = no set time.
  time?: string | null;
  address: string;
  // Registry key for the house, written by the email script and the Airbnb
  // sync. Used to look the property up for its access codes.
  property?: string;
  type: string;
  done: boolean;
  completedAt: number | null;
  sameDayTurnover?: boolean;
  // When a finished cleaning was reopened by "Start another session": its
  // original finish time, put back if that session is discarded.
  reopenedFrom?: number | null;
  // The main cleaner. Anyone else on the cleaning is in crew (crew.ts).
  assignedTo?: string | null;
  assignedToName?: string | null;
  crew?: string[] | null;
  startedAt?: number | null;
  checklist?: ChecklistItem[];
  // Cancelled jobs stay in Firestore for the record but are hidden in the app.
  cancelled?: boolean;
  cancelledAt?: number | null;
  cancelReason?: string | null;
  createdAt?: number;
  timeSummary?: {
    employeeName: string;
    minutes: number;
    earned: number;
  } | null;
  // Cleaners already paid for this cleaning (flatPayDue in payroll.ts).
  paidTo?: string[] | null;
  finishNote?: FinishNote | null;
  // How many steps "check all" ticked in one tap at the finish, so the owner can
  // tell a list worked through from one ticked off at the end.
  checkedAtFinish?: number | null;
  // Supplies the cleaner flagged as running low at the finish.
  lowSupplies?: string[] | null;
  // What this cleaning pays, when it differs from the house's regular price
  // (deep cleans, one-offs). Unset = the house price.
  price?: number | null;
  // For houses whose host pays us directly: whether this one has been paid.
  hostPaid?: boolean;
  hostPaidAt?: number | null;
  hostPaidMethod?: string | null;
  // Website requests arrive as pending: the owner confirms them into real
  // jobs. Cleaners never see a pending job.
  pending?: boolean;
  source?: string;
  contact?: { name?: string; phone?: string; email?: string } | null;
  notes?: string;
  requestId?: number | null;
};

export type Employee = {
  id: string;
  name: string;
  // From when cleanings paid by the hour. Cleanings now pay a flat amount per
  // house (cleanerPayFor in payroll.ts); 0 for cleaners added since.
  hourlyRate: number;
  phone?: string;
  zelle?: string;
  photo?: string | null;
  pin?: string | null;
  // Hex color used for this cleaner's calendar dots and job cards.
  color?: string | null;
  // Days and hours they've said they can't work (timeOff.ts). Read it with
  // timeOffOf(), which drops anything malformed.
  timeOff?: TimeOff[] | null;
  active: boolean;
  createdAt: number;
};

// pushError/pushErrorAt say why a phone has no push token (set and cleared
// by registerForPushNotifications).
type DevicePush = { pushToken?: string | null; pushError?: string | null; pushErrorAt?: number | null };

export type DeviceRecord =
  | ({ role: "owner" } & DevicePush)
  | ({ role: "cleaner"; employeeId: string; employeeName: string } & DevicePush);

export type TimeEntry = {
  id: string;
  jobId: string | null;
  jobAddress: string;
  jobDate: string;
  employeeId: string;
  employeeName: string;
  startedAt: number;
  endedAt: number;
  minutes: number;
  hourlyRate: number;
  earned: number;
  // Set on entries paid by the house (a flat amount, however long it took).
  // Absent on older entries paid by the hour at hourlyRate.
  flatPay?: number | null;
  paid: boolean;
  paidAt: number | null;
  method: string | null;
  manual?: boolean;
  note?: string;
};

export type NewJobInput = {
  dateKey?: string | null;
  time?: string | null;
  date?: string;
  address: string;
  type: string;
  sameDayTurnover?: boolean;
};

// The one place a job document is shaped. Every producer in the app goes
// through here so new fields can't be missed by one of them.
export function newJobDoc(input: NewJobInput, template?: string[] | null): Omit<Job, "id"> {
  const dateKey = input.dateKey || (input.date ? parseJobDateToKey(input.date) : null);
  const date = dateKey ? formatDateLabel(dateKey) : (input.date || "").trim();
  return {
    date,
    dateKey,
    time: isTime(input.time) ? input.time : null,
    address: input.address.trim(),
    type: input.type.trim() || "Turnover",
    done: false,
    completedAt: null,
    sameDayTurnover: input.sameDayTurnover === true,
    assignedTo: null,
    assignedToName: null,
    startedAt: null,
    checklist: buildChecklist(template),
    cancelled: false,
    cancelledAt: null,
    cancelReason: null,
    createdAt: Date.now(),
  };
}

// Turns the owner's pasted text (one item per line) into a clean template.
export function parseChecklistText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}
