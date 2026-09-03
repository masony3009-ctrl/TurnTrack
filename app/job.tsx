import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { collection, doc, onSnapshot, updateDoc, writeBatch } from "firebase/firestore";
import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { tapImpact, tapSelect, tapSuccess, tapWarning } from "../components/haptics";
import { openInMaps } from "../components/maps";
import { useProfile } from "../components/ProfileProvider";
import { alertSoon, AssigneeRow, Avatar, BottomBar, BrandButton, Card, ChecklistRow, ElapsedTimer, Pill, ProgressBar, ScreenHeader, SheetModal } from "../components/ui";
import { db } from "../firebase";
import { assignmentMessage, cancellationMessage, sendPushToEmployee, unassignedMessage } from "../notifications";
import { computeEarned, formatDuration, formatMoney, minutesBetween } from "../payroll";
import { cleanerColor, colors, radius, type, unassignedColor } from "../theme";
import { daysFromToday, formatDayHeading, jobDateKey, relativeDayLabel } from "../turnover";
import { buildChecklist, ChecklistItem, DEFAULT_CHECKLIST, Employee, Job } from "../types";

export default function JobDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [missing, setMissing] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const [template, setTemplate] = useState<string[]>(DEFAULT_CHECKLIST);
  const [busy, setBusy] = useState(false);
  const { state, employees } = useProfile();
  const isOwner = state.status === "owner";
  const selfId = state.status === "cleaner" ? state.employee.id : null;
  const selfName = state.status === "cleaner" ? state.employee.name : null;

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "settings", "checklist"), (snapshot) => {
      const items = snapshot.data()?.items;
      setTemplate(Array.isArray(items) && items.length > 0 ? items : DEFAULT_CHECKLIST);
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
      setJob({ id: snapshot.id, ...snapshot.data() } as Job);
    }, (error) => {
      console.warn("job listener error:", error);
      setMissing(true);
    });
    return unsub;
  }, [id]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  // Permissions. Firestore is open, so this is the only gate: the owner can
  // do anything; a cleaner can work only the job assigned to them, and can
  // take an unassigned one.
  const isMine = !!selfId && job?.assignedTo === selfId;
  const canWork = isOwner || isMine;
  const canTake = !isOwner && !!selfId && !!job && !job.assignedTo && !job.cancelled;

  // Checklist shown from the template when the job has none yet; the list is
  // only written to the job when someone actually starts or ticks it.
  const checklist: ChecklistItem[] = job?.checklist && job.checklist.length > 0 ? job.checklist : buildChecklist(template);
  const checkedCount = checklist.filter(item => item.done).length;
  const progress = checklist.length > 0 ? checkedCount / checklist.length : 0;
  const allDone = checklist.length > 0 && checkedCount === checklist.length;

  const notify = (employeeId: string | null | undefined, message: ReturnType<typeof assignmentMessage>) => {
    if (employeeId) sendPushToEmployee(employeeId, message);
  };

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
      tapSuccess();
      if (emp) notify(emp.id, assignmentMessage({ ...job, assignedTo: emp.id, assignedToName: emp.name }));
      notify(previousId, unassignedMessage(job));
    } catch (e) {
      console.warn("assign failed:", e);
      Alert.alert("Couldn't assign", "The assignment didn't save. Check your connection and try again.");
    }
  };

  const takeJob = async () => {
    if (!job || !selfId || !selfName) return;
    try {
      await updateDoc(doc(db, "jobs", job.id), { assignedTo: selfId, assignedToName: selfName });
      tapSuccess();
    } catch (e) {
      console.warn("take job failed:", e);
      Alert.alert("Couldn't take the job", "Check your connection and try again.");
    }
  };

  const startCleaning = async () => {
    if (!job || busy) return;
    if (!job.assignedTo) {
      if (canTake) {
        // Cleaner takes an unassigned job and starts in one step.
        setBusy(true);
        try {
          await updateDoc(doc(db, "jobs", job.id), {
            assignedTo: selfId,
            assignedToName: selfName,
            startedAt: Date.now(),
            ...(job.checklist && job.checklist.length > 0 ? {} : { checklist: buildChecklist(template) }),
          });
          tapImpact();
          setShowChecklist(true);
        } catch (e) {
          console.warn("start cleaning failed:", e);
          Alert.alert("Couldn't start the timer", "Check your connection and try again.");
        }
        setBusy(false);
        return;
      }
      Alert.alert("No cleaner assigned", "Assign this job to a cleaner first so the time gets tracked to them.");
      return;
    }
    if (!canWork) {
      Alert.alert("Not your job", `This cleaning is assigned to ${job.assignedToName}. Ask the owner to reassign it if that's wrong.`);
      return;
    }
    setBusy(true);
    try {
      await updateDoc(doc(db, "jobs", job.id), {
        startedAt: Date.now(),
        ...(job.checklist && job.checklist.length > 0 ? {} : { checklist: buildChecklist(template) }),
      });
      tapImpact();
      setShowChecklist(true);
    } catch (e) {
      console.warn("start cleaning failed:", e);
      Alert.alert("Couldn't start the timer", "Check your connection and try again.");
    }
    setBusy(false);
  };

  const cancelTimer = () => {
    if (!job || !canWork) return;
    Alert.alert("Discard timer", "Throw away this timer without logging any time?", [
      { text: "Keep timing", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: async () => {
          try {
            await updateDoc(doc(db, "jobs", job.id), { startedAt: null });
            tapWarning();
          } catch (e) {
            console.warn("discard timer failed:", e);
          }
        },
      },
    ]);
  };

  // Writes the time entry and closes the job in ONE batch so a retry can
  // never double-log. Returns false if the cleaner record is gone.
  const logTimeAndClose = async (opts: { cancel?: boolean }) => {
    if (!job || !job.startedAt) return false;
    const emp = employees.find(e => e.id === job.assignedTo);
    if (!emp) {
      Alert.alert(
        "Cleaner not found",
        "The assigned cleaner no longer exists, so no pay can be calculated. Reassign the job and try again, or discard the timer."
      );
      return false;
    }
    const endedAt = Date.now();
    const minutes = minutesBetween(job.startedAt, endedAt);
    const earned = computeEarned(minutes, emp.hourlyRate);
    const employeeName = job.assignedToName || emp.name;
    const batch = writeBatch(db);
    batch.set(doc(collection(db, "timeEntries")), {
      jobId: job.id,
      jobAddress: job.address,
      jobDate: job.date,
      employeeId: emp.id,
      employeeName,
      startedAt: job.startedAt,
      endedAt,
      minutes,
      hourlyRate: emp.hourlyRate,
      earned,
      paid: false,
      paidAt: null,
      method: null,
    });
    batch.update(doc(db, "jobs", job.id), {
      startedAt: null,
      done: !opts.cancel,
      completedAt: opts.cancel ? null : endedAt,
      timeSummary: { employeeName, minutes, earned },
      ...(opts.cancel ? { cancelled: true, cancelledAt: endedAt, cancelReason: "Cancelled by owner" } : {}),
    });
    await batch.commit();
    return { employeeName, minutes, earned };
  };

  const finishCleaning = async () => {
    if (!job || !job.startedAt || busy || !canWork) return;
    const unchecked = checklist.length - checkedCount;
    const proceed = async () => {
      setBusy(true);
      try {
        const result = await logTimeAndClose({});
        if (result) {
          tapSuccess();
          setShowChecklist(false);
          alertSoon(
            "Cleaning finished",
            `${result.employeeName} worked ${formatDuration(result.minutes)} and earned ${formatMoney(result.earned)}. It's been added to payroll.`
          );
        }
      } catch (e) {
        console.warn("finish cleaning failed:", e);
        Alert.alert(
          "Couldn't save the time",
          "Nothing was saved and the timer is still running. Check your connection, then tap Finish again."
        );
      }
      setBusy(false);
    };
    if (unchecked > 0) {
      Alert.alert(
        `${unchecked} item${unchecked === 1 ? "" : "s"} unchecked`,
        "Finish anyway, or go back to the checklist?",
        [
          { text: "Review checklist", onPress: () => setShowChecklist(true) },
          { text: "Finish anyway", style: "destructive", onPress: proceed },
        ]
      );
      return;
    }
    proceed();
  };

  const cancelCleaning = () => {
    if (!job || !isOwner) return;
    const finish = async (mode: "log" | "discard" | "plain") => {
      try {
        if (mode === "log") {
          const result = await logTimeAndClose({ cancel: true });
          if (!result) return;
        } else {
          await updateDoc(doc(db, "jobs", job.id), {
            cancelled: true,
            cancelledAt: Date.now(),
            cancelReason: "Cancelled by owner",
            startedAt: null,
          });
        }
        notify(job.assignedTo, cancellationMessage(job));
        tapWarning();
        goBack();
      } catch (e) {
        console.warn("cancel failed:", e);
        Alert.alert("Couldn't cancel", "Check your connection and try again.");
      }
    };
    if (job.startedAt) {
      const minutes = minutesBetween(job.startedAt, Date.now());
      Alert.alert(
        "Timer is running",
        `${job.assignedToName || "The cleaner"} has ${formatDuration(minutes)} on the clock. Log that time to payroll before cancelling?`,
        [
          { text: "Keep the job", style: "cancel" },
          { text: "Discard time & cancel", style: "destructive", onPress: () => finish("discard") },
          { text: "Log time & cancel", onPress: () => finish("log") },
        ]
      );
      return;
    }
    Alert.alert(
      "Cancel this cleaning",
      `Cancel ${job.address} on ${job.date}? It disappears from everyone's phone but stays in the records.${job.assignedToName ? ` ${job.assignedToName} will be notified.` : ""}`,
      [
        { text: "Keep it", style: "cancel" },
        { text: "Cancel cleaning", style: "destructive", onPress: () => finish("plain") },
      ]
    );
  };

  const restoreCleaning = async () => {
    if (!job || !isOwner) return;
    try {
      await updateDoc(doc(db, "jobs", job.id), { cancelled: false, cancelledAt: null, cancelReason: null });
      notify(job.assignedTo, assignmentMessage(job));
      tapSuccess();
    } catch (e) {
      console.warn("restore failed:", e);
      Alert.alert("Couldn't restore", "Check your connection and try again.");
    }
  };

  const toggleChecklistItem = async (index: number) => {
    if (!job || !canWork) return;
    const updated = checklist.map((item, i) => (i === index ? { ...item, done: !item.done } : item));
    tapSelect();
    try {
      await updateDoc(doc(db, "jobs", job.id), { checklist: updated });
    } catch (e) {
      console.warn("checklist update failed:", e);
    }
  };

  if (missing) {
    return (
      <View style={styles.container}>
        <ScreenHeader onBack={goBack} title="Job not found" subtitle="This job was deleted or couldn't be loaded." />
      </View>
    );
  }
  if (!job) {
    return (
      <View style={styles.container}>
        <ScreenHeader onBack={goBack} title="Loading…" />
      </View>
    );
  }

  const key = jobDateKey(job);
  const days = daysFromToday(job);
  const rel = relativeDayLabel(days);
  const sameDay = job.sameDayTurnover === true;
  const running = !!job.startedAt;
  const activeEmployees = employees.filter(e => e.active);
  const assignedEmployee = employees.find(e => e.id === job.assignedTo);
  const assignedColor = job.assignedTo ? cleanerColor(assignedEmployee || { id: job.assignedTo }) : unassignedColor;
  const dateHeading = key ? formatDayHeading(key) : job.date;

  const renderChecklist = () => checklist.map((item, i) => (
    <ChecklistRow key={i} text={item.text} done={item.done} onPress={canWork ? () => toggleChecklistItem(i) : undefined} />
  ));

  return (
    <View style={styles.container}>
      <ScreenHeader
        onBack={goBack}
        backLabel="Back"
        title={job.address}
        subtitle={rel ? `${dateHeading} · ${rel}` : dateHeading}
      />

      <SheetModal visible={showAssign} title="Assign to" onClose={() => setShowAssign(false)}>
        {activeEmployees.length === 0 && (
          <Text style={styles.sheetHint}>No active cleaners yet. Add one on the Team tab first.</Text>
        )}
        {activeEmployees.map(emp => (
          <TouchableOpacity
            key={emp.id}
            style={[styles.assignOption, job.assignedTo === emp.id && styles.assignOptionActive]}
            onPress={() => assign(emp)}
            activeOpacity={0.7}
          >
            <Avatar name={emp.name} photo={emp.photo} color={cleanerColor(emp)} size={36} />
            <View style={{ flex: 1 }}>
              <Text style={styles.assignName}>{emp.name}</Text>
              <Text style={styles.assignRate}>{formatMoney(emp.hourlyRate)}/hr</Text>
            </View>
            {job.assignedTo === emp.id && <Ionicons name="checkmark-circle" size={22} color={colors.teal} />}
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
          <View style={{ flex: 1 }}><ProgressBar value={progress} /></View>
        </View>
        {renderChecklist()}
        {running && canWork ? (
          <BrandButton
            label={allDone ? "All done — finish cleaning" : "Finish cleaning"}
            icon="checkmark-circle"
            variant={allDone ? "primary" : "outline"}
            onPress={() => { setShowChecklist(false); setTimeout(finishCleaning, 450); }}
            style={{ marginTop: 14 }}
          />
        ) : null}
        <BrandButton label="Keep cleaning" icon="sparkles" variant="ghost" onPress={() => setShowChecklist(false)} style={{ marginTop: 6 }} />
      </SheetModal>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 150 }}>
        <View style={styles.pillRow}>
          {running ? <Pill label="In progress" tone="solid" icon="time" /> : null}
          {job.done && !running ? <Pill label="Done" tone="neutral" icon="checkmark" /> : null}
          {job.cancelled ? <Pill label="Cancelled" tone="danger" icon="close-circle" /> : null}
          {sameDay ? <Pill label="Same-day turnover" tone="gold" icon="alert-circle" /> : null}
          <Pill label={job.type} tone="neutral" />
        </View>

        {job.cancelled && (
          <View style={styles.cancelledBanner}>
            <Ionicons name="close-circle" size={17} color={colors.danger} />
            <Text style={styles.cancelledBannerText}>
              This cleaning was cancelled{job.cancelReason ? ` (${job.cancelReason.toLowerCase()})` : ""}. It&apos;s hidden from the job list.
            </Text>
          </View>
        )}
        {sameDay && !job.cancelled && (
          <View style={styles.sameDayBanner}>
            <Ionicons name="alert-circle" size={17} color={colors.goldDark} />
            <Text style={styles.sameDayBannerText}>Checkout and a new check-in happen on this date. The clean has to be done between guests.</Text>
          </View>
        )}

        <Card onPress={() => openInMaps(job.address)}>
          <View style={styles.addressRow}>
            <View style={styles.addressIcon}>
              <Ionicons name="location" size={20} color={colors.tealDark} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={type.section}>Property</Text>
              <Text style={styles.addressText}>{job.address}</Text>
              <Text style={styles.addressHint}>Tap to open in Maps</Text>
            </View>
            <Ionicons name="navigate-circle-outline" size={26} color={colors.teal} />
          </View>
        </Card>

        <Card accent={assignedColor}>
          <View style={styles.cardHeaderRow}>
            <Text style={type.section}>Assigned cleaner</Text>
            {isOwner && !job.cancelled && (
              <TouchableOpacity onPress={() => setShowAssign(true)} hitSlop={8}>
                <Text style={styles.changeLink}>{job.assignedToName ? "Change" : "Assign"}</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={{ marginTop: 10 }}>
            <AssigneeRow name={job.assignedToName} color={assignedColor} photo={assignedEmployee?.photo} size={38} />
          </View>
          {canTake && (
            <BrandButton label="Take this job" icon="hand-right-outline" variant="outline" compact onPress={takeJob} style={{ marginTop: 12, alignSelf: "flex-start" }} />
          )}
        </Card>

        {!job.cancelled && (
          <Card>
            <Text style={type.section}>Time tracking</Text>
            {running && job.startedAt ? (
              <View style={styles.timerBlock}>
                <View style={styles.liveRow}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>{job.assignedToName} is cleaning</Text>
                </View>
                <ElapsedTimer startedAt={job.startedAt} />
                {canWork && (
                  <TouchableOpacity style={styles.discardBtn} onPress={cancelTimer} hitSlop={8}>
                    <Text style={styles.discardText}>Discard timer</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : job.timeSummary ? (
              <View style={styles.summaryStrip}>
                <Ionicons name="checkmark-circle" size={19} color={colors.teal} />
                <Text style={styles.summaryText}>
                  {job.timeSummary.employeeName} · {formatDuration(job.timeSummary.minutes)} · {formatMoney(job.timeSummary.earned)}
                </Text>
              </View>
            ) : (
              <Text style={styles.timerHint}>
                {canWork
                  ? "Tap Start cleaning below when you arrive. The checklist pops up and the clock starts."
                  : job.assignedToName
                    ? `Only ${job.assignedToName.split(" ")[0]} or the owner can start this timer.`
                    : "Assign a cleaner to start tracking time."}
              </Text>
            )}
          </Card>
        )}

        <Card>
          <View style={styles.cardHeaderRow}>
            <Text style={type.section}>Checklist</Text>
            <Text style={styles.checklistCount}>{checkedCount}/{checklist.length}</Text>
          </View>
          <ProgressBar value={progress} />
          {renderChecklist()}
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

      {!job.cancelled && (canWork || canTake) && (
        <BottomBar>
          {running ? (
            <View style={styles.barRow}>
              <BrandButton label="Checklist" icon="list" variant="outline" onPress={() => setShowChecklist(true)} style={{ flex: 1 }} />
              <BrandButton label={busy ? "Saving…" : "Finish cleaning"} icon="checkmark-circle" onPress={finishCleaning} disabled={busy} style={{ flex: 1.4 }} />
            </View>
          ) : (
            <BrandButton
              label={busy ? "Starting…" : canWork ? (job.timeSummary ? "Start another session" : "Start cleaning") : "Take this job & start"}
              icon="play"
              onPress={startCleaning}
              disabled={busy}
            />
          )}
        </BottomBar>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 12 },
  sheetHint: { fontSize: 14, color: colors.muted, marginBottom: 12 },
  cancelledBanner: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.dangerSoft,
    borderRadius: radius.md, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: "#F3C8C8",
  },
  cancelledBannerText: { flex: 1, fontSize: 13.5, color: colors.danger, lineHeight: 19, fontWeight: "600" },
  sameDayBanner: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.goldSoft,
    borderRadius: radius.md, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: "#F0DDBA",
  },
  sameDayBannerText: { flex: 1, fontSize: 13.5, color: colors.goldDark, lineHeight: 19, fontWeight: "600" },
  addressRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  addressIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.tealSoft, alignItems: "center", justifyContent: "center" },
  addressText: { fontSize: 16, fontWeight: "700", color: colors.ink, marginTop: 3 },
  addressHint: { fontSize: 12, color: colors.tealDark, fontWeight: "600", marginTop: 2 },
  cardHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  changeLink: { fontSize: 14, fontWeight: "700", color: colors.tealDark },
  timerBlock: { marginTop: 10, alignItems: "flex-start" },
  liveRow: { flexDirection: "row", alignItems: "center", gap: 7, marginBottom: 6 },
  liveDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.teal },
  liveText: { fontSize: 13.5, fontWeight: "600", color: colors.tealDark },
  discardBtn: { marginTop: 8, minHeight: 36, justifyContent: "center" },
  discardText: { fontSize: 13.5, fontWeight: "600", color: colors.danger },
  summaryStrip: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.tealFaint,
    borderRadius: radius.sm, padding: 11, marginTop: 10,
  },
  summaryText: { fontSize: 14, fontWeight: "600", color: colors.tealDark, flex: 1 },
  timerHint: { fontSize: 13.5, color: colors.muted, lineHeight: 19, marginTop: 8 },
  checklistCount: { fontSize: 13, fontWeight: "700", color: colors.tealDark },
  sheetProgressRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 6 },
  sheetProgressText: { fontSize: 13, fontWeight: "700", color: colors.tealDark },
  assignOption: {
    flexDirection: "row", alignItems: "center", gap: 11, minHeight: 56,
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    padding: 12, marginBottom: 8, backgroundColor: colors.bg,
  },
  assignOptionActive: { borderColor: colors.teal, backgroundColor: colors.tealFaint },
  assignName: { fontSize: 15, fontWeight: "600", color: colors.ink },
  assignRate: { fontSize: 12.5, color: colors.muted, marginTop: 1 },
  unassignRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, marginTop: 4 },
  unassignText: { fontSize: 14, fontWeight: "600", color: colors.danger },
  cancelLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 48 },
  cancelLinkText: { fontSize: 14, fontWeight: "600", color: colors.danger },
  barRow: { flexDirection: "row", gap: 10 },
});
