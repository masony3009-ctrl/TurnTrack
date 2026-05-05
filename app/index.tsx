import { useRouter } from "expo-router";
import { addDoc, collection, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { db } from "../firebaseConfig";
import { registerForPushNotifications, scheduleTodaysJobNotifications } from "../notifications";

type Job = {
  id: string;
  date: string;
  address: string;
  type: string;
  done: boolean;
  completedAt?: number;
};

export default function Index() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newType, setNewType] = useState("");
  const router = useRouter();

  useEffect(() => {
    registerForPushNotifications();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "jobs"), (snapshot) => {
      const loaded = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Job[];

      const now = Date.now();
      const filtered = loaded.filter(job => {
        if (!job.done) return true;
        if (!job.completedAt) return true;
        const hoursSinceDone = (now - job.completedAt) / (1000 * 60 * 60);
        return hoursSinceDone < 24;
      });

      filtered.sort((a, b) => {
        const parseDate = (str: string) => {
          const months: { [key: string]: number } = {
            Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
            Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
          };
          const m1 = str.match(/([A-Za-z]+)\s+(\d+)\s+(\d{4})/);
          if (m1) return new Date(parseInt(m1[3]), months[m1[1].substring(0,3)], parseInt(m1[2])).getTime();
          const m2 = str.match(/([A-Za-z]+),\s+([A-Za-z]+)\s+(\d+)/);
          if (m2) return new Date(new Date().getFullYear(), months[m2[2].substring(0,3)], parseInt(m2[3])).getTime();
          return 0;
        };
        return parseDate(a.date) - parseDate(b.date);
      });

      setJobs(filtered);
      scheduleTodaysJobNotifications(filtered);
    });
    return unsub;
  }, []);

  const toggleDone = async (id: string, current: boolean) => {
    await updateDoc(doc(db, "jobs", id), {
      done: !current,
      completedAt: !current ? Date.now() : null
    });
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
    });
    setNewDate("");
    setNewAddress("");
    setNewType("");
    setShowForm(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.appTitle}>TurnTrack</Text>
      <Text style={styles.header}>Upcoming jobs</Text>
      <Text style={styles.subheader}>{jobs.filter(j => !j.done).length} jobs remaining</Text>

      <Modal visible={showForm} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.form}>
            <Text style={styles.formTitle}>New job</Text>
            <TextInput
              style={styles.input}
              placeholder="Date (e.g. Mon Mar 24)"
              placeholderTextColor="#7AAEC8"
              value={newDate}
              onChangeText={setNewDate}
            />
            <TextInput
              style={styles.input}
              placeholder="Address"
              placeholderTextColor="#7AAEC8"
              value={newAddress}
              onChangeText={setNewAddress}
            />
            <TextInput
              style={styles.input}
              placeholder="Type (e.g. Turnover)"
              placeholderTextColor="#7AAEC8"
              value={newType}
              onChangeText={setNewType}
            />
            <TouchableOpacity style={styles.button} onPress={addJob}>
              <Text style={styles.buttonText}>Add job</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelButton} onPress={() => setShowForm(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <ScrollView showsVerticalScrollIndicator={false}>
        {jobs.map((job) => (
          <TouchableOpacity
            key={job.id}
            onPress={() => router.push({ pathname: "/job", params: { address: job.address, date: job.date, type: job.type }})}
          >
            <View style={[styles.card, job.done && styles.cardDone]}>
              <View style={styles.tag}>
                <Text style={styles.tagText}>{job.type}</Text>
              </View>
              <Text style={styles.date}>{job.date}</Text>
              <Text style={styles.address}>{job.address}</Text>
              <TouchableOpacity
                style={[styles.button, job.done && styles.buttonDone]}
                onPress={() => toggleDone(job.id, job.done)}
              >
                <Text style={[styles.buttonText, job.done && styles.buttonTextDone]}>{job.done ? "Done" : "Mark as done"}</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        ))}
        <View style={{ height: 20 }} />
      </ScrollView>

      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.calendarButton} onPress={() => router.push("/calendar")}>
          <Text style={styles.calendarButtonText}>View calendar</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.fab} onPress={() => setShowForm(true)}>
          <Text style={styles.fabText}>+ Add job</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#E8F4FD", paddingTop: 60, paddingHorizontal: 20 },
  appTitle: { fontSize: 11, fontWeight: "500", color: "#1A7ABF", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 },
  header: { fontSize: 26, fontWeight: "500", color: "#0A1F35", marginBottom: 2 },
  subheader: { fontSize: 14, color: "#7AAEC8", marginBottom: 20 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 16, marginBottom: 10, borderWidth: 0.5, borderColor: "#C8E4F5" },
  cardDone: { opacity: 0.45 },
  tag: { alignSelf: "flex-start", backgroundColor: "#DAEEF9", borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3, marginBottom: 8 },
  tagText: { fontSize: 11, fontWeight: "500", color: "#0A4A7A" },
  date: { fontSize: 12, color: "#7AAEC8", marginBottom: 3 },
  address: { fontSize: 15, fontWeight: "500", color: "#0A1F35", marginBottom: 10 },
  button: { backgroundColor: "#1A7ABF", borderRadius: 10, padding: 10, alignItems: "center" },
  buttonDone: { backgroundColor: "#C8E4F5" },
  buttonText: { color: "#FFFFFF", fontWeight: "500", fontSize: 13 },
  buttonTextDone: { color: "#7AAEC8" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)", justifyContent: "flex-end" },
  form: { backgroundColor: "#FFFFFF", borderRadius: 24, padding: 24, marginHorizontal: 12, marginBottom: 40 },
  formTitle: { fontSize: 17, fontWeight: "500", marginBottom: 16, color: "#0A1F35" },
  input: { borderWidth: 0.5, borderColor: "#C8E4F5", borderRadius: 10, padding: 11, marginBottom: 10, fontSize: 15, color: "#0A1F35", backgroundColor: "#E8F4FD" },
  cancelButton: { marginTop: 8, alignItems: "center", padding: 10 },
  cancelText: { color: "#7AAEC8", fontSize: 14 },
  bottomBar: { flexDirection: "row", gap: 10, paddingVertical: 16 },
  calendarButton: { flex: 1, backgroundColor: "#1A7ABF", borderRadius: 12, padding: 15, alignItems: "center" },
  calendarButtonText: { color: "#FFFFFF", fontWeight: "500", fontSize: 14 },
  fab: { flex: 1, backgroundColor: "#FFFFFF", borderRadius: 12, padding: 15, alignItems: "center", borderWidth: 0.5, borderColor: "#1A7ABF" },
  fabText: { color: "#1A7ABF", fontWeight: "500", fontSize: 14 },
});