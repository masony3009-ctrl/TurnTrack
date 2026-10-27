import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../firebase";
import { parseSupplies, type SupplyReport } from "../supplies";

// Live view of settings/supplies: houses with supplies flagged as running low.
// Pass false to skip the subscription (cleaners never need it).
export function useSupplies(enabled = true): SupplyReport[] {
  const [reports, setReports] = useState<SupplyReport[]>([]);
  useEffect(() => {
    if (!enabled) {
      setReports([]);
      return;
    }
    return onSnapshot(
      doc(db, "settings", "supplies"),
      (snap) => setReports(parseSupplies(snap.data())),
      (error) => console.warn("supplies listen failed:", error)
    );
  }, [enabled]);
  return reports;
}
