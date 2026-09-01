import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { addDoc, collection, deleteDoc, doc, onSnapshot, writeBatch } from "firebase/firestore";
import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useProfile } from "../../components/ProfileProvider";
import { Avatar, BrandButton, Card, EmptyState, ErrorState, FormInput, ScreenHeader, SheetModal } from "../../components/ui";
import { db } from "../../firebase";
import { computeEarned, formatDuration, formatEntryDate, formatMoney } from "../../payroll";
import { colors, radius, shadow } from "../../theme";
import { Employee, TimeEntry } from "../../types";

export default function PayrollScreen() {
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [manualFor, setManualFor] = useState<Employee | null>(null);
  const [manualMinutes, setManualMinutes] = useState("");
  const [manualNote, setManualNote] = useState("");
  const { state } = useProfile();

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "timeEntries"), (snapshot) => {
      const loaded = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as TimeEntry[];
      loaded.sort((a, b) => b.endedAt - a.endedAt);
      setEntries(loaded);
      setLoadError(false);
    }, (error) => {
      console.warn("timeEntries listener error:", error);
      setLoadError(true);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "employees"), (snapshot) => {
      const loaded = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Employee[];
      loaded.sort((a, b) => a.name.localeCompare(b.name));
      setEmployees(loaded);
    }, (error) => {
      console.warn("employees listener error:", error);
      setLoadError(true);
    });
    return unsub;
  }, []);

  const unpaid = entries.filter(e => !e.paid);
  const paid = entries.filter(e => e.paid);
  const orphanedUnpaid = unpaid.filter(e => !employees.some(emp => emp.id === e.employeeId));
  const totalOwed = unpaid.reduce((sum, e) => sum + e.earned, 0);
  const totalMinutes = unpaid.reduce((sum, e) => sum + e.minutes, 0);

  const markPaid = (emp: Employee, empEntries: TimeEntry[], total: number) => {
    Alert.alert(
      "Mark paid",
      `Mark ${formatMoney(total)} (${empEntries.length} entr${empEntries.length === 1 ? "y" : "ies"}) as paid to ${emp.name} via Zelle?\n\nDo this after you've actually sent the Zelle payment.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Mark paid",
          onPress: async () => {
            try {
              const batch = writeBatch(db);
              const paidAt = Date.now();
              empEntries.forEach(e => {
                batch.update(doc(db, "timeEntries", e.id), { paid: true, paidAt, method: "Zelle" });
              });
              await batch.commit();
            } catch (err) {
              console.warn("mark paid failed:", err);
              Alert.alert("Couldn't mark paid", "The entries are still marked unpaid. Check your connection and try again.");
            }
          },
        },
      ]
    );
  };

  const copyZelle = async (emp: Employee) => {
    if (!emp.zelle) {
      Alert.alert("No Zelle info", `Add ${emp.name}'s Zelle phone or email on the Team screen.`);
      return;
    }
    await Clipboard.setStringAsync(emp.zelle);
    Alert.alert("Copied", `${emp.name}'s Zelle info (${emp.zelle}) copied. Paste it in your banking app to send the payment.`);
  };

  const deleteEntry = (entry: TimeEntry) => {
    Alert.alert(
      "Delete time entry",
      `Delete ${formatDuration(entry.minutes)} (${formatMoney(entry.earned)}) for ${entry.employeeName}? This can't be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteDoc(doc(db, "timeEntries", entry.id));
          },
        },
      ]
    );
  };

  const openManual = (emp: Employee) => {
    setManualFor(emp);
    setManualMinutes("");
    setManualNote("");
  };

  const saveManual = async () => {
    if (!manualFor) return;
    const minutes = parseInt(manualMinutes, 10);
    if (isNaN(minutes) || minutes <= 0 || minutes > 24 * 60) {
      Alert.alert("Invalid minutes", "Enter the number of minutes worked, like 90.");
      return;
    }
    const nowMs = Date.now();
    try {
      await addDoc(collection(db, "timeEntries"), {
        jobId: null,
        jobAddress: manualNote.trim() || "Manual entry",
        jobDate: formatEntryDate(nowMs),
        employeeId: manualFor.id,
        employeeName: manualFor.name,
        startedAt: nowMs,
        endedAt: nowMs,
        minutes,
        hourlyRate: manualFor.hourlyRate,
        earned: computeEarned(minutes, manualFor.hourlyRate),
        paid: false,
        paidAt: null,
        method: null,
        manual: true,
        note: manualNote.trim(),
      });
      setManualFor(null);
    } catch (e) {
      console.warn("manual entry failed:", e);
      Alert.alert("Couldn't add time", "The entry didn't save. Check your connection and try again.");
    }
  };

  const manualPreviewMinutes = parseInt(manualMinutes, 10);
  const showManualPreview = manualFor && !isNaN(manualPreviewMinutes) && manualPreviewMinutes > 0;

  if (state.status !== "owner") {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Payroll" />
        <EmptyState
          icon="lock-closed-outline"
          title="Owner only"
          body="Payroll is only available on the owner's profile."
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Payroll" subtitle="Hours tracked, pay owed, Zelle-ready" />

      <SheetModal visible={manualFor !== null} title={`Add time for ${manualFor?.name || ""}`} onClose={() => setManualFor(null)}>
        <FormInput label="Minutes worked" placeholder="e.g. 90" value={manualMinutes} onChangeText={setManualMinutes} keyboardType="number-pad" />
        <FormInput label="What was it for? (optional)" placeholder="e.g. Deep clean at Desert Oasis" value={manualNote} onChangeText={setManualNote} />
        {showManualPreview && (
          <View style={styles.previewStrip}>
            <Ionicons name="calculator-outline" size={15} color={colors.tealDark} />
            <Text style={styles.previewText}>
              {formatDuration(manualPreviewMinutes)} × {formatMoney(manualFor.hourlyRate)}/hr = {formatMoney(computeEarned(manualPreviewMinutes, manualFor.hourlyRate))}
            </Text>
          </View>
        )}
        <BrandButton label="Add entry" icon="add" onPress={saveManual} />
      </SheetModal>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={[styles.hero, shadow.card]}>
          <Text style={styles.heroLabel}>TOTAL OWED</Text>
          <Text style={styles.heroAmount}>{formatMoney(totalOwed)}</Text>
          <Text style={styles.heroSub}>
            {totalOwed > 0
              ? `${formatDuration(totalMinutes)} of unpaid work across ${unpaid.length} entr${unpaid.length === 1 ? "y" : "ies"}`
              : "Everyone is paid up"}
          </Text>
        </View>

        {loadError && (
          <ErrorState
            title="Can't load payroll"
            body="Firestore blocked access to the employees or timeEntries collection. Update the security rules in the Firebase console, then reopen this screen."
          />
        )}
        {!loadError && employees.length === 0 && (
          <EmptyState
            icon="cash-outline"
            title="No cleaners yet"
            body="Add cleaners on the Team screen. Their tracked hours and pay will show up here."
          />
        )}

        {employees.filter(e => e.active || unpaid.some(en => en.employeeId === e.id)).map(emp => {
          const empUnpaid = unpaid.filter(e => e.employeeId === emp.id);
          const total = empUnpaid.reduce((sum, e) => sum + e.earned, 0);
          const empMinutes = empUnpaid.reduce((sum, e) => sum + e.minutes, 0);
          return (
            <Card key={emp.id}>
              <View style={styles.empTop}>
                <Avatar name={emp.name} photo={emp.photo} size={38} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.empName}>{emp.name}</Text>
                  <Text style={styles.empSub}>
                    {empUnpaid.length === 0
                      ? "No unpaid time"
                      : `${formatDuration(empMinutes)} at ${formatMoney(emp.hourlyRate)}/hr`}
                  </Text>
                </View>
                <Text style={[styles.empOwed, total === 0 && { color: colors.faint }]}>{formatMoney(total)}</Text>
              </View>

              {empUnpaid.map(entry => (
                <View key={entry.id} style={styles.entryRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.entryAddress}>{entry.jobAddress}</Text>
                    <Text style={styles.entryMeta}>
                      {entry.jobDate} · {formatDuration(entry.minutes)} · {formatMoney(entry.earned)}{entry.manual ? " · manual" : ""}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => deleteEntry(entry)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={16} color={colors.faint} />
                  </TouchableOpacity>
                </View>
              ))}

              <View style={styles.actionRow}>
                {empUnpaid.length > 0 && (
                  <BrandButton
                    label={`Mark ${formatMoney(total)} paid`}
                    icon="checkmark-circle"
                    onPress={() => markPaid(emp, empUnpaid, total)}
                    style={styles.actionMain}
                  />
                )}
                <TouchableOpacity style={styles.smallAction} onPress={() => copyZelle(emp)}>
                  <Ionicons name="copy-outline" size={15} color={colors.tealDark} />
                  <Text style={styles.smallActionText}>Zelle</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.smallAction} onPress={() => openManual(emp)}>
                  <Ionicons name="add" size={16} color={colors.tealDark} />
                  <Text style={styles.smallActionText}>Time</Text>
                </TouchableOpacity>
              </View>
            </Card>
          );
        })}

        {orphanedUnpaid.length > 0 && (
          <Card>
            <Text style={styles.empName}>Deleted cleaners</Text>
            <Text style={styles.empSub}>Unpaid entries from cleaners no longer on the team</Text>
            {orphanedUnpaid.map(entry => (
              <View key={entry.id} style={styles.entryRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.entryAddress}>{entry.employeeName} — {entry.jobAddress}</Text>
                  <Text style={styles.entryMeta}>
                    {entry.jobDate} · {formatDuration(entry.minutes)} · {formatMoney(entry.earned)}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => deleteEntry(entry)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={16} color={colors.faint} />
                </TouchableOpacity>
              </View>
            ))}
          </Card>
        )}

        <TouchableOpacity style={styles.historyToggle} onPress={() => setShowHistory(!showHistory)}>
          <Ionicons name={showHistory ? "chevron-up" : "time-outline"} size={15} color={colors.tealDark} />
          <Text style={styles.historyToggleText}>
            {showHistory ? "Hide paid history" : `Paid history (${paid.length})`}
          </Text>
        </TouchableOpacity>

        {showHistory && paid.slice(0, 100).map(entry => (
          <View key={entry.id} style={styles.paidRow}>
            <Ionicons name="checkmark-circle" size={17} color={colors.teal} />
            <View style={{ flex: 1 }}>
              <Text style={styles.entryAddress}>{entry.employeeName} — {entry.jobAddress}</Text>
              <Text style={styles.entryMeta}>
                {entry.jobDate} · {formatDuration(entry.minutes)} · {formatMoney(entry.earned)} · paid {entry.paidAt ? formatEntryDate(entry.paidAt) : ""}{entry.method ? ` via ${entry.method}` : ""}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20 },
  hero: {
    backgroundColor: colors.dark, borderRadius: radius.lg, padding: 20, marginBottom: 14,
  },
  heroLabel: { fontSize: 11, fontWeight: "700", color: "#9FB4BE", letterSpacing: 1.5 },
  heroAmount: { fontSize: 34, fontWeight: "700", color: colors.white, marginTop: 4 },
  heroSub: { fontSize: 13, color: "#B9CAD2", marginTop: 4 },
  empTop: { flexDirection: "row", alignItems: "center", gap: 11 },
  empName: { fontSize: 15.5, fontWeight: "700", color: colors.ink },
  empSub: { fontSize: 12.5, color: colors.muted, marginTop: 1 },
  empOwed: { fontSize: 18, fontWeight: "700", color: colors.tealDark },
  entryRow: {
    flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9,
    borderTopWidth: 1, borderTopColor: colors.bg, marginTop: 9,
  },
  entryAddress: { fontSize: 13.5, fontWeight: "600", color: colors.ink },
  entryMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  actionRow: { flexDirection: "row", gap: 8, marginTop: 12, alignItems: "stretch" },
  actionMain: { flex: 1, paddingVertical: 11 },
  smallAction: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4,
    borderWidth: 1.5, borderColor: colors.line, borderRadius: radius.md,
    paddingHorizontal: 13, paddingVertical: 11, backgroundColor: colors.card,
  },
  smallActionText: { fontSize: 13, fontWeight: "600", color: colors.tealDark },
  historyToggle: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 13 },
  historyToggleText: { fontSize: 13.5, fontWeight: "600", color: colors.tealDark },
  paidRow: {
    flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.card,
    borderRadius: radius.md, padding: 12, marginBottom: 7, borderWidth: 1, borderColor: colors.line, opacity: 0.75,
  },
  previewStrip: {
    flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: colors.tealSoft,
    borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 14,
  },
  previewText: { fontSize: 13.5, fontWeight: "600", color: colors.tealDark },
});
