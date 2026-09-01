import * as Application from "expo-application";
import { collection, deleteDoc, doc, onSnapshot, setDoc } from "firebase/firestore";
import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import { db } from "../firebase";
import { DeviceRecord, Employee } from "../types";

export type ProfileState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "unset" }
  | { status: "owner" }
  | { status: "cleaner"; employee: Employee };

type ProfileContextValue = {
  state: ProfileState;
  employees: Employee[];
  assignDevice: (record: DeviceRecord) => Promise<void>;
  switchProfile: () => Promise<void>;
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

  useEffect(() => {
    resolveDeviceId().then(setDeviceId);
  }, []);

  useEffect(() => {
    if (!deviceId) return;
    const unsub = onSnapshot(doc(db, "devices", deviceId), (snap) => {
      setDeviceRecord(snap.exists() ? (snap.data() as DeviceRecord) : null);
    }, (error) => {
      console.warn("device listener error:", error);
      setLoadError(true);
    });
    return unsub;
  }, [deviceId]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "employees"), (snap) => {
      const loaded = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Employee[];
      loaded.sort((a, b) => a.name.localeCompare(b.name));
      setEmployees(loaded);
    }, (error) => {
      console.warn("employees listener error:", error);
      setLoadError(true);
    });
    return unsub;
  }, []);

  const state: ProfileState = useMemo(() => {
    if (loadError) return { status: "error" };
    if (!deviceId || deviceRecord === undefined || employees === null) return { status: "loading" };
    if (!deviceRecord) return { status: "unset" };
    if (deviceRecord.role === "owner") return { status: "owner" };
    const employee = employees.find(e => e.id === deviceRecord.employeeId);
    if (!employee || !employee.active) return { status: "unset" };
    return { status: "cleaner", employee };
  }, [loadError, deviceId, deviceRecord, employees]);

  const value = useMemo<ProfileContextValue>(() => ({
    state,
    employees: employees || [],
    assignDevice: async (record: DeviceRecord) => {
      if (!deviceId) return;
      await setDoc(doc(db, "devices", deviceId), { ...record, updatedAt: Date.now() });
    },
    switchProfile: async () => {
      if (!deviceId) return;
      await deleteDoc(doc(db, "devices", deviceId));
    },
  }), [state, employees, deviceId]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used inside ProfileProvider");
  return ctx;
}
