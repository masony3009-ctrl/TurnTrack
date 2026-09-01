import { Ionicons } from "@expo/vector-icons";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { db } from "../firebase";
import { colors, radius, shadow, type } from "../theme";
import { Employee } from "../types";
import { useProfile } from "./ProfileProvider";
import { Avatar, BrandButton, FormInput, SheetModal } from "./ui";

type PinTarget =
  | { kind: "owner"; creating: boolean | null }
  | { kind: "cleaner"; employee: Employee; creating: boolean };

export function ProfileGate() {
  const { employees, assignDevice } = useProfile();
  const [target, setTarget] = useState<PinTarget | null>(null);
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [pinError, setPinError] = useState("");
  const [busy, setBusy] = useState(false);

  const activeCleaners = employees.filter(e => e.active);

  const resetSheet = () => {
    setPin("");
    setPinConfirm("");
    setPinError("");
    setBusy(false);
  };

  const openCleaner = (employee: Employee) => {
    resetSheet();
    setTarget({ kind: "cleaner", employee, creating: !employee.pin });
  };

  const openOwner = async () => {
    resetSheet();
    setTarget({ kind: "owner", creating: null });
    try {
      const snap = await getDoc(doc(db, "settings", "owner"));
      const exists = snap.exists() && !!snap.data()?.pin;
      setTarget({ kind: "owner", creating: !exists });
    } catch (e) {
      console.warn("owner pin lookup failed:", e);
      setPinError("Couldn't reach the server. Close this and try again.");
    }
  };

  const submit = async () => {
    if (!target || busy || target.creating === null) return;
    const entered = pin.trim();
    if (!/^\d{4,8}$/.test(entered)) {
      setPinError("The PIN must be 4 to 8 digits.");
      return;
    }
    if (target.creating && pinConfirm.trim() !== entered) {
      setPinError("The PINs don't match.");
      return;
    }
    setBusy(true);
    setPinError("");
    try {
      if (target.kind === "owner") {
        if (target.creating) {
          await setDoc(doc(db, "settings", "owner"), { pin: entered, createdAt: Date.now() });
        } else {
          const snap = await getDoc(doc(db, "settings", "owner"));
          if (entered !== snap.data()?.pin) {
            setPinError("Wrong PIN — try again.");
            setBusy(false);
            return;
          }
        }
        await assignDevice({ role: "owner" });
      } else {
        const emp = target.employee;
        if (target.creating) {
          await updateDoc(doc(db, "employees", emp.id), { pin: entered });
        } else {
          const snap = await getDoc(doc(db, "employees", emp.id));
          if (entered !== snap.data()?.pin) {
            setPinError("Wrong PIN — try again. If you forgot it, ask the owner to reset it.");
            setBusy(false);
            return;
          }
        }
        await assignDevice({ role: "cleaner", employeeId: emp.id, employeeName: emp.name });
      }
      setTarget(null);
    } catch (e) {
      console.warn("sign in failed:", e);
      setPinError("Something went wrong signing in. Try again.");
    }
    setBusy(false);
  };

  const sheetTitle = !target
    ? ""
    : target.kind === "owner"
      ? target.creating ? "Create owner PIN" : "Owner sign-in"
      : target.creating
        ? `Welcome, ${target.employee.name.split(" ")[0]}!`
        : `Hi ${target.employee.name.split(" ")[0]}`;

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <Text style={type.wordmark}>TurnTrack</Text>
        <Text style={styles.title}>Sign in</Text>
        <Text style={styles.sub}>Tap your profile and enter your PIN. This phone stays signed in.</Text>

        <Text style={[type.section, styles.sectionLabel]}>Cleaners</Text>
        {activeCleaners.length === 0 && (
          <View style={[styles.hintCard, shadow.card]}>
            <Ionicons name="people-outline" size={20} color={colors.faint} />
            <Text style={styles.hintText}>
              No cleaner profiles yet. The owner adds cleaners on the Team tab.
            </Text>
          </View>
        )}
        {activeCleaners.map(emp => (
          <TouchableOpacity
            key={emp.id}
            style={[styles.cleanerRow, shadow.card]}
            onPress={() => openCleaner(emp)}
            activeOpacity={0.7}
          >
            <Avatar name={emp.name} photo={emp.photo} size={46} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cleanerName}>{emp.name}</Text>
              {!emp.pin && <Text style={styles.firstTime}>First sign-in — you&apos;ll create your PIN</Text>}
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.faint} />
          </TouchableOpacity>
        ))}

        <Text style={[type.section, styles.sectionLabel]}>Management</Text>
        <TouchableOpacity style={[styles.ownerRow, shadow.card]} onPress={openOwner} activeOpacity={0.7}>
          <View style={styles.ownerIcon}>
            <Ionicons name="shield-checkmark" size={22} color={colors.white} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.ownerTitle}>Owner</Text>
            <Text style={styles.ownerSub}>Payroll, team management, and scheduling</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.faint} />
        </TouchableOpacity>
      </ScrollView>

      <SheetModal visible={target !== null} title={sheetTitle} onClose={() => setTarget(null)}>
        {target?.creating === null && !pinError ? (
          <Text style={styles.checkingText}>Checking…</Text>
        ) : (
          <>
            {target?.creating && (
              <Text style={styles.pinIntro}>
                {target.kind === "owner"
                  ? "First time here — set the PIN that protects the owner side of the app. Share it only with people who should see payroll."
                  : "Pick a PIN only you know. You'll use it to sign in on any phone."}
              </Text>
            )}
            <FormInput
              label={target?.creating ? "New PIN (4–8 digits)" : "PIN"}
              placeholder="••••"
              value={pin}
              onChangeText={setPin}
              keyboardType="number-pad"
              secure
            />
            {target?.creating && (
              <FormInput
                label="Confirm PIN"
                placeholder="••••"
                value={pinConfirm}
                onChangeText={setPinConfirm}
                keyboardType="number-pad"
                secure
              />
            )}
          </>
        )}
        {pinError ? <Text style={styles.pinErrorText}>{pinError}</Text> : null}
        <BrandButton
          label={busy ? "One sec…" : target?.creating ? "Set PIN & sign in" : "Sign in"}
          icon="lock-closed"
          onPress={submit}
        />
      </SheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingTop: 84, paddingHorizontal: 24, paddingBottom: 48 },
  title: { fontSize: 26, fontWeight: "700", color: colors.ink, marginTop: 4 },
  sub: { fontSize: 14, color: colors.muted, marginTop: 4, marginBottom: 22 },
  sectionLabel: { marginBottom: 8, marginTop: 10 },
  cleanerRow: {
    flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card,
    borderRadius: radius.lg, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: colors.line,
  },
  cleanerName: { fontSize: 16, fontWeight: "600", color: colors.ink },
  firstTime: { fontSize: 12, color: colors.tealDark, fontWeight: "600", marginTop: 1 },
  hintCard: {
    flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.card,
    borderRadius: radius.lg, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: colors.line,
  },
  hintText: { flex: 1, fontSize: 13.5, color: colors.muted, lineHeight: 19 },
  ownerRow: {
    flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card,
    borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.line,
  },
  ownerIcon: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: colors.teal,
    alignItems: "center", justifyContent: "center",
  },
  ownerTitle: { fontSize: 16, fontWeight: "700", color: colors.ink },
  ownerSub: { fontSize: 12.5, color: colors.muted, marginTop: 1 },
  checkingText: { fontSize: 14, color: colors.muted, marginBottom: 14 },
  pinIntro: { fontSize: 13.5, color: colors.muted, lineHeight: 19, marginBottom: 14 },
  pinErrorText: { fontSize: 13.5, fontWeight: "600", color: colors.danger, marginBottom: 12 },
});
