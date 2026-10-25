import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { formatTime, TIME_CHOICES } from "../jobTime";
import { colors, radius } from "../theme";
import { tapSelect } from "./haptics";

// Start-time picker: half-hour chips, 7 AM to 7 PM, plus "No set time". Plain
// buttons rather than a native clock, so it ships in an over-the-air update.
export function TimeChips({ label, value, onChange }: {
  label: string;
  value: string | null;
  onChange: (time: string | null) => void;
}) {
  const pick = (t: string | null) => { tapSelect(); onChange(t); };
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.grid}>
        <Chip text="No set time" selected={value === null} onPress={() => pick(null)} wide />
        {TIME_CHOICES.map((t) => (
          <Chip key={t} text={formatTime(t) || t} selected={value === t} onPress={() => pick(t)} />
        ))}
      </View>
    </View>
  );
}

function Chip({ text, selected, onPress, wide }: { text: string; selected: boolean; onPress: () => void; wide?: boolean }) {
  return (
    <TouchableOpacity
      style={[styles.chip, wide && styles.chipWide, selected && styles.chipOn]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{text}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 12 },
  label: { fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6, letterSpacing: 0.3 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: {
    minWidth: 82, minHeight: 40, paddingHorizontal: 10, borderRadius: radius.sm, borderWidth: 1,
    borderColor: colors.line, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center",
  },
  chipWide: { minWidth: 120 },
  chipOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  chipText: { fontSize: 13.5, fontWeight: "600", color: colors.ink, fontVariant: ["tabular-nums"] },
  chipTextOn: { color: colors.white },
});
