import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { addDoc, collection, deleteDoc, doc, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { tapSelect, tapSuccess } from "../../components/haptics";
import { useProfile } from "../../components/ProfileProvider";
import { alertSoon, AssigneeRow, BrandButton, Card, DatePickerField, EmptyState, Fab, FormInput, IconButton, Pill, ScreenHeader, SectionHeader, SheetModal } from "../../components/ui";
import { db } from "../../firebase";
import { registerForPushNotifications, scheduleTodaysJobNotifications, sendTestNotification } from "../../notifications";
import { cleanerColor, colors, radius, unassignedColor } from "../../theme";
import { daysFromToday, formatShortDate, GROUP_ORDER, GROUP_TITLES, hasSameDayTurnover, HIDE_AFTER_DAYS, isJobVisible, jobDateKey, jobGroup, JobGroup, relativeDayLabel, sortByDate } from "../../turnover";
import { DEFAULT_CHECKLIST, Employee, Job, newJobDoc, parseChecklistText } from "../../types";

type Section = { group: JobGroup; jobs: Job[] };

export default function JobsScreen() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [newDateKey, setNewDateKey] = useState<string | null>(null);
  const [newAddress, setNewAddress] = useState("");
  const [newType, setNewType] = useState("");
  const [newSameDayTurnover, setNewSameDayTurnover] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const [showChecklistEditor, setShowChecklistEditor] = useState(false);
  const [checklistText, setChecklistText] = useState("");
  const [checklistTemplate, setChecklistTemplate] = useState<string[]>(DEFAULT_CHECKLIST);
  const router = useRouter();
  const { state, switchProfile, viewAs, employees, deviceId } = useProfile();
  const isOwner = state.status === "owner";
  const ownerViewing = state.status === "cleaner" && state.ownerViewing;
  const selfId = state.status === "cleaner" ? state.employee.id : null;
  const firstName = state.status === "cleaner" ? state.employee.name.split(" ")[0] : null;

  useEffect(() => {
    registerForPushNotifications(deviceId);
  }, [deviceId]);

  // The owner's checklist template lives at settings/checklist.
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "settings", "checklist"), (snap) => {
      const items = snap.data()?.items;
      setChecklistTemplate(Array.isArray(items) && items.length > 0 ? items : DEFAULT_CHECKLIST);
    }, (error) => {
      console.warn("checklist listener error:", error);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "jobs"), (snapshot) => {
      const loaded = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Job[];
      // Cancelled jobs and jobs a couple of days past their date leave the
      // phones but stay in Firestore. A running timer always stays visible.
      setJobs(sortByDate(loaded.filter(isJobVisible)));
    });
    return unsub;
  }, []);

  // Owners get reminded about every job; cleaners only about theirs. While
  // the owner is just viewing as a cleaner, their phone keeps the full set.
  useEffect(() => {
    const relevant = selfId && !ownerViewing ? jobs.filter(j => j.assignedTo === selfId) : jobs;
    scheduleTodaysJobNotifications(relevant);
  }, [jobs, selfId, ownerViewing]);

  const employeeById = useMemo(() => {
    const map = new Map<string, Employee>();
    employees.forEach(e => map.set(e.id, e));
    return map;
  }, [employees]);

  const canManage = (job: Job) => isOwner || (!!selfId && job.assignedTo === selfId);

  const toggleDone = async (job: Job) => {
    if (!canManage(job)) return;
    tapSelect();
    try {
      await updateDoc(doc(db, "jobs", job.id), {
        done: !job.done,
        completedAt: !job.done ? Date.now() : null,
      });
    } catch (e) {
      console.warn("toggle done failed:", e);
      Alert.alert("Couldn't update", "Check your connection and try again.");
    }
  };

  const deleteJob = (job: Job) => {
    Alert.alert(
      "Delete job",
      `Delete "${job.address}" on ${job.date}? This removes it from the records too. To just take it off the schedule, cancel it from the job screen instead.`,
      [
        { text: "Keep", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: async () => { await deleteDoc(doc(db, "jobs", job.id)); } },
      ]
    );
  };

  const openChecklistEditor = () => {
    setChecklistText(checklistTemplate.join("\n"));
    setShowChecklistEditor(true);
  };

  const saveChecklist = async () => {
    const items = parseChecklistText(checklistText);
    if (items.length === 0) {
      Alert.alert("Empty checklist", "Add at least one item, one per line.");
      return;
    }
    try {
      await setDoc(doc(db, "settings", "checklist"), { items, updatedAt: Date.now() });
      setShowChecklistEditor(false);
      tapSuccess();
      alertSoon("Checklist saved", `${items.length} items. New cleanings will use this list.`);
    } catch (e) {
      console.warn("save checklist failed:", e);
      Alert.alert("Couldn't save", "The checklist didn't save. Check your connection and try again.");
    }
  };

  const resetForm = () => {
    setNewDateKey(null);
    setNewAddress("");
    setNewType("");
    setNewSameDayTurnover(false);
  };

  const addJob = async () => {
    if (!newDateKey) {
      Alert.alert("Pick a date", "Choose the cleaning date first.");
      return;
    }
    if (!newAddress.trim()) {
      Alert.alert("Missing address", "Enter the property name or address.");
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      await addDoc(collection(db, "jobs"), newJobDoc({
        dateKey: newDateKey,
        address: newAddress,
        type: newType || "Turnover",
        sameDayTurnover: newSameDayTurnover,
      }, checklistTemplate));
      tapSuccess();
      resetForm();
      setShowForm(false);
    } catch (e) {
      console.warn("add job failed:", e);
      Alert.alert("Couldn't add the job", "Check your connection and try again.");
    }
    setSaving(false);
  };

  const onSwitchPress = () => {
    if (ownerViewing) {
      viewAs(null);
      return;
    }
    Alert.alert(
      "Switch profile",
      "This phone goes back to the sign-in screen. You'll need a PIN to get back in.",
      [
        { text: "Stay", style: "cancel" },
        { text: "Switch", onPress: () => { switchProfile(); } },
      ]
    );
  };

  const active = jobs.filter(j => !j.done);
  const todayCount = active.filter(j => daysFromToday(j) === 0).length;
  const weekCount = active.filter(j => {
    const d = daysFromToday(j);
    return d !== null && d >= 0 && d <= 6;
  }).length;
  const unassignedCount = active.filter(j => !j.assignedTo).length;
  const mineCount = selfId ? active.filter(j => j.assignedTo === selfId).length : 0;

  const visibleJobs = selfId && mineOnly ? jobs.filter(j => j.assignedTo === selfId) : jobs;

  const sections: Section[] = useMemo(() => {
    const buckets = new Map<JobGroup, Job[]>();
    visibleJobs.forEach(job => {
      const g = jobGroup(job);
      if (!buckets.has(g)) buckets.set(g, []);
      buckets.get(g)!.push(job);
    });
    return GROUP_ORDER.filter(g => buckets.has(g)).map(g => ({ group: g, jobs: buckets.get(g)! }));
  }, [visibleJobs]);

  const subtitle = firstName
    ? `Hey ${firstName} — ${mineCount} of ${active.length} upcoming ${active.length === 1 ? "is" : "are"} yours`
    : `${active.length} upcoming cleaning${active.length === 1 ? "" : "s"}`;

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Jobs"
        subtitle={subtitle}
        right={
          <>
            {isOwner && <IconButton icon="scan-outline" onPress={() => router.push("/scan-calendar")} />}
            {isOwner && <IconButton icon="list-outline" onPress={openChecklistEditor} />}
            {isOwner && <IconButton icon="notifications-outline" onPress={sendTestNotification} />}
            <IconButton icon={ownerViewing ? "arrow-undo-outline" : "swap-horizontal"} onPress={onSwitchPress} />
          </>
        }
      />

      <View style={styles.statRow}>
        <Stat label="Today" value={todayCount} />
        <Stat label="This week" value={weekCount} />
        {selfId ? (
          <Stat label="Mine" value={mineCount} />
        ) : (
          <Stat label="Unassigned" value={unassignedCount} warn={unassignedCount > 0} />
        )}
      </View>

      {selfId && (
        <View style={styles.filterRow}>
          <FilterChip label="All jobs" active={!mineOnly} onPress={() => { tapSelect(); setMineOnly(false); }} />
          <FilterChip label="My jobs" active={mineOnly} onPress={() => { tapSelect(); setMineOnly(true); }} />
        </View>
      )}

      <SheetModal visible={showChecklistEditor} title="Cleaning checklist" onClose={() => setShowChecklistEditor(false)}>
        <Text style={styles.sheetHint}>
          One item per line. Every new cleaning gets this list, and it pops up when a cleaner taps Start cleaning.
        </Text>
        <FormInput
          label="Checklist items"
          placeholder={"Strip all beds\nWash and dry all laundry\n…"}
          value={checklistText}
          onChangeText={setChecklistText}
          multiline
        />
        <BrandButton label="Save checklist" icon="checkmark" onPress={saveChecklist} />
      </SheetModal>

      <SheetModal visible={showForm} title="New cleaning" onClose={() => setShowForm(false)}>
        <DatePickerField label="Date" value={newDateKey} onChange={setNewDateKey} />
        <FormInput label="Property" placeholder="Name or address" value={newAddress} onChangeText={setNewAddress} autoCapitalize="words" />
        <FormInput label="Job type" placeholder="Turnover" value={newType} onChangeText={setNewType} autoCapitalize="words" />
        <TouchableOpacity
          style={[styles.toggleRow, newSameDayTurnover && styles.toggleRowActive]}
          onPress={() => { tapSelect(); setNewSameDayTurnover(!newSameDayTurnover); }}
          activeOpacity={0.7}
        >
          <Ionicons
            name={newSameDayTurnover ? "checkbox" : "square-outline"}
            size={24}
            color={newSameDayTurnover ? colors.gold : colors.faint}
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.toggleText, newSameDayTurnover && { color: colors.goldDark }]}>Same-day turnover</Text>
            <Text style={styles.toggleSub}>Guest checks out and a new one checks in the same day</Text>
          </View>
        </TouchableOpacity>
        <BrandButton label={saving ? "Adding…" : "Add cleaning"} icon="add" onPress={addJob} disabled={saving} />
      </SheetModal>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 110 }}>
        {visibleJobs.length === 0 && (
          mineOnly && jobs.length > 0 ? (
            <EmptyState
              icon="person-outline"
              title="Nothing assigned to you yet"
              body="When a job gets assigned to you it shows up here. Switch to All jobs to see the whole schedule."
            />
          ) : (
            <EmptyState
              icon="sparkles-outline"
              title="No cleanings coming up"
              body={`Jobs from your booking emails land here automatically. You can also scan an Airbnb calendar or add one by hand. Jobs clear out ${HIDE_AFTER_DAYS} days after the cleaning date.`}
            />
          )
        )}

        {sections.map(section => (
          <View key={section.group}>
            <SectionHeader
              title={GROUP_TITLES[section.group]}
              count={section.jobs.length}
              tone={section.group === "running" ? "live" : section.group === "overdue" ? "warn" : "default"}
            />
            {section.jobs.map(job => {
              const assignee = job.assignedTo ? employeeById.get(job.assignedTo) : undefined;
              const color = job.assignedTo ? cleanerColor(assignee || { id: job.assignedTo }) : unassignedColor;
              return (
                <JobCard
                  key={job.id}
                  job={job}
                  color={color}
                  photo={assignee?.photo}
                  canToggle={canManage(job)}
                  canDelete={isOwner}
                  onPress={() => router.push({ pathname: "/job", params: { id: job.id } })}
                  onToggle={() => toggleDone(job)}
                  onDelete={() => deleteJob(job)}
                />
              );
            })}
          </View>
        ))}
      </ScrollView>

      {isOwner && <Fab icon="add" label="Add cleaning" onPress={() => { resetForm(); setShowForm(true); }} />}
    </View>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <View style={[styles.statChip, warn && styles.statChipWarn]}>
      <Text style={[styles.statNumber, warn && { color: colors.goldDark }]}>{value}</Text>
      <Text style={[styles.statLabel, warn && { color: colors.goldDark }]}>{label}</Text>
    </View>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.filterChip, active && styles.filterChipActive]} onPress={onPress} activeOpacity={0.7}>
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function JobCard({ job, color, photo, canToggle, canDelete, onPress, onToggle, onDelete }: {
  job: Job;
  color: string;
  photo?: string | null;
  canToggle: boolean;
  canDelete: boolean;
  onPress: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const sameDay = hasSameDayTurnover(job);
  const key = jobDateKey(job);
  const days = daysFromToday(job);
  const rel = relativeDayLabel(days);
  const running = !!job.startedAt;
  return (
    <Card tone={sameDay && !job.done ? "gold" : "default"} accent={color} onPress={onPress} style={job.done ? styles.cardDone : undefined}>
      <View style={styles.cardTop}>
        <View style={styles.pillRow}>
          {running ? <Pill label="In progress" tone="solid" icon="time" /> : null}
          {job.done ? <Pill label="Done" tone="neutral" icon="checkmark" /> : null}
          {sameDay ? <Pill label="Same-day" tone="gold" icon="alert-circle" /> : null}
          <Pill label={job.type} tone="neutral" />
        </View>
        {canDelete && (
          <TouchableOpacity onPress={onDelete} hitSlop={10} style={styles.trashBtn}>
            <Ionicons name="trash-outline" size={17} color={colors.faint} />
          </TouchableOpacity>
        )}
      </View>
      <Text style={[styles.address, job.done && styles.addressDone]} numberOfLines={2}>{job.address}</Text>
      <View style={styles.metaRow}>
        <Ionicons name="calendar-clear-outline" size={13} color={colors.muted} />
        <Text style={styles.metaText}>{key ? formatShortDate(key) : job.date}</Text>
        {rel ? <Text style={[styles.metaRel, days === 0 && { color: colors.tealDark }, days !== null && days < 0 && !job.done && { color: colors.goldDark }]}>· {rel}</Text> : null}
      </View>
      <View style={styles.cardBottom}>
        <AssigneeRow name={job.assignedToName} color={color} photo={photo} />
        {canToggle && (
          <TouchableOpacity
            style={[styles.doneCircle, job.done && styles.doneCircleActive]}
            onPress={onToggle}
            hitSlop={8}
          >
            <Ionicons name="checkmark" size={20} color={job.done ? colors.white : colors.faint} />
          </TouchableOpacity>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20 },
  statRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  statChip: {
    flex: 1, backgroundColor: colors.card, borderRadius: radius.md, paddingVertical: 10,
    alignItems: "center", borderWidth: 1, borderColor: colors.line,
  },
  statChipWarn: { backgroundColor: colors.goldSoft, borderColor: "#F0D9A6" },
  statNumber: { fontSize: 20, fontWeight: "800", color: colors.ink },
  statLabel: { fontSize: 11, fontWeight: "600", color: colors.muted, marginTop: 1 },
  filterRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  filterChip: {
    borderRadius: radius.pill, paddingHorizontal: 16, minHeight: 36, justifyContent: "center",
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
  },
  filterChipActive: { backgroundColor: colors.dark, borderColor: colors.dark },
  filterChipText: { fontSize: 13, fontWeight: "600", color: colors.muted },
  filterChipTextActive: { color: colors.white },
  sheetHint: { fontSize: 13.5, color: colors.muted, lineHeight: 19, marginBottom: 12 },
  toggleRow: {
    flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 12, marginBottom: 14, backgroundColor: colors.bg,
  },
  toggleRowActive: { backgroundColor: colors.goldSoft, borderColor: "#F0D9A6" },
  toggleText: { fontSize: 14.5, fontWeight: "600", color: colors.ink },
  toggleSub: { fontSize: 12, color: colors.muted, marginTop: 1 },
  cardDone: { opacity: 0.6 },
  cardTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 8 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, flex: 1 },
  trashBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center", marginTop: -6, marginRight: -6 },
  address: { fontSize: 17.5, fontWeight: "700", color: colors.ink, lineHeight: 23 },
  addressDone: { textDecorationLine: "line-through", color: colors.muted },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 5 },
  metaText: { fontSize: 13, color: colors.muted },
  metaRel: { fontSize: 13, fontWeight: "700", color: colors.muted },
  cardBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12, gap: 10 },
  doneCircle: {
    width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderColor: colors.line,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.card,
  },
  doneCircleActive: { backgroundColor: colors.teal, borderColor: colors.teal },
});
