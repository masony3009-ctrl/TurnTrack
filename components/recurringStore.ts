import { doc, onSnapshot, runTransaction, writeBatch } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../firebase";
import { seriesJobId, type FillPlan, type Series } from "../recurring";
import { newJobDoc, type Employee, type Job } from "../types";

const REF = () => doc(db, "settings", "recurring");

function itemsOf(raw: unknown): Series[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is Series => !!v && typeof v === "object" && typeof (v as Series).id === "string" && typeof (v as Series).start === "string");
}

// Every repeat, live. Null until loaded (or when not wanted).
export function useRecurring(enabled: boolean): Series[] | null {
  const [series, setSeries] = useState<Series[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(REF(), (snap) => setSeries(itemsOf(snap.data()?.items)), (error) => {
      console.warn("recurring listener error:", error);
    });
  }, [enabled]);
  return enabled ? series : null;
}

// Read-modify-write of the whole list in one transaction, so two phones
// changing repeats at once don't drop each other's change.
async function changeSeries(change: (items: Series[]) => Series[]): Promise<void> {
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(REF());
    tx.set(REF(), { items: change(itemsOf(snap.data()?.items)), updatedAt: Date.now() }, { merge: true });
  });
}

export function addSeries(series: Series): Promise<void> {
  return changeSeries(items => [...items.filter(s => s.id !== series.id), series]);
}

export function updateSeries(id: string, changes: Partial<Series>): Promise<void> {
  return changeSeries(items => items.map(s => (s.id === id ? { ...s, ...changes } : s)));
}

// A repeat's cleaning deleted by hand isn't made again.
export function skipDay(id: string, day: string): Promise<void> {
  return changeSeries(items => items.map(s => (s.id === id ? { ...s, skip: [...new Set([...(s.skip || []), day])] } : s)));
}

// The fields of one repeat's cleaning on one day.
export function seriesJobFields(series: Series, day: string, template: string[] | null, nameOf: (id: string) => string | undefined) {
  const [lead, ...rest] = series.crew || [];
  return {
    ...newJobDoc({ dateKey: day, time: series.time, address: series.address, type: series.type }, template),
    property: series.property,
    source: "app",
    assignedTo: lead || null,
    assignedToName: lead ? nameOf(lead) || "Cleaner" : null,
    crew: rest.length ? rest : null,
    seriesId: series.id,
    seriesDate: day,
  };
}

// Carries out a fill plan. Each new cleaning is created only if its fixed id
// isn't there yet, so another owner phone doing the same at once can't double
// it. Returns how many cleanings were added.
export async function fillRepeats(plan: FillPlan, template: string[] | null, employees: Employee[]): Promise<number> {
  const nameOf = (id: string) => employees.find(e => e.id === id)?.name;
  let added = 0;
  for (const { series, day } of plan.create) {
    const ref = doc(db, "jobs", seriesJobId(series.id, day));
    const made = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists()) return false;
      tx.set(ref, seriesJobFields(series, day, template, nameOf));
      return true;
    });
    if (made) added += 1;
  }
  if (plan.adopt.length) {
    const batch = writeBatch(db);
    plan.adopt.forEach(({ series, day, jobId }) => batch.update(doc(db, "jobs", jobId), { seriesId: series.id, seriesDate: day }));
    await batch.commit();
  }
  return added;
}

// Cancels a stopped repeat's cleanings after the given day that haven't happened.
export async function cancelSeriesAfter(jobs: Job[], seriesId: string, after: string): Promise<number> {
  const later = jobs.filter(j => j.seriesId === seriesId && !j.done && !j.cancelled && !j.startedAt && (j.dateKey || "") > after);
  if (later.length === 0) return 0;
  const batch = writeBatch(db);
  const at = Date.now();
  later.forEach(j => batch.update(doc(db, "jobs", j.id), { cancelled: true, cancelledAt: at, cancelReason: "Repeat stopped" }));
  await batch.commit();
  return later.length;
}

