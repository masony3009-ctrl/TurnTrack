import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { addDoc, collection, deleteDoc, doc, onSnapshot, updateDoc, writeBatch } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { MyPay } from "../../components/MyPay";
import { useProfile } from "../../components/ProfileProvider";
import { alertSoon, Avatar, BrandButton, Card, DatePickerField, EmptyState, ErrorState, FormInput, ScreenHeader, SheetModal } from "../../components/ui";
import { db } from "../../firebase";
import { computeEarned, formatDuration, formatEntryDate, formatMoney } from "../../payroll";
import { LONG_SESSION_MINUTES } from "../../session";
import { cleanerColor, colors, radius, shadow } from "../../theme";
import { dateFromKey, keyFromDate, todayKey } from "../../turnover";
import { Employee, TimeEntry } from "../../types";

const HISTORY_LIMIT = 100;

// Noon on the chosen day, so a manual or corrected entry sorts on that date.
function noonOf(dateKey: string): number {
  const d = dateFromKey(dateKey) || new Date();
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

type Payee = { id: string; name: string };

export default function PayrollScreen() {
  // null until loaded, so "Everyone is paid up" never flashes over real debts.
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [manualFor, setManualFor] = useState<Employee | null>(null);
  const [manualMinutes, setManualMinutes] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [manualDateKey, setManualDateKey] = useState<string | null>(todayKey());
  const [editing, setEditing] = useState<TimeEntry | null>(null);
  const [editMinutes, setEditMinutes] = useState("");
  const [editDateKey, setEditDateKey] = useState<string | null>(null);
  const { state, employees } = useProfile();
  const isOwner = state.status === "owner";

  // Everyone's pay is the owner's business: cleaners' phones only ever load
  // their own (MyPay).
  useEffect(() => {
    if (!isOwner) return;
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
  }, [isOwner]);

  const all = entries || [];
  const unpaid = all.filter(e => !e.paid);
  const paid = all.filter(e => e.paid);
  const employeeIds = useMemo(() => new Set(employees.map(e => e.id)), [employees]);
  // Unpaid time from cleaners no longer on the team, one group per person.
  const orphanGroups = useMemo(() => {
    const groups = new Map<string, { payee: Payee; entries: TimeEntry[] }>();
    unpaid.filter(e => !employeeIds.has(e.employeeId)).forEach(e => {
      const g = groups.get(e.employeeId) || { payee: { id: e.employeeId, name: e.employeeName }, entries: [] };
      g.entries.push(e);
      groups.set(e.employeeId, g);
    });
    return [...groups.values()];
  }, [unpaid, employeeIds]);
  const totalOwed = unpaid.reduce((sum, e) => sum + e.earned, 0);
  const totalMinutes = unpaid.reduce((sum, e) => sum + e.minutes, 0);

  // Records how it was paid, asked at the moment of marking: not every payment is Zelle.
  const markPaid = (payee: Payee, empEntries: TimeEntry[], total: number) => {
    const settle = async (method: string) => {
      try {
        const batch = writeBatch(db);
        const paidAt = Date.now();
        empEntries.forEach(e => {
          batch.update(doc(db, "timeEntries", e.id), { paid: true, paidAt, method });
        });
        await batch.commit();
      } catch (err) {
        console.warn("mark paid failed:", err);
        Alert.alert("Couldn't mark paid", "The entries are still marked unpaid. Check your connection and try again.");
      }
    };
    Alert.alert(
      "Mark paid",
      `Mark ${formatMoney(total)} (${empEntries.length} entr${empEntries.length === 1 ? "y" : "ies"}) as paid to ${payee.name}?\n\nDo this after you've actually sent the money.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Paid in cash", onPress: () => settle("Cash") },
        { text: "Paid by Zelle", onPress: () => settle("Zelle") },
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
            try {
              await deleteDoc(doc(db, "timeEntries", entry.id));
              setEditing(null);
            } catch (e) {
              console.warn("delete entry failed:", e);
              Alert.alert("Couldn't delete", "The entry is still there. Check your connection and try again.");
            }
          },
        },
      ]
    );
  };

  const openManual = (emp: Employee) => {
    setManualFor(emp);
    setManualMinutes("");
    setManualNote("");
    setManualDateKey(todayKey());
  };

  // Fixing an entry: a timer left on overnight, or the wrong day. Pay is
  // recomputed at the rate the entry was logged at.
  const openEdit = (entry: TimeEntry) => {
    setEditing(entry);
    setEditMinutes(String(entry.minutes));
    setEditDateKey(keyFromDate(new Date(entry.endedAt)));
  };

  const saveEdit = async () => {
    if (!editing) return;
    const minutes = parseInt(editMinutes, 10);
    if (isNaN(minutes) || minutes <= 0 || minutes > 24 * 60) {
      Alert.alert("Invalid minutes", "Enter the number of minutes worked, like 150.");
      return;
    }
    const sameDay = editDateKey === keyFromDate(new Date(editing.endedAt));
    const endedAt = sameDay || !editDateKey ? editing.endedAt : noonOf(editDateKey);
    try {
      await updateDoc(doc(db, "timeEntries", editing.id), {
        minutes,
        earned: computeEarned(minutes, editing.hourlyRate),
        endedAt,
        startedAt: endedAt - minutes * 60000,
        ...(sameDay ? {} : { jobDate: formatEntryDate(endedAt) }),
        editedAt: Date.now(),
      });
      setEditing(null);
    } catch (e) {
      console.warn("edit entry failed:", e);
      Alert.alert("Couldn't save", "The entry didn't change. Check your connection and try again.");
    }
  };

  const saveManual = async () => {
    if (!manualFor) return;
    const minutes = parseInt(manualMinutes, 10);
    if (isNaN(minutes) || minutes <= 0 || minutes > 24 * 60) {
      Alert.alert("Invalid minutes", "Enter the number of minutes worked, like 90.");
      return;
    }
    const endedAt = manualDateKey && manualDateKey !== todayKey() ? noonOf(manualDateKey) : Date.now();
    try {
      await addDoc(collection(db, "timeEntries"), {
        jobId: null,
        jobAddress: manualNote.trim() || "Manual entry",
        jobDate: formatEntryDate(endedAt),
        employeeId: manualFor.id,
        employeeName: manualFor.name,
        startedAt: endedAt - minutes * 60000,
        endedAt,
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
      alertSoon("Time added", `${formatDuration(minutes)} logged for ${manualFor.name}.`);
    } catch (e) {
      console.warn("manual entry failed:", e);
      Alert.alert("Couldn't add time", "The entry didn't save. Check your connection and try again.");
    }
  };

  const manualPreviewMinutes = parseInt(manualMinutes, 10);
  const showManualPreview = manualFor && !isNaN(manualPreviewMinutes) && manualPreviewMinutes > 0;

  const editPreview = parseInt(editMinutes, 10);

  // A cleaner (or the owner viewing as one) sees only their own pay.
  if (state.status === "cleaner") return <MyPay employee={state.employee} />;
  if (!isOwner) {
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

      <SheetModal visible={editing !== null} title={`Fix ${editing?.employeeName.split(" ")[0] || ""}'s time`} onClose={() => setEditing(null)}>
        {editing ? <Text style={styles.editLead}>{editing.jobAddress} · logged at {formatMoney(editing.hourlyRate)}/hr</Text> : null}
        <DatePickerField label="Day" value={editDateKey} onChange={setEditDateKey} />
        <FormInput label="Minutes worked" placeholder="e.g. 150" value={editMinutes} onChangeText={setEditMinutes} keyboardType="number-pad" />
        {editing && !isNaN(editPreview) && editPreview > 0 ? (
          <View style={styles.previewStrip}>
            <Ionicons name="calculator-outline" size={15} color={colors.tealDark} />
            <Text style={styles.previewText}>
              {formatDuration(editPreview)} × {formatMoney(editing.hourlyRate)}/hr = {formatMoney(computeEarned(editPreview, editing.hourlyRate))}
            </Text>
          </View>
        ) : null}
        <BrandButton label="Save" icon="checkmark" onPress={saveEdit} />
        {editing ? (
          <TouchableOpacity style={styles.deleteLink} onPress={() => deleteEntry(editing)} accessibilityRole="button">
            <Ionicons name="trash-outline" size={15} color={colors.danger} />
            <Text style={styles.deleteLinkText}>Delete this entry</Text>
          </TouchableOpacity>
        ) : null}
      </SheetModal>

      <SheetModal visible={manualFor !== null} title={`Add time for ${manualFor?.name || ""}`} onClose={() => setManualFor(null)}>
        <DatePickerField label="Day" value={manualDateKey} onChange={setManualDateKey} />
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
          {entries ? (
            <>
              <Text style={styles.heroAmount}>{formatMoney(totalOwed)}</Text>
              <Text style={styles.heroSub}>
                {totalOwed > 0
                  ? `${formatDuration(totalMinutes)} of unpaid work across ${unpaid.length} entr${unpaid.length === 1 ? "y" : "ies"}`
                  : "Everyone is paid up"}
              </Text>
            </>
          ) : (
            <View style={styles.heroLoading}>
              <ActivityIndicator color={colors.white} />
              <Text style={styles.heroSub}>Loading pay…</Text>
            </View>
          )}
        </View>

        {loadError && (
          <ErrorState
            title="Can't load payroll"
            body="Firestore blocked access to the timeEntries collection. Update the security rules in the Firebase console, then reopen this screen."
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
                <Avatar name={emp.name} photo={emp.photo} color={cleanerColor(emp)} size={38} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.empName}>{emp.name}</Text>
                  <Text style={styles.empSub}>
                    {empUnpaid.length === 0
                      ? `No unpaid time · ${formatMoney(emp.hourlyRate)}/hr`
                      : `${formatDuration(empMinutes)} unpaid, at the rate each was logged`}
                  </Text>
                </View>
                <Text style={[styles.empOwed, total === 0 && { color: colors.faint }]}>{formatMoney(total)}</Text>
              </View>

              {empUnpaid.map(entry => <EntryRow key={entry.id} entry={entry} onPress={() => openEdit(entry)} />)}

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

        {orphanGroups.map(({ payee, entries: owed }) => {
          const total = owed.reduce((sum, e) => sum + e.earned, 0);
          return (
            <Card key={payee.id}>
              <View style={styles.empTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.empName}>{payee.name}</Text>
                  <Text style={styles.empSub}>No longer on the team · unpaid time</Text>
                </View>
                <Text style={styles.empOwed}>{formatMoney(total)}</Text>
              </View>
              {owed.map(entry => <EntryRow key={entry.id} entry={entry} onPress={() => openEdit(entry)} />)}
              <View style={styles.actionRow}>
                <BrandButton label={`Mark ${formatMoney(total)} paid`} icon="checkmark-circle" onPress={() => markPaid(payee, owed, total)} style={styles.actionMain} />
              </View>
            </Card>
          );
        })}

        <TouchableOpacity style={styles.historyToggle} onPress={() => setShowHistory(!showHistory)}>
          <Ionicons name={showHistory ? "chevron-up" : "time-outline"} size={15} color={colors.tealDark} />
          <Text style={styles.historyToggleText}>
            {showHistory ? "Hide paid history" : `Paid history (${paid.length})`}
          </Text>
        </TouchableOpacity>

        {showHistory && paid.length > HISTORY_LIMIT ? (
          <Text style={styles.historyNote}>Showing the latest {HISTORY_LIMIT} of {paid.length} payments.</Text>
        ) : null}
        {showHistory && paid.slice(0, HISTORY_LIMIT).map(entry => (
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

// One unpaid entry; tap to fix its time or delete it. Very long ones are
// flagged, since a timer left running is the usual way pay goes wrong.
function EntryRow({ entry, onPress }: { entry: TimeEntry; onPress: () => void }) {
  const long = entry.minutes > LONG_SESSION_MINUTES;
  return (
    <TouchableOpacity style={styles.entryRow} onPress={onPress} accessibilityRole="button" accessibilityHint="Opens the entry to fix or delete it">
      <View style={{ flex: 1 }}>
        <Text style={styles.entryAddress}>{entry.jobAddress}</Text>
        <Text style={styles.entryMeta}>
          {entry.jobDate} · {formatDuration(entry.minutes)} · {formatMoney(entry.earned)}{entry.manual ? " · manual" : ""}
        </Text>
        {long ? <Text style={styles.entryWarn}>Over {LONG_SESSION_MINUTES / 60} hours: was the timer left on? Tap to fix.</Text> : null}
      </View>
      <Ionicons name="create-outline" size={17} color={colors.tealDark} />
    </TouchableOpacity>
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
    flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 9, minHeight: 48,
    borderTopWidth: 1, borderTopColor: colors.bg, marginTop: 9,
  },
  entryAddress: { fontSize: 13.5, fontWeight: "600", color: colors.ink },
  entryMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  entryWarn: { fontSize: 12, fontWeight: "700", color: colors.goldDark, marginTop: 3 },
  editLead: { fontSize: 13.5, color: colors.muted, marginBottom: 12 },
  heroLoading: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  historyNote: { fontSize: 12.5, color: colors.muted, textAlign: "center", marginBottom: 8 },
  deleteLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 6, minHeight: 44 },
  deleteLinkText: { color: colors.danger, fontSize: 13.5, fontWeight: "600" },
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
