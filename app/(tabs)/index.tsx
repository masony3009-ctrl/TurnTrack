import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { addDoc, collection, deleteDoc, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useProfile } from "../../components/ProfileProvider";
import { BrandButton, Card, EmptyState, Fab, FormInput, IconButton, Pill, ScreenHeader, SheetModal } from "../../components/ui";
import { db } from "../../firebase";
import { registerForPushNotifications, scheduleTodaysJobNotifications, sendTestNotification } from "../../notifications";
import { colors, radius } from "../../theme";
import { hasSameDayTurnover, parseJobDateToDate } from "../../turnover";
import { Job } from "../../types";

function daysFromToday(dateStr: string): number | null {
  const date = parseJobDateToDate(dateStr);
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export default function JobsScreen() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newType, setNewType] = useState("");
  const [newSameDayTurnover, setNewSameDayTurnover] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const router = useRouter();
  const { state, switchProfile } = useProfile();
  const isOwner = state.status === "owner";
  const selfId = state.status === "cleaner" ? state.employee.id : null;

  useEffect(() => {
    registerForPushNotifications();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "jobs"), (snapshot) => {
      const loaded = snapshot.docs.map(d => ({
        id: d.id,
        ...d.data()
      })) as Job[];

      const now = Date.now();
      const filtered = loaded.filter(job => {
        if (!job.done) return true;
        if (!job.completedAt) return true;
        const hoursSinceDone = (now - job.completedAt) / (1000 * 60 * 60);
        return hoursSinceDone < 24;
      });

      filtered.sort((a, b) => {
        return (parseJobDateToDate(a.date)?.getTime() || 0) - (parseJobDateToDate(b.date)?.getTime() || 0);
      });

      setJobs(filtered);
    });
    return unsub;
  }, []);

  // Owners get reminded about every job; cleaners only about jobs assigned to them.
  useEffect(() => {
    const relevant = selfId ? jobs.filter(j => j.assignedTo === selfId) : jobs;
    scheduleTodaysJobNotifications(relevant);
  }, [jobs, selfId]);

  const toggleDone = async (id: string, current: boolean) => {
    await updateDoc(doc(db, "jobs", id), {
      done: !current,
      completedAt: !current ? Date.now() : null
    });
  };

  const deleteJob = (id: string, address: string) => {
    Alert.alert(
      "Delete job",
      `Are you sure you want to delete "${address}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            await deleteDoc(doc(db, "jobs", id));
          }
        }
      ]
    );
  };

  const addJob = async () => {
    if (!newDate || !newAddress || !newType) {
      Alert.alert("Missing info", "Please fill out all fields.");
      return;
    }
    await addDoc(collection(db, "jobs"), {
      date: newDate,
      address: newAddress,
      type: newType,
      done: false,
      completedAt: null,
      sameDayTurnover: newSameDayTurnover,
      assignedTo: null,
      assignedToName: null,
      startedAt: null,
    });
    setNewDate("");
    setNewAddress("");
    setNewType("");
    setNewSameDayTurnover(false);
    setShowForm(false);
  };

  const active = jobs.filter(j => !j.done);
  const todayCount = active.filter(j => daysFromToday(j.date) === 0).length;
  const weekCount = active.filter(j => {
    const d = daysFromToday(j.date);
    return d !== null && d >= 0 && d <= 6;
  }).length;
  const unassignedCount = active.filter(j => !j.assignedTo).length;
  const visibleJobs = selfId && mineOnly ? jobs.filter(j => j.assignedTo === selfId) : jobs;

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Jobs"
        subtitle={
          state.status === "cleaner"
            ? `Hey ${state.employee.name.split(" ")[0]} — ${active.length} upcoming`
            : `${active.length} upcoming cleaning${active.length === 1 ? "" : "s"}`
        }
        right={
          <>
            {isOwner && <IconButton icon="scan-outline" onPress={() => router.push("/scan-calendar")} />}
            {isOwner && <IconButton icon="notifications-outline" onPress={sendTestNotification} />}
            <IconButton icon="swap-horizontal" onPress={switchProfile} />
          </>
        }
      />

      <View style={styles.statRow}>
        <View style={styles.statChip}>
          <Text style={styles.statNumber}>{todayCount}</Text>
          <Text style={styles.statLabel}>Today</Text>
        </View>
        <View style={styles.statChip}>
          <Text style={styles.statNumber}>{weekCount}</Text>
          <Text style={styles.statLabel}>This week</Text>
        </View>
        <View style={[styles.statChip, unassignedCount > 0 && styles.statChipWarn]}>
          <Text style={[styles.statNumber, unassignedCount > 0 && { color: colors.goldDark }]}>{unassignedCount}</Text>
          <Text style={[styles.statLabel, unassignedCount > 0 && { color: colors.goldDark }]}>Unassigned</Text>
        </View>
      </View>

      {selfId && (
        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterChip, !mineOnly && styles.filterChipActive]}
            onPress={() => setMineOnly(false)}
          >
            <Text style={[styles.filterChipText, !mineOnly && styles.filterChipTextActive]}>All jobs</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, mineOnly && styles.filterChipActive]}
            onPress={() => setMineOnly(true)}
          >
            <Text style={[styles.filterChipText, mineOnly && styles.filterChipTextActive]}>My jobs</Text>
          </TouchableOpacity>
        </View>
      )}

      <SheetModal visible={showForm} title="New job" onClose={() => setShowForm(false)}>
        <FormInput label="Date" placeholder="e.g. Mon Mar 24" value={newDate} onChangeText={setNewDate} />
        <FormInput label="Address" placeholder="Property address" value={newAddress} onChangeText={setNewAddress} />
        <FormInput label="Job type" placeholder="e.g. Turnover" value={newType} onChangeText={setNewType} />
        <TouchableOpacity
          style={[styles.toggleRow, newSameDayTurnover && styles.toggleRowActive]}
          onPress={() => setNewSameDayTurnover(!newSameDayTurnover)}
        >
          <Ionicons
            name={newSameDayTurnover ? "checkbox" : "square-outline"}
            size={22}
            color={newSameDayTurnover ? colors.gold : colors.faint}
          />
          <Text style={[styles.toggleText, newSameDayTurnover && { color: colors.goldDark }]}>
            Same-day turnover
          </Text>
        </TouchableOpacity>
        <BrandButton label="Add job" icon="add" onPress={addJob} />
      </SheetModal>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 96 }}>
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
              title="No jobs yet"
              body="Jobs from your booking emails land here automatically. You can also scan an Airbnb calendar or add one by hand."
            />
          )
        )}
        {visibleJobs.map((job) => {
          const sameDay = hasSameDayTurnover(job);
          return (
            <TouchableOpacity
              key={job.id}
              onPress={() => router.push({ pathname: "/job", params: { id: job.id } })}
              activeOpacity={0.7}
            >
              <Card tone={sameDay ? "gold" : "default"} style={job.done ? styles.cardDone : undefined}>
                <View style={styles.cardTop}>
                  <View style={styles.pillRow}>
                    <Pill label={job.type} tone="teal" />
                    {job.startedAt ? <Pill label="In progress" tone="gold" icon="time" /> : null}
                  </View>
                  {isOwner && (
                    <TouchableOpacity onPress={() => deleteJob(job.id, job.address)} hitSlop={8}>
                      <Ionicons name="trash-outline" size={17} color={colors.faint} />
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={styles.address}>{job.address}</Text>
                <View style={styles.metaRow}>
                  <Ionicons name="calendar-clear-outline" size={13} color={colors.muted} />
                  <Text style={styles.metaText}>{job.date}</Text>
                </View>
                {sameDay && (
                  <View style={styles.sameDayStrip}>
                    <Ionicons name="alert-circle" size={15} color={colors.goldDark} />
                    <Text style={styles.sameDayText}>Same-day turnover — checkout and check-in today</Text>
                  </View>
                )}
                <View style={styles.cardBottom}>
                  <View style={styles.assigneeRow}>
                    <Ionicons
                      name={job.assignedToName ? "person-circle" : "person-circle-outline"}
                      size={20}
                      color={job.assignedToName ? colors.tealDark : colors.gold}
                    />
                    <Text style={job.assignedToName ? styles.assignee : styles.unassigned}>
                      {job.assignedToName || "Unassigned"}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.doneCircle, job.done && styles.doneCircleActive]}
                    onPress={() => toggleDone(job.id, job.done)}
                    hitSlop={6}
                  >
                    <Ionicons name="checkmark" size={18} color={job.done ? colors.white : colors.faint} />
                  </TouchableOpacity>
                </View>
              </Card>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {isOwner && <Fab icon="add" label="Add job" onPress={() => setShowForm(true)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20 },
  statRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  statChip: {
    flex: 1, backgroundColor: colors.card, borderRadius: radius.md, paddingVertical: 10,
    alignItems: "center", borderWidth: 1, borderColor: colors.line,
  },
  statChipWarn: { backgroundColor: colors.goldSoft, borderColor: "#F0DDBA" },
  statNumber: { fontSize: 20, fontWeight: "700", color: colors.ink },
  statLabel: { fontSize: 11.5, color: colors.muted, marginTop: 1 },
  filterRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  filterChip: {
    borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
  },
  filterChipActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  filterChipText: { fontSize: 13, fontWeight: "600", color: colors.muted },
  filterChipTextActive: { color: colors.white },
  cardDone: { opacity: 0.5 },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 },
  pillRow: { flexDirection: "row", gap: 6, flexWrap: "wrap", flex: 1 },
  address: { fontSize: 16.5, fontWeight: "700", color: colors.ink, marginBottom: 5 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 4 },
  metaText: { fontSize: 13, color: colors.muted },
  sameDayStrip: {
    flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.goldSoft,
    borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 7, marginTop: 6,
  },
  sameDayText: { fontSize: 12.5, fontWeight: "600", color: colors.goldDark, flex: 1 },
  cardBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 },
  assigneeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  assignee: { fontSize: 13.5, fontWeight: "600", color: colors.tealDark },
  unassigned: { fontSize: 13.5, fontWeight: "600", color: colors.goldDark },
  doneCircle: {
    width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: colors.line,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.card,
  },
  doneCircleActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  toggleRow: {
    flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 12, marginBottom: 14, backgroundColor: colors.bg,
  },
  toggleRowActive: { borderColor: colors.gold, backgroundColor: colors.goldSoft },
  toggleText: { fontSize: 14.5, fontWeight: "600", color: colors.ink },
});
