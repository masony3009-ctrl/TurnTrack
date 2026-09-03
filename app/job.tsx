import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { addDoc, collection, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useProfile } from "../components/ProfileProvider";
import { Avatar, BrandButton, Card, Pill, SheetModal } from "../components/ui";
import { db } from "../firebase";
import { assignmentMessage, cancellationMessage, sendPushToEmployee, unassignedMessage } from "../notifications";
import { computeEarned, formatDuration, formatElapsed, formatMoney, minutesBetween } from "../payroll";
import { cleanerColor, colors, radius, type } from "../theme";
import { buildChecklist, ChecklistItem, DEFAULT_CHECKLIST, Employee, Job } from "../types";

export default function JobDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [missing, setMissing] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showAssign, setShowAssign] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const [now, setNow] = useState(Date.now());
  const checklistInitialized = useRef(false);
  const templateRef = useRef<string[]>(DEFAULT_CHECKLIST);
  const { state } = useProfile();
  const isOwner = state.status === "owner";

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "settings", "checklist"), (snapshot) => {
      const items = snapshot.data()?.items;
      templateRef.current = Array.isArray(items) && items.length > 0 ? items : DEFAULT_CHECKLIST;
    }, (error) => {
      console.warn("checklist template listener error:", error);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!id) return;
    const unsub = onSnapshot(doc(db, "jobs", id), (snapshot) => {
      if (!snapshot.exists()) {
        setMissing(true);
        setJob(null);
        return;
      }
      const data = { id: snapshot.id, ...snapshot.data() } as Job;
      setJob(data);
      if (!data.checklist && !checklistInitialized.current) {
        checklistInitialized.current = true;
        updateDoc(doc(db, "jobs", id), { checklist: buildChecklist(templateRef.current) });
      }
    }, (error) => {
      console.warn("job listener error:", error);
      setMissing(true);
    });
    return unsub;
  }, [id]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "employees"), (snapshot) => {
      const loaded = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Employee[];
      loaded.sort((a, b) => a.name.localeCompare(b.name));
      setEmployees(loaded);
    }, (error) => {
      console.warn("employees listener error:", error);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!job?.startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [job?.startedAt]);

  const assign = async (emp: Employee | null) => {
    if (!job) return;
    const previousId = job.assignedTo || null;
    if ((emp ? emp.id : null) === previousId) {
      setShowAssign(false);
      return;
    }
    try {
      await updateDoc(doc(db, "jobs", job.id), {
        assignedTo: emp ? emp.id : null,
        assignedToName: emp ? emp.name : null,
      });
      setShowAssign(false);
      // Tell the new cleaner, and the old one if there was one. Pushes go to
      // whichever phones are signed in as them; failures are logged, not shown.
      if (emp) sendPushToEmployee(emp.id, assignmentMessage({ ...job, assignedTo: emp.id, assignedToName: emp.name }));
      if (previousId) sendPushToEmployee(previousId, unassignedMessage(job));
    } catch (e) {
      console.warn("assign failed:", e);
      Alert.alert("Couldn't assign", "The assignment didn't save. Check your connection and try again.");
    }
  };

  const startCleaning = async () => {
    if (!job) return;
    if (!job.assignedTo) {
      Alert.alert("No cleaner assigned", "Assign this job to a cleaner first so the time gets tracked to them.");
      return;
    }
    try {
      const update: Partial<Job> = { startedAt: Date.now() };
      if (!job.checklist || job.checklist.length === 0) {
        update.checklist = buildChecklist(templateRef.current);
      }
      await updateDoc(doc(db, "jobs", job.id), update);
      // The checklist pops up as soon as the timer starts.
      setShowChecklist(true);
    } catch (e) {
      console.warn("start cleaning failed:", e);
      Alert.alert("Couldn't start the timer", "Check your connection and try again.");
    }
  };

  const cancelCleaning = () => {
    if (!job) return;
    Alert.alert(
      "Cancel this cleaning",
      `Cancel ${job.address} on ${job.date}? It disappears from everyone's phone but stays in the records.${job.assignedToName ? ` ${job.assignedToName} will be notified.` : ""}`,
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Cancel cleaning",
          style: "destructive",
          onPress: async () => {
            try {
              await updateDoc(doc(db, "jobs", job.id), {
                cancelled: true,
                cancelledAt: Date.now(),
                cancelReason: "Cancelled by owner",
                startedAt: null,
              });
              if (job.assignedTo) sendPushToEmployee(job.assignedTo, cancellationMessage(job));
              router.back();
            } catch (e) {
              console.warn("cancel failed:", e);
              Alert.alert("Couldn't cancel", "Check your connection and try again.");
            }
          },
        },
      ]
    );
  };

  const restoreCleaning = async () => {
    if (!job) return;
    try {
      await updateDoc(doc(db, "jobs", job.id), { cancelled: false, cancelledAt: null, cancelReason: null });
      if (job.assignedTo) sendPushToEmployee(job.assignedTo, assignmentMessage(job));
    } catch (e) {
      console.warn("restore failed:", e);
      Alert.alert("Couldn't restore", "Check your connection and try again.");
    }
  };

  const cancelTimer = () => {
    if (!job) return;
    Alert.alert("Cancel timer", "Discard this timer without logging any time?", [
      { text: "Keep timing", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: async () => {
          await updateDoc(doc(db, "jobs", job.id), { startedAt: null });
        },
      },
    ]);
  };

  const finishCleaning = async () => {
    if (!job || !job.startedAt) return;
    const emp = employees.find(e => e.id === job.assignedTo);
    const rate = emp ? emp.hourlyRate : 0;
    const endedAt = Date.now();
    const minutes = minutesBetween(job.startedAt, endedAt);
    const earned = computeEarned(minutes, rate);
    const employeeName = job.assignedToName || emp?.name || "Unknown";

    if (!emp) {
      Alert.alert(
        "Cleaner not found",
        "The assigned cleaner no longer exists, so no pay can be calculated. Reassign the job and finish again, or discard the timer."
      );
      return;
    }

    try {
      await addDoc(collection(db, "timeEntries"), {
        jobId: job.id,
        jobAddress: job.address,
        jobDate: job.date,
        employeeId: emp.id,
        employeeName,
        startedAt: job.startedAt,
        endedAt,
        minutes,
        hourlyRate: rate,
        earned,
        paid: false,
        paidAt: null,
        method: null,
      });
      await updateDoc(doc(db, "jobs", job.id), {
        startedAt: null,
        done: true,
        completedAt: endedAt,
        timeSummary: { employeeName, minutes, earned },
      });
      Alert.alert(
        "Cleaning finished",
        `${employeeName} worked ${formatDuration(minutes)} and earned ${formatMoney(earned)}. It's been added to payroll.`
      );
    } catch (e) {
      console.warn("finish cleaning failed:", e);
      Alert.alert(
        "Couldn't save the time",
        "The time entry didn't save, so the timer is still running. Check your connection and the Firestore security rules (timeEntries collection), then tap Finish again."
      );
    }
  };

  const toggleChecklistItem = async (index: number) => {
    if (!job?.checklist) return;
    const updated = job.checklist.map((item, i) =>
      i === index ? { ...item, done: !item.done } : item
    );
    await updateDoc(doc(db, "jobs", job.id), { checklist: updated });
  };

  const BackRow = (
    <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
      <Ionicons name="chevron-back" size={20} color={colors.tealDark} />
      <Text style={styles.backText}>Jobs</Text>
    </TouchableOpacity>
  );

  if (missing) {
    return (
      <View style={styles.container}>
        {BackRow}
        <Text style={type.wordmark}>TurnTrack</Text>
        <Text style={[type.title, { marginTop: 2 }]}>Job not found</Text>
        <Text style={styles.missingText}>This job was deleted or couldn&apos;t be loaded. Go back to see the current list.</Text>
      </View>
    );
  }

  if (!job) {
    return (
      <View style={styles.container}>
        {BackRow}
        <Text style={type.wordmark}>TurnTrack</Text>
        <Text style={[type.title, { marginTop: 2 }]}>Loading job…</Text>
      </View>
    );
  }

  const checklist = job.checklist || [];
  const checkedCount = checklist.filter(item => item.done).length;
  const progress = checklist.length > 0 ? checkedCount / checklist.length : 0;
  const activeEmployees = employees.filter(e => e.active);
  const sameDay = job.sameDayTurnover === true;
  const assignedEmployee = employees.find(e => e.id === job.assignedTo);
  const assignedColor = job.assignedTo ? cleanerColor(assignedEmployee || { id: job.assignedTo }) : colors.gold;

  const renderChecklist = (items: ChecklistItem[]) => items.map((item, i) => (
    <TouchableOpacity key={i} style={styles.checkRow} onPress={() => toggleChecklistItem(i)}>
      <View style={[styles.checkCircle, item.done && styles.checkCircleActive]}>
        {item.done && <Ionicons name="checkmark" size={14} color={colors.white} />}
      </View>
      <Text style={[styles.checkItem, item.done && styles.checkItemDone]}>{item.text}</Text>
    </TouchableOpacity>
  ));

  return (
    <View style={styles.container}>
      {BackRow}
      <Text style={type.wordmark}>TurnTrack</Text>
      <Text style={styles.heroTitle}>{job.address}</Text>
      <View style={styles.heroPills}>
        <Pill label={job.type} tone="teal" />
        {sameDay && <Pill label="Same-day turnover" tone="gold" icon="alert-circle" />}
        {job.cancelled && <Pill label="Cancelled" tone="danger" icon="close-circle" />}
      </View>
      <View style={styles.heroMeta}>
        <Ionicons name="calendar-clear-outline" size={14} color={colors.muted} />
        <Text style={styles.heroMetaText}>{job.date}</Text>
      </View>

      <SheetModal visible={showAssign} title="Assign to" onClose={() => setShowAssign(false)}>
        {activeEmployees.length === 0 && (
          <Text style={styles.noEmployeesText}>
            No active cleaners yet. Add one on the Team tab first.
          </Text>
        )}
        {activeEmployees.map(emp => (
          <TouchableOpacity
            key={emp.id}
            style={[styles.assignOption, job.assignedTo === emp.id && styles.assignOptionActive]}
            onPress={() => assign(emp)}
          >
            <Avatar name={emp.name} photo={emp.photo} color={cleanerColor(emp)} size={34} />
            <View style={{ flex: 1 }}>
              <Text style={styles.assignName}>{emp.name}</Text>
              {isOwner && <Text style={styles.assignRate}>{formatMoney(emp.hourlyRate)}/hr</Text>}
            </View>
            {job.assignedTo === emp.id && (
              <Ionicons name="checkmark-circle" size={22} color={colors.teal} />
            )}
          </TouchableOpacity>
        ))}
        {job.assignedTo && (
          <TouchableOpacity style={styles.unassignRow} onPress={() => assign(null)}>
            <Ionicons name="person-remove-outline" size={16} color={colors.danger} />
            <Text style={styles.unassignText}>Remove assignment</Text>
          </TouchableOpacity>
        )}
      </SheetModal>

      <SheetModal visible={showChecklist} title="Cleaning checklist" onClose={() => setShowChecklist(false)}>
        <View style={styles.sheetProgressRow}>
          <Text style={styles.sheetProgressText}>{checkedCount} of {checklist.length} done</Text>
          <View style={[styles.progressTrack, { flex: 1, marginTop: 0, marginBottom: 0 }]}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        </View>
        {renderChecklist(checklist)}
        <BrandButton
          label={checkedCount === checklist.length && checklist.length > 0 ? "All done — close" : "Keep cleaning"}
          icon={checkedCount === checklist.length && checklist.length > 0 ? "checkmark-done" : "sparkles"}
          onPress={() => setShowChecklist(false)}
          style={{ marginTop: 14 }}
        />
      </SheetModal>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {job.cancelled && (
          <View style={styles.cancelledBanner}>
            <Ionicons name="close-circle" size={17} color={colors.danger} />
            <Text style={styles.cancelledBannerText}>
              This cleaning was cancelled{job.cancelReason ? ` (${job.cancelReason.toLowerCase()})` : ""}. It&apos;s hidden from the job list.
            </Text>
          </View>
        )}
        {sameDay && (
          <View style={styles.sameDayBanner}>
            <Ionicons name="alert-circle" size={17} color={colors.goldDark} />
            <Text style={styles.sameDayBannerText}>Checkout and new check-in happen on this date — clean must be done between guests.</Text>
          </View>
        )}

        <Card>
          <View style={styles.assignHeader}>
            <Text style={type.section}>Assigned cleaner</Text>
            {!job.cancelled && (
              <TouchableOpacity onPress={() => setShowAssign(true)} hitSlop={6}>
                <Text style={styles.changeLink}>{job.assignedToName ? "Change" : "Assign"}</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.assignBody}>
            {job.assignedToName ? (
              <>
                <Avatar
                  name={job.assignedToName}
                  photo={assignedEmployee?.photo}
                  color={assignedColor}
                  size={38}
                />
                <Text style={[styles.assignedName, { color: assignedColor }]}>{job.assignedToName}</Text>
              </>
            ) : (
              <>
                <View style={styles.unassignedCircle}>
                  <Ionicons name="person-add-outline" size={17} color={colors.goldDark} />
                </View>
                <Text style={styles.unassignedText}>Nobody assigned yet</Text>
              </>
            )}
          </View>
        </Card>

        {!job.cancelled && <Card>
          <Text style={type.section}>Time tracking</Text>
          {job.startedAt ? (
            <View style={styles.timerBlock}>
              <View style={styles.liveRow}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>{job.assignedToName} is cleaning</Text>
              </View>
              <Text style={styles.timerText}>{formatElapsed(job.startedAt, now)}</Text>
              <BrandButton label="Open checklist" icon="list" variant="outline" onPress={() => setShowChecklist(true)} style={{ marginBottom: 10 }} />
              <BrandButton label="Finish cleaning" icon="checkmark-circle" onPress={finishCleaning} />
              <TouchableOpacity style={styles.cancelTimerBtn} onPress={cancelTimer}>
                <Text style={styles.cancelTimerText}>Discard timer</Text>
              </TouchableOpacity>
            </View>
          ) : job.timeSummary ? (
            <View style={styles.timerBlock}>
              <View style={styles.summaryStrip}>
                <Ionicons name="checkmark-circle" size={19} color={colors.teal} />
                <Text style={styles.summaryText}>
                  {job.timeSummary.employeeName} — {formatDuration(job.timeSummary.minutes)} — {formatMoney(job.timeSummary.earned)}
                </Text>
              </View>
              <BrandButton label="Start another session" icon="play" variant="outline" onPress={startCleaning} />
            </View>
          ) : (
            <View style={styles.timerBlock}>
              <BrandButton label="Start cleaning" icon="play" onPress={startCleaning} style={styles.startBtn} />
            </View>
          )}
        </Card>}

        <Card>
          <View style={styles.checklistHeader}>
            <Text style={type.section}>Checklist</Text>
            <Text style={styles.checklistCount}>{checkedCount}/{checklist.length}</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
          {renderChecklist(checklist)}
        </Card>
        {isOwner && (
          job.cancelled ? (
            <BrandButton label="Restore this cleaning" icon="refresh" variant="outline" onPress={restoreCleaning} />
          ) : (
            <TouchableOpacity style={styles.cancelLink} onPress={cancelCleaning} hitSlop={6}>
              <Ionicons name="close-circle-outline" size={16} color={colors.danger} />
              <Text style={styles.cancelLinkText}>Cancel this cleaning</Text>
            </TouchableOpacity>
          )
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  cancelledBanner: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.dangerSoft,
    borderRadius: radius.md, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: "#F3C8C8",
  },
  cancelledBannerText: { flex: 1, fontSize: 13.5, color: colors.danger, lineHeight: 19, fontWeight: "600" },
  sheetProgressRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 6 },
  sheetProgressText: { fontSize: 13, fontWeight: "700", color: colors.tealDark },
  cancelLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14 },
  cancelLinkText: { fontSize: 14, fontWeight: "600", color: colors.danger },
  container: { flex: 1, backgroundColor: colors.bg, paddingTop: 56, paddingHorizontal: 20 },
  back: { flexDirection: "row", alignItems: "center", marginBottom: 10, alignSelf: "flex-start" },
  backText: { fontSize: 15, fontWeight: "600", color: colors.tealDark },
  missingText: { fontSize: 15, color: colors.muted, marginTop: 8 },
  heroTitle: { fontSize: 23, fontWeight: "700", color: colors.ink, marginTop: 2, marginBottom: 8 },
  heroPills: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginBottom: 7 },
  heroMeta: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 16 },
  heroMetaText: { fontSize: 13.5, color: colors.muted },
  sameDayBanner: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.goldSoft,
    borderRadius: radius.md, padding: 12, marginBottom: 12,
    borderWidth: 1, borderColor: "#F0DDBA",
  },
  sameDayBannerText: { flex: 1, fontSize: 13, fontWeight: "600", color: colors.goldDark, lineHeight: 18 },
  assignHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  changeLink: { fontSize: 13.5, fontWeight: "600", color: colors.tealDark },
  assignBody: { flexDirection: "row", alignItems: "center", gap: 11, marginTop: 11 },
  assignedName: { fontSize: 16, fontWeight: "700", color: colors.ink },
  unassignedCircle: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: colors.goldSoft,
    alignItems: "center", justifyContent: "center",
  },
  unassignedText: { fontSize: 15, fontWeight: "600", color: colors.goldDark },
  timerBlock: { marginTop: 12 },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 4 },
  liveDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.gold },
  liveText: { fontSize: 13.5, fontWeight: "600", color: colors.muted },
  timerText: { fontSize: 46, fontWeight: "700", color: colors.ink, fontVariant: ["tabular-nums"], marginBottom: 14 },
  startBtn: { paddingVertical: 15 },
  cancelTimerBtn: { alignItems: "center", padding: 10, marginTop: 4 },
  cancelTimerText: { color: colors.danger, fontSize: 13.5, fontWeight: "600" },
  summaryStrip: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.tealFaint,
    borderRadius: radius.sm, padding: 11, marginBottom: 12,
  },
  summaryText: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.tealDark },
  checklistHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  checklistCount: { fontSize: 13.5, fontWeight: "700", color: colors.tealDark },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.bg, marginTop: 10, marginBottom: 6, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.teal },
  checkRow: {
    flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.bg,
  },
  checkCircle: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.line,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.card,
  },
  checkCircleActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  checkItem: { flex: 1, fontSize: 14.5, color: colors.ink },
  checkItemDone: { color: colors.faint, textDecorationLine: "line-through" },
  noEmployeesText: { fontSize: 14, color: colors.muted, marginBottom: 12, lineHeight: 20 },
  assignOption: {
    flexDirection: "row", alignItems: "center", gap: 11,
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    padding: 12, marginBottom: 8, backgroundColor: colors.bg,
  },
  assignOptionActive: { borderColor: colors.teal, borderWidth: 1.5, backgroundColor: colors.tealFaint },
  assignName: { fontSize: 15, fontWeight: "600", color: colors.ink },
  assignRate: { fontSize: 12.5, color: colors.muted, marginTop: 1 },
  unassignRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 11, marginTop: 2 },
  unassignText: { fontSize: 14, fontWeight: "600", color: colors.danger },
});
