import { doc, onSnapshot, runTransaction } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../firebase";
import { dropEvent, eventsOf, putEvent, type OwnerEvent } from "../ownerEvents";
import { todayKey } from "../turnover";

const REF = () => doc(db, "settings", "ownerEvents");

// The owner's events, live. Null until loaded; stays null (and reads nothing)
// on a cleaner's phone. failed = they couldn't be read, so the screen can say
// so instead of showing a calendar that quietly has no meetings on it.
export function useOwnerEvents(enabled: boolean): { events: OwnerEvent[] | null; failed: boolean } {
  const [events, setEvents] = useState<OwnerEvent[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    return onSnapshot(REF(), snap => {
      setEvents(eventsOf(snap.data()?.items));
      setFailed(false);
    }, error => {
      console.warn("owner events listener error:", error);
      setEvents(prev => prev || []);
      setFailed(true);
    });
  }, [enabled]);
  return { events: enabled ? events : null, failed: enabled && failed };
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
