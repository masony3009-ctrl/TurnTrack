import { Ionicons } from "@expo/vector-icons";
import { arrayRemove, arrayUnion, doc, updateDoc } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { db } from "../firebase";
import { TIME_CHOICES } from "../jobTime";
import { sendPushToOwners } from "../notifications";
import { colors, radius } from "../theme";
import {
  buildTimeOff, clashingJobs, clashMessage, datesLabel, hoursLabel, pastTimeOff, timeOffOf,
  type TimeOff, type TimeOffKind,
} from "../timeOff";
import { dateFromKey, formatShortDate, jobDateKey, todayKey } from "../turnover";
import { Employee, Job } from "../types";
import { tapSelect, tapSuccess, tapWarning } from "./haptics";
import { TimeChips } from "./TimeChips";
import { alertSoon, BrandButton, DatePickerField, FormInput, SheetModal } from "./ui";

const KINDS: { kind: TimeOffKind; label: string }[] = [
  { kind: "day", label: "One day" },
  { kind: "days", label: "A few days" },
  { kind: "weekly", label: "Every week" },
];
const WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
// "Until" can't be the first choice, and "from" can't be the last.
const FROM_CHOICES = TIME_CHOICES.slice(0, -1);

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// One line of time off: when, the hours, and the reason.
export function TimeOffRow({ block, today, onRemove }: { block: TimeOff; today: string; onRemove?: () => void }) {
  const when = datesLabel(block, today);
  return (
    <View style={styles.row}>
      <Ionicons name={block.weekdays ? "repeat" : "calendar-clear-outline"} size={18} color={colors.tealDark} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{when}</Text>
        <Text style={styles.rowSub}>{hoursLabel(block)}{block.note ? ` · ${block.note}` : ""}</Text>
      </View>
      {onRemove ? (
        <TouchableOpacity onPress={onRemove} hitSlop={10} style={styles.rowRemove} accessibilityRole="button" accessibilityLabel={`Remove time off, ${when}`}>
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// Asks first, then takes one block off the cleaner's record.
export function confirmRemoveTimeOff(employee: Employee, block: TimeOff, ownerViewing: boolean) {
  const today = todayKey();
  const first = employee.name.split(" ")[0];
  Alert.alert(
    "Remove this time off?",
    `${datesLabel(block, today)}, ${hoursLabel(block).toLowerCase()}. ${ownerViewing ? `${first} shows` : "You'll show"} as free again.`,
    [
      { text: "Keep it", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            // Anything already over goes too, so the record stays short.
            await updateDoc(doc(db, "employees", employee.id), { timeOff: arrayRemove(block, ...pastTimeOff(timeOffOf(employee), today)) });
            tapSuccess();
          } catch (e) {
            console.warn("removing time off failed:", e);
            alertSoon("Couldn't remove it", "Check your signal and try again.");
          }
        },
      },
    ]
  );
}

// The form for blocking out time, starting on the given day (today when
// none). Closes once it's saved.
export function TimeOffSheet({ visible, employee, ownerViewing, jobs, houseOf, startDay, onClose }: {
  visible: boolean;
  employee: Employee;
  // The owner looking at the app as this cleaner: their phone isn't told.
  ownerViewing: boolean;
  // Every job; the cleaner's own are picked out to warn about clashes.
  jobs: Job[];
  houseOf: (job: Job) => string;
  startDay: string | null;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<TimeOffKind>("day");
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [allDay, setAllDay] = useState(true);
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // A fresh form every time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    const day = startDay || todayKey();
    setKind("day");
    setStart(day);
    setEnd(null);
    setWeekdays([(dateFromKey(day) as Date).getDay()]);
    setAllDay(true);
    setFrom(null);
    setTo(null);
    setNote("");
    setError(null);
    setSaving(false);
  }, [visible, startDay]);

  const untilChoices = useMemo(() => (from ? TIME_CHOICES.filter(t => t > from) : TIME_CHOICES.slice(1)), [from]);
  const first = employee.name.split(" ")[0];

  const pickKind = (k: TimeOffKind) => { tapSelect(); setKind(k); setError(null); };
  const pickFrom = (t: string | null) => {
    setFrom(t);
    if (t && to && to <= t) setTo(null);
    setError(null);
  };
  const toggleWeekday = (d: number) => {
    tapSelect();
    setWeekdays(prev => (prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]));
    setError(null);
  };

  const save = async () => {
    const now = todayKey();
    const result = buildTimeOff({ kind, start, end, weekdays, allDay, from, to, note }, newId(), Date.now(), now);
    if ("error" in result) {
      tapWarning();
      setError(result.error);
      return;
    }
    setSaving(true);
    try {
      await updateDoc(doc(db, "employees", employee.id), { timeOff: arrayUnion(result.block) });
    } catch (e) {
      console.warn("saving time off failed:", e);
      setSaving(false);
      setError("That didn't save. Check your signal and tap Block it out again.");
      return;
    }
    setSaving(false);
    tapSuccess();
    const mine = jobs.filter(j => j.assignedTo === employee.id).map(j => ({ ...j, dateKey: jobDateKey(j) }));
    const clashes = clashingJobs(result.block, mine, now).map(j => ({ id: j.id, house: houseOf(j), dateKey: j.dateKey as string }));
    if (clashes.length > 0 && !ownerViewing) sendPushToOwners(clashMessage(employee.name, result.block, clashes, now));
    const list = clashes.slice(0, 3).map(c => `${c.house} (${formatShortDate(c.dateKey)})`).join(", ");
    const more = clashes.length > 3 ? ` and ${clashes.length - 3} more` : "";
    const warn = () => (ownerViewing
      ? Alert.alert(`${first} is still booked then`, `${first} is on ${list}${more}. Blocking time doesn't take them off a cleaning. Reassign it from the cleaning.`)
      : Alert.alert("You're still booked then", `You're on ${list}${more}. Blocking time doesn't take you off a cleaning, so the owner has been told.`));
    onClose();
    // iOS drops an alert shown while the sheet is still sliding away.
    if (clashes.length > 0) setTimeout(warn, 450);
  };

  return (
    <SheetModal visible={visible} title="Block out time" onClose={onClose}>
      <Text style={styles.label}>How long</Text>
      <View style={styles.segment}>
        {KINDS.map(k => (
          <TouchableOpacity
            key={k.kind}
            style={[styles.segmentChip, kind === k.kind && styles.segmentChipOn]}
            onPress={() => pickKind(k.kind)}
            accessibilityRole="radio"
            accessibilityState={{ selected: kind === k.kind }}
          >
            <Text style={[styles.segmentText, kind === k.kind && styles.segmentTextOn]}>{k.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {kind === "day" ? <DatePickerField label="Day" value={start} onChange={d => { setStart(d); setError(null); }} /> : null}
      {kind === "days" ? (
        <>
          <DatePickerField label="First day" value={start} onChange={d => { setStart(d); setError(null); }} />
          <DatePickerField label="Last day" value={end} onChange={d => { setEnd(d); setError(null); }} />
        </>
      ) : null}
      {kind === "weekly" ? (
        <>
          <Text style={styles.label}>Every</Text>
          <View style={styles.weekdays}>
            {WEEKDAY_LETTERS.map((letter, d) => {
              const on = weekdays.includes(d);
              return (
                <TouchableOpacity
                  key={d}
                  style={[styles.weekday, on && styles.weekdayOn]}
                  onPress={() => toggleWeekday(d)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={WEEKDAY_NAMES[d]}
                >
                  <Text style={[styles.weekdayText, on && styles.weekdayTextOn]}>{letter}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <DatePickerField label="Starting" value={start} onChange={d => { setStart(d); setError(null); }} />
        </>
      ) : null}

      <Text style={styles.label}>When</Text>
      <View style={styles.segment}>
        {[true, false].map(value => (
          <TouchableOpacity
            key={String(value)}
            style={[styles.segmentChip, allDay === value && styles.segmentChipOn]}
            onPress={() => { tapSelect(); setAllDay(value); setError(null); }}
            accessibilityRole="radio"
            accessibilityState={{ selected: allDay === value }}
          >
            <Text style={[styles.segmentText, allDay === value && styles.segmentTextOn]}>{value ? "All day" : "Part of the day"}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {!allDay ? (
        <>
          <TimeChips label="Busy from" value={from} onChange={pickFrom} choices={FROM_CHOICES} noneLabel={null} />
          <TimeChips label="Until" value={to} onChange={t => { setTo(t); setError(null); }} choices={untilChoices} noneLabel={null} />
        </>
      ) : null}

      <FormInput label="Reason (optional)" value={note} onChangeText={setNote} placeholder="Class, doctor, out of town…" autoCapitalize="sentences" />
      <Text style={styles.noteHint}>Only {ownerViewing ? first : "you"} and the owner see this.</Text>

      {error ? (
        <View style={styles.error} accessibilityLiveRegion="polite">
          <Ionicons name="alert-circle" size={16} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
      <BrandButton label={saving ? "Saving…" : "Block it out"} icon="checkmark" onPress={save} disabled={saving} />
      <BrandButton label="Cancel" variant="ghost" onPress={onClose} style={{ marginTop: 4 }} />
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.line },
  rowTitle: { fontSize: 15, fontWeight: "700", color: colors.ink },
  rowSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  rowRemove: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6, letterSpacing: 0.3 },
  segment: { flexDirection: "row", gap: 7, marginBottom: 14 },
  segmentChip: {
    flex: 1, minHeight: 42, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", paddingHorizontal: 6,
  },
  segmentChipOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  segmentText: { fontSize: 13.5, fontWeight: "600", color: colors.ink, textAlign: "center" },
  segmentTextOn: { color: colors.white },
  weekdays: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  weekday: {
    width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.bg, alignItems: "center", justifyContent: "center",
  },
  weekdayOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  weekdayText: { fontSize: 14, fontWeight: "700", color: colors.ink },
  weekdayTextOn: { color: colors.white },
  noteHint: { fontSize: 12, color: colors.faint, marginTop: -6, marginBottom: 14 },
  error: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: colors.dangerSoft, borderRadius: radius.sm, padding: 10, marginBottom: 12 },
  errorText: { flex: 1, fontSize: 13.5, fontWeight: "600", color: colors.danger },
});
