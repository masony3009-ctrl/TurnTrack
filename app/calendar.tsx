import { useRouter } from "expo-router";
import { collection, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Calendar } from "react-native-calendars";
import { db } from "../firebase";

type Job = {
  id: string;
  date: string;
  address: string;
  type: string;
  done: boolean;
};

function parseJobDate(dateStr: string): string | null {
  try {
    const months: { [key: string]: string } = {
      Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
      Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12"
    };
    const match = dateStr.match(/([A-Za-z]+)\s+(\d+)\s+(\d{4})/);
    if (match) {
      const month = months[match[1].substring(0, 3)];
      const day = match[2].padStart(2, "0");
      const year = match[3];
      if (month) return `${year}-${month}-${day}`;
    }
    const match2 = dateStr.match(/([A-Za-z]+),\s+([A-Za-z]+)\s+(\d+)/);
    if (match2) {
      const month = months[match2[2].substring(0, 3)];
      const day = match2[3].padStart(2, "0");
      const year = new Date().getFullYear().toString();
      if (month) return `${year}-${month}-${day}`;
    }
    return null;
  } catch {
    return null;
  }
}

export default function CalendarScreen() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedJobs, setSelectedJobs] = useState<Job[]>([]);
  const router = useRouter();

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "jobs"), (snapshot) => {
      const loaded = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Job[];
      setJobs(loaded);
    });
    return unsub;
  }, []);

  const markedDates: { [key: string]: any } = {};
  jobs.forEach(job => {
    const parsed = parseJobDate(job.date);
    if (parsed) {
      markedDates[parsed] = {
        marked: true,
        dotColor: "#1A7ABF",
        selectedColor: "#1A7ABF",
      };
    }
  });

  if (selectedDate) {
    markedDates[selectedDate] = {
      ...markedDates[selectedDate],
      selected: true,
      selectedColor: "#1A7ABF",
    };
  }

  const handleDayPress = (day: any) => {
    setSelectedDate(day.dateString);
    const dayJobs = jobs.filter(job => parseJobDate(job.date) === day.dateString);
    setSelectedJobs(dayJobs);
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => router.back()} style={styles.back}>
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>
      <Text style={styles.appTitle}>TurnTrack</Text>
      <Text style={styles.header}>Calendar</Text>
      <Calendar
        markedDates={markedDates}
        onDayPress={handleDayPress}
        style={styles.calendar}
        theme={{
          backgroundColor: "#FFFFFF",
          calendarBackground: "#FFFFFF",
          todayTextColor: "#1A7ABF",
          selectedDayBackgroundColor: "#1A7ABF",
          dotColor: "#1A7ABF",
          arrowColor: "#1A7ABF",
          textDayFontSize: 14,
          textMonthFontSize: 15,
          textDayHeaderFontSize: 12,
          monthTextColor: "#0A1F35",
          dayTextColor: "#0A1F35",
          textDisabledColor: "#C8E4F5",
        }}
      />
      <ScrollView style={{ marginTop: 12 }}>
        {selectedJobs.length > 0 ? (
          selectedJobs.map(job => (
            <TouchableOpacity
              key={job.id}
              style={styles.card}
              onPress={() => router.push({ pathname: "/job", params: { address: job.address, date: job.date, type: job.type }})}
            >
              <View style={styles.tag}>
                <Text style={styles.tagText}>{job.type}</Text>
              </View>
              <Text style={styles.cardDate}>{job.date}</Text>
              <Text style={styles.cardAddress}>{job.address}</Text>
            </TouchableOpacity>
          ))
        ) : selectedDate ? (
          <Text style={styles.noJobs}>No jobs on this day</Text>
        ) : (
          <Text style={styles.noJobs}>Tap a day to see jobs</Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#E8F4FD", paddingTop: 60, paddingHorizontal: 20 },
  back: { marginBottom: 8 },
  backText: { fontSize: 15, color: "#1A7ABF" },
  appTitle: { fontSize: 11, fontWeight: "500", color: "#1A7ABF", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 },
  header: { fontSize: 26, fontWeight: "500", color: "#0A1F35", marginBottom: 16 },
  calendar: { borderRadius: 16, borderWidth: 0.5, borderColor: "#C8E4F5", overflow: "hidden" },
  card: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 16, marginBottom: 10, borderWidth: 0.5, borderColor: "#C8E4F5" },
  tag: { alignSelf: "flex-start", backgroundColor: "#DAEEF9", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, marginBottom: 8 },
  tagText: { fontSize: 11, fontWeight: "500", color: "#0A4A7A" },
  cardDate: { fontSize: 12, color: "#7AAEC8", marginBottom: 4 },
  cardAddress: { fontSize: 15, fontWeight: "500", color: "#0A1F35" },
  noJobs: { textAlign: "center", color: "#7AAEC8", marginTop: 24, fontSize: 15 },
});