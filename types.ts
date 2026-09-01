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
  active: boolean;
  createdAt: number;
};

export type DeviceRecord =
  | { role: "owner" }
  | { role: "cleaner"; employeeId: string; employeeName: string };

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

export function buildChecklist(): ChecklistItem[] {
  return DEFAULT_CHECKLIST.map(text => ({ text, done: false }));
}
