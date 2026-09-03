import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { collection, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Calendar } from "react-native-calendars";
import { useProfile } from "../../components/ProfileProvider";
import { Card, ColorDot, Pill, ScreenHeader } from "../../components/ui";
import { db } from "../../firebase";
import { cleanerColor, colors, radius, shadow, unassignedColor } from "../../theme";
import { hasSameDayTurnover, isJobVisible, parseJobDateToKey } from "../../turnover";
import { Job } from "../../types";

export default function CalendarScreen() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedJobs, setSelectedJobs] = useState<Job[]>([]);
  const router = useRouter();
  const { employees } = useProfile();

  const colorFor = (job: Job) =>
    job.assignedTo ? cleanerColor(employees.find(e => e.id === job.assignedTo) || { id: job.assignedTo }) : unassignedColor;

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "jobs"), (snapshot) => {
      const loaded = snapshot.docs.map(d => ({
        id: d.id,
        ...d.data()
      })) as Job[];
      setJobs(loaded.filter(isJobVisible));
    });
    return unsub;
  }, []);

  // One dot per job, colored by the cleaner it's assigned to, so a day with
  // three cleanings shows three dots and you can see who's where.
  const markedDates: { [key: string]: any } = {};
  jobs.forEach(job => {
    const parsed = parseJobDateToKey(job.date);
    if (!parsed) return;
    const dots = markedDates[parsed]?.dots || [];
    dots.push({ key: job.id, color: colorFor(job) });
    markedDates[parsed] = { dots };
  });

  if (selectedDate) {
    markedDates[selectedDate] = {
      ...markedDates[selectedDate],
      selected: true,
      selectedColor: colors.teal,
    };
  }

  const handleDayPress = (day: any) => {
    setSelectedDate(day.dateString);
    const dayJobs = jobs.filter(job => parseJobDateToKey(job.date) === day.dateString);
    setSelectedJobs(dayJobs);
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Calendar" subtitle="Tap a day to see its cleanings" />
      <View style={styles.calendarWrap}>
        <Calendar
          markingType="multi-dot"
          markedDates={markedDates}
          onDayPress={handleDayPress}
          theme={{
            backgroundColor: colors.card,
            calendarBackground: colors.card,
            todayTextColor: colors.teal,
            selectedDayBackgroundColor: colors.teal,
            selectedDayTextColor: colors.white,
            dotColor: colors.teal,
            arrowColor: colors.teal,
            textDayFontSize: 14,
            textMonthFontSize: 15,
            textMonthFontWeight: "700",
            textDayHeaderFontSize: 11,
            monthTextColor: colors.ink,
            dayTextColor: colors.ink,
            textDisabledColor: colors.line,
            textSectionTitleColor: colors.faint,
          }}
        />
      </View>
      <ScrollView style={{ marginTop: 14 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={styles.legend}>
          {employees.filter(e => e.active).map(emp => (
            <View key={emp.id} style={styles.legendItem}>
              <ColorDot color={cleanerColor(emp)} />
              <Text style={styles.legendText}>{emp.name.split(" ")[0]}</Text>
            </View>
          ))}
          <View style={styles.legendItem}>
            <ColorDot color={unassignedColor} />
            <Text style={styles.legendText}>Unassigned</Text>
          </View>
        </View>
        {selectedJobs.length > 0 ? (
          selectedJobs.map(job => {
            const sameDay = hasSameDayTurnover(job);
            const jobColor = colorFor(job);
            return (
              <TouchableOpacity
                key={job.id}
                onPress={() => router.push({ pathname: "/job", params: { id: job.id } })}
                activeOpacity={0.7}
              >
                <Card tone={sameDay ? "gold" : "default"} style={{ borderLeftWidth: 4, borderLeftColor: jobColor }}>
                  <View style={styles.pillRow}>
                    <Pill label={job.type} tone="teal" />
                    {sameDay && <Pill label="Same-day" tone="gold" icon="alert-circle" />}
                  </View>
                  <Text style={styles.address}>{job.address}</Text>
                  <View style={styles.metaRow}>
                    <Ionicons
                      name={job.assignedToName ? "person-circle" : "person-circle-outline"}
                      size={17}
                      color={jobColor}
                    />
                    <Text style={job.assignedToName ? [styles.assignee, { color: jobColor }] : styles.unassigned}>
                      {job.assignedToName || "Unassigned"}
                    </Text>
                  </View>
                </Card>
              </TouchableOpacity>
            );
          })
        ) : (
          <View style={styles.hintBox}>
            <Ionicons name={selectedDate ? "cafe-outline" : "hand-left-outline"} size={20} color={colors.faint} />
            <Text style={styles.hintText}>
              {selectedDate ? "No jobs on this day" : "Tap a day to see jobs"}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 12, paddingHorizontal: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendText: { fontSize: 12, fontWeight: "600", color: colors.muted },
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20 },
  calendarWrap: {
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line,
    overflow: "hidden", backgroundColor: colors.card, ...shadow.card,
  },
  pillRow: { flexDirection: "row", gap: 6, marginBottom: 8 },
  address: { fontSize: 15.5, fontWeight: "700", color: colors.ink, marginBottom: 6 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  assignee: { fontSize: 13, fontWeight: "600", color: colors.tealDark },
  unassigned: { fontSize: 13, fontWeight: "600", color: colors.goldDark },
  hintBox: { alignItems: "center", gap: 6, paddingVertical: 26 },
  hintText: { fontSize: 14, color: colors.faint },
});
