import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { addDoc, collection, deleteDoc, doc, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { tapSelect, tapSuccess } from "../../components/haptics";
import { useProfile } from "../../components/ProfileProvider";
import { alertSoon, AssigneeRow, BrandButton, Card, DatePickerField, EmptyState, ErrorState, Fab, FormInput, IconButton, Pill, ProgressBar, ScreenHeader, SectionHeader, SheetModal } from "../../components/ui";
import { useProperties } from "../../components/useProperties";
import { db } from "../../firebase";
import { PushProblemCard, usePushRegistration } from "../../components/PushProblem";
import { assignmentMessage, scheduleTodaysJobNotifications, sendPushToEmployee, sendTestNotification } from "../../notifications";
import { TimeChips } from "../../components/TimeChips";
import { withTime } from "../../jobTime";
import { formatClockTime } from "../../payroll";
import { type Property } from "../../properties";
import { cleanerColor, colors, radius, unassignedColor } from "../../theme";
import { daysFromToday, daysLeftInWeek, formatShortDate, GROUP_ORDER, GROUP_TITLES, hasSameDayTurnover, HIDE_AFTER_DAYS, isJobVisible, jobDateKey, jobGroup, JobGroup, relativeDayLabel, sortByDate, todayKey } from "../../turnover";
import { checklistProgress, currentRoom, DEFAULT_CHECKLIST, legacyItems, templateFromDoc, templateStats } from "../../checklist";
import { isOpenJob } from "../../assign";
import { Employee, Job, newJobDoc, parseChecklistText } from "../../types";

type Section = { group: JobGroup; jobs: Job[] };

// What a cleaner's list shows: everything, their own, or the ones nobody has.
type Scope = "all" | "mine" | "open";

// Picked from a list rather than typed, so the same kind of job is always
// spelled the same way.
const JOB_TYPES = ["Turnover", "Standard Cleaning", "Deep Cleaning", "Move-out Cleaning", "Handyman"];

// Cancelled cleanings stay findable (to restore one) for this long after their date.
const CANCELLED_WINDOW_DAYS = 30;

export default function JobsScreen() {
  // null until the first snapshot, so a cold start shows "Loading", not an
  // empty schedule.
  const [allJobs, setAllJobs] = useState<Job[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [newDateKey, setNewDateKey] = useState<string | null>(null);
  const [newHouse, setNewHouse] = useState<Property | null>(null);
  const [newAddress, setNewAddress] = useState("");
  const [newType, setNewType] = useState(JOB_TYPES[0]);
  const [newAssignee, setNewAssignee] = useState<Employee | null>(null);
  const [newSameDayTurnover, setNewSameDayTurnover] = useState(false);
  const [newTime, setNewTime] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [scope, setScope] = useState<Scope>("all");
  const [showCancelled, setShowCancelled] = useState(false);
  const [showChecklistEditor, setShowChecklistEditor] = useState(false);
  const [checklistText, setChecklistText] = useState("");
  const [checklistTemplate, setChecklistTemplate] = useState<string[]>(DEFAULT_CHECKLIST);
  const router = useRouter();
  // Set by a tapped notification about several cleanings ("open", "mine").
  const { filter, at } = useLocalSearchParams<{ filter?: string; at?: string }>();
  const properties = useProperties();
  const { state, switchProfile, viewAs, employees, deviceId } = useProfile();
  const isOwner = state.status === "owner";
  const ownerViewing = state.status === "cleaner" && state.ownerViewing;
  const selfId = state.status === "cleaner" ? state.employee.id : null;
  const firstName = state.status === "cleaner" ? state.employee.name.split(" ")[0] : null;

  const push = usePushRegistration(deviceId);

  useEffect(() => {
    if (filter === "open" || filter === "mine") setScope(filter);
  }, [filter, at]);

  // The owner's checklist template lives at settings/checklist.
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "settings", "checklist"), (snap) => {
      setChecklistTemplate(templateFromDoc(snap.data()));
    }, (error) => {
      console.warn("checklist listener error:", error);
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "jobs"), (snapshot) => {
      setLoadError(null);
      setAllJobs(sortByDate(snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Job[]));
    }, (error) => {
      console.warn("jobs listener error:", error);
      setLoadError(error.message);
    });
    return unsub;
  }, []);

  // Cancelled jobs and finished ones a couple of days past their date leave
  // the phones but stay in Firestore. Running timers and unfinished past
  // cleanings always stay visible.
  const jobs = useMemo(() => (allJobs || []).filter(isJobVisible), [allJobs]);
  const cancelledJobs = useMemo(() => (allJobs || []).filter(j => {
    if (!j.cancelled) return false;
    const days = daysFromToday(j);
    return days === null || days >= -CANCELLED_WINDOW_DAYS;
  }), [allJobs]);

  // Owners get reminded about every job; cleaners only about theirs. While
  // the owner is just viewing as a cleaner, their phone keeps the full set.
  // Unconfirmed website requests aren't on the schedule, so never remind.
  useEffect(() => {
    if (!allJobs) return;
    const scheduled = jobs.filter(j => !j.pending);
    const relevant = selfId && !ownerViewing ? scheduled.filter(j => j.assignedTo === selfId) : scheduled;
    scheduleTodaysJobNotifications(relevant);
  }, [allJobs, jobs, selfId, ownerViewing]);

  // Cleaners (and the owner viewing as one) never see unconfirmed requests.
  const roleJobs = useMemo(() => (selfId ? jobs.filter(j => !j.pending) : jobs), [jobs, selfId]);

  const employeeById = useMemo(() => {
    const map = new Map<string, Employee>();
    employees.forEach(e => map.set(e.id, e));
    return map;
  }, [employees]);

  // The circle is owner bookkeeping. Cleaners finish from the job itself, which
  // logs their time; a tick here would skip payroll.
  const toggleDone = async (job: Job) => {
    if (!isOwner) return;
    if (job.startedAt) {
      Alert.alert(
        "Timer is running",
        `${job.assignedToName || "Someone"} is on the clock for this one. Open the job and finish it there so the time gets logged.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open job", onPress: () => router.push({ pathname: "/job", params: { id: job.id } }) },
        ]
      );
      return;
    }
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
    if (job.startedAt) {
      Alert.alert(
        "Timer is running",
        `${job.assignedToName || "Someone"} is on the clock for this one. Open the job to finish or cancel it first, so their time isn't lost.`
      );
      return;
    }
    Alert.alert(
      "Delete job",
      `Delete "${job.address}" on ${job.date}? This removes it from the records too. To just take it off the schedule, cancel it from the job screen instead.`,
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteDoc(doc(db, "jobs", job.id));
            } catch (e) {
              console.warn("delete job failed:", e);
              Alert.alert("Couldn't delete", "The job is still there. Check your connection and try again.");
            }
          },
        },
      ]
    );
  };

  const openChecklistEditor = () => {
    setChecklistText(checklistTemplate.join("\n"));
    setShowChecklistEditor(true);
  };

  const sendTest = async () => {
    try {
      await sendTestNotification();
      Alert.alert("Test notification", "One should arrive on this phone in about 5 seconds.");
    } catch (e) {
      console.warn("test notification failed:", e);
      Alert.alert("Couldn't send a test", "Check that notifications are allowed for TurnTrack in this phone's settings.");
    }
  };

  const openMore = () => {
    Alert.alert("More", undefined, [
      { text: "Assign cleanings", onPress: () => router.push("/assign") },
      { text: "Edit cleaning checklist", onPress: openChecklistEditor },
      { text: "Send a test notification", onPress: sendTest },
      { text: "Close", style: "cancel" },
    ]);
  };

  const saveChecklist = async () => {
    const lines = parseChecklistText(checklistText);
    const stats = templateStats(lines);
    if (stats.steps === 0) {
      Alert.alert("No steps yet", "Add at least one step under a room, one per line.");
      return;
    }
    try {
      // `items` is the plain version phones on an older app version still read.
      await setDoc(doc(db, "settings", "checklist"), { lines, items: legacyItems(lines), updatedAt: Date.now() });
      setShowChecklistEditor(false);
      tapSuccess();
      alertSoon(
        "Checklist saved",
        `${stats.rooms} room${stats.rooms === 1 ? "" : "s"}, ${stats.steps} steps. Cleanings nobody has started yet use it right away.`
      );
    } catch (e) {
      console.warn("save checklist failed:", e);
      Alert.alert("Couldn't save", "The checklist didn't save. Check your connection and try again.");
    }
  };

  const resetForm = () => {
    setNewDateKey(null);
    setNewTime(null);
    setNewHouse(null);
    setNewAddress("");
    setNewType(JOB_TYPES[0]);
    setNewAssignee(null);
    setNewSameDayTurnover(false);
  };

  const addJob = async () => {
    if (!newDateKey) {
      Alert.alert("Pick a date", "Choose the cleaning date first.");
      return;
    }
    const address = newHouse ? newHouse.address || newHouse.name : newAddress.trim();
    if (!address) {
      Alert.alert("Pick a house", "Choose one of the houses, or type the address of a new one.");
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const fields = {
        ...newJobDoc({ dateKey: newDateKey, time: newTime, address, type: newType, sameDayTurnover: newSameDayTurnover }, checklistTemplate),
        // The registry name is what every other writer files a house under.
        property: newHouse ? newHouse.name : null,
        source: "app",
        assignedTo: newAssignee ? newAssignee.id : null,
        assignedToName: newAssignee ? newAssignee.name : null,
      };
      const ref = await addDoc(collection(db, "jobs"), fields);
      tapSuccess();
      if (newAssignee) sendPushToEmployee(newAssignee.id, assignmentMessage({ id: ref.id, ...fields } as Job));
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

  const active = roleJobs.filter(j => !j.done && !j.pending);
  const upcoming = active.filter(j => { const d = daysFromToday(j); return d !== null && d >= 0; });
  const todayCount = upcoming.filter(j => daysFromToday(j) === 0).length;
  // Today through Saturday, the same week the calendar counts.
  const weekLeft = daysLeftInWeek();
  const weekCount = upcoming.filter(j => (daysFromToday(j) as number) <= weekLeft).length;
  const unassignedCount = upcoming.filter(j => !j.assignedTo).length;
  const mineCount = selfId ? upcoming.filter(j => j.assignedTo === selfId).length : 0;
  const today = todayKey();
  const openJobs = useMemo(() => roleJobs.filter(j => isOpenJob(j, today)), [roleJobs, today]);

  const viewingCancelled = isOwner && showCancelled;
  const visibleJobs = viewingCancelled
    ? cancelledJobs
    : selfId && scope === "mine" ? roleJobs.filter(j => j.assignedTo === selfId)
    : selfId && scope === "open" ? openJobs
    : roleJobs;

  const sections: Section[] = useMemo(() => {
    if (viewingCancelled) return [];
    const buckets = new Map<JobGroup, Job[]>();
    visibleJobs.forEach(job => {
      const g = jobGroup(job);
      if (!buckets.has(g)) buckets.set(g, []);
      buckets.get(g)!.push(job);
    });
    return GROUP_ORDER.filter(g => buckets.has(g)).map(g => ({ group: g, jobs: buckets.get(g)! }));
  }, [visibleJobs, viewingCancelled]);

  const subtitle = firstName
    ? `Hey ${firstName} — ${mineCount} of ${upcoming.length} upcoming ${upcoming.length === 1 ? "is" : "are"} yours`
    : `${upcoming.length} upcoming cleaning${upcoming.length === 1 ? "" : "s"}`;
  const activeCleaners = employees.filter(e => e.active);

  const renderCard = (job: Job) => {
    const assignee = job.assignedTo ? employeeById.get(job.assignedTo) : undefined;
    const color = job.assignedTo ? cleanerColor(assignee || { id: job.assignedTo }) : unassignedColor;
    return (
      <JobCard
        key={job.id}
        job={job}
        color={color}
        photo={assignee?.photo}
        canToggle={isOwner && !job.pending && !job.cancelled}
        canDelete={isOwner}
        onPress={() => router.push({ pathname: "/job", params: { id: job.id } })}
        onToggle={() => toggleDone(job)}
        onDelete={() => deleteJob(job)}
      />
    );
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Jobs"
        subtitle={allJobs ? subtitle : "Loading cleanings…"}
        onSubtitlePress={isOwner ? () => router.navigate("/calendar") : undefined}
        right={
          <>
            {isOwner && <IconButton icon="ellipsis-horizontal" onPress={openMore} label="More: checklist and test notification" />}
            <IconButton
              icon={ownerViewing ? "arrow-undo-outline" : "swap-horizontal"}
              onPress={onSwitchPress}
              label={ownerViewing ? "Back to owner" : "Switch profile"}
            />
          </>
        }
      />

      <PushProblemCard result={push.result} checking={push.checking} onRetry={push.retry} />

      <View style={styles.statRow}>
        <Stat label="Today" value={todayCount} />
        <Stat label="This week" value={weekCount} />
        {selfId ? (
          <Stat label="Mine" value={mineCount} />
        ) : (
          <Stat label="Unassigned" value={unassignedCount} warn={unassignedCount > 0} onPress={() => router.push("/assign")} />
        )}
      </View>

      {selfId && (
        <View style={styles.filterRow}>
          <FilterChip label="All jobs" active={scope === "all"} onPress={() => { tapSelect(); setScope("all"); }} />
          <FilterChip label="My jobs" active={scope === "mine"} onPress={() => { tapSelect(); setScope("mine"); }} />
          <FilterChip label={`Open${openJobs.length ? ` (${openJobs.length})` : ""}`} active={scope === "open"} onPress={() => { tapSelect(); setScope("open"); }} />
        </View>
      )}
      {isOwner && (
        <View style={styles.filterRow}>
          <FilterChip label="Schedule" active={!showCancelled} onPress={() => { tapSelect(); setShowCancelled(false); }} />
          <FilterChip
            label={`Cancelled${cancelledJobs.length ? ` (${cancelledJobs.length})` : ""}`}
            active={showCancelled}
            onPress={() => { tapSelect(); setShowCancelled(true); }}
          />
        </View>
      )}

      <SheetModal visible={showChecklistEditor} title="Cleaning checklist" onClose={() => setShowChecklistEditor(false)}>
        <Text style={styles.sheetHint}>
          One step per line. A line ending in a colon starts a room, like &quot;Kitchen:&quot;. Put a tip after a bar: &quot;Oven | Wipe the door glass&quot;. A line starting with &gt; is a note for the whole room. &quot;Bathroom #:&quot; repeats once per bathroom at each house, and &quot;Half bath:&quot; only shows at houses that have one. A room ending in &quot;(optional)&quot;, like &quot;Bedroom (optional):&quot;, stays hidden until someone taps Add a room on a cleaning.
        </Text>
        <FormInput
          label="Checklist"
          placeholder={"Kitchen:\n> Microfiber for everything\nCounters | Wipe every crumb\n…"}
          value={checklistText}
          onChangeText={setChecklistText}
          multiline
        />
        <BrandButton label="Save checklist" icon="checkmark" onPress={saveChecklist} />
      </SheetModal>

      <SheetModal visible={showForm} title="New cleaning" onClose={() => setShowForm(false)}>
        <DatePickerField label="Date" value={newDateKey} onChange={setNewDateKey} />
        <Text style={styles.fieldLabel}>House</Text>
        <View style={styles.choiceGrid}>
          {properties.map(p => (
            <Choice
              key={p.name}
              text={p.short || p.name}
              selected={newHouse?.name === p.name}
              onPress={() => { tapSelect(); setNewHouse(newHouse?.name === p.name ? null : p); }}
            />
          ))}
        </View>
        {!newHouse ? (
          <FormInput label="Or a new address" placeholder="Street, city" value={newAddress} onChangeText={setNewAddress} autoCapitalize="words" />
        ) : (
          <Text style={styles.houseHint}>{newHouse.address}</Text>
        )}
        <TimeChips label="Start time" value={newTime} onChange={setNewTime} />
        <Text style={styles.fieldLabel}>Job type</Text>
        <View style={styles.choiceGrid}>
          {JOB_TYPES.map(t => (
            <Choice key={t} text={t} selected={newType === t} onPress={() => { tapSelect(); setNewType(t); }} />
          ))}
        </View>
        <Text style={styles.fieldLabel}>Cleaner</Text>
        <View style={styles.choiceGrid}>
          <Choice text="Unassigned" selected={!newAssignee} onPress={() => { tapSelect(); setNewAssignee(null); }} />
          {activeCleaners.map(emp => (
            <Choice key={emp.id} text={emp.name.split(" ")[0]} selected={newAssignee?.id === emp.id} onPress={() => { tapSelect(); setNewAssignee(emp); }} />
          ))}
        </View>
        <TouchableOpacity
          style={[styles.toggleRow, newSameDayTurnover && styles.toggleRowActive]}
          onPress={() => { tapSelect(); setNewSameDayTurnover(!newSameDayTurnover); }}
          activeOpacity={0.7}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: newSameDayTurnover }}
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
        {loadError && !allJobs ? (
          <ErrorState title="Couldn't load the jobs" body={`Check your connection; the list updates by itself once it's back. (${loadError})`} />
        ) : !allJobs ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.teal} />
            <Text style={styles.loadingText}>Loading cleanings…</Text>
          </View>
        ) : viewingCancelled ? (
          cancelledJobs.length === 0 ? (
            <EmptyState
              icon="close-circle-outline"
              title="No cancelled cleanings"
              body={`Cleanings cancelled in the last ${CANCELLED_WINDOW_DAYS} days show up here, so you can open one and restore it.`}
            />
          ) : (
            <>
              <SectionHeader title="Cancelled" count={cancelledJobs.length} />
              {cancelledJobs.map(renderCard)}
            </>
          )
        ) : visibleJobs.length === 0 ? (
          scope === "open" ? (
            <EmptyState
              icon="checkmark-done-outline"
              title="No open cleanings"
              body="Every upcoming cleaning has someone on it. When one opens up, it shows here for you to take."
            />
          ) : scope === "mine" && roleJobs.length > 0 ? (
            <EmptyState
              icon="person-outline"
              title="Nothing assigned to you yet"
              body="When a job gets assigned to you it shows up here. Switch to All jobs to see the whole schedule."
            />
          ) : (
            <EmptyState
              icon="sparkles-outline"
              title="No cleanings coming up"
              body={`Jobs from Airbnb, Turno, your booking emails and the website land here automatically${isOwner ? ", or tap Add cleaning" : ""}. Finished jobs clear out ${HIDE_AFTER_DAYS} days after the cleaning date.`}
            />
          )
        ) : null}

        {sections.map(section => (
          <View key={section.group}>
            <SectionHeader
              title={GROUP_TITLES[section.group]}
              count={section.jobs.length}
              tone={section.group === "running" ? "live" : section.group === "overdue" || section.group === "pending" ? "warn" : "default"}
            />
            {section.jobs.map(renderCard)}
          </View>
        ))}
      </ScrollView>

      {isOwner && <Fab icon="add" label="Add cleaning" onPress={() => { resetForm(); setShowForm(true); }} />}
    </View>
  );
}

function Stat({ label, value, warn, onPress }: { label: string; value: number; warn?: boolean; onPress?: () => void }) {
  const body = (
    <>
      <Text style={[styles.statNumber, warn && { color: colors.goldDark }]}>{value}</Text>
      <Text style={[styles.statLabel, warn && { color: colors.goldDark }]}>{label}{onPress ? " ›" : ""}</Text>
    </>
  );
  if (!onPress) {
    return <View style={[styles.statChip, warn && styles.statChipWarn]} accessible accessibilityLabel={`${label}: ${value}`}>{body}</View>;
  }
  return (
    <TouchableOpacity
      style={[styles.statChip, warn && styles.statChipWarn]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}. Opens the assign screen`}
    >
      {body}
    </TouchableOpacity>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.filterChip, active && styles.filterChipActive]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Choice({ text, selected, onPress }: { text: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.choice, selected && styles.choiceOn]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      <Text style={[styles.choiceText, selected && styles.choiceTextOn]} numberOfLines={1}>{text}</Text>
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
  const pending = job.pending === true;
  // Checklist progress while someone is cleaning, so the owner can watch
  // from the list without opening the job.
  const cl = checklistProgress(job.checklist);
  const room = running ? currentRoom(job.checklist) : null;
  return (
    <Card tone={(sameDay && !job.done) || pending ? "gold" : job.cancelled ? "danger" : "default"} accent={pending ? colors.gold : color} onPress={onPress} style={job.done || job.cancelled ? styles.cardDone : undefined}>
      <View style={styles.cardTop}>
        <View style={styles.pillRow}>
          {pending ? <Pill label="Needs confirmation" tone="gold" icon="mail-unread" /> : null}
          {job.cancelled ? <Pill label="Cancelled" tone="danger" icon="close-circle" /> : null}
          {running ? <Pill label="In progress" tone="solid" icon="time" /> : null}
          {job.done ? <Pill label="Done" tone="neutral" icon="checkmark" /> : null}
          {sameDay ? <Pill label="Same-day" tone="gold" icon="alert-circle" /> : null}
          <Pill label={job.type} tone="neutral" />
        </View>
        {canDelete && (
          <TouchableOpacity onPress={onDelete} hitSlop={10} style={styles.trashBtn} accessibilityRole="button" accessibilityLabel="Delete job">
            <Ionicons name="trash-outline" size={17} color={colors.muted} />
          </TouchableOpacity>
        )}
      </View>
      <Text style={[styles.address, job.done && styles.addressDone]} numberOfLines={2}>{job.address}</Text>
      <View style={styles.metaRow}>
        <Ionicons name="calendar-clear-outline" size={13} color={colors.muted} />
        <Text style={styles.metaText}>{withTime(key ? formatShortDate(key) : job.date, job.time)}</Text>
        {rel ? <Text style={[styles.metaRel, days === 0 && { color: colors.tealDark }, days !== null && days < 0 && !job.done && { color: colors.goldDark }]}>· {rel}</Text> : null}
      </View>
      {running && cl.total > 0 ? (
        <View style={styles.checkProgress}>
          <View style={{ flex: 1 }}><ProgressBar value={cl.done / cl.total} color={color} /></View>
          <Text style={styles.checkProgressText}>
            {room ? `${room} · ` : ""}{cl.done}/{cl.total}{cl.lastAt ? ` · ${formatClockTime(cl.lastAt)}` : ""}
          </Text>
        </View>
      ) : null}
      <View style={styles.cardBottom}>
        {pending ? (
          <View style={styles.contactRow}>
            <Ionicons name="person-outline" size={17} color={colors.muted} />
            <Text style={styles.contactText}>{job.contact?.name || "Website customer"}</Text>
          </View>
        ) : (
          <AssigneeRow name={job.assignedToName} color={color} photo={photo} />
        )}
        {pending ? <Ionicons name="chevron-forward" size={20} color={colors.faint} /> : null}
        {canToggle && (
          <TouchableOpacity
            style={[styles.doneCircle, job.done && styles.doneCircleActive]}
            onPress={onToggle}
            hitSlop={8}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: !!job.done }}
            accessibilityLabel={job.done ? "Marked done. Tap to undo" : "Mark done"}
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
    borderRadius: radius.pill, paddingHorizontal: 16, minHeight: 40, justifyContent: "center",
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
  },
  filterChipActive: { backgroundColor: colors.dark, borderColor: colors.dark },
  filterChipText: { fontSize: 13, fontWeight: "600", color: colors.muted },
  filterChipTextActive: { color: colors.white },
  loading: { alignItems: "center", paddingVertical: 48, gap: 10 },
  loadingText: { fontSize: 14, color: colors.muted },
  sheetHint: { fontSize: 13.5, color: colors.muted, lineHeight: 19, marginBottom: 12 },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6, letterSpacing: 0.3 },
  choiceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 12 },
  choice: {
    minHeight: 40, paddingHorizontal: 12, borderRadius: radius.sm, borderWidth: 1, maxWidth: "100%",
    borderColor: colors.line, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center",
  },
  choiceOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  choiceText: { fontSize: 13.5, fontWeight: "600", color: colors.ink },
  choiceTextOn: { color: colors.white },
  houseHint: { fontSize: 13, color: colors.muted, marginTop: -4, marginBottom: 12 },
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
  trashBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", marginTop: -10, marginRight: -10 },
  address: { fontSize: 17.5, fontWeight: "700", color: colors.ink, lineHeight: 23 },
  addressDone: { textDecorationLine: "line-through", color: colors.muted },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 5 },
  metaText: { fontSize: 13, color: colors.muted },
  metaRel: { fontSize: 13, fontWeight: "700", color: colors.muted },
  checkProgress: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  checkProgressText: { fontSize: 12, fontWeight: "700", color: colors.tealDark },
  cardBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12, gap: 10 },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  contactText: { fontSize: 13.5, fontWeight: "600", color: colors.muted },
  doneCircle: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: colors.line,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.card,
  },
  doneCircleActive: { backgroundColor: colors.teal, borderColor: colors.teal },
});
