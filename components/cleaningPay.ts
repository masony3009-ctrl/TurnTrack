import { arrayUnion, doc, writeBatch } from "firebase/firestore";
import { db } from "../firebase";
import { cleanerPayFor, FLAT_PAY_SINCE, flatEntry, flatEntryId, flatPayDue, formatMoney } from "../payroll";
import { findProperty, type Property } from "../properties";
import { crewOf } from "../crew";
import { dateFromKey, jobDateKey } from "../turnover";
import type { Employee, Job } from "../types";

export type PayDue = { employee: Employee; pay: number };

// Who on a finished cleaning still has no pay recorded for it. Only cleanings
// since pay went flat (FLAT_PAY_SINCE); earlier ones were paid by the hour.
export function payDueFor(job: Job, employees: Employee[], properties: Property[]): PayDue[] {
  const key = jobDateKey(job);
  if (!key || key < FLAT_PAY_SINCE) return [];
  const pay = cleanerPayFor(findProperty(properties, job));
  const out: PayDue[] = [];
  for (const id of crewOf(job)) {
    const employee = employees.find(e => e.id === id);
    if (employee && flatPayDue(job, employee, pay) > 0) out.push({ employee, pay });
  }
  return out;
}

// When the cleaning ended, for sorting the entry: when it was marked done, or
// noon on its day.
function endedAtOf(job: Job): number {
  if (job.completedAt) return job.completedAt;
  const d = dateFromKey(jobDateKey(job) || "") || new Date();
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

// Records pay for a finished cleaning that was closed without the timer. Owed:
// an unpaid entry per cleaner, with a fixed id so a retry can't pay twice.
// Settled (paid outside the app): no entry, just marked so it stops being
// listed. Either way the cleaner goes on the job's paidTo in the same save.
export async function recordCleaningPay(job: Job, dues: PayDue[], settled = false): Promise<void> {
  if (dues.length === 0) return;
  const batch = writeBatch(db);
  if (!settled) {
    const endedAt = endedAtOf(job);
    dues.forEach(({ employee, pay }) => {
      batch.set(doc(db, "timeEntries", flatEntryId(job.id, employee.id)), flatEntry(job, employee, pay, endedAt));
    });
  }
  batch.update(doc(db, "jobs", job.id), { paidTo: arrayUnion(...dues.map(d => d.employee.id)) });
  await batch.commit();
}

// "Jewel gets $80" / "Jewel and Shane get $80 each".
export function duesSentence(dues: PayDue[]): string {
  const names = dues.map(d => d.employee.name.split(" ")[0]);
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const same = dues.every(d => d.pay === dues[0].pay);
  if (dues.length === 1) return `${who} gets ${formatMoney(dues[0].pay)}`;
  return same ? `${who} get ${formatMoney(dues[0].pay)} each` : `${who} get ${dues.map(d => formatMoney(d.pay)).join(" and ")}`;
}
