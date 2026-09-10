import { formatDateLabel, parseJobDateToKey } from "./turnover";

export type ChecklistItem = {
  text: string;
  done: boolean;
  // Section label ("Kitchen"), not a tickable task. Comes from a template
  // line ending in a colon.
  heading?: boolean;
  // Stamped when someone ticks the item and cleared when they untick it, so
  // the owner can see what got done and when. Absent on items ticked before
  // stamping existed.
  doneAt?: number | null;
  doneBy?: string | null;
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

// A template line ending in a colon is a section heading, e.g. "Kitchen:".
export function isHeadingLine(line: string): boolean {
  return /:s*$/.test(line);
}

export function buildChecklist(template?: string[] | null): ChecklistItem[] {
  const source = template && template.length > 0 ? template : DEFAULT_CHECKLIST;
  return source.map(line => isHeadingLine(line)
    ? { text: line.replace(/:s*$/, ""), done: false, heading: true }
    : { text: line, done: false });
}

export type ChecklistProgress = {
  done: number;
  total: number;
  // The most recent tick, so a card can say "last check 2:31 PM".
  lastAt: number | null;
  lastBy: string | null;
};

export function checklistProgress(items?: ChecklistItem[] | null): ChecklistProgress {
  const list = items || [];
  let done = 0;
  let lastAt: number | null = null;
  let lastBy: string | null = null;
  let total = 0;
  for (const item of list) {
    // Headings are labels, not work: they never count toward progress.
    if (item.heading) continue;
    total++;
    if (!item.done) continue;
    done++;
    if (typeof item.doneAt === "number" && (lastAt === null || item.doneAt > lastAt)) {
      lastAt = item.doneAt;
      lastBy = item.doneBy || null;
    }
  }
  return { done, total, lastAt, lastBy };
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
