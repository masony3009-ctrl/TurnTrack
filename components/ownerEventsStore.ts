import { doc, onSnapshot, runTransaction } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../firebase";
import { dropEvent, eventsOf, putEvent, type OwnerEvent } from "../ownerEvents";
import { todayKey } from "../turnover";

const REF = () => doc(db, "settings", "ownerEvents");

// The owner's events, live. Null until loaded; stays null (and reads nothing)
// on a cleaner's phone.
export function useOwnerEvents(enabled: boolean): OwnerEvent[] | null {
  const [events, setEvents] = useState<OwnerEvent[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(REF(), snap => setEvents(eventsOf(snap.data()?.items)), error => {
      console.warn("owner events listener error:", error);
      setEvents(prev => prev || []);
    });
  }, [enabled]);
  return enabled ? events : null;
}

// Read-modify-write of the whole list in one transaction, so two owner phones
// saving at once don't drop each other's change.
async function change(edit: (items: OwnerEvent[]) => OwnerEvent[]): Promise<void> {
  await runTransaction(db, async tx => {
    const snap = await tx.get(REF());
    tx.set(REF(), { items: edit(eventsOf(snap.data()?.items)), updatedAt: Date.now() }, { merge: true });
  });
}

export function saveOwnerEvent(event: OwnerEvent): Promise<void> {
  return change(items => putEvent(items, event, todayKey()));
}

export function deleteOwnerEvent(id: string): Promise<void> {
  return change(items => dropEvent(items, id, todayKey()));
}
