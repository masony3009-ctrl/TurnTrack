import { formatDateLabel, parseJobDateToKey } from "./turnover";

export type ChecklistItem = {
  text: string;
  done: boolean;
};

export type Job = {
  id: string;
  // Human label, e.g. "Sat, May 9 2026". Kept for the email script and
  // older records; the app reads dateKey first.
  date: string;
  // Canonical "YYYY-MM-DD". Set on every job the app creates.
  dateKey?: string | null;
  address: string;
  type: string;
  done: boolean;
  completedAt: number | null;
  sameDayTurnover?: boolean;
  assignedTo?: string | null;
  assignedToName?: string | null;
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
};

export type Employee = {
  id: string;
  name: string;
  hourlyRate: number;
  phone?: string;
  zelle?: string;
  photo?: string | null;
  pin?: string | null;
  // Hex color used for this cleaner's calendar dots and job cards.
  color?: string | null;
  active: boolean;
  createdAt: number;
};

export type DeviceRecord =
  | { role: "owner"; pushToken?: string | null }
  | { role: "cleaner"; employeeId: string; employeeName: string; pushToken?: string | null };

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
  paid: boolean;
  paidAt: number | null;
  method: string | null;
  manual?: boolean;
  note?: string;
};

// Fallback checklist. The owner can replace it in-app; the live template is
// stored in Firestore at settings/checklist as { items: string[] }.
export const DEFAULT_CHECKLIST: string[] = [
  "Strip all beds",
  "Wash and dry all laundry",
  "Clean and sanitize all kitchen appliances",
  "Clean bathrooms",
  "Vacuum + mop floors",
  "Restock supplies",
  "Wipe + sanitize surfaces",
  "Check for damages",
];

export function buildChecklist(template?: string[] | null): ChecklistItem[] {
  const source = template && template.length > 0 ? template : DEFAULT_CHECKLIST;
  return source.map(text => ({ text, done: false }));
}

export type NewJobInput = {
  dateKey?: string | null;
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
