import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { addDoc, collection, deleteDoc, doc, onSnapshot, setDoc, updateDoc } from "firebase/firestore";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { tapSelect, tapSuccess } from "../../components/haptics";
import { useProfile } from "../../components/ProfileProvider";
import { ActionSheet, alertSoon, AssigneeRow, BrandButton, Card, DatePickerField, EmptyState, ErrorState, Fab, FormInput, IconButton, Pill, ProgressBar, ScreenHeader, SectionHeader, SheetModal } from "../../components/ui";
import { warnUnreached } from "../../components/pushWarning";
import { useProperties } from "../../components/useProperties";
import { duesSentence, payDueFor, recordCleaningPay } from "../../components/cleaningPay";
import { db } from "../../firebase";
import { PushProblemCard, usePushRegistration } from "../../components/PushProblem";
import { assignmentMessage, scheduleTodaysJobNotifications, sendPushToEmployee, sendTestNotification } from "../../notifications";
import { TimeChips } from "../../components/TimeChips";
import { withTime } from "../../jobTime";
import { formatClockTime } from "../../payroll";
import { findProperty, type Property } from "../../properties";
import { cardTitle, matchesSearch, weeksOf } from "../../jobList";
import { fillPlan, newSeriesId, REPEATS, seriesJobId, type Repeat, type Series } from "../../recurring";
import { addSeries, fillRepeats, skipDay, useRecurring } from "../../components/recurringStore";
import { openInMaps } from "../../components/maps";
import { availabilityColors, cleanerColor, colors, radius, unassignedColor } from "../../theme";
import { daysFromToday, daysLeftInWeek, formatShortDate, GROUP_ORDER, GROUP_TITLES, hasSameDayTurnover, isJobVisible, jobDateKey, jobGroup, JobGroup, relativeDayLabel, sortByDate, todayKey } from "../../turnover";
import { checklistProgress, currentRoom, DEFAULT_CHECKLIST, legacyItems, templateFromDoc, templateStats } from "../../checklist";
import { isOpenJob } from "../../assign";
import { crewLabel, isOnCrew } from "../../crew";
import { availabilityFor, availabilityShort, availabilityTone, availabilityWarning, bookingsOf, type Availability } from "../../availability";
import { houseLabel } from "../../schedule";
import { Employee, Job, JOB_TYPES, newJobDoc, parseChecklistText } from "../../types";

type Section = { group: JobGroup; jobs: Job[] };

// What a cleaner's list shows: everything, their own, or the ones nobody has.
type Scope = "all" | "mine" | "open";


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
  // Everyone going on the new cleaning, the main cleaner first.
  const [newCrew, setNewCrew] = useState<Employee[]>([]);
  const [newSameDayTurnover, setNewSameDayTurnover] = useState(false);
  const [newTime, setNewTime] = useState<string | null>(null);
  const [newRepeat, setNewRepeat] = useState<Repeat | null>(null);
  const [saving, setSaving] = useState(false);
  const [scope, setScope] = useState<Scope>("all");
  // What's typed in the search box, and the Today / This week filter from the boxes at the top.
  const [query, setQuery] = useState("");
  const [range, setRange] = useState<"today" | "week" | null>(null);
  // Weeks after next start folded; these are the ones opened.
  const [openWeeks, setOpenWeeks] = useState<Set<string>>(new Set());
  const [showCancelled, setShowCancelled] = useState(false);
  const [showChecklistEditor, setShowChecklistEditor] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [checklistText, setChecklistText] = useState("");
  // What the editor opened with, to tell whether anything was typed.
  const [checklistOriginal, setChecklistOriginal] = useState("");
  const [checklistTemplate, setChecklistTemplate] = useState<string[]>(DEFAULT_CHECKLIST);
  const router = useRouter();
  // Set by a tapped notification about several cleanings ("open", "mine").
  // add: a day picked on the Calendar to add a cleaning on.
  const { filter, at, add } = useLocalSearchParams<{ filter?: string; at?: string; add?: string }>();
  const properties = useProperties();
  const { state, switchProfile, viewAs, employees, deviceId } = useProfile();
  const isOwner = state.status === "owner";
  const ownerViewing = state.status === "cleaner" && state.ownerViewing;
  const selfId = state.status === "cleaner" ? state.employee.id : null;
  const firstName = state.status === "cleaner" ? state.employee.name.split(" ")[0] : null;

  const push = usePushRegistration(deviceId);

  // Cleaners start on their own cleanings; the owner sees everything. A
  // notification that opened a list (below) still picks its own.
  useEffect(() => {
    setScope(selfId ? "mine" : "all");
  }, [selfId]);

  useEffect(() => {
    if (filter === "open" || filter === "mine") setScope(filter);
  }, [filter, at]);

  // "Add a cleaning this day" on the Calendar opens the form with the day picked.
  useEffect(() => {
    if (!add || state.status !== "owner") return;
    resetForm();
    setNewDateKey(add);
    setShowForm(true);
    // Only a new request from the Calendar opens it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [add, at]);

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
  // Who's already on what each day, so the new-cleaning form can say who's free.
  const bookings = useMemo(() => bookingsOf(allJobs || []), [allJobs]);

  // Owners get reminded about every job; cleaners only about theirs. While
  // the owner is just viewing as a cleaner, their phone keeps the full set.
  // Unconfirmed website requests aren't on the schedule, so never remind.
  useEffect(() => {
    if (!allJobs) return;
    const scheduled = jobs.filter(j => !j.pending);
    const relevant = selfId && !ownerViewing ? scheduled.filter(j => isOnCrew(j, selfId)) : scheduled;
    scheduleTodaysJobNotifications(relevant);
  }, [allJobs, jobs, selfId, ownerViewing]);

  // The owner's phone keeps repeating cleanings filled a couple of months
  // ahead. Each is made with a fixed id, so a second owner phone doing the
  // same can't double it; when everything's there the plan is empty.
  const series = useRecurring(isOwner);
  const filling = useRef(false);
  useEffect(() => {
    if (!isOwner || !allJobs || !series || series.length === 0 || filling.current) return;
    const plan = fillPlan(series, allJobs, todayKey());
    if (plan.create.length === 0 && plan.adopt.length === 0) return;
    filling.current = true;
    fillRepeats(plan, checklistTemplate, employees)
      .catch(e => console.warn("filling repeats failed:", e))
      .finally(() => { filling.current = false; });
  }, [isOwner, allJobs, series, checklistTemplate, employees]);

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
    const finishing = !job.done;
    const completedAt = finishing ? Date.now() : null;
    try {
      await updateDoc(doc(db, "jobs", job.id), { done: finishing, completedAt });
    } catch (e) {
      console.warn("toggle done failed:", e);
      Alert.alert("Couldn't update", "Check your connection and try again.");
      return;
    }
    // Pay is per cleaning now, so a cleaning closed without the timer still
    // owes the cleaners on it. Ask rather than guess: it may have been paid
    // already. "Not now" leaves it on Payroll's "no pay recorded" list.
    const dues = finishing ? payDueFor({ ...job, done: true, completedAt }, employees, properties) : [];
    if (dues.length === 0) return;
    const record = async (settled: boolean) => {
      try {
        await recordCleaningPay({ ...job, done: true, completedAt }, dues, settled);
        if (!settled) alertSoon("Added to payroll", `${duesSentence(dues)} for this cleaning. Mark it paid on the Payroll tab once you've sent it.`);
      } catch (e) {
        console.warn("record pay failed:", e);
        Alert.alert("Couldn't add the pay", "The cleaning is done, but the pay didn't save. It's listed on the Payroll tab to add from there.");
      }
    };
    Alert.alert(
      "Add the pay?",
      `${duesSentence(dues)} for this cleaning. No timer ran, so nothing is on payroll for it yet.`,
      [
        { text: "Not now", style: "cancel" },
        { text: "Already paid", onPress: () => record(true) },
        { text: "Add to payroll", onPress: () => record(false) },
      ]
    );
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
              return;
            }
            // A repeat's cleaning deleted by hand stays gone.
            if (job.seriesId && job.seriesDate) {
              skipDay(job.seriesId, job.seriesDate).catch(e => console.warn("skipping repeat day failed:", e));
            }
          },
        },
      ]
    );
  };

  const openChecklistEditor = () => {
    const text = checklistTemplate.join("\n");
    setChecklistText(text);
    setChecklistOriginal(text);
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

  const openMore = () => setShowMore(true);

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
    setNewCrew([]);
    setNewSameDayTurnover(false);
    setNewRepeat(null);
  };

  const newSlot = { id: null, key: newDateKey, time: newTime };
  const houseOf = (j: Job) => houseLabel(j, properties);

  const addJob = () => {
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
    // Anyone who can't work then, or is on another cleaning, is asked about first.
    const warnings = newCrew
      .map(emp => availabilityWarning(availabilityFor(emp, newSlot, bookings), emp.name, houseOf))
      .filter((w): w is { title: string; body: string } => w !== null);
    if (warnings.length === 0) {
      saveJob(newDateKey, address);
      return;
    }
    const warning = warnings.length === 1
      ? warnings[0]
      : { title: "Check who's free", body: `${warnings.map(w => `${w.title}.`).join("\n")}\n\nGive it to them anyway?` };
    Alert.alert(warning.title, warning.body, [
      { text: "Cancel", style: "cancel" },
      { text: "Give it to them", onPress: () => saveJob(newDateKey, address) },
    ]);
  };

  const saveJob = async (dateKey: string, address: string) => {
    setSaving(true);
    try {
      // A repeating cleaning: the repeat is saved first, and this is its first
      // cleaning, under the fixed id the filling uses, so it isn't made twice.
      const seriesId = newRepeat ? newSeriesId(Date.now(), Math.random()) : null;
      const fields = {
        ...newJobDoc({ dateKey, time: newTime, address, type: newType, sameDayTurnover: newSameDayTurnover }, checklistTemplate),
        // The registry name is what every other writer files a house under.
        property: newHouse ? newHouse.name : null,
        source: "app",
        assignedTo: newCrew[0]?.id || null,
        assignedToName: newCrew[0]?.name || null,
        crew: newCrew.length > 1 ? newCrew.slice(1).map(e => e.id) : null,
        ...(seriesId ? { seriesId, seriesDate: dateKey } : {}),
      };
      let ref: { id: string };
      if (seriesId && newRepeat) {
        const repeat: Series = {
          id: seriesId, every: newRepeat, start: dateKey, until: null, property: fields.property, address, type: newType,
          time: newTime, crew: newCrew.map(e => e.id), skip: [], createdAt: Date.now(),
        };
        await addSeries(repeat);
        ref = doc(db, "jobs", seriesJobId(seriesId, dateKey));
        await setDoc(doc(db, "jobs", ref.id), fields);
      } else {
        ref = await addDoc(collection(db, "jobs"), fields);
      }
      tapSuccess();
      warnUnreached(
        newCrew.map(emp => ({ name: emp.name, reached: sendPushToEmployee(emp.id, assignmentMessage({ id: ref.id, ...fields } as Job)) })),
        "this cleaning"
      );
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
  const mineCount = selfId ? upcoming.filter(j => isOnCrew(j, selfId)).length : 0;
  const today = todayKey();
  const openJobs = useMemo(() => roleJobs.filter(j => isOpenJob(j, today)), [roleJobs, today]);

  const viewingCancelled = isOwner && showCancelled;
  const scopedJobs = viewingCancelled
    ? cancelledJobs
    : selfId && scope === "mine" ? roleJobs.filter(j => isOnCrew(j, selfId))
    : selfId && scope === "open" ? openJobs
    : roleJobs;
  const searching = query.trim().length > 0;
  const visibleJobs = scopedJobs.filter(j => {
    if (range && !viewingCancelled) {
      const d = daysFromToday(j);
      if (j.done || d === null || d < 0 || d > (range === "today" ? 0 : weekLeft)) return false;
    }
    if (!searching) return true;
    const house = findProperty(properties, j);
    const { title, subtitle } = cardTitle(j, house);
    return matchesSearch([title, subtitle, house?.name, j.type, crewLabel(j, id => employeeById.get(id)?.name), j.contact?.name], query);
  });

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
    const { title, subtitle } = cardTitle(job, findProperty(properties, job));
    const mine = !!selfId && isOnCrew(job, selfId);
    return (
      <JobCard
        key={job.id}
        job={job}
        title={title}
        subtitle={subtitle}
        yours={mine && scope !== "mine"}
        onDirections={mine && daysFromToday(job) === 0 && !job.done && !job.cancelled ? () => openInMaps(job.address) : undefined}
        assigneeName={crewLabel(job, id => employeeById.get(id)?.name)}
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
        <Stat
          label="Today"
          value={todayCount}
          active={range === "today"}
          onPress={() => { tapSelect(); setRange(r => (r === "today" ? null : "today")); }}
          hint="Shows only today's cleanings. Tap again for all."
        />
        <Stat
          label="This week"
          value={weekCount}
          active={range === "week"}
          onPress={() => { tapSelect(); setRange(r => (r === "week" ? null : "week")); }}
          hint="Shows only this week's cleanings. Tap again for all."
        />
        {selfId ? (
          <Stat label="Mine" value={mineCount} active={scope === "mine"} onPress={() => { tapSelect(); setScope("mine"); }} hint="Shows your cleanings" />
        ) : (
          <Stat label="Unassigned ›" value={unassignedCount} warn={unassignedCount > 0} onPress={() => router.push("/assign")} hint="Opens the assign screen" />
        )}
      </View>

      {selfId && (
        <View style={styles.filterRow}>
          <FilterChip label="All jobs" active={scope === "all"} onPress={() => { tapSelect(); setScope("all"); }} />
          <FilterChip label="My jobs" active={scope === "mine"} onPress={() => { tapSelect(); setScope("mine"); }} />
          <FilterChip label={`Open${openJobs.length ? ` (${openJobs.length})` : ""}`} active={scope === "open"} onPress={() => { tapSelect(); setScope("open"); }} />
        </View>
      )}
      {viewingCancelled && (
        <View style={styles.filterRow}>
          <FilterChip label="Back to the schedule" active={false} onPress={() => { tapSelect(); setShowCancelled(false); }} />
        </View>
      )}

      <View style={styles.searchRow}>
        <Ionicons name="search" size={17} color={colors.muted} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search house, street or cleaner"
          placeholderTextColor={colors.muted}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          accessibilityLabel="Search cleanings"
        />
        {query ? (
          <TouchableOpacity onPress={() => setQuery("")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear the search">
            <Ionicons name="close-circle" size={18} color={colors.muted} />
          </TouchableOpacity>
        ) : null}
      </View>

      <ActionSheet
        visible={showMore}
        title="More"
        onClose={() => setShowMore(false)}
        actions={[
          { label: "Assign cleanings", icon: "people-outline", onPress: () => router.push("/assign") },
          { label: "Edit cleaning checklist", icon: "list-outline", onPress: openChecklistEditor },
          { label: "Send a test notification", icon: "notifications-outline", onPress: sendTest },
          {
            label: `Cancelled cleanings${cancelledJobs.length ? ` (${cancelledJobs.length})` : ""}`,
            icon: "close-circle-outline",
            onPress: () => setShowCancelled(true),
          },
        ]}
      />

      <SheetModal
        visible={showChecklistEditor}
        title="Cleaning checklist"
        onClose={() => setShowChecklistEditor(false)}
        dirty={checklistText !== checklistOriginal}
      >
        <Text style={styles.sheetHint}>
          {"One step per line.\nKitchen: starts a room · Oven | tip · > room note\nBathroom #: one per bath · Half bath: only if there is one · Bedroom (optional): added by hand"}
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

      <SheetModal
        visible={showForm}
        title="New cleaning"
        onClose={() => { resetForm(); setShowForm(false); }}
        dirty={!!(newDateKey || newTime || newHouse || newAddress.trim() || newCrew.length || newSameDayTurnover || newRepeat || newType !== JOB_TYPES[0])}
      >
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
        <Text style={styles.fieldLabel}>Repeats</Text>
        <View style={styles.choiceGrid}>
          <Choice text="Doesn't repeat" selected={newRepeat === null} onPress={() => { tapSelect(); setNewRepeat(null); }} />
          {REPEATS.map(r => (
            <Choice key={r.value} text={r.label} selected={newRepeat === r.value} onPress={() => { tapSelect(); setNewRepeat(r.value); }} />
          ))}
        </View>
        <Text style={styles.fieldLabel}>Cleaners</Text>
        <View style={styles.choiceGrid}>
          <Choice text="Unassigned" selected={newCrew.length === 0} onPress={() => { tapSelect(); setNewCrew([]); }} />
          {activeCleaners.map(emp => (
            <Choice
              key={emp.id}
              text={emp.name.split(" ")[0]}
              selected={newCrew.some(e => e.id === emp.id)}
              onPress={() => {
                tapSelect();
                setNewCrew(prev => (prev.some(e => e.id === emp.id) ? prev.filter(e => e.id !== emp.id) : [...prev, emp]));
              }}
              status={availabilityFor(emp, newSlot, bookings)}
              multi
            />
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
            <Text style={styles.toggleSub}>Checkout and check-in on the same day</Text>
          </View>
        </TouchableOpacity>
        <BrandButton label={saving ? "Adding…" : "Add cleaning"} icon="add" onPress={addJob} disabled={saving} />
      </SheetModal>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 110 }}>
        {loadError && !allJobs ? (
          <ErrorState title="Couldn't load the jobs" body={`Check your signal. It updates on its own. (${loadError})`} />
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
              body={`Cancelled in the last ${CANCELLED_WINDOW_DAYS} days. Open one to restore it.`}
            />
          ) : (
            <>
              <SectionHeader title="Cancelled" count={cancelledJobs.length} />
              {cancelledJobs.map(renderCard)}
            </>
          )
        ) : visibleJobs.length === 0 ? (
          searching || range ? (
            <EmptyState
              icon="search-outline"
              title="Nothing matches"
              body={searching ? `No cleaning matches "${query.trim()}". Try a house, street or cleaner's name.` : "No cleanings left in that range. Tap the box again to see them all."}
            />
          ) : scope === "open" ? (
            <EmptyState
              icon="checkmark-done-outline"
              title="No open cleanings"
              body="Every upcoming cleaning is covered."
            />
          ) : scope === "mine" && roleJobs.length > 0 ? (
            <EmptyState
              icon="person-outline"
              title="Nothing assigned to you yet"
              body="Your cleanings show here once assigned."
            />
          ) : (
            <EmptyState
              icon="sparkles-outline"
              title="No cleanings coming up"
              body={`Airbnb, Turno and website bookings land here on their own${isOwner ? ", or tap Add cleaning" : ""}.`}
            />
          )
        ) : null}

        {sections.map(section => (
          <View key={section.group}>
            <SectionHeader
              title={GROUP_TITLES[section.group]}
              count={section.jobs.length}
              tone={section.group === "running" ? "live" : section.group === "overdue" ? "warn" : "default"}
            />
            {section.group === "later" && !searching && !range
              ? weeksOf(section.jobs, today).map((week, i) => {
                const open = i === 0 || openWeeks.has(week.start);
                const toggle = () => {
                  tapSelect();
                  setOpenWeeks(prev => {
                    const next = new Set(prev);
                    if (next.has(week.start)) next.delete(week.start);
                    else next.add(week.start);
                    return next;
                  });
                };
                return (
                  <View key={week.start || "later"}>
                    <TouchableOpacity
                      style={styles.weekHeader}
                      onPress={toggle}
                      disabled={i === 0}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: open }}
                      accessibilityLabel={`${week.label}, ${week.jobs.length} cleaning${week.jobs.length === 1 ? "" : "s"}`}
                    >
                      <Text style={styles.weekHeaderText}>{week.label}</Text>
                      <Text style={styles.weekHeaderCount}>{week.jobs.length} cleaning{week.jobs.length === 1 ? "" : "s"}</Text>
                      {i === 0 ? null : <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.muted} />}
                    </TouchableOpacity>
                    {open ? week.jobs.map(renderCard) : null}
                  </View>
                );
              })
              : section.jobs.map(renderCard)}
          </View>
        ))}
      </ScrollView>

      {isOwner && <Fab icon="add" label="Add cleaning" onPress={() => { resetForm(); setShowForm(true); }} />}
    </View>
  );
}

// One of the boxes at the top. Tapping filters the list (active) or opens a
// screen; warn draws the eye to a number that needs doing something about.
function Stat({ label, value, warn, active, onPress, hint }: {
  label: string;
  value: number;
  warn?: boolean;
  active?: boolean;
  onPress?: () => void;
  hint?: string;
}) {
  const textStyle = [warn && styles.statWarnText, active && styles.statActiveText];
  const body = (
    <>
      <Text style={[styles.statNumber, ...textStyle]}>{value}</Text>
      <Text style={[styles.statLabel, ...textStyle]}>{label}</Text>
    </>
  );
  const chip = [styles.statChip, warn && styles.statChipWarn, active && styles.statChipActive];
  if (!onPress) {
    return <View style={chip} accessible accessibilityLabel={`${label}: ${value}`}>{body}</View>;
  }
  return (
    <TouchableOpacity
      style={chip}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${label.replace(" ›", "")}: ${value}`}
      accessibilityHint={hint}
      accessibilityState={{ selected: !!active }}
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

// status: a cleaner's availability on the day picked, shown under their name.
// multi: one of several that can be picked together (the cleaners).
function Choice({ text, selected, onPress, status, multi }: {
  text: string;
  selected: boolean;
  onPress: () => void;
  status?: Availability | null;
  multi?: boolean;
}) {
  const label = status ? availabilityShort(status) : null;
  const off = status?.kind === "off" && !selected;
  return (
    <TouchableOpacity
      style={[styles.choice, selected && styles.choiceOn, off && styles.choiceOff]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole={multi ? "checkbox" : "radio"}
      accessibilityState={multi ? { checked: selected } : { selected }}
      accessibilityLabel={label ? `${text}, ${label}` : undefined}
    >
      <Text style={[styles.choiceText, selected && styles.choiceTextOn, off && { color: colors.muted }]} numberOfLines={1}>{text}</Text>
      {status && label ? (
        <Text style={[styles.choiceStatus, { color: selected ? colors.white : availabilityColors[availabilityTone(status)] }]} numberOfLines={1}>{label}</Text>
      ) : null}
    </TouchableOpacity>
  );
}

function JobCard({ job, title, subtitle, yours, onDirections, assigneeName, color, photo, canToggle, canDelete, onPress, onToggle, onDelete }: {
  job: Job;
  // The house it's at (or its street), and the address under that.
  title: string;
  subtitle: string | null;
  // A cleaner's own cleaning in a list that has everyone's.
  yours: boolean;
  // A cleaner's own cleaning today: one tap to the map.
  onDirections?: () => void;
  // "Jewel Smith", or "Jewel & Shane" when more than one is on it.
  assigneeName: string | null;
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
  // At most three tags, the most important first; the kind of cleaning is
  // the first to go when a card has more to say.
  const pills: ReactNode[] = [];
  if (pending) pills.push(<Pill key="pending" label="Needs confirmation" tone="request" icon="mail-unread" />);
  if (job.cancelled) pills.push(<Pill key="cancelled" label="Cancelled" tone="danger" icon="close-circle" />);
  if (running) pills.push(<Pill key="running" label="In progress" tone="solid" icon="time" />);
  if (job.done) pills.push(<Pill key="done" label="Done" tone="neutral" icon="checkmark" />);
  if (sameDay) pills.push(<Pill key="sameday" label="Same-day" tone="gold" icon="alert-circle" />);
  if (yours) pills.push(<Pill key="yours" label="Yours" tone="teal" icon="person" />);
  pills.push(<Pill key="type" label={job.type} tone="neutral" />);
  return (
    <Card
      tone={sameDay && !job.done ? "gold" : pending ? "request" : job.cancelled ? "danger" : "default"}
      accent={pending ? colors.request : color}
      onPress={onPress}
      style={job.done || job.cancelled ? styles.cardDone : undefined}
    >
      <View style={styles.cardTop}>
        <View style={styles.pillRow}>{pills.slice(0, 3)}</View>
        {canDelete && (
          <TouchableOpacity onPress={onDelete} hitSlop={10} style={styles.trashBtn} accessibilityRole="button" accessibilityLabel="Delete job">
            <Ionicons name="trash-outline" size={17} color={colors.muted} />
          </TouchableOpacity>
        )}
      </View>
      <Text style={[styles.address, job.done && styles.addressDone]} numberOfLines={2}>{title}</Text>
      {subtitle ? <Text style={styles.addressSub} numberOfLines={1}>{subtitle}</Text> : null}
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
          <AssigneeRow name={assigneeName} color={color} photo={photo} />
        )}
        {onDirections ? (
          <TouchableOpacity style={styles.dirBtn} onPress={onDirections} hitSlop={6} accessibilityRole="button" accessibilityLabel="Directions to this cleaning">
            <Ionicons name="navigate-outline" size={15} color={colors.tealDark} />
            <Text style={styles.dirText}>Directions</Text>
          </TouchableOpacity>
        ) : null}
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
  // Not gold: gold means a same-day turnover.
  statChipWarn: { borderColor: colors.tealDark, borderWidth: 1.5 },
  statWarnText: { color: colors.tealDark },
  statChipActive: { backgroundColor: colors.dark, borderColor: colors.dark },
  statActiveText: { color: colors.white },
  statNumber: { fontSize: 20, fontWeight: "800", color: colors.ink },
  statLabel: { fontSize: 11, fontWeight: "600", color: colors.muted, marginTop: 1 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, minHeight: 44, marginBottom: 12,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.ink, paddingVertical: 10 },
  weekHeader: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 40, paddingHorizontal: 2, marginBottom: 6 },
  weekHeaderText: { fontSize: 14, fontWeight: "700", color: colors.ink },
  weekHeaderCount: { flex: 1, fontSize: 13, color: colors.muted },
  addressSub: { fontSize: 13, color: colors.muted, marginTop: 2 },
  dirBtn: {
    flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1.5, borderColor: colors.tealDark,
    borderRadius: radius.pill, paddingHorizontal: 12, minHeight: 36,
  },
  dirText: { fontSize: 13, fontWeight: "700", color: colors.tealDark },
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
  choiceOn: { backgroundColor: colors.tealDark, borderColor: colors.tealDark },
  choiceText: { fontSize: 13.5, fontWeight: "600", color: colors.ink },
  choiceTextOn: { color: colors.white },
  choiceOff: { borderStyle: "dashed" },
  choiceStatus: { fontSize: 11.5, fontWeight: "600", marginTop: 1 },
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
  doneCircleActive: { backgroundColor: colors.tealDark, borderColor: colors.tealDark },
});
