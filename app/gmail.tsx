import * as AuthSession from "expo-auth-session/providers/google";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { addDoc, collection } from "firebase/firestore";
import { useState } from "react";
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { db } from "../firebaseConfig";

WebBrowser.maybeCompleteAuthSession();

const CLIENT_ID = "540170332193-sfelonuspuobp2tpc7t9quhfuq9n7phg.apps.googleusercontent.com";

type DetectedJob = {
  date: string;
  address: string;
  type: string;
};

export default function GmailScreen() {
  const [jobs, setJobs] = useState<DetectedJob[]>([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const [request, response, promptAsync] = AuthSession.useAuthRequest({
    iosClientId: CLIENT_ID,
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
  });

  const scanEmails = async (token: string) => {
    setLoading(true);
    try {
      const listRes = await fetch(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=airbnb+reservation&maxResults=10",
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const listData = await listRes.json();
      if (!listData.messages) {
        Alert.alert("No emails found", "No Airbnb reservation emails were found.");
        setLoading(false);
        return;
      }
      const detected: DetectedJob[] = [];
      for (const msg of listData.messages.slice(0, 5)) {
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const msgData = await msgRes.json();
        const snippet = msgData.snippet || "";
        const dateMatch = snippet.match(/\b(\w+ \d{1,2},? \d{4})\b/);
        const addressMatch = snippet.match(/\d+\s+\w+\s+(St|Ave|Rd|Blvd|Dr|Ln|Way)/i);
        if (dateMatch) {
          detected.push({
            date: dateMatch[1],
            address: addressMatch ? addressMatch[0] : "Address not found",
            type: "Turnover",
          });
        }
      }
      setJobs(detected);
      if (detected.length === 0) {
        Alert.alert("No dates found", "Emails were found but no dates could be extracted.");
      }
    } catch (e) {
      Alert.alert("Error", "Something went wrong scanning emails.");
    }
    setLoading(false);
  };

  const handleSignIn = async () => {
    const result = await promptAsync();
    if (result.type === "success") {
      await scanEmails(result.authentication!.accessToken);
    }
  };

  const saveJob = async (job: DetectedJob) => {
    await addDoc(collection(db, "jobs"), { ...job, done: false });
    Alert.alert("Saved!", `${job.address} added to your jobs.`);
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => router.back()} style={styles.back}>
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>
      <Text style={styles.header}>Scan Gmail</Text>
      <Text style={styles.sub}>Find Airbnb bookings in your email</Text>
      <TouchableOpacity style={styles.button} onPress={handleSignIn} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? "Scanning..." : "Sign in and Scan"}</Text>
      </TouchableOpacity>
      <FlatList
        data={jobs}
        keyExtractor={(_, i) => i.toString()}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.date}>{item.date}</Text>
            <Text style={styles.address}>{item.address}</Text>
            <Text style={styles.type}>{item.type}</Text>
            <TouchableOpacity style={styles.saveButton} onPress={() => saveJob(item)}>
              <Text style={styles.buttonText}>Add to Jobs</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5", paddingTop: 60, paddingHorizontal: 20 },
  back: { marginBottom: 16 },
  backText: { fontSize: 16, color: "#4a90e2" },
  header: { fontSize: 28, fontWeight: "bold", color: "#1a1a1a" },
  sub: { fontSize: 15, color: "#888", marginBottom: 24, marginTop: 4 },
  button: { backgroundColor: "#4a90e2", borderRadius: 12, padding: 16, alignItems: "center", marginBottom: 24 },
  saveButton: { backgroundColor: "#4a90e2", borderRadius: 8, padding: 10, alignItems: "center", marginTop: 12 },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 12 },
  date: { fontSize: 13, color: "#888", marginBottom: 4 },
  address: { fontSize: 17, fontWeight: "600", color: "#1a1a1a" },
  type: { fontSize: 14, color: "#4a90e2", marginTop: 4 },
});