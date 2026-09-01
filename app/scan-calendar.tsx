import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { addDoc, collection } from "firebase/firestore";
import { useState } from "react";
import { ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { BrandButton, Card, Pill } from "../components/ui";
import { db } from "../firebase";
import { colors, radius, type } from "../theme";

type DetectedJob = {
  date: string;
  address: string;
  type: string;
  sameDayTurnover?: boolean;
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
                  text: `This is an Airbnb host calendar screenshot.

The calendar shows guest bookings as solid BLACK horizontal bars spanning multiple days. Each bar has a guest name on it.

IMPORTANT RULES:
- A cleaning is needed on the EXACT DAY the black bar ENDS
- The last day of the black bar is the checkout/cleaning day
- Do NOT add a cleaning for days in the MIDDLE of a black bar
- Do NOT add a cleaning if the black bar continues past the visible screen
- Only add cleanings where a black bar visibly ENDS and is followed by empty/white days
- Mark sameDayTurnover true when one guest checks out on a date and another black bar starts on that exact same date

Looking at the screenshot:
- What is the property name at the top?
- What month is shown?
- For each black bar that has a visible END point, what is the last day of that bar?
- For each checkout, does a different booking start on that same date?

Today is ${new Date().toDateString()}.

Respond ONLY with valid JSON, no markdown:
{
  "property": "exact property name",
  "month": "May 2026",
  "checkouts": [
    {"date": "Sat, May 9 2026", "guest": "Guest Name", "sameDayTurnover": false}
  ]
}

If a booking bar does not have a clear end point visible in the screenshot, do NOT include it.`,
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
        sameDayTurnover: c.sameDayTurnover === true,
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
        assignedTo: null,
        assignedToName: null,
        startedAt: null,
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
      <TouchableOpacity onPress={() => router.back()} style={styles.back} hitSlop={8}>
        <Ionicons name="chevron-back" size={20} color={colors.tealDark} />
        <Text style={styles.backText}>Jobs</Text>
      </TouchableOpacity>
      <Text style={type.wordmark}>TurnTrack</Text>
      <Text style={[type.title, { marginTop: 2 }]}>Scan calendar</Text>
      <Text style={styles.sub}>Upload a screenshot of your Airbnb calendar and the checkout dates get detected automatically.</Text>

      <BrandButton
        label={image ? "Choose a different photo" : "Upload calendar screenshot"}
        icon="image-outline"
        onPress={pickImage}
        style={{ marginBottom: 14 }}
      />

      {image && (
        <Image source={{ uri: image }} style={styles.preview} resizeMode="contain" />
      )}

      {loading && (
        <Card style={styles.loadingBox}>
          <ActivityIndicator color={colors.teal} />
          <Text style={styles.loadingText}>Scanning with AI — this takes a few seconds…</Text>
        </Card>
      )}

      {detectedJobs.length > 0 && (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
          <Text style={styles.resultsTitle}>Found {detectedJobs.length} cleaning{detectedJobs.length === 1 ? "" : "s"} for {propertyName}</Text>
          {detectedJobs.map((job, i) => (
            <Card key={i} tone={job.sameDayTurnover ? "gold" : "default"} style={styles.jobRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.jobDate}>{job.date}</Text>
                <View style={styles.jobPills}>
                  <Pill label={job.type} tone="teal" />
                  {job.sameDayTurnover && <Pill label="Same-day" tone="gold" icon="alert-circle" />}
                </View>
              </View>
              <TouchableOpacity onPress={() => removeJob(i)} hitSlop={8}>
                <Ionicons name="close-circle-outline" size={22} color={colors.faint} />
              </TouchableOpacity>
            </Card>
          ))}
          <BrandButton
            label={`Add all ${detectedJobs.length} jobs`}
            icon="checkmark-done"
            onPress={addAllJobs}
            style={{ marginTop: 6 }}
          />
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingTop: 56, paddingHorizontal: 20 },
  back: { flexDirection: "row", alignItems: "center", marginBottom: 10, alignSelf: "flex-start" },
  backText: { fontSize: 15, fontWeight: "600", color: colors.tealDark },
  sub: { fontSize: 14, color: colors.muted, marginTop: 4, marginBottom: 18, lineHeight: 20 },
  preview: { width: "100%", height: 180, borderRadius: radius.md, marginBottom: 14, backgroundColor: colors.card },
  loadingBox: { flexDirection: "row", alignItems: "center", gap: 12 },
  loadingText: { fontSize: 14, color: colors.muted, flex: 1 },
  resultsTitle: { fontSize: 15.5, fontWeight: "700", color: colors.ink, marginBottom: 10 },
  jobRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  jobDate: { fontSize: 14.5, fontWeight: "700", color: colors.ink, marginBottom: 7 },
  jobPills: { flexDirection: "row", gap: 6 },
});
