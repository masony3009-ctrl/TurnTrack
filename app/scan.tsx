import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { addDoc, collection } from "firebase/firestore";
import { useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { db } from "../firebase";

type DetectedJob = {
  date: string;
  address: string;
  type: string;
};

function scanText(text: string): DetectedJob | null {
  const dateMatch = text.match(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\b/i
  ) || text.match(
    /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/
  ) || text.match(
    /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\b/i
  );

  const addressMatch = text.match(
    /\d+\s+[A-Za-z0-9\s]+(?:St|Ave|Rd|Blvd|Dr|Ln|Way|Court|Ct|Place|Pl|Circle|Cir)\.?/i
  );

  const isTurno = text.toLowerCase().includes("turno");
  const isAirbnb = text.toLowerCase().includes("airbnb");
  const type = isTurno ? "Turno Turnover" : isAirbnb ? "Airbnb Turnover" : "Turnover";

  if (dateMatch) {
    return {
      date: dateMatch[0],
      address: addressMatch ? addressMatch[0] : "Address not found",
      type,
    };
  }
  return null;
}

export default function ScanScreen() {
  const [detected, setDetected] = useState<DetectedJob | null>(null);
  const [rawText, setRawText] = useState("");
  const router = useRouter();

  const handleScan = async () => {
    const text = await Clipboard.getStringAsync();
    if (!text) {
      Alert.alert("Nothing copied", "Copy a notification first, then tap Scan.");
      return;
    }
    setRawText(text);
    const result = scanText(text);
    if (result) {
      setDetected(result);
    } else {
      Alert.alert("No date found", "Could not find a date in the copied text. Try copying more of the notification.");
    }
  };

  const saveJob = async () => {
    if (!detected) return;
    await addDoc(collection(db, "jobs"), { ...detected, done: false });
    Alert.alert("Saved!", `${detected.address} added to your jobs.`);
    setDetected(null);
    setRawText("");
    router.back();
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => router.back()} style={styles.back}>
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>

      <Text style={styles.header}>Scan Notification</Text>
      <Text style={styles.sub}>Copy a notification from Airbnb or Turno, then tap Scan below.</Text>

      <View style={styles.steps}>
        <Text style={styles.step}>1. Get a notification from Airbnb or Turno</Text>
        <Text style={styles.step}>2. Long press the notification</Text>
        <Text style={styles.step}>3. Tap Copy</Text>
        <Text style={styles.step}>4. Come back here and tap Scan</Text>
      </View>

      <TouchableOpacity style={styles.scanButton} onPress={handleScan}>
        <Text style={styles.buttonText}>Scan Clipboard</Text>
      </TouchableOpacity>

      {rawText !== "" && (
        <ScrollView style={styles.rawBox}>
          <Text style={styles.rawLabel}>Copied text:</Text>
          <Text style={styles.rawText}>{rawText}</Text>
        </ScrollView>
      )}

      {detected && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Date detected</Text>
          <Text style={styles.cardValue}>{detected.date}</Text>
          <Text style={styles.cardLabel}>Address</Text>
          <Text style={styles.cardValue}>{detected.address}</Text>
          <Text style={styles.cardLabel}>Type</Text>
          <Text style={styles.cardValue}>{detected.type}</Text>
          <TouchableOpacity style={styles.saveButton} onPress={saveJob}>
            <Text style={styles.buttonText}>Add to Jobs</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5", paddingTop: 60, paddingHorizontal: 20 },
  back: { marginBottom: 16 },
  backText: { fontSize: 16, color: "#4a90e2" },
  header: { fontSize: 28, fontWeight: "bold", color: "#1a1a1a" },
  sub: { fontSize: 15, color: "#888", marginBottom: 24, marginTop: 4, lineHeight: 22 },
  steps: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 24 },
  step: { fontSize: 14, color: "#1a1a1a", paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: "#f0f0f0" },
  scanButton: { backgroundColor: "#4a90e2", borderRadius: 12, padding: 16, alignItems: "center", marginBottom: 24 },
  saveButton: { backgroundColor: "#34a853", borderRadius: 8, padding: 12, alignItems: "center", marginTop: 16 },
  buttonText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 12 },
  cardLabel: { fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 12, marginBottom: 2 },
  cardValue: { fontSize: 17, fontWeight: "600", color: "#1a1a1a" },
  rawBox: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 16, maxHeight: 120 },
  rawLabel: { fontSize: 12, color: "#888", marginBottom: 4 },
  rawText: { fontSize: 13, color: "#555", lineHeight: 20 },
});