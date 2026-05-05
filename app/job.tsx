import { useLocalSearchParams, useRouter } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

export default function JobDetail() {
  const { address, date, type } = useLocalSearchParams();
  const router = useRouter();

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => router.back()} style={styles.back}>
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>
      <Text style={styles.appTitle}>TurnTrack</Text>
      <Text style={styles.header}>Job details</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Date</Text>
        <Text style={styles.value}>{date}</Text>
        <Text style={styles.label}>Address</Text>
        <Text style={styles.value}>{address}</Text>
        <Text style={styles.label}>Job type</Text>
        <Text style={styles.value}>{type}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Checklist</Text>
        {["Strip all beds","Wash and dry all laundry","Clean and sanatize all kitchen appliances", "Clean bathrooms", "Vacuum + mop floors", "Restock supplies", "Wipe + sanatize surfaces", "Check for damages"].map((item, i) => (
          <Text key={i} style={styles.checkItem}>— {item}</Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#E8F4FD", paddingTop: 60, paddingHorizontal: 20 },
  back: { marginBottom: 8 },
  backText: { fontSize: 15, color: "#1A7ABF" },
  appTitle: { fontSize: 11, fontWeight: "500", color: "#1A7ABF", letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 },
  header: { fontSize: 26, fontWeight: "500", color: "#0A1F35", marginBottom: 20 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 0.5, borderColor: "#C8E4F5" },
  label: { fontSize: 11, color: "#7AAEC8", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 12, marginBottom: 2 },
  value: { fontSize: 16, fontWeight: "500", color: "#0A1F35" },
  checkItem: { fontSize: 14, color: "#0A1F35", paddingVertical: 7, borderBottomWidth: 0.5, borderBottomColor: "#E8F4FD" },
});