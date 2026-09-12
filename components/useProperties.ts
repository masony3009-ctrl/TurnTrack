import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "../firebase";
import { parseProperties, type Property } from "../properties";

// Live view of settings/properties. One subscription per screen that needs
// it; the doc is small and changes about never.
export function useProperties(): Property[] {
  const [properties, setProperties] = useState<Property[]>([]);
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, "settings", "properties"),
      (snap) => setProperties(parseProperties(snap.data()?.items)),
      (error) => console.warn("properties listen failed:", error)
    );
    return unsub;
  }, []);
  return properties;
}
