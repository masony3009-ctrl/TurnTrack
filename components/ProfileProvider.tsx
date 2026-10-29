import * as Application from "expo-application";
import { collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import { db, ensureSignedIn } from "../firebase";
import { clearScheduledReminders, pushRecordFields } from "../notifications";
import { DeviceRecord, Employee } from "../types";

export type ProfileState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "unset" }
  | { status: "owner" }
  // ownerViewing is true when the owner is looking at the app as a cleaner
  // without that cleaner's PIN. The phone itself stays the owner's.
  | { status: "cleaner"; employee: Employee; ownerViewing: boolean };

type ProfileContextValue = {
  state: ProfileState;
  employees: Employee[];
  deviceId: string | null;
  assignDevice: (record: DeviceRecord) => Promise<void>;
  switchProfile: () => Promise<void>;
  viewAs: (employee: Employee | null) => void;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

async function resolveDeviceId(): Promise<string> {
  if (Platform.OS === "android") {
    return "and-" + (Application.getAndroidId() || "unknown");
  }
  if (Platform.OS === "ios") {
    const id = await Application.getIosIdForVendorAsync();
    return "ios-" + (id || "unknown");
  }
  try {
    const existing = window.localStorage.getItem("turntrack-device-id");
    if (existing) return existing;
    const fresh = "web-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    window.localStorage.setItem("turntrack-device-id", fresh);
    return fresh;
  } catch {
    return "web-" + Math.random().toString(36).slice(2);
  }
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  // undefined = first snapshot not received yet; null = no record for this device
  const [deviceRecord, setDeviceRecord] = useState<DeviceRecord | null | undefined>(undefined);
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [viewingAsId, setViewingAsId] = useState<string | null>(null);

  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    resolveDeviceId().then(setDeviceId);
  }, []);

  // Nothing may touch Firestore before the anonymous sign-in lands - once the
  // rules require auth, a listener that starts first is denied and never
  // retries on its own.
  useEffect(() => {
    let cancelled = false;
    ensureSignedIn()
      .then(() => { if (!cancelled) setAuthReady(true); })
      .catch((e) => {
        console.warn("anonymous sign-in failed:", e);
        if (!cancelled) setLoadError(true);
      });
    return () => { cancelled = true; };
  }, []);

  // Drop "view as" if the viewed cleaner is deactivated or deleted, so a
  // later reactivation doesn't snap the owner's phone back into their view.
  useEffect(() => {
    if (!viewingAsId || !employees) return;
    const viewing = employees.find(e => e.id === viewingAsId);
    if (!viewing || !viewing.active) setViewingAsId(null);
  }, [viewingAsId, employees]);

  useEffect(() => {
    if (!deviceId || !authReady) return;
    const unsub = onSnapshot(doc(db, "devices", deviceId), (snap) => {
      setDeviceRecord(snap.exists() ? (snap.data() as DeviceRecord) : null);
    }, (error) => {
      console.warn("device listener error:", error);
      setLoadError(true);
    });
    return unsub;
  }, [deviceId, authReady]);

  useEffect(() => {
    if (!authReady) return;
    const unsub = onSnapshot(collection(db, "employees"), (snap) => {
      const loaded = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Employee[];
      // A record missing its name must not crash every phone at launch.
      loaded.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
      setEmployees(loaded);
    }, (error) => {
      console.warn("employees listener error:", error);
      setLoadError(true);
    });
    return unsub;
  }, [authReady]);

  const state: ProfileState = useMemo(() => {
    if (loadError) return { status: "error" };
    if (!deviceId || deviceRecord === undefined || employees === null) return { status: "loading" };
    if (!deviceRecord) return { status: "unset" };
    if (deviceRecord.role === "owner") {
      const viewing = viewingAsId ? employees.find(e => e.id === viewingAsId) : null;
      if (viewing && viewing.active) return { status: "cleaner", employee: viewing, ownerViewing: true };
      return { status: "owner" };
    }
    const employee = employees.find(e => e.id === deviceRecord.employeeId);
    if (!employee || !employee.active) return { status: "unset" };
    return { status: "cleaner", employee, ownerViewing: false };
  }, [loadError, deviceId, deviceRecord, employees, viewingAsId]);

  // Signed out, deactivated or removed: this phone stops announcing cleanings.
  useEffect(() => {
    if (state.status === "unset") clearScheduledReminders();
  }, [state.status]);

  const value = useMemo<ProfileContextValue>(() => ({
    state,
    employees: employees || [],
    deviceId,
    assignDevice: async (record: DeviceRecord) => {
      if (!deviceId) return;
      setViewingAsId(null);
      // Keeps this phone's push token, so pushes and morning reminders still
      // reach it after a profile switch rewrites the record.
      await setDoc(doc(db, "devices", deviceId), { ...record, ...pushRecordFields(), updatedAt: Date.now() });
    },
    switchProfile: async () => {
      if (!deviceId) return;
      setViewingAsId(null);
      await deleteDoc(doc(db, "devices", deviceId));
    },
    viewAs: (employee: Employee | null) => {
      setViewingAsId(employee ? employee.id : null);
    },
  }), [state, employees, deviceId]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used inside ProfileProvider");
  return ctx;
}
