import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { collection, onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Calendar } from "react-native-calendars";
import { tapSelect } from "../../components/haptics";
import { useProfile } from "../../components/ProfileProvider";
import { AssigneeRow, calendarTheme, Card, ColorDot, IconButton, Pill, ScreenHeader } from "../../components/ui";
import { db } from "../../firebase";
import { cleanerColor, colors, radius, shadow, unassignedColor } from "../../theme";
import { formatDayHeading, hasSameDayTurnover, isJobVisible, jobDateKey, sortByDate, todayKey } from "../../turnover";
import { Job } from "../../types";

export default function CalendarScreen() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedDate, setSelectedDate] = useState(todayKey());
  const [calendarKey, setCalendarKey] = useState(0);
  const router = useRouter();
  const { employees, state } = useProfile();
  const selfId = state.status === "cleaner" ? state.employee.id : null;

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "jobs"), (snapshot) => {
      const loaded = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Job[];
      setJobs(sortByDate(loaded.filter(isJobVisible)));
    });
    return unsub;
  }, []);

  const colorFor = (job: Job) =>
    job.assignedTo ? cleanerColor(employees.find(e => e.id === job.assignedTo) || { id: job.assignedTo }) : unassignedColor;

  // dateKey -> jobs that day. Derived, so the day list can never go stale.
  const byDay = useMemo(() => {
    const map = new Map<string, Job[]>();
    jobs.forEach(job => {
      const key = jobDateKey(job);
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(job);
    });
    return map;
  }, [jobs]);

  // One dot per job in the cleaner's color; same-day turnovers add a gold dot.
  const markedDates = useMemo(() => {
    const marks: { [key: string]: any } = {};
    byDay.forEach((dayJobs, key) => {
      const dots = dayJobs.flatMap(job => {
        const base = [{ key: job.id, color: colorFor(job) }];
        return hasSameDayTurnover(job) ? [...base, { key: job.id + "-sd", color: colors.gold }] : base;
      });
      marks[key] = { dots: dots.slice(0, 4) };
    });
    marks[selectedDate] = { ...(marks[selectedDate] || {}), selected: true, selectedColor: colors.teal };
    return marks;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byDay, selectedDate, employees]);

  const selectedJobs = byDay.get(selectedDate) || [];
  const activeCleaners = employees.filter(e => e.active);

  const jumpToToday = () => {
    tapSelect();
    setSelectedDate(todayKey());
    setCalendarKey(k => k + 1);
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Calendar"
        subtitle="Dots show who has each cleaning"
        right={<IconButton icon="today-outline" onPress={jumpToToday} />}
      />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
        <View style={styles.calendarWrap}>
          <Calendar
            key={calendarKey}
            current={selectedDate}
            markingType="multi-dot"
            markedDates={markedDates}
            onDayPress={(day: { dateString: string }) => { tapSelect(); setSelectedDate(day.dateString); }}
            enableSwipeMonths
            theme={calendarTheme}
          />
        </View>

        <View style={styles.legend}>
          {activeCleaners.map(emp => (
            <View key={emp.id} style={styles.legendItem}>
              <ColorDot color={cleanerColor(emp)} />
              <Text style={styles.legendText}>{emp.name.split(" ")[0]}</Text>
            </View>
          ))}
          <View style={styles.legendItem}>
            <ColorDot color={unassignedColor} />
            <Text style={styles.legendText}>Unassigned</Text>
          </View>
          <View style={styles.legendItem}>
            <ColorDot color={colors.gold} />
            <Text style={styles.legendText}>Same-day</Text>
          </View>
        </View>

        <View style={styles.dayHeader}>
          <Text style={styles.dayTitle}>{formatDayHeading(selectedDate)}</Text>
          <Text style={styles.dayCount}>
            {selectedJobs.length === 0 ? "No cleanings" : `${selectedJobs.length} cleaning${selectedJobs.length === 1 ? "" : "s"}`}
          </Text>
        </View>

        {selectedJobs.length > 0 ? (
          selectedJobs.map(job => {
            const sameDay = hasSameDayTurnover(job);
            const jobColor = colorFor(job);
            const assignee = employees.find(e => e.id === job.assignedTo);
            const mine = !!selfId && job.assignedTo === selfId;
            return (
              <Card
                key={job.id}
                tone={sameDay ? "gold" : "default"}
                accent={jobColor}
                onPress={() => router.push({ pathname: "/job", params: { id: job.id } })}
              >
                <View style={styles.pillRow}>
                  {job.startedAt ? <Pill label="In progress" tone="solid" icon="time" /> : null}
                  {job.done ? <Pill label="Done" tone="neutral" icon="checkmark" /> : null}
                  {sameDay ? <Pill label="Same-day" tone="gold" icon="alert-circle" /> : null}
                  {mine ? <Pill label="Yours" tone="teal" /> : null}
                  <Pill label={job.type} tone="neutral" />
                </View>
                <Text style={styles.address}>{job.address}</Text>
                <View style={{ marginTop: 8 }}>
                  <AssigneeRow name={job.assignedToName} color={jobColor} photo={assignee?.photo} />
                </View>
              </Card>
            );
          })
        ) : (
          <View style={styles.hintBox}>
            <Ionicons name="cafe-outline" size={20} color={colors.faint} />
            <Text style={styles.hintText}>Nothing scheduled this day</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20 },
  calendarWrap: {
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line,
    overflow: "hidden", backgroundColor: colors.card, ...shadow.card,
  },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 12, marginBottom: 6, paddingHorizontal: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendText: { fontSize: 12, fontWeight: "600", color: colors.muted },
  dayHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 12, marginBottom: 10, paddingHorizontal: 2 },
  dayTitle: { fontSize: 16, fontWeight: "700", color: colors.ink },
  dayCount: { fontSize: 12.5, fontWeight: "600", color: colors.muted },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  address: { fontSize: 16.5, fontWeight: "700", color: colors.ink },
  hintBox: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.card, borderRadius: radius.lg, padding: 22, borderWidth: 1, borderColor: colors.line,
  },
  hintText: { fontSize: 14, color: colors.muted },
});
