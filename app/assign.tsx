import { useRouter } from "expo-router";
import { collection, doc, onSnapshot, runTransaction } from "firebase/firestore";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { groupOutbox, isOpenJob, loadByCleaner, openCounts, openRange, RANGE_LABELS, type OpenRange } from "../assign";
import { tapSelect, tapSuccess } from "../components/haptics";
import { useProfile } from "../components/ProfileProvider";
import { BottomBar, BrandButton, Card, ColorDot, EmptyState, ErrorState, Pill, ScreenHeader } from "../components/ui";
import { useProperties } from "../components/useProperties";
import { db } from "../firebase";
import { formatTime } from "../jobTime";
import {
  assignmentDigestMessage, assignmentMessage, openJobsMessage, sendPushToCrew, sendPushToEmployee, unassignedMessage,
} from "../notifications";
import { countsAsCleaning, houseLabel } from "../schedule";
import { cleanerColor, colors, radius, textOn } from "../theme";
import { formatDayHeading, hasSameDayTurnover, jobDateKey, sortByDate, todayKey } from "../turnover";
import { Employee, Job } from "../types";

// Assignments made here are told to each cleaner in one notification once the
// owner pauses, instead of one buzz per tap.
const NOTIFY_AFTER_MS = 8000;
const RANGES: OpenRange[] = ["week", "next", "later"];

// Thrown inside the assignment when the job changed under us.
class Changed extends Error {}

export default function AssignScreen() {
  const router = useRouter();
  const { state, employees } = useProfile();
  const isOwner = state.status === "owner";
  const properties = useProperties();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [range, setRange] = useState<OpenRange>("week");
  // Jobs handed out on this screen stay in the list, showing who has them,
  // until you leave: the list doesn't jump and a wrong tap is one tap to fix.
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const touchedRef = useRef(touched);
  touchedRef.current = touched;
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState(false);
  const today = todayKey();

  // job id -> who it went to, waiting to be announced; and who has already been told.
  const outbox = useRef(new Map<string, { employeeId: string; job: Job }>());
  const told = useRef(new Map<string, string>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const labelOf = useRef((job: Job) => houseLabel(job, properties));
  labelOf.current = (job: Job) => houseLabel(job, properties);

  useEffect(() => {
    return onSnapshot(
      collection(db, "jobs"),
      snap => setJobs(sortByDate(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Job[])),
      error => setLoadError(error.message)
    );
  }, []);

  // Reads only refs, so the copy the cleanup below holds still sends everything.
  const flush = () => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = null;
    const grouped = groupOutbox(outbox.current);
    outbox.current.clear();
    grouped.forEach((list, employeeId) => {
      list.forEach(j => told.current.set(j.id, employeeId));
      sendPushToEmployee(employeeId, list.length === 1 ? assignmentMessage(list[0]) : assignmentDigestMessage(list, labelOf.current));
    });
  };

  // Leaving the screen or the app sends whatever is still waiting.
  useEffect(() => {
    const sub = AppState.addEventListener("change", next => { if (next !== "active") flush(); });
    return () => { sub.remove(); flush(); };
  }, []);

  const all = useMemo(() => jobs || [], [jobs]);
  const counts = useMemo(() => openCounts(all, today), [all, today]);
  const load = useMemo(() => loadByCleaner(all, range, today), [all, range, today]);
  const crew = employees.filter(e => e.active);
  const employeeById = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);
  const days = useMemo(() => {
    const out: { key: string; jobs: Job[] }[] = [];
    for (const job of all) {
      const shown = isOpenJob(job, today) || (touched.has(job.id) && countsAsCleaning(job) && !job.done);
      const key = jobDateKey(job);
      if (!shown || !key || openRange(key, today) !== range) continue;
      if (out[out.length - 1]?.key !== key) out.push({ key, jobs: [] });
      out[out.length - 1].jobs.push(job);
    }
    return out;
  }, [all, today, range, touched]);
  const openTotal = counts.week + counts.next + counts.later;

  const assign = async (job: Job, emp: Employee | null) => {
    if (saving.has(job.id)) return;
    tapSelect();
    setSaving(prev => new Set(prev).add(job.id));
    const wasTouched = touchedRef.current.has(job.id);
    setTouched(prev => new Set(prev).add(job.id));
    try {
      await runTransaction(db, async tx => {
        const ref = doc(db, "jobs", job.id);
        const snap = await tx.get(ref);
        const current = snap.data();
        if (!snap.exists() || current?.cancelled) throw new Changed("This cleaning was cancelled or removed.");
        if (current?.startedAt) throw new Changed(`${current.assignedToName || "Someone"} already started this cleaning.`);
        // A cleaner may have taken it from their phone a moment ago.
        if (current?.assignedTo && !wasTouched && current.assignedTo !== emp?.id) {
          throw new Changed(`${current.assignedToName || "Another cleaner"} took this cleaning first.`);
        }
        tx.update(ref, { assignedTo: emp ? emp.id : null, assignedToName: emp ? emp.name : null });
      });
      tapSuccess();
      if (emp) outbox.current.set(job.id, { employeeId: emp.id, job: { ...job, assignedTo: emp.id, assignedToName: emp.name } });
      else outbox.current.delete(job.id);
      // Someone already told about this one is losing it.
      const before = told.current.get(job.id);
      if (before && before !== emp?.id) {
        told.current.delete(job.id);
        sendPushToEmployee(before, unassignedMessage(job));
      }
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(flush, NOTIFY_AFTER_MS);
    } catch (e) {
      if (!wasTouched) setTouched(prev => { const next = new Set(prev); next.delete(job.id); return next; });
      if (e instanceof Changed) {
        Alert.alert("Couldn't assign", e.message);
      } else {
        console.warn("assign failed:", e);
        Alert.alert("Couldn't assign", "Assigning needs a connection. Check your signal and tap the cleaner again.");
      }
    }
    setSaving(prev => { const next = new Set(prev); next.delete(job.id); return next; });
  };

  const askCrew = () => {
    if (crew.length === 0) {
      Alert.alert("No cleaners yet", "Add cleaners on the Team tab first.");
      return;
    }
    Alert.alert(
      "Ask the crew",
      `Send a notification to ${crew.length} cleaner${crew.length === 1 ? "" : "s"} about the ${openTotal} open cleaning${openTotal === 1 ? "" : "s"}? Tapping it shows them the open ones to take.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Send",
          onPress: async () => {
            setAsking(true);
            const reached = await sendPushToCrew(crew.map(e => e.id), openJobsMessage(counts));
            setAsking(false);
            if (reached > 0) {
              tapSuccess();
              Alert.alert("Sent", `It reached ${reached} phone${reached === 1 ? "" : "s"}. Cleanings they take show up with their color here.`);
            } else {
              Alert.alert("Nobody got it", "None of the crew's phones could be reached (notifications off, or not signed in). Text them instead.");
            }
          },
        },
      ]
    );
  };

  if (!isOwner) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Assign cleanings" onBack={() => router.back()} />
        <EmptyState icon="lock-closed-outline" title="Owner only" body="Only the owner hands out cleanings. Open cleanings show under Open on the Jobs tab." />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Assign cleanings"
        subtitle={jobs ? (openTotal ? `${openTotal} need a cleaner` : "Every upcoming cleaning is covered") : "Loading cleanings…"}
        onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))}
      />

      <View style={styles.rangeRow}>
        {RANGES.map(r => (
          <TouchableOpacity
            key={r}
            style={[styles.rangeChip, range === r && styles.rangeChipOn]}
            onPress={() => { tapSelect(); setRange(r); }}
            accessibilityRole="tab"
            accessibilityState={{ selected: range === r }}
          >
            <Text style={[styles.rangeText, range === r && styles.rangeTextOn]}>{RANGE_LABELS[r]}</Text>
            <Text style={[styles.rangeCount, range === r && styles.rangeTextOn, counts[r] > 0 && range !== r && { color: colors.goldDark }]}>{counts[r]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {crew.length > 0 ? (
        <View style={styles.loadRow}>
          <Text style={styles.loadLabel}>{RANGE_LABELS[range]} so far:</Text>
          {crew.map(e => (
            <View key={e.id} style={styles.loadItem}>
              <ColorDot color={cleanerColor(e)} />
              <Text style={styles.loadText}>{e.name.split(" ")[0]} {load.get(e.id) || 0}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 130 }}>
        {loadError && !jobs ? (
          <ErrorState title="Couldn't load the cleanings" body={`Check your connection and try again. (${loadError})`} />
        ) : !jobs ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.teal} />
            <Text style={styles.loadingText}>Loading cleanings…</Text>
          </View>
        ) : crew.length === 0 ? (
          <EmptyState icon="people-outline" title="No cleaners yet" body="Add cleaners on the Team tab, then come back here to hand out the open cleanings." />
        ) : days.length === 0 ? (
          <EmptyState
            icon="checkmark-done-outline"
            title={`${RANGE_LABELS[range]} is covered`}
            body={range === "later" ? "Nothing further out needs a cleaner yet." : "Every cleaning in this stretch has someone on it."}
          />
        ) : (
          days.map(day => (
            <View key={day.key}>
              <Text style={styles.dayHeading}>{formatDayHeading(day.key)}</Text>
              {day.jobs.map(job => {
                const assignee = job.assignedTo ? employeeById.get(job.assignedTo) : undefined;
                const time = formatTime(job.time);
                return (
                  <Card key={job.id} accent={assignee ? cleanerColor(assignee) : undefined} tone={hasSameDayTurnover(job) ? "gold" : "default"}>
                    <TouchableOpacity onPress={() => router.push({ pathname: "/job", params: { id: job.id } })} accessibilityRole="button" accessibilityHint="Opens the cleaning">
                      <View style={styles.jobTop}>
                        <Text style={styles.house} numberOfLines={1}>{houseLabel(job, properties)}</Text>
                        {saving.has(job.id) ? <ActivityIndicator size="small" color={colors.teal} /> : null}
                      </View>
                      <View style={styles.pillRow}>
                        {time ? <Pill label={time} tone="neutral" icon="time-outline" /> : null}
                        {hasSameDayTurnover(job) ? <Pill label="Same-day" tone="gold" icon="alert-circle" /> : null}
                        <Pill label={job.type} tone="neutral" />
                      </View>
                    </TouchableOpacity>
                    <View style={styles.crewRow}>
                      {crew.map(e => {
                        const on = job.assignedTo === e.id;
                        const color = cleanerColor(e);
                        return (
                          <TouchableOpacity
                            key={e.id}
                            style={[styles.crewChip, { borderColor: color }, on && { backgroundColor: color }]}
                            onPress={() => assign(job, on ? null : e)}
                            disabled={saving.has(job.id)}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: on }}
                            accessibilityLabel={on ? `${e.name} has this. Tap to take it back off them` : `Give this to ${e.name}`}
                          >
                            <Text style={[styles.crewText, { color: on ? textOn(color) : colors.ink }]}>{e.name.split(" ")[0]}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </Card>
                );
              })}
            </View>
          ))
        )}
      </ScrollView>

      {jobs && openTotal > 0 && crew.length > 0 ? (
        <BottomBar>
          <BrandButton label={asking ? "Sending…" : "Ask the crew to pick some up"} icon="megaphone-outline" variant="outline" onPress={askCrew} disabled={asking} />
        </BottomBar>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20 },
  rangeRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  rangeChip: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 42,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
  },
  rangeChipOn: { backgroundColor: colors.dark, borderColor: colors.dark },
  rangeText: { fontSize: 13, fontWeight: "600", color: colors.muted },
  rangeCount: { fontSize: 13, fontWeight: "800", color: colors.muted },
  rangeTextOn: { color: colors.white },
  loadRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 10 },
  loadLabel: { fontSize: 12.5, color: colors.muted },
  loadItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  loadText: { fontSize: 12.5, fontWeight: "700", color: colors.ink },
  loading: { alignItems: "center", paddingVertical: 48, gap: 10 },
  loadingText: { fontSize: 14, color: colors.muted },
  dayHeading: { fontSize: 13, fontWeight: "800", color: colors.ink, marginTop: 8, marginBottom: 8 },
  jobTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  house: { flex: 1, fontSize: 16.5, fontWeight: "700", color: colors.ink },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  crewRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  crewChip: { minHeight: 40, minWidth: 64, paddingHorizontal: 14, borderRadius: radius.pill, borderWidth: 1.5, alignItems: "center", justifyContent: "center", backgroundColor: colors.card },
  crewText: { fontSize: 14, fontWeight: "700" },
});
