export type ChecklistItem = {
  text: string;
  done: boolean;
};

export type Job = {
  id: string;
  date: string;
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

// Turns the owner's pasted text (one item per line) into a clean template.
export function parseChecklistText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
}
