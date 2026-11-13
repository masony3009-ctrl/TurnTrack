import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useLocalSearchParams, useRouter } from "expo-router";
import { arrayUnion, collection, deleteDoc, doc, getDocs, onSnapshot, query, runTransaction, updateDoc, where, writeBatch } from "firebase/firestore";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { OWNER_PHONE, OWNER_PHONE_LABEL } from "../business";
import { EndTimeSheet } from "../components/EndTimeSheet";
import { addToCalendar } from "../components/calendar";
import { tapImpact, tapSelect, tapSuccess, tapWarning } from "../components/haptics";
import { openInMaps } from "../components/maps";
import { availabilityDetail, availabilityFor, availabilityTone, availabilityWarning, bookingsOf } from "../availability";
import { cleaningEvent } from "../calendarEvent";
import { useProfile } from "../components/ProfileProvider";
import { FinishSheet } from "../components/FinishSheet";
import { PriceSheet } from "../components/PriceSheet";
import { EditJobSheet, type JobDetails } from "../components/EditJobSheet";
import { nextGuestsLine, nextStay } from "../nextGuests";
import { warnUnreached } from "../components/pushWarning";
import { RoomChecklist } from "../components/RoomChecklist";
import { alertSoon, AssigneeRow, Avatar, BottomBar, BrandButton, Card, ElapsedTimer, Pill, ProgressBar, ScreenHeader, SheetModal } from "../components/ui";
import { addableRooms, addRoom, checkAll, checklistForJob, checklistProgress, ownsList, removeRoom, roomMinutes, templateFromDoc, toggleStep, type ChecklistItem } from "../checklist";
import { db } from "../firebase";
import {
  assignmentMessage, cancellationMessage, discardedMessage, finishReportMessage, givenBackMessage, movedMessage, roomDoneMessage,
  sendPushToEmployee, sendPushToOwners, unassignedMessage,
} from "../notifications";
import { WhenSheet } from "../components/WhenSheet";
import { canEditDate, formatTime, isTime, withTime } from "../jobTime";
import { cleanerPayFor, flatPayDue, formatClockTime, formatDollars, formatDuration, formatMoney, minutesBetween } from "../payroll";
import { useProperties } from "../components/useProperties";
import { isDeepClean, jobPrice } from "../money";
import { addToCrew, crewLabel, crewOf, isOnCrew, removeFromCrew, type CrewChanges } from "../crew";
import { accessCodes, findProperty, houseKey, type AccessCode } from "../properties";
import { houseLabel } from "../schedule";
import { isLongSession, mergeSummary, otherRunningJob, sessionEntryId, startCheck, waitBriefly } from "../session";
import { supplyList } from "../supplies";
import { availabilityColors, cleanerColor, colors, radius, type, unassignedColor } from "../theme";
import { daysFromToday, formatDateLabel, formatDayHeading, jobDateKey, relativeDayLabel, todayKey } from "../turnover";
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
  const [showEdit, setShowEdit] = useState(false);
  // Ticks each minute so "2h 10m left" before the next guests stays true.
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  // Set when confirming a website request that has no date: saving the date
  // confirms it too.
  const [confirmOnDate, setConfirmOnDate] = useState(false);
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

  // Every cleaning: who's already booked that day (the Assign to list), and
  // when the next guests arrive at this house. The Jobs tab listens to the
  // same query, so Firestore answers from what it already has. Null until loaded.
  const [allJobs, setAllJobs] = useState<Job[] | null>(null);
  const [allJobsFailed, setAllJobsFailed] = useState(false);
  useEffect(() => {
    return onSnapshot(collection(db, "jobs"), (snapshot) => {
      setAllJobsFailed(false);
      setAllJobs(snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Job[]);
    }, (error) => {
      console.warn("jobs listener error:", error);
      setAllJobsFailed(true);
    });
  }, []);
  const bookings = useMemo(() => bookingsOf(allJobs || []), [allJobs]);

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  // Permissions. Firestore is open, so this is the only gate: the owner can
  // do anything; a cleaner can work only a job they're on (the main cleaner or
  // the crew), and can take an unassigned one.
  const isMine = !!job && isOnCrew(job, selfId);
  const canWork = (isOwner || isMine) && !job?.cancelled;
  const canTake = !isOwner && !!selfId && !!job && !job.assignedTo && !job.cancelled && !job.pending;
  // A cleaner can hand back their own job until they've started or finished it.
  const canGiveBack = isMine && !!job && !job.startedAt && !job.done && !job.cancelled;

  // Access codes come from the registry rather than the job, so changing a
  // code in one place changes it on every cleaning at that house, past and
  // future, without rewriting a single job.
  const property = findProperty(properties, job);
  // The next guests at this house, from the stays the syncs and emails recorded.
  const stay = useMemo(
    () => (job ? nextStay(job, allJobs || [], j => houseKey(findProperty(properties, j)?.name || j.property || j.address)) : null),
    [job, allJobs, properties]
  );
  const codes = accessCodes(property);
  const house = property?.short || job?.property || job?.address || "the house";
  // A host who pays us directly: this cleaning can be marked paid.
  const jobKey = job ? jobDateKey(job) : null;
  const billed = !!property?.billedFrom && !!jobKey && jobKey >= property.billedFrom;

  // Until someone ticks something, a job shows the current template for its
  // house (one room per bathroom, plus the house's own steps); the list is
  // written to the job when someone starts or ticks it. See checklistForJob.
  const checklist: ChecklistItem[] = checklistForJob({
    stored: job?.checklist,
    done: job?.done === true,
    template,
    bathrooms: property?.bathrooms,
    houseSteps: property?.checklist,
  });
  // Write the shown list to the job only once the template and the houses
  // have loaded, so a fast tap can't save the fallback list or one missing
  // the house's own steps.
  const freshChecklist = !ownsList(job?.checklist) && template !== null && properties.length > 0;
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

  const nameOf = (id: string) => employees.find(e => e.id === id)?.name;
  // Sends to each cleaner, and tells the owner about anyone whose phone
  // couldn't take it so they can text instead.
  const notifyEach = (ids: string[], message: ReturnType<typeof assignmentMessage>, about: string) => {
    warnUnreached(ids.map(id => ({ name: nameOf(id) || "The cleaner", reached: sendPushToEmployee(id, message) })), about);
  };
  // Everyone on the cleaning hears about a move or a cancellation.
  const notifyCrew = (message: ReturnType<typeof assignmentMessage>, about: string) => {
    if (job) notifyEach(crewOf(job), message, about);
  };

  // Who was put on or taken off in the "Who's cleaning" sheet. They're told
  // once, when it closes, so a mis-tap undone right away sends nothing.
  // "none": a change that was undone.
  const crewNotes = useRef(new Map<string, "added" | "removed" | "none">());
  const flushCrewNotes = () => {
    const current = job;
    const notes = [...crewNotes.current.entries()];
    crewNotes.current.clear();
    if (!current) return;
    const added = notes.filter(([, k]) => k === "added").map(([id]) => id);
    const removed = notes.filter(([, k]) => k === "removed").map(([id]) => id);
    if (added.length) notifyEach(added, assignmentMessage(current), "this cleaning");
    if (removed.length) notifyEach(removed, unassignedMessage(current), "being taken off this cleaning");
  };
  // Leaving the screen or the app sends whatever is still waiting.
  const flushRef = useRef(flushCrewNotes);
  flushRef.current = flushCrewNotes;
  useEffect(() => {
    const sub = AppState.addEventListener("change", next => { if (next !== "active") flushRef.current(); });
    return () => { sub.remove(); flushRef.current(); };
  }, []);
  const closeAssign = () => {
    setShowAssign(false);
    flushCrewNotes();
  };

  // Puts cleaners on the job or takes them off. The sheet stays open so the
  // owner can put more than one on; each is paid the house's cleaner pay.
  const saveCrew = async (changes: CrewChanges, added: Employee | null, removed: string[]) => {
    if (!job) return;
    // Finishing pays whoever is on the job, so a running timer needs someone.
    if (job.startedAt && !changes.assignedTo) {
      Alert.alert(
        "Timer is running",
        `${job.assignedToName || "The cleaner"} is on the clock. Finish or discard that timer before taking everyone off this cleaning.`
      );
      return;
    }
    try {
      await updateDoc(doc(db, "jobs", job.id), changes);
      tapSuccess();
      const notes = crewNotes.current;
      if (added) notes.set(added.id, notes.get(added.id) === "removed" ? "none" : "added");
      removed.forEach(id => notes.set(id, notes.get(id) === "added" ? "none" : "removed"));
    } catch (e) {
      console.warn("assign failed:", e);
      Alert.alert("Couldn't assign", "The change didn't save. Check your connection and try again.");
    }
  };
  const toggleCleaner = (emp: Employee) => {
    if (!job) return;
    if (isOnCrew(job, emp.id)) saveCrew(removeFromCrew(job, emp.id, nameOf), null, [emp.id]);
    else saveCrew(addToCrew(job, emp, nameOf), emp, []);
  };
  const clearCrew = () => {
    if (!job) return;
    const ids = crewOf(job);
    Alert.alert(
      ids.length > 1 ? "Take everyone off?" : "Remove the assignment?",
      `${crewLabel(job, nameOf) || "The cleaner"} will be taken off this cleaning and told when you close this.`,
      [
        { text: "Keep", style: "cancel" },
        { text: "Take off", style: "destructive", onPress: () => saveCrew({ assignedTo: null, assignedToName: null, crew: null }, null, ids) },
      ]
    );
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
  const saveDetails = async (d: JobDetails) => {
    if (!job || !isOwner || busy) return;
    setBusy(true);
    try {
      await updateDoc(doc(db, "jobs", job.id), {
        type: d.type,
        sameDayTurnover: d.sameDayTurnover,
        property: d.property,
        address: d.address,
        notes: d.notes,
      });
      setShowEdit(false);
      tapSuccess();
    } catch (e) {
      console.warn("save details failed:", e);
      Alert.alert("Couldn't save", "Nothing changed. Check your connection and try again.");
    }
    setBusy(false);
  };

  const saveWhen = async (next: { dateKey: string | null; time: string | null }) => {
    if (!job || !isOwner || busy) return;
    const moveDate = canEditDate(job.source) && !!next.dateKey && next.dateKey !== jobDateKey(job);
    const confirming = confirmOnDate && moveDate;
    const changes = {
      time: next.time,
      ...(moveDate && next.dateKey ? { dateKey: next.dateKey, date: formatDateLabel(next.dateKey) } : {}),
      ...(confirming ? { pending: false } : {}),
    };
    setBusy(true);
    try {
      await updateDoc(doc(db, "jobs", job.id), changes);
      setShowWhen(false);
      setConfirmOnDate(false);
      tapSuccess();
      notifyCrew(movedMessage({ ...job, ...changes }), "the new date or time");
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

  // A cleaner takes themselves off their job (back to the unassigned pool if
  // they were the only one). The owner is told, because somebody may now have
  // to cover it.
  const giveBack = async () => {
    if (!job || !isMine || !selfId || job.startedAt || busy) return;
    setBusy(true);
    try {
      await updateDoc(doc(db, "jobs", job.id), removeFromCrew(job, selfId, nameOf));
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
      Alert.alert("Not your job", `This cleaning is assigned to ${crewLabel(job, nameOf)}. Ask the owner to reassign it if that's wrong.`);
      return;
    }
    // A cleaner starting their own: check their other timers. The owner
    // starting one: check the main cleaner's.
    const self = taking || isMine;
    const who = self ? selfId : job.assignedTo;
    if (who) {
      try {
        const snap = await getDocs(query(collection(db, "jobs"), where("assignedTo", "==", who)));
        const other = otherRunningJob(snap.docs.map(d => ({ id: d.id, ...d.data() }) as Job), who, job.id);
        if (other) {
          const name = (self ? selfName : job.assignedToName)?.split(" ")[0] || "This cleaner";
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
      ...(job.done ? { done: false, completedAt: null, reopenedFrom: job.completedAt || Date.now() } : {}),
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
            // A session started on a finished cleaning, thrown away, leaves it
            // finished at its original time.
            const restore = job.reopenedFrom ? { done: true, completedAt: job.reopenedFrom, reopenedFrom: null } : {};
            await waitBriefly(updateDoc(doc(db, "jobs", job.id), { startedAt: null, ...restore }), SAVE_WAIT_MS, lateSaveFailed("Discarding the timer"));
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

  // Writes a time entry for everyone on the cleaning and closes the job in ONE
  // batch. Entry ids come from the session, so a second Finish (no signal, or
  // two phones) overwrites them instead of paying twice. Returns false if no
  // one on the job is still on the team.
  const logTimeAndClose = async (opts: {
    cancel?: boolean;
    finishNote?: FinishNote | null;
    checklist?: ChecklistItem[];
    endedAt?: number;
    checkedAtFinish?: number | null;
    lowSupplies?: string[];
  }) => {
    if (!job || !job.startedAt) return false;
    const team = crewOf(job).map(id => employees.find(e => e.id === id)).filter((e): e is Employee => !!e);
    if (team.length === 0) {
      Alert.alert(
        "Cleaner not found",
        "The assigned cleaner no longer exists, so no pay can be calculated. Discard the timer, then add the pay by hand in Payroll if it's owed."
      );
      return false;
    }
    const startedAt = job.startedAt;
    const endedAt = opts.endedAt ?? Date.now();
    const minutes = minutesBetween(startedAt, endedAt);
    // The house's flat pay, however long it took, to each cleaner on it.
    const pay = cleanerPayFor(property);
    const shares = team.map(emp => ({ emp, earned: flatPayDue(job, emp, pay) }));
    const earned = shares.reduce((sum, s) => sum + s.earned, 0);
    const employeeName = crewLabel(job, nameOf) || team[0].name;
    const batch = writeBatch(db);
    shares.forEach(({ emp, earned: share }) => {
      // The main cleaner keeps the id phones have always written.
      const id = emp.id === job.assignedTo ? sessionEntryId(job.id, startedAt) : `${sessionEntryId(job.id, startedAt)}_${emp.id}`;
      // Merged, and never touching paid/paidAt/method: a second Finish of the
      // same session (a phone that saved late, after the owner finished it
      // and marked it paid) must not turn it back to owed. A new entry has no
      // paid field yet, which reads as owed everywhere.
      batch.set(doc(db, "timeEntries", id), {
        jobId: job.id,
        jobAddress: job.address,
        jobDate: job.date,
        employeeId: emp.id,
        employeeName: emp.id === job.assignedTo ? job.assignedToName || emp.name : emp.name,
        startedAt,
        endedAt,
        minutes,
        hourlyRate: emp.hourlyRate,
        flatPay: pay,
        earned: share,
      }, { merge: true });
    });
    const session = { employeeName, minutes, earned };
    batch.update(doc(db, "jobs", job.id), {
      startedAt: null,
      reopenedFrom: null,
      done: !opts.cancel,
      completedAt: opts.cancel ? null : endedAt,
      // Earlier sessions on this job stay counted; this one adds to them.
      timeSummary: mergeSummary(job.timeSummary, session),
      paidTo: arrayUnion(...team.map(e => e.id)),
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
    return { ...session, pay, paidCount: shares.filter(s => s.earned > 0).length, queued: saved === "queued" };
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
          `${result.employeeName} worked ${formatDuration(result.minutes)}` +
            (result.earned <= 0 ? ". They were already paid for this cleaning. "
              : result.paidCount > 1 ? ` and earned ${formatMoney(result.pay)} each. `
              : ` and earned ${formatMoney(result.earned)}. `) +
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
        notifyCrew(cancellationMessage(job), "this cleaning being cancelled");
        tapWarning();
        goBack();
      } catch (e) {
        console.warn("cancel failed:", e);
        Alert.alert("Couldn't cancel", "Check your connection and try again.");
      }
    };
    if (job.startedAt) {
      const minutes = minutesBetween(job.startedAt, Date.now());
      const who = crewLabel(job, nameOf) || "The cleaner";
      const pay = cleanerPayFor(property);
      const dues = crewOf(job).map(id => employees.find(e => e.id === id)).map(emp => (emp ? flatPayDue(job, emp, pay) : 0));
      const due = dues.reduce((sum, d) => sum + d, 0);
      const each = dues.filter(d => d > 0).length > 1 ? ` (${formatMoney(pay)} each)` : "";
      Alert.alert(
        "Timer is running",
        due > 0
          ? `${who} ${crewOf(job).length > 1 ? "have" : "has"} ${formatDuration(minutes)} on the clock. Pay ${formatMoney(due)}${each} for this cleaning before cancelling?`
          : `${who} has ${formatDuration(minutes)} on the clock. Log that time to payroll before cancelling?`,
        [
          { text: "Keep the job", style: "cancel" },
          { text: due > 0 ? "Don't pay & cancel" : "Discard time & cancel", style: "destructive", onPress: () => finish("discard") },
          { text: due > 0 ? `Pay ${formatMoney(due)} & cancel` : "Log time & cancel", onPress: () => finish("log") },
        ]
      );
      return;
    }
    Alert.alert(
      "Cancel this cleaning",
      `Cancel ${job.address} on ${job.date}? It disappears from everyone's phone but stays in the records.${job.assignedTo ? ` ${crewLabel(job, nameOf)} will be notified.` : ""}`,
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
      notifyCrew(assignmentMessage(job), "this cleaning being back on");
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
    // Confirmed with no readable date, it would be missing from the calendar,
    // reminders and availability. Pick the day first; saving it confirms.
    if (!jobDateKey(job)) {
      setConfirmOnDate(true);
      setShowWhen(true);
      return;
    }
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
        { text: "Start timer", onPress: () => { pendingTick.current = { index, at: Date.now() }; startCleaning(); } },
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

  // The step tapped before the timer was running gets its tick once the timer
  // starts (within a couple of minutes, so a start much later doesn't tick it).
  const pendingTick = useRef<{ index: number; at: number } | null>(null);
  useEffect(() => {
    const p = pendingTick.current;
    if (!job?.startedAt || !p) return;
    pendingTick.current = null;
    if (Date.now() - p.at < 2 * 60000) toggleChecklistItem(p.index);
    // Only the timer starting matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.startedAt]);

  if (loadError && !job) {
    return (
      <View style={styles.container}>
        <ScreenHeader onBack={goBack} title="Couldn't load this job" subtitle="Check your signal and try again." />
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
          subtitle="Waiting for the owner to confirm."
        />
      </View>
    );
  }

  const key = jobDateKey(job);
  const days = daysFromToday(job);
  const rel = relativeDayLabel(days);
  const sameDay = job.sameDayTurnover === true;
  // When the next guests come and when these ones have to be out.
  const guestsLine = nextGuestsLine(job, stay, property?.checkInTime, clock, todayKey());
  const checkoutLine = property?.checkOutTime ? `Guests check out by ${formatTime(property.checkOutTime)}` : null;
  const guestRow = [sameDay ? null : guestsLine, checkoutLine].filter((l): l is string => !!l);
  const running = !!job.startedAt;
  const contact = job.contact || null;
  const hasContact = !!(contact && (contact.name || contact.phone));
  const activeEmployees = employees.filter(e => e.active);
  const houseOf = (j: Job) => houseLabel(j, properties);
  const assignedEmployee = employees.find(e => e.id === job.assignedTo);
  const crewIds = crewOf(job);
  const crewName = crewLabel(job, nameOf);
  const assignedColor = job.assignedTo ? cleanerColor(assignedEmployee || { id: job.assignedTo }) : unassignedColor;
  const dateHeading = key ? formatDayHeading(key) : job.date;
  // Cleaners tap the date to put the cleaning in their own calendar; the
  // owner's date row changes the date instead.
  const calendarEvent = !isOwner && !job.cancelled && !job.done
    ? cleaningEvent({ dateKey: key, time: job.time, house, address: job.address, type: job.type, sameDay })
    : null;
  const price = jobPrice(job, property);
  const priceHint = [
    job.price ? "This cleaning" : price !== null ? "House price" : isDeepClean(job) ? "Deep clean · set a price" : "Set a price",
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
        onClose={() => { setShowWhen(false); setConfirmOnDate(false); }}
        onSave={saveWhen}
      />

      {isOwner ? (
        <EditJobSheet visible={showEdit} job={job} properties={properties} busy={busy} onClose={() => setShowEdit(false)} onSave={saveDetails} />
      ) : null}

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

      <SheetModal visible={showAssign} title="Who's cleaning" onClose={closeAssign}>
        {activeEmployees.length === 0 ? (
          <Text style={styles.sheetHint}>No cleaners yet. Add one on the Team tab.</Text>
        ) : (
          <Text style={styles.sheetHint}>Tap to put someone on or take them off. Each one earns {formatDollars(cleanerPayFor(property))} for this cleaning. They&apos;re notified when you close this.</Text>
        )}
        {activeEmployees.map(emp => {
          const on = isOnCrew(job, emp.id);
          const avail = availabilityFor(emp, { id: job.id, key, time: job.time }, bookings);
          const blocked = !on && avail?.kind === "off";
          // Free can only be said once their other cleanings have loaded.
          const status = !avail ? null
            : avail.kind !== "free" ? availabilityDetail(avail, houseOf, isTime(job.time))
            : allJobsFailed ? "No time off then · couldn't check their other cleanings"
            : allJobs === null ? "Checking their day…"
            : availabilityDetail(avail, houseOf, isTime(job.time));
          // Someone who can't work then, or is on another cleaning, is asked about first.
          const warning = on ? null : availabilityWarning(avail, emp.name, houseOf);
          const pick = () => {
            if (!warning) return toggleCleaner(emp);
            Alert.alert(warning.title, warning.body, [
              { text: "Cancel", style: "cancel" },
              { text: "Give it to them", onPress: () => toggleCleaner(emp) },
            ]);
          };
          return (
            <TouchableOpacity
              key={emp.id}
              style={[styles.assignOption, on && styles.assignOptionActive]}
              onPress={pick}
              activeOpacity={0.7}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
            >
              <Avatar name={emp.name} photo={emp.photo} color={cleanerColor(emp)} size={36} muted={blocked} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.assignName, blocked && { color: colors.muted }]}>{emp.name}</Text>
                {avail && status ? (
                  <Text style={[styles.assignStatus, { color: allJobs === null && avail.kind === "free" ? colors.muted : availabilityColors[availabilityTone(avail)] }]}>
                    {status}
                  </Text>
                ) : null}
              </View>
              <Ionicons name={on ? "checkmark-circle" : "ellipse-outline"} size={22} color={on ? colors.teal : colors.faint} />
            </TouchableOpacity>
          );
        })}
        {crewIds.length > 0 && (
          <TouchableOpacity style={styles.unassignRow} onPress={clearCrew}>
            <Ionicons name="person-remove-outline" size={16} color={colors.danger} />
            <Text style={styles.unassignText}>{crewIds.length > 1 ? "Take everyone off" : "Remove assignment"}</Text>
          </TouchableOpacity>
        )}
        {activeEmployees.length > 0 ? <BrandButton label="Done" icon="checkmark" onPress={closeAssign} /> : null}
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
          {crewIds.length > 1
            ? `You come off ${property?.short || job.address} · ${job.date}. The others on it keep it. The owner is notified.`
            : `${property?.short || job.address} · ${job.date} goes back to the open list. The owner is notified.`}
        </Text>
        {days !== null && days >= 0 && days <= 1 ? (
          <View style={styles.giveBackUrgent}>
            <Ionicons name="call-outline" size={16} color={colors.goldDark} />
            <View style={{ flex: 1 }}>
              <Text style={styles.giveBackUrgentText}>
                It&apos;s {days === 0 ? "today" : "tomorrow"}. Call the owner too.
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
          <Text style={styles.pendingBarText}>Waiting for signal. Keep TurnTrack open.</Text>
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
              Cancelled{job.cancelReason ? ` · ${job.cancelReason}` : ""}
            </Text>
          </View>
        )}
        {isPending && (
          <Card tone="gold">
            <View style={styles.pendingHeader}>
              <Ionicons name="mail-unread" size={18} color={colors.goldDark} />
              <Text style={styles.pendingTitle}>Website request · not scheduled</Text>
            </View>
            <Text style={styles.pendingBody}>
              Confirm once the details are set. Cleaners can&apos;t see it until then.
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
            <Text style={styles.sameDayBannerText}>{guestsLine ? `Same day. ${guestsLine}.` : "Same day: clean between checkout and check-in."}</Text>
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
            <View style={styles.cardHeaderRow}>
              <Text style={type.section}>{job.source === "website" ? "Request details" : "Notes"}</Text>
              {isOwner && !job.cancelled ? (
                <TouchableOpacity onPress={() => setShowEdit(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Edit the notes">
                  <Text style={styles.changeLink}>Edit</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <Text style={styles.notesText}>{job.notes}</Text>
          </Card>
        ) : null}

        {/* When, what it pays and where, in one card. Each row opens its editor (or Maps). */}
        <Card style={styles.infoCard}>
          {isOwner && !job.cancelled ? (
            <InfoRow
              icon="calendar-outline"
              value={key ? formatDayHeading(key) : "No date yet"}
              sub={formatTime(job.time) || "No set time"}
              trailing="create-outline"
              onPress={() => setShowWhen(true)}
              label="Change date and time"
            />
          ) : null}
          {calendarEvent && key ? (
            <InfoRow
              icon="calendar-outline"
              value={formatDayHeading(key)}
              sub={`${formatTime(job.time) || "No set time"} · Tap to add to your calendar`}
              trailing="add-circle-outline"
              onPress={() => addToCalendar(calendarEvent)}
              label="Add to your calendar"
            />
          ) : null}
          {isOwner && !job.cancelled && !isPending ? (
            <InfoRow
              icon="pricetag-outline"
              value={price !== null ? formatDollars(price) : "No price"}
              sub={priceHint}
              trailing="create-outline"
              onPress={() => setShowPrice(true)}
              label="Change the price"
              divider
            />
          ) : null}
          {guestRow.length ? (
            <StaticRow icon="people-outline" value={guestRow[0]} sub={guestRow[1]} divider={(isOwner && !job.cancelled) || !!calendarEvent} />
          ) : null}
          <InfoRow
            icon="location"
            value={job.address}
            sub="Tap for directions"
            trailing="navigate-circle-outline"
            onPress={() => openInMaps(job.address)}
            label="Open in Maps"
            divider={(isOwner && !job.cancelled) || !!calendarEvent || guestRow.length > 0}
          />
          {isOwner && !job.cancelled ? (
            <InfoRow
              icon="options-outline"
              value="Edit details"
              sub="Kind of cleaning, same-day, house, notes"
              trailing="chevron-forward"
              onPress={() => setShowEdit(true)}
              label="Edit the cleaning's details"
              divider
            />
          ) : null}
        </Card>

        {property?.notes ? (
          <Card>
            <Text style={type.section}>House notes</Text>
            <Text style={styles.notesText}>{property.notes}</Text>
          </Card>
        ) : null}

        {!isPending && codes.length > 0 && !(isOwner || isMine || viewingAs) && !job.done && (
          <Text style={styles.codesLocked}>Codes show once this cleaning is yours.</Text>
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
              {copied ? `${copied} code copied` : "Tap to copy"}
            </Text>
          </Card>
        )}

        {!isPending && <Card accent={assignedColor}>
          <View style={styles.cardHeaderRow}>
            <Text style={type.section}>{crewIds.length > 1 ? "Cleaners" : "Assigned cleaner"}</Text>
            {isOwner && !job.cancelled && (
              <TouchableOpacity onPress={() => setShowAssign(true)} hitSlop={8}>
                <Text style={styles.changeLink}>{job.assignedToName ? "Change" : "Assign"}</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={{ marginTop: 10 }}>
            <AssigneeRow name={crewName} color={assignedColor} photo={assignedEmployee?.photo} size={38} />
          </View>
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
                  <Text style={styles.liveText}>{crewName ? `${crewName} ${crewIds.length > 1 ? "are" : "is"} cleaning` : "Timer running"}</Text>
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
                  {/* Pay is between the owner and the cleaner who did it; a crew's total isn't one cleaner's. */}
                  {isOwner || viewingAs || (isMine && !job.timeSummary.employeeName.includes("&")) ? ` · ${formatMoney(job.timeSummary.earned)}` : ""}
                </Text>
              </View>
            ) : (
              <Text style={styles.timerHint}>
                {viewingAs
                  ? "Read-only while viewing as a cleaner."
                  : canWork
                  ? "Tap Start cleaning when you arrive."
                  : job.assignedToName
                    ? `Only ${crewIds.length > 1 ? crewName : job.assignedToName.split(" ")[0]} or the owner can start this.`
                    : "Assign a cleaner to track time."}
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
                <Text style={styles.finishNoteTitle}>Running low</Text>
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
          ) : canTake ? (
            // Today: take it for later, or take it and start the clock now.
            <View style={styles.barRow}>
              <BrandButton label="Take this job" icon="hand-right-outline" variant="outline" onPress={takeJob} disabled={busy} style={{ flex: 1 }} />
              <BrandButton label={busy ? "Starting…" : "Take & start"} icon="play" onPress={startCleaning} disabled={busy} style={{ flex: 1 }} />
            </View>
          ) : (
            <BrandButton
              label={busy ? "Starting…" : job.done ? "Start another session" : "Start cleaning"}
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

// A line in the info card that only tells (nothing to tap).
function StaticRow({ icon, value, sub, divider }: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  sub?: string;
  divider?: boolean;
}) {
  return (
    <View style={[styles.infoRow, divider && styles.infoDivider]} accessible accessibilityLabel={sub ? `${value}. ${sub}` : value}>
      <View style={styles.addressIcon}>
        <Ionicons name={icon} size={19} color={colors.tealDark} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.staticText}>{value}</Text>
        {sub ? <Text style={styles.addressHint}>{sub}</Text> : null}
      </View>
    </View>
  );
}

// One tappable line of the job's info card: an icon, the value, an optional
// second line, and the icon for what tapping does.
function InfoRow({ icon, value, sub, trailing, onPress, label, divider }: {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  sub?: string;
  trailing: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  label: string;
  divider?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.infoRow, divider && styles.infoDivider]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${value}. ${label}`}
    >
      <View style={styles.addressIcon}>
        <Ionicons name={icon} size={19} color={colors.tealDark} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.addressText}>{value}</Text>
        {sub ? <Text style={styles.addressHint}>{sub}</Text> : null}
      </View>
      <Ionicons name={trailing} size={22} color={colors.teal} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  infoCard: { paddingVertical: 4 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, minHeight: 56 },
  infoDivider: { borderTopWidth: 1, borderTopColor: colors.bg },
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
  staticText: { fontSize: 14.5, fontWeight: "600", color: colors.ink, marginTop: 3, lineHeight: 20 },
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
  assignStatus: { fontSize: 12.5, fontWeight: "600", marginTop: 3 },
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
