import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { arrayUnion, collection, deleteDoc, doc, getDocs, onSnapshot, query, runTransaction, updateDoc, where, writeBatch } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { OWNER_PHONE, OWNER_PHONE_LABEL } from "../business";
import { EndTimeSheet } from "../components/EndTimeSheet";
import { tapImpact, tapSelect, tapSuccess, tapWarning } from "../components/haptics";
import { openInMaps } from "../components/maps";
import { useProfile } from "../components/ProfileProvider";
import { FinishSheet } from "../components/FinishSheet";
import { PriceSheet } from "../components/PriceSheet";
import { RoomChecklist } from "../components/RoomChecklist";
import { alertSoon, AssigneeRow, Avatar, BottomBar, BrandButton, Card, ElapsedTimer, Pill, ProgressBar, ScreenHeader, SheetModal } from "../components/ui";
import { addableRooms, addRoom, checkAll, checklistForJob, checklistProgress, ownsList, removeRoom, roomMinutes, templateFromDoc, toggleStep, type ChecklistItem } from "../checklist";
import { db } from "../firebase";
import {
  assignmentMessage, cancellationMessage, discardedMessage, finishReportMessage, givenBackMessage, movedMessage, roomDoneMessage,
  sendPushToEmployee, sendPushToOwners, unassignedMessage,
} from "../notifications";
import { WhenSheet } from "../components/WhenSheet";
import { canEditDate, formatTime, withTime } from "../jobTime";
import { computeEarned, formatClockTime, formatDuration, formatMoney, minutesBetween } from "../payroll";
import { useProperties } from "../components/useProperties";
import { isDeepClean, jobPrice } from "../money";
import { accessCodes, findProperty, houseKey, type AccessCode } from "../properties";
import { isLongSession, mergeSummary, otherRunningJob, sessionEntryId, startCheck, waitBriefly } from "../session";
import { supplyList } from "../supplies";
import { cleanerColor, colors, radius, type, unassignedColor } from "../theme";
import { daysFromToday, formatDateLabel, formatDayHeading, jobDateKey, relativeDayLabel } from "../turnover";
import { Employee, FinishNote, Job } from "../types";

// How long a save may take before the screen stops waiting on it. With no
// signal Firestore keeps the change on this phone and uploads it later.
const SAVE_WAIT_MS = 2500;

// Thrown inside a claim transaction when someone else got the job first.
class AlreadyTaken extends Error {}

export default function JobDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [missing, setMissing] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const [showFinish, setShowFinish] = useState(false);
  const [showGiveBack, setShowGiveBack] = useState(false);
  const [showWhen, setShowWhen] = useState(false);
  const [showPrice, setShowPrice] = useState(false);
  // A long session waiting on "when did you finish?", with what Finish chose.
  const [endTimeFor, setEndTimeFor] = useState<{ note: string | null; allChecked: boolean; supplies: string[] } | null>(null);
  // True while a change made on this phone hasn't reached the server.
  const [pendingWrites, setPendingWrites] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // null until settings/checklist has loaded, so a job's stored list isn't
  // swapped for the fallback template in the meantime.
  const [template, setTemplate] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  // The freshest checklist we know of. Ticks write the whole array, so a
  // second tap landing before the server echoes the first must build on the
  // first, not on the array this render closed over - otherwise the faster
  // tap silently wipes the slower one.
  const checklistRef = useRef<ChecklistItem[]>([]);
  // Which code was last copied, so the hint can confirm it landed.
  const [copied, setCopied] = useState<string | null>(null);
  const properties = useProperties();
  const { state, employees } = useProfile();
  const isOwner = state.status === "owner";
  // The owner previewing as a cleaner looks but doesn't touch: anything done
  // here would be credited to the cleaner.
  const viewingAs = state.status === "cleaner" && state.ownerViewing;
  const selfId = state.status === "cleaner" && !viewingAs ? state.employee.id : null;
  const selfName = state.status === "cleaner" && !viewingAs ? state.employee.name : null;
  // The owner is behind this phone, either signed in as owner or viewing as
  // a cleaner. They don't need a push about their own ticks.
  const ownerAtPhone = isOwner || viewingAs;

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "settings", "checklist"), (snapshot) => {
      setTemplate(templateFromDoc(snapshot.data()));
    }, (error) => {
      console.warn("checklist template listener error:", error);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!id) return;
    setLoadError(false);
    const unsub = onSnapshot(doc(db, "jobs", id), { includeMetadataChanges: true }, (snapshot) => {
      setPendingWrites(snapshot.metadata.hasPendingWrites);
      if (!snapshot.exists()) {
        setMissing(true);
        setJob(null);
        return;
      }
      setMissing(false);
      setJob({ id: snapshot.id, ...snapshot.data() } as Job);
    }, (error) => {
      console.warn("job listener error:", error);
      setLoadError(true);
    });
    return unsub;
  }, [id, reloadKey]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  // Permissions. Firestore is open, so this is the only gate: the owner can
  // do anything; a cleaner can work only the job assigned to them, and can
  // take an unassigned one.
  const isMine = !!selfId && job?.assignedTo === selfId;
  const canWork = (isOwner || isMine) && !job?.cancelled;
  const canTake = !isOwner && !!selfId && !!job && !job.assignedTo && !job.cancelled && !job.pending;
  // A cleaner can hand back their own job until they've started or finished it.
  const canGiveBack = isMine && !!job && !job.startedAt && !job.done && !job.cancelled;

  // Access codes come from the registry rather than the job, so changing a
  // code in one place changes it on every cleaning at that house, past and
  // future, without rewriting a single job.
  const property = findProperty(properties, job);
  const codes = accessCodes(property);
  const house = property?.short || job?.property || job?.address || "the house";
  // A host who pays us directly: this cleaning can be marked paid.
  const jobKey = job ? jobDateKey(job) : null;
  const billed = !!property?.billedFrom && !!jobKey && jobKey >= property.billedFrom;

  // Until someone ticks something, a job shows the current template for its
  // house (one room per bathroom); the list is written to the job when
  // someone starts or ticks it. See checklistForJob.
  const checklist: ChecklistItem[] = checklistForJob({
    stored: job?.checklist,
    done: job?.done === true,
    template,
    bathrooms: property?.bathrooms,
  });
  // Write the shown list to the job only once the template has loaded, so a
  // fast tap can't save the fallback list.
  const freshChecklist = !ownsList(job?.checklist) && template !== null;
  const roomsToAdd = template ? addableRooms(template) : [];
  useEffect(() => {
    checklistRef.current = checklist;
  }, [checklist]);

  // Headings are labels, so every count here comes from the helper rather
  // than the raw array length.
  const activity = checklistProgress(checklist);
  const checkedCount = activity.done;
  const taskCount = activity.total;
  const progress = taskCount > 0 ? checkedCount / taskCount : 0;
  const allDone = taskCount > 0 && checkedCount === taskCount;

  const copyCode = async (c: AccessCode) => {
    try {
      await Clipboard.setStringAsync(c.code);
      tapSelect();
      setCopied(c.label);
    } catch (e) {
      console.warn("copy code failed:", e);
    }
  };

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
    // The running session belongs to whoever started it; moving the job now
    // would pay all of it to the next person.
    if (job.startedAt) {
      Alert.alert(
        "Timer is running",
        `${job.assignedToName || "The cleaner"} is on the clock. Finish or discard that timer before changing who has this cleaning.`
      );
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

  // The owner prices this one cleaning (or clears it back to the house price)
  // and, for a host who pays us directly, marks it paid.
  const savePrice = async (next: { price: number | null; hostPaid: boolean }) => {
    if (!job || !isOwner || busy) return;
    setBusy(true);
    try {
      await updateDoc(doc(db, "jobs", job.id), {
        price: next.price,
        ...(billed
          ? {
            hostPaid: next.hostPaid,
            hostPaidAt: next.hostPaid ? job.hostPaidAt || Date.now() : null,
            hostPaidMethod: next.hostPaid ? job.hostPaidMethod || null : null,
          }
          : {}),
      });
      setShowPrice(false);
      tapSuccess();
    } catch (e) {
      console.warn("save price failed:", e);
      Alert.alert("Couldn't save the price", "Nothing changed. Check your connection and try again.");
    }
    setBusy(false);
  };

  // The owner moves a job or sets its start time. A synced job's date stays
  // with its calendar (WhenSheet only offers the time there); whoever is
  // assigned hears about the change.
  const saveWhen = async (next: { dateKey: string | null; time: string | null }) => {
    if (!job || !isOwner || busy) return;
    const moveDate = canEditDate(job.source) && !!next.dateKey && next.dateKey !== jobDateKey(job);
    const changes = {
      time: next.time,
      ...(moveDate && next.dateKey ? { dateKey: next.dateKey, date: formatDateLabel(next.dateKey) } : {}),
    };
    setBusy(true);
    try {
      await updateDoc(doc(db, "jobs", job.id), changes);
      setShowWhen(false);
      tapSuccess();
      notify(job.assignedTo, movedMessage({ ...job, ...changes }));
    } catch (e) {
      console.warn("save date failed:", e);
      Alert.alert("Couldn't save the date", "Nothing changed. Check your connection and try again.");
    }
    setBusy(false);
  };

  // Claims an unassigned job, failing if another cleaner got there first (their
  // phone may have shown it as free a moment ago, same as this one did).
  const claim = (extra: Record<string, unknown>) => {
    if (!job || !selfId || !selfName) return Promise.reject(new Error("not signed in as a cleaner"));
    const ref = doc(db, "jobs", job.id);
    return runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.data();
      if (!snap.exists() || current?.cancelled) throw new AlreadyTaken("gone");
      if (current?.assignedTo && current.assignedTo !== selfId) throw new AlreadyTaken(String(current.assignedToName || "another cleaner"));
      tx.update(ref, { assignedTo: selfId, assignedToName: selfName, ...extra });
    });
  };

  const claimFailed = (e: unknown, title: string) => {
    if (e instanceof AlreadyTaken) {
      Alert.alert("Already taken", e.message === "gone" ? "This cleaning was cancelled or removed." : `${e.message} took this cleaning first.`);
      return;
    }
    console.warn(`${title}:`, e);
    Alert.alert(title, "Taking a job needs a connection. Check your signal and try again.");
  };

  const takeJob = async () => {
    if (!job || !selfId || !selfName || busy) return;
    setBusy(true);
    try {
      await claim({});
      tapSuccess();
    } catch (e) {
      claimFailed(e, "Couldn't take the job");
    }
    setBusy(false);
  };

  // A cleaner hands their own job back to the unassigned pool. The owner is
  // told, because somebody now has to cover it.
  const giveBack = async () => {
    if (!job || !isMine || job.startedAt || busy) return;
    setBusy(true);
    try {
      await updateDoc(doc(db, "jobs", job.id), { assignedTo: null, assignedToName: null });
      setShowGiveBack(false);
      tapWarning();
      if (!ownerAtPhone) {
        const reached = await sendPushToOwners(givenBackMessage(job, selfName, property?.short || job.property || job.address));
        // The sheet promised the owner would hear about it; if no phone took the
        // notification, the cleaner has to call instead.
        if (reached === 0) {
          alertSoon("The owner wasn't notified", `The job is back in the pool, but the notification didn't go through. Call ${OWNER_PHONE_LABEL} so it gets covered.`, [
            { text: "Not now", style: "cancel" },
            { text: "Call", onPress: () => Linking.openURL(`tel:${OWNER_PHONE}`) },
          ]);
        }
      }
    } catch (e) {
      console.warn("give back failed:", e);
      Alert.alert("Couldn't give it back", "You're still on this cleaning. Check your connection and try again.");
    }
    setBusy(false);
  };

  // A save the server rejected after the screen had already moved on.
  const lateSaveFailed = (what: string) => (e: unknown) => {
    console.warn(`${what} failed later:`, e);
    Alert.alert(`${what} didn't save`, "The server turned it down once the signal came back. Check the job and try again.");
  };

  // Asks first when a start needs a second look (another timer still running,
  // a future date, an already finished cleaning), then starts.
  const startCleaning = async () => {
    if (!job || busy) return;
    const taking = !job.assignedTo;
    if (taking && !canTake) {
      Alert.alert("No cleaner assigned", "Assign this job to a cleaner first so the time gets tracked to them.");
      return;
    }
    if (!taking && !canWork) {
      Alert.alert("Not your job", `This cleaning is assigned to ${job.assignedToName}. Ask the owner to reassign it if that's wrong.`);
      return;
    }
    const who = taking ? selfId : job.assignedTo;
    if (who) {
      try {
        const snap = await getDocs(query(collection(db, "jobs"), where("assignedTo", "==", who)));
        const other = otherRunningJob(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Job), who, job.id);
        if (other) {
          const name = (taking ? selfName : job.assignedToName)?.split(" ")[0] || "This cleaner";
          Alert.alert(
            "Another timer is running",
            `${name} is still on the clock at ${other.property || other.address} (${other.date}). Finish or discard that one first, or the overlap gets paid twice.`,
            [
              { text: "Cancel", style: "cancel" },
              { text: "Open it", onPress: () => router.push({ pathname: "/job", params: { id: other.id } }) },
            ]
          );
          return;
        }
      } catch (e) {
        // No signal: don't block the start on a check that can't run.
        console.warn("running-timer check failed:", e);
      }
    }
    const check = startCheck(job, daysFromToday(job));
    if (check) {
      Alert.alert(
        check === "finished" ? "Start another session?" : "This cleaning isn't today",
        check === "finished"
          ? "This cleaning is already finished. Start another session? Its time adds to what's already logged."
          : `This cleaning is on ${job.date}. Start the timer now anyway?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Start timer", onPress: () => beginTimer(taking) },
        ]
      );
      return;
    }
    beginTimer(taking);
  };

  const beginTimer = async (taking: boolean) => {
    if (!job) return;
    setBusy(true);
    const changes = {
      startedAt: Date.now(),
      // Another session on a finished job reopens it until it's finished again.
      ...(job.done ? { done: false, completedAt: null } : {}),
      ...(freshChecklist ? { checklist } : {}),
    };
    try {
      if (taking) await claim(changes);
      else await waitBriefly(updateDoc(doc(db, "jobs", job.id), changes), SAVE_WAIT_MS, lateSaveFailed("Starting the timer"));
      tapImpact();
      setShowChecklist(true);
    } catch (e) {
      if (taking) claimFailed(e, "Couldn't start the timer");
      else {
        console.warn("start cleaning failed:", e);
        Alert.alert("Couldn't start the timer", "Check your connection and try again.");
      }
    }
    setBusy(false);
  };

  const cancelTimer = () => {
    if (!job || !canWork || !job.startedAt) return;
    const minutes = minutesBetween(job.startedAt, Date.now());
    Alert.alert("Discard timer", `Throw away ${formatDuration(minutes)} without logging any time?`, [
      { text: "Keep timing", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: async () => {
          try {
            await waitBriefly(updateDoc(doc(db, "jobs", job.id), { startedAt: null }), SAVE_WAIT_MS, lateSaveFailed("Discarding the timer"));
            tapWarning();
            if (!ownerAtPhone) sendPushToOwners(discardedMessage(job, selfName, minutes, house));
          } catch (e) {
            console.warn("discard timer failed:", e);
            Alert.alert("Couldn't discard the timer", "It's still running. Check your connection and try again.");
          }
        },
      },
    ]);
  };

  // Writes the time entry and closes the job in ONE batch. The entry's id comes
  // from the session, so a second Finish (no signal, or two phones) overwrites
  // it instead of paying twice. Returns false if the cleaner record is gone.
  const logTimeAndClose = async (opts: {
    cancel?: boolean;
    finishNote?: FinishNote | null;
    checklist?: ChecklistItem[];
    endedAt?: number;
    checkedAtFinish?: number | null;
    lowSupplies?: string[];
  }) => {
    if (!job || !job.startedAt) return false;
    const emp = employees.find(e => e.id === job.assignedTo);
    if (!emp) {
      Alert.alert(
        "Cleaner not found",
        "The assigned cleaner no longer exists, so no pay can be calculated. Discard the timer, then add the time by hand in Payroll if it's owed."
      );
      return false;
    }
    const endedAt = opts.endedAt ?? Date.now();
    const minutes = minutesBetween(job.startedAt, endedAt);
    const earned = computeEarned(minutes, emp.hourlyRate);
    const employeeName = job.assignedToName || emp.name;
    const batch = writeBatch(db);
    batch.set(doc(db, "timeEntries", sessionEntryId(job.id, job.startedAt)), {
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
    const session = { employeeName, minutes, earned };
    batch.update(doc(db, "jobs", job.id), {
      startedAt: null,
      done: !opts.cancel,
      completedAt: opts.cancel ? null : endedAt,
      // Earlier sessions on this job stay counted; this one adds to them.
      timeSummary: mergeSummary(job.timeSummary, session),
      ...(opts.cancel
        ? { cancelled: true, cancelledAt: endedAt, cancelReason: "Cancelled by owner" }
        : {
          finishNote: opts.finishNote || job.finishNote || null,
          checkedAtFinish: opts.checkedAtFinish ?? null,
          lowSupplies: opts.lowSupplies?.length ? opts.lowSupplies : null,
        }),
      // Keep the list the cleaner was shown, so the finished job reads back
      // the same rooms even if nothing was ticked. A "check all" finish
      // writes its fully ticked list in the same batch as the time.
      ...(opts.checklist ? { checklist: opts.checklist } : freshChecklist ? { checklist } : {}),
    });
    // Low supplies go on the house's shopping list in the same save, added to
    // whatever is already waiting there until the owner restocks.
    if (!opts.cancel && opts.lowSupplies?.length) {
      const name = property?.short || property?.name || job.property || job.address;
      batch.set(doc(db, "settings", "supplies"), {
        houses: { [houseKey(property?.name || job.property || job.address)]: {
          name, items: arrayUnion(...opts.lowSupplies), at: endedAt, by: employeeName, jobId: job.id,
        } },
      }, { merge: true });
    }
    const saved = await waitBriefly(batch.commit(), SAVE_WAIT_MS, lateSaveFailed("Finishing the cleaning"));
    return { ...session, queued: saved === "queued" };
  };

  // note: required (the reason) when steps are unchecked, optional otherwise;
  // FinishSheet collects it. allChecked: everything was done - tick it all.
  // endedAt: when a long session really ended, from EndTimeSheet.
  // supplies: what the cleaner flagged as running low.
  const completeCleaning = async (note: string | null, allChecked = false, endedAt?: number, supplies: string[] = []) => {
    if (!job || !job.startedAt || busy || !canWork) return;
    if (endedAt === undefined && isLongSession(job.startedAt, Date.now())) {
      setShowFinish(false);
      setTimeout(() => setEndTimeFor({ note, allChecked, supplies }), 450);
      return;
    }
    const actor = selfName || (isOwner ? "Owner" : null);
    const unchecked = taskCount - checkedCount;
    const finishNote: FinishNote | null = note
      ? { text: note, by: actor, at: Date.now(), skipped: allChecked ? 0 : unchecked }
      : null;
    const base = checklistRef.current.length > 0 ? checklistRef.current : checklist;
    setBusy(true);
    try {
      const result = await logTimeAndClose({
        finishNote,
        endedAt,
        checklist: allChecked ? checkAll(base, actor, Date.now()) : undefined,
        checkedAtFinish: allChecked && unchecked > 0 ? unchecked : null,
        lowSupplies: supplies,
      });
      if (result) {
        tapSuccess();
        setShowChecklist(false);
        setShowFinish(false);
        setEndTimeFor(null);
        if ((finishNote || supplies.length) && !ownerAtPhone) {
          sendPushToOwners(finishReportMessage(job, { by: actor, note: finishNote, supplies }, house));
        }
        alertSoon(
          "Cleaning finished",
          `${result.employeeName} worked ${formatDuration(result.minutes)} and earned ${formatMoney(result.earned)}. ` +
            (result.queued
              ? "It's saved on this phone and goes to payroll when the signal comes back. Keep TurnTrack open until the yellow bar is gone."
              : "It's been added to payroll.")
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

  const finishCleaning = () => {
    if (!job || !job.startedAt || busy || !canWork) return;
    // The owner's phone shows the same Finish button on a cleaner's live job;
    // one stray tap would end their timer.
    if (isOwner && job.assignedTo) {
      const first = job.assignedToName?.split(" ")[0] || "The cleaner";
      Alert.alert(
        `End ${first}'s timer?`,
        `${first} has ${formatDuration(minutesBetween(job.startedAt, Date.now()))} on the clock. Finish the cleaning for them?`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Finish it", onPress: () => setShowFinish(true) },
        ]
      );
      return;
    }
    setShowFinish(true);
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

  // Website requests: the owner turns one into a real job, or drops it. The
  // request itself stays in the website admin and email either way.
  const confirmRequest = async () => {
    if (!job || !isOwner || busy) return;
    setBusy(true);
    try {
      await updateDoc(doc(db, "jobs", job.id), { pending: false });
      tapSuccess();
    } catch (e) {
      console.warn("confirm request failed:", e);
      Alert.alert("Couldn't confirm", "The request is still pending. Check your connection and try again.");
    }
    setBusy(false);
  };

  const declineRequest = () => {
    if (!job || !isOwner) return;
    Alert.alert(
      "Decline request",
      `Remove this request from ${job.contact?.name || "the customer"}? It stays in your website admin and email.`,
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Decline",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteDoc(doc(db, "jobs", job.id));
              tapWarning();
              goBack();
            } catch (e) {
              console.warn("decline request failed:", e);
              Alert.alert("Couldn't decline", "Check your connection and try again.");
            }
          },
        },
      ]
    );
  };

  // Writes a reshaped list (a room added or removed). Same freshest-list
  // rule as ticks, so it can't wipe a tick that hasn't echoed back yet.
  const writeChecklist = async (change: (items: ChecklistItem[]) => ChecklistItem[], failTitle: string) => {
    if (!job || !canWork || job.done) return;
    const base = checklistRef.current.length > 0 ? checklistRef.current : checklist;
    const updated = change(base);
    if (updated === base) return;
    checklistRef.current = updated;
    try {
      await updateDoc(doc(db, "jobs", job.id), { checklist: updated });
      tapSuccess();
    } catch (e) {
      console.warn("checklist change failed:", e);
      Alert.alert(failTitle, "Check your connection and try again.");
    }
  };

  const addRoomToJob = (base: string) => {
    if (!template) return;
    writeChecklist(items => addRoom(items, template, base, selfName || (isOwner ? "Owner" : null), Date.now()), "Couldn't add the room");
  };

  const removeRoomFromJob = (headingIndex: number) => {
    writeChecklist(items => removeRoom(items, headingIndex), "Couldn't remove the room");
  };

  const toggleChecklistItem = async (index: number) => {
    if (!job || !canWork) return;
    if (checklist[index] && checklist[index].heading) return;
    // Ticking is part of the cleaning, so the clock should be running; a list
    // worked with no timer pays one minute at the end.
    if (!isOwner && !job.startedAt && !job.done) {
      Alert.alert("Start the timer first?", "The clock should be running while you work through the checklist.", [
        { text: "Not now", style: "cancel" },
        { text: "Start timer", onPress: startCleaning },
      ]);
      return;
    }
    // Who ticked it: the signed-in cleaner, or the owner working the job.
    const actor = selfName || (isOwner ? "Owner" : null);
    const base = checklistRef.current.length > 0 ? checklistRef.current : checklist;
    const now = Date.now();
    const { items: updated, finishedRoom } = toggleStep(base, index, actor, now);
    // Hold the new list locally so a rapid follow-up tap starts from it.
    checklistRef.current = updated;
    tapSelect();
    try {
      await updateDoc(doc(db, "jobs", job.id), { checklist: updated });
    } catch (e) {
      console.warn("checklist update failed:", e);
      Alert.alert("That tick didn't save", "Check your connection and tap it again.");
      return;
    }
    // Tell the owner a room is finished, once per room, after the tick saved.
    if (finishedRoom && !ownerAtPhone) {
      sendPushToOwners(roomDoneMessage(job, {
        title: finishedRoom.title,
        minutes: roomMinutes(finishedRoom),
        by: actor,
        at: now,
        house: property?.short || job.property || job.address,
      }));
    }
  };

  if (loadError && !job) {
    return (
      <View style={styles.container}>
        <ScreenHeader onBack={goBack} title="Couldn't load this job" subtitle="TurnTrack couldn't reach the database. Check your signal, then try again." />
        <BrandButton label="Try again" icon="refresh" variant="outline" onPress={() => setReloadKey(k => k + 1)} />
      </View>
    );
  }
  if (missing) {
    return (
      <View style={styles.container}>
        <ScreenHeader onBack={goBack} title="Job not found" subtitle="This job was deleted." />
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

  const isPending = job.pending === true;
  if (isPending && !isOwner) {
    return (
      <View style={styles.container}>
        <ScreenHeader
          onBack={goBack}
          title="Not scheduled yet"
          subtitle="This website request hasn't been confirmed by the owner. It'll show up in Jobs once it is."
        />
      </View>
    );
  }

  const key = jobDateKey(job);
  const days = daysFromToday(job);
  const rel = relativeDayLabel(days);
  const sameDay = job.sameDayTurnover === true;
  const running = !!job.startedAt;
  const contact = job.contact || null;
  const hasContact = !!(contact && (contact.name || contact.phone));
  const activeEmployees = employees.filter(e => e.active);
  const assignedEmployee = employees.find(e => e.id === job.assignedTo);
  const assignedColor = job.assignedTo ? cleanerColor(assignedEmployee || { id: job.assignedTo }) : unassignedColor;
  const dateHeading = key ? formatDayHeading(key) : job.date;
  const price = jobPrice(job, property);
  const priceHint = [
    job.price ? "Set on this cleaning" : price !== null ? "The house's regular price" : isDeepClean(job) ? "Deep cleans are priced one at a time" : "Set it here or on the Houses tab",
    billed && job.done ? (job.hostPaid ? "Host paid" : "Host hasn't paid") : null,
  ].filter(Boolean).join(" · ");

  // Live record of what has been ticked. The owner sees this update as the
  // cleaner works, because the job document streams from Firestore.
  const checklistActivity = activity.lastAt
    ? `Last check ${formatClockTime(activity.lastAt)}${activity.lastBy ? ` · ${activity.lastBy.split(" ")[0]}` : ""}`
    : running
      ? "Nothing checked off yet"
      : "";

  // Adding a room is for whoever can work the job, before it's finished.
  const canAddRooms = canWork && !job.done && !job.cancelled && !isPending && roomsToAdd.length > 0;
  const renderChecklist = () => (
    <RoomChecklist
      items={checklist}
      canWork={canWork}
      closed={job.done && !running}
      onToggle={toggleChecklistItem}
      roomsToAdd={roomsToAdd}
      onAddRoom={canAddRooms ? addRoomToJob : undefined}
      onRemoveRoom={canAddRooms ? removeRoomFromJob : undefined}
    />
  );
  const finishNote = job.done ? job.finishNote : null;

  return (
    <View style={styles.container}>
      <ScreenHeader
        onBack={goBack}
        backLabel="Back"
        title={job.address}
        subtitle={key ? [withTime(dateHeading, job.time), rel].filter(Boolean).join(" · ") : job.date ? withTime(job.date, job.time) : "No date yet"}
      />

      <WhenSheet
        visible={showWhen}
        source={job.source}
        dateKey={key}
        time={job.time || null}
        busy={busy}
        onClose={() => setShowWhen(false)}
        onSave={saveWhen}
      />

      <PriceSheet
        visible={showPrice}
        price={job.price ?? null}
        housePrice={isDeepClean(job) ? null : property?.price ?? null}
        billed={billed}
        hostPaid={job.hostPaid === true}
        busy={busy}
        onClose={() => setShowPrice(false)}
        onSave={savePrice}
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
          <Text style={styles.sheetProgressText}>{checkedCount} of {taskCount} done</Text>
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

      <SheetModal visible={showGiveBack} title="Give this job back?" onClose={() => setShowGiveBack(false)}>
        <Text style={styles.giveBackBody}>
          {property?.short || job.address} on {job.date} goes back to unassigned so another cleaner can take it. The owner gets a notification.
        </Text>
        {days !== null && days >= 0 && days <= 1 ? (
          <View style={styles.giveBackUrgent}>
            <Ionicons name="call-outline" size={16} color={colors.goldDark} />
            <View style={{ flex: 1 }}>
              <Text style={styles.giveBackUrgentText}>
                This cleaning is {days === 0 ? "today" : "tomorrow"}. Call the owner too, so it gets covered in time.
              </Text>
              <TouchableOpacity style={styles.callRow} onPress={() => Linking.openURL(`tel:${OWNER_PHONE}`)} hitSlop={6} accessibilityRole="button">
                <Text style={styles.callText}>Call {OWNER_PHONE_LABEL}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
        <BrandButton label={busy ? "Giving it back…" : "Give it back"} icon="arrow-undo" variant="outline" onPress={giveBack} disabled={busy} style={{ marginTop: 14 }} />
        <BrandButton label="Keep it" variant="ghost" onPress={() => setShowGiveBack(false)} style={{ marginTop: 4 }} />
      </SheetModal>

      <FinishSheet
        visible={showFinish}
        items={checklist}
        busy={busy}
        onClose={() => setShowFinish(false)}
        onReview={() => { setShowFinish(false); setTimeout(() => setShowChecklist(true), 450); }}
        onFinish={(note, supplies) => completeCleaning(note, false, undefined, supplies)}
        onCheckAll={(note, supplies) => completeCleaning(note, true, undefined, supplies)}
      />

      {job.startedAt ? (
        <EndTimeSheet
          visible={!!endTimeFor}
          startedAt={job.startedAt}
          now={Date.now()}
          busy={busy}
          onClose={() => setEndTimeFor(null)}
          onPick={(endedAt) => endTimeFor && completeCleaning(endTimeFor.note, endTimeFor.allChecked, endedAt, endTimeFor.supplies)}
        />
      ) : null}

      {pendingWrites ? (
        <View style={styles.pendingBar}>
          <Ionicons name="cloud-offline-outline" size={16} color={colors.goldDark} />
          <Text style={styles.pendingBarText}>Saved on this phone, waiting for signal. Keep TurnTrack open until this goes away.</Text>
        </View>
      ) : null}

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 150 }}>
        <View style={styles.pillRow}>
          {isPending ? <Pill label="Needs confirmation" tone="gold" icon="mail-unread" /> : null}
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
        {isPending && (
          <Card tone="gold">
            <View style={styles.pendingHeader}>
              <Ionicons name="mail-unread" size={18} color={colors.goldDark} />
              <Text style={styles.pendingTitle}>Website request — not on the schedule yet</Text>
            </View>
            <Text style={styles.pendingBody}>
              Confirm it once you&apos;ve agreed on the details with the customer. Until then, cleaners can&apos;t see it and no reminders fire.
            </Text>
            <BrandButton label={busy ? "Confirming…" : "Confirm job"} icon="checkmark-circle" onPress={confirmRequest} disabled={busy} style={{ marginTop: 12 }} />
            <TouchableOpacity style={styles.declineBtn} onPress={declineRequest} hitSlop={6}>
              <Text style={styles.declineText}>Decline & remove</Text>
            </TouchableOpacity>
          </Card>
        )}

        {sameDay && !job.cancelled && (
          <View style={styles.sameDayBanner}>
            <Ionicons name="alert-circle" size={17} color={colors.goldDark} />
            <Text style={styles.sameDayBannerText}>Checkout and a new check-in happen on this date. The clean has to be done between guests.</Text>
          </View>
        )}

        {hasContact && contact && (
          <Card>
            <Text style={type.section}>Customer</Text>
            {contact.name ? <Text style={styles.contactName}>{contact.name}</Text> : null}
            {contact.phone ? (
              <TouchableOpacity style={styles.contactRow} onPress={() => Linking.openURL(`tel:${contact.phone}`)} hitSlop={6}>
                <Ionicons name="call-outline" size={16} color={colors.tealDark} />
                <Text style={styles.contactLink}>{contact.phone}</Text>
              </TouchableOpacity>
            ) : null}
            {isOwner && contact.email ? (
              <TouchableOpacity style={styles.contactRow} onPress={() => Linking.openURL(`mailto:${contact.email}`)} hitSlop={6}>
                <Ionicons name="mail-outline" size={16} color={colors.tealDark} />
                <Text style={styles.contactLink}>{contact.email}</Text>
              </TouchableOpacity>
            ) : null}
          </Card>
        )}

        {job.notes ? (
          <Card>
            <Text style={type.section}>Request details</Text>
            <Text style={styles.notesText}>{job.notes}</Text>
          </Card>
        ) : null}

        {isOwner && !job.cancelled && (
          <Card onPress={() => setShowWhen(true)}>
            <View style={styles.addressRow}>
              <View style={styles.addressIcon}>
                <Ionicons name="calendar-outline" size={20} color={colors.tealDark} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={type.section}>Date & time</Text>
                <Text style={styles.addressText}>{key ? formatDayHeading(key) : "No date yet"}</Text>
                <Text style={styles.addressHint}>{formatTime(job.time) || "No set time"} · Tap to change</Text>
              </View>
              <Ionicons name="create-outline" size={22} color={colors.teal} />
            </View>
          </Card>
        )}

        {isOwner && !job.cancelled && !isPending && (
          <Card onPress={() => setShowPrice(true)}>
            <View style={styles.addressRow}>
              <View style={styles.addressIcon}>
                <Ionicons name="pricetag-outline" size={20} color={colors.tealDark} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={type.section}>Pays</Text>
                <Text style={styles.addressText}>{price !== null ? formatMoney(price) : "No price set"}</Text>
                <Text style={styles.addressHint}>{priceHint} · Tap to change</Text>
              </View>
              <Ionicons name="create-outline" size={22} color={colors.teal} />
            </View>
          </Card>
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

        {!isPending && codes.length > 0 && !(isOwner || isMine || viewingAs) && !job.done && (
          <Text style={styles.codesLocked}>Door codes show here once this cleaning is yours.</Text>
        )}
        {!isPending && codes.length > 0 && (isOwner || isMine || viewingAs) && (
          <Card>
            <View style={styles.cardHeaderRow}>
              <Text style={type.section}>Access codes</Text>
              <Ionicons name="keypad-outline" size={18} color={colors.tealDark} />
            </View>
            <View style={styles.codeRow}>
              {codes.map((c) => (
                <TouchableOpacity
                  key={c.label}
                  style={styles.codeChip}
                  onPress={() => copyCode(c)}
                  accessibilityLabel={`${c.label} code ${c.code}, tap to copy`}
                  hitSlop={4}
                >
                  <Text style={styles.codeLabel}>{c.label}</Text>
                  <Text style={styles.codeValue}>{c.code}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.codeHint}>
              {copied ? `${copied} code copied` : "Tap a code to copy it"}
            </Text>
          </Card>
        )}

        {!isPending && <Card accent={assignedColor}>
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
          {canGiveBack && (
            <TouchableOpacity style={styles.giveBackLink} onPress={() => setShowGiveBack(true)} hitSlop={6} accessibilityRole="button">
              <Ionicons name="arrow-undo-outline" size={16} color={colors.danger} />
              <Text style={styles.giveBackText}>Give this job back</Text>
            </TouchableOpacity>
          )}
        </Card>}

        {!job.cancelled && !isPending && (
          <Card>
            <Text style={type.section}>Time tracking</Text>
            {running && job.startedAt ? (
              <View style={styles.timerBlock}>
                <View style={styles.liveRow}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>{job.assignedToName ? `${job.assignedToName} is cleaning` : "Timer running"}</Text>
                </View>
                <ElapsedTimer startedAt={job.startedAt} />
                <Text style={styles.startedText}>
                  Started {formatClockTime(job.startedAt)} · {checkedCount} of {taskCount} checked
                </Text>
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
                  {job.timeSummary.employeeName} · {formatDuration(job.timeSummary.minutes)}
                  {/* Pay is between the owner and the cleaner who did it. */}
                  {isOwner || isMine || viewingAs ? ` · ${formatMoney(job.timeSummary.earned)}` : ""}
                </Text>
              </View>
            ) : (
              <Text style={styles.timerHint}>
                {viewingAs
                  ? "You're viewing as a cleaner, so this job is read-only. Switch back to the owner to work it."
                  : canWork
                  ? "Tap Start cleaning below when you arrive. The checklist pops up and the clock starts."
                  : job.assignedToName
                    ? `Only ${job.assignedToName.split(" ")[0]} or the owner can start this timer.`
                    : "Assign a cleaner to start tracking time."}
              </Text>
            )}
          </Card>
        )}

        {!isPending && <Card>
          <View style={styles.cardHeaderRow}>
            <Text style={type.section}>Checklist</Text>
            <Text style={styles.checklistCount}>{checkedCount}/{taskCount}</Text>
          </View>
          <ProgressBar value={progress} />
          {checklistActivity ? <Text style={styles.checklistActivity}>{checklistActivity}</Text> : null}
          {finishNote ? (
            <View style={styles.finishNote}>
              <Ionicons name="alert-circle" size={17} color={colors.goldDark} />
              <View style={{ flex: 1 }}>
                <Text style={styles.finishNoteTitle}>
                  {finishNote.skipped > 0
                    ? `Finished with ${finishNote.skipped} step${finishNote.skipped === 1 ? "" : "s"} not done`
                    : "Note at finish"}
                  {finishNote.by ? ` · ${finishNote.by.split(" ")[0]}` : ""} · {formatClockTime(finishNote.at)}
                </Text>
                <Text style={styles.finishNoteText}>&ldquo;{finishNote.text}&rdquo;</Text>
              </View>
            </View>
          ) : null}
          {job.done && job.lowSupplies?.length ? (
            <View style={styles.finishNote}>
              <Ionicons name="cart-outline" size={17} color={colors.goldDark} />
              <View style={{ flex: 1 }}>
                <Text style={styles.finishNoteTitle}>Running low at the finish</Text>
                <Text style={styles.finishNoteText}>{supplyList(job.lowSupplies)}</Text>
              </View>
            </View>
          ) : null}
          {isOwner && job.done && job.checkedAtFinish ? (
            <Text style={styles.checklistActivity}>
              {job.checkedAtFinish} step{job.checkedAtFinish === 1 ? " was" : "s were"} checked off in one tap at the finish.
            </Text>
          ) : null}
          {renderChecklist()}
        </Card>}

        {isOwner && !isPending && (
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

      {!job.cancelled && !isPending && (canWork || canTake) && (
        <BottomBar>
          {running ? (
            <View style={styles.barRow}>
              <BrandButton label="Checklist" icon="list" variant="outline" onPress={() => setShowChecklist(true)} style={{ flex: 1 }} />
              <BrandButton label={busy ? "Saving…" : "Finish cleaning"} icon="checkmark-circle" onPress={finishCleaning} disabled={busy} style={{ flex: 1.4 }} />
            </View>
          ) : canTake && days !== null && days > 0 ? (
            // Days ahead, a cleaner is signing up for it, not starting a clock.
            <BrandButton label={busy ? "Taking…" : "Take this job"} icon="hand-right-outline" onPress={takeJob} disabled={busy} />
          ) : (
            <BrandButton
              label={busy ? "Starting…" : canWork ? (job.done ? "Start another session" : "Start cleaning") : "Take this job & start"}
              icon="play"
              variant={job.done ? "outline" : "primary"}
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
  pendingHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  pendingTitle: { flex: 1, fontSize: 15, fontWeight: "700", color: colors.goldDark },
  pendingBody: { fontSize: 13.5, color: colors.muted, lineHeight: 19, marginTop: 8 },
  declineBtn: { alignItems: "center", justifyContent: "center", minHeight: 44, marginTop: 2 },
  declineText: { color: colors.danger, fontSize: 13.5, fontWeight: "600" },
  contactName: { fontSize: 16, fontWeight: "700", color: colors.ink, marginTop: 8 },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 36 },
  contactLink: { fontSize: 14.5, fontWeight: "600", color: colors.tealDark },
  notesText: { fontSize: 14, color: colors.ink, lineHeight: 20, marginTop: 8 },
  addressRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  addressIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.tealSoft, alignItems: "center", justifyContent: "center" },
  addressText: { fontSize: 16, fontWeight: "700", color: colors.ink, marginTop: 3 },
  addressHint: { fontSize: 12, color: colors.tealDark, fontWeight: "600", marginTop: 2 },
  // Codes get read off the screen one-handed at a keypad, so they are big,
  // tabular, and widely spaced.
  codeRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 12 },
  codeChip: {
    flexGrow: 1,
    minWidth: 96,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.tealSoft,
    borderWidth: 1,
    borderColor: colors.line,
  },
  codeLabel: { fontSize: 11, fontWeight: "700", color: colors.tealDark, textTransform: "uppercase", letterSpacing: 0.6 },
  codeValue: { fontSize: 24, fontWeight: "800", color: colors.ink, marginTop: 2, fontVariant: ["tabular-nums"] },
  codeHint: { fontSize: 12, color: colors.muted, marginTop: 10 },
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
  checklistActivity: { fontSize: 12.5, color: colors.muted, marginTop: 8 },
  finishNote: {
    flexDirection: "row", gap: 8, alignItems: "flex-start", backgroundColor: colors.goldSoft,
    borderRadius: radius.md, padding: 12, marginTop: 10, borderWidth: 1, borderColor: "#F0DDBA",
  },
  finishNoteTitle: { fontSize: 13, fontWeight: "700", color: colors.goldDark },
  finishNoteText: { fontSize: 14, color: colors.ink, lineHeight: 20, marginTop: 3 },
  startedText: { fontSize: 13, color: colors.muted, marginTop: 2 },
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
  giveBackLink: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, marginTop: 6, alignSelf: "flex-start" },
  giveBackText: { fontSize: 14, fontWeight: "600", color: colors.danger },
  giveBackBody: { fontSize: 14.5, color: colors.ink, lineHeight: 21 },
  giveBackUrgent: {
    flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: colors.goldSoft,
    borderRadius: radius.md, padding: 12, marginTop: 12, borderWidth: 1, borderColor: "#F0DDBA",
  },
  giveBackUrgentText: { fontSize: 13.5, color: colors.goldDark, lineHeight: 19, fontWeight: "600" },
  callRow: { minHeight: 40, justifyContent: "center", alignSelf: "flex-start" },
  callText: { fontSize: 14.5, fontWeight: "700", color: colors.tealDark },
  pendingBar: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.goldSoft,
    borderRadius: radius.md, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: "#F0DDBA",
  },
  pendingBarText: { flex: 1, fontSize: 13, color: colors.goldDark, lineHeight: 18, fontWeight: "600" },
  codesLocked: { fontSize: 13, color: colors.muted, marginBottom: 12, marginLeft: 2 },
});
