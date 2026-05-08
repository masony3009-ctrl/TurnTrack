import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { addDoc, collection } from "firebase/firestore";
import { useState } from "react";
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { db } from "../firebase";

type DetectedJob = {
  date: string;
  address: string;
  type: string;
};

export default function ScanCalendarScreen() {
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [detectedJobs, setDetectedJobs] = useState<DetectedJob[]>([]);
  const [propertyName, setPropertyName] = useState("");
  const router = useRouter();

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Please allow access to your photo library.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 1.0,
    });

    if (!result.canceled && result.assets[0]) {
      setImage(result.assets[0].uri);
      setDetectedJobs([]);
      await scanCalendar(result.assets[0].base64 || "", result.assets[0].mimeType || "image/jpeg");
    }
  };

  const scanCalendar = async (base64: string, mimeType: string) => {
    setLoading(true);
    try {
      const apiKey = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;
      if (!apiKey) {
        Alert.alert("Error", "API key not configured.");
        setLoading(false);
        return;
      }

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-opus-4-5",
          max_tokens: 1000,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: mimeType,
                    data: base64,
                  },
                },
                {
                  type: "text",
                  text: `This is a screenshot of an Airbnb host calendar. 

The calendar shows guest bookings as dark/black horizontal bars spanning multiple days. Each bar has the guest's name on it.

Please identify:
1. The property name shown at the top of the screen
2. The month shown
3. For each booking bar, identify the CHECKOUT date which is the day AFTER the booking bar ends

For example if a booking bar ends on the 9th, the checkout/cleaning date is the 9th (the last day of the bar is checkout day).

Today is ${new Date().toDateString()}.

Respond ONLY with valid JSON, no markdown, no explanation:
{
  "property": "exact property name from top of screen",
  "month": "May 2026",
  "checkouts": [
    {"date": "Sat, May 9 2026", "guest": "Guest Name"},
    {"date": "Tue, May 19 2026", "guest": "Guest Name"}
  ]
}`,
                },
              ],
            },
          ],
        }),
      });

      const data = await response.json();
      
      if (data.error) {
        Alert.alert("API Error", data.error.message);
        setLoading(false);
        return;
      }

      const text = data.content[0].text.trim();
      const parsed = JSON.parse(text);

      setPropertyName(parsed.property || "Airbnb Property");
      const jobs = parsed.checkouts.map((c: any) => ({
        date: c.date,
        address: parsed.property || "Airbnb Property",
        type: "Airbnb Turnover",
      }));
      setDetectedJobs(jobs);

    } catch (e) {
      console.log("Scan error:", e);
      Alert.alert("Error", "Could not process the image. Please try again.");
    }
    setLoading(false);
  };

  const addAllJobs = async () => {
    for (const job of detectedJobs) {
      await addDoc(collection(db, "jobs"), {
        ...job,
        done: false,
        completedAt: null,
      });
    }
    Alert.alert("Added!", `${detectedJobs.length} cleaning jobs added to your calendar.`);
    router.back();
  };

  const removeJob = (index: number) => {
    setDetectedJobs(detectedJobs.filter((_, i) => i !== index));
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => router.back()} style={styles.back}>
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>
      <Text style={styles.appTitle}>TurnTrack</Text>
      <Text style={styles.header}>Scan calendar</Text>
      <Text style={styles.sub}>Upload a screenshot of your Airbnb calendar to automatically detect checkout dates</Text>

      <TouchableOpacity style={styles.uploadBtn} onPress={pickImage}>
        <Text style={styles.uploadBtnText}>{image ? "Choose different photo" : "Upload calendar screenshot"}</Text>
      </TouchableOpacity>

      {image && (
        <Image source={{ uri: image }} style={styles.preview} resizeMode="contain" />
      )}

      {loading && (
        <View style={styles.loadingBox}>
          <ActivityIndicator color="#1A7ABF" />
          <Text style={styles.loadingText}>Scanning with AI — this takes a few seconds...</Text>
        </View>
      )}

      {detectedJobs.length > 0 && (
        <ScrollView style={styles.results}>
          <Text style={styles.resultsTitle}>Found {detectedJobs.length} cleaning(s) for {propertyName}:</Text>
          {detectedJobs.map((job, i) => (
            <View key={i} style={styles.jobRow}>
              <View style={styles.jobInfo}>
                <Text style={styles.jobDate}>{job.date}</Text>
                <Text style={styles.jobType}>{job.type}</Text>
              </View>
              <TouchableOpacity onPress={() => removeJob(i)} style={styles.removeBtn}>
                <Text style={styles.removeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity style={styles.addAllBtn} onPress={addAllJobs}>
            <Text style={styles.addAllBtnText}>Add all {detectedJobs.length} jobs</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#E8F4FD", paddingTop: 60, paddingHorizontal: 20 },
  back: { marginBottom: 8 },
  backText: { fontSize: 15, color: "#1A7ABF" },
  appTitle: { fontSize: 11, fontWeight: "500", color: "#1A7ABF", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 },
  header: { fontSize: 26, fontWeight: "500", color: "#0A1F35", marginBottom: 4 },
  sub: { fontSize: 14, color: "#7AAEC8", marginBottom: 20, lineHeight: 20 },
  uploadBtn: { backgroundColor: "#1A7ABF", borderRadius: 12, padding: 15, alignItems: "center", marginBottom: 16 },
  uploadBtnText: { color: "#FFFFFF", fontWeight: "500", fontSize: 15 },
  preview: { width: "100%", height: 200, borderRadius: 12, marginBottom: 16 },
  loadingBox: { flexDirection: "row", alignItems: "center", gap: 10, padding: 16, backgroundColor: "#FFFFFF", borderRadius: 12, marginBottom: 16 },
  loadingText: { fontSize: 14, color: "#7AAEC8", flex: 1 },
  results: { flex: 1 },
  resultsTitle: { fontSize: 15, fontWeight: "500", color: "#0A1F35", marginBottom: 12 },
  jobRow: { backgroundColor: "#FFFFFF", borderRadius: 12, padding: 14, marginBottom: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 0.5, borderColor: "#C8E4F5" },
  jobInfo: { flex: 1 },
  jobDate: { fontSize: 14, fontWeight: "500", color: "#0A1F35" },
  jobType: { fontSize: 12, color: "#7AAEC8", marginTop: 2 },
  removeBtn: { width: 24, height: 24, borderRadius: 12, backgroundColor: "#F0F7FF", alignItems: "center", justifyContent: "center" },
  removeBtnText: { fontSize: 11, color: "#7AAEC8" },
  addAllBtn: { backgroundColor: "#1A7ABF", borderRadius: 12, padding: 15, alignItems: "center", marginVertical: 16 },
  addAllBtnText: { color: "#FFFFFF", fontWeight: "500", fontSize: 15 },
});