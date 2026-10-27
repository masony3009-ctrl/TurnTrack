import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { formatClockTime, formatDuration } from "../payroll";
import { endTimeChoices } from "../session";
import { colors, radius } from "../theme";
import { tapSelect } from "./haptics";
import { BrandButton, SheetModal } from "./ui";

// A timer that ran past six hours was most likely left on. Before paying all
// of it, ask when the cleaning really ended.
export function EndTimeSheet({ visible, startedAt, now, busy, onPick, onClose }: {
  visible: boolean;
  startedAt: number;
  now: number;
  busy: boolean;
  onPick: (endedAt: number) => void;
  onClose: () => void;
}) {
  const choices = endTimeChoices(startedAt, now);
  const fullMinutes = Math.round((now - startedAt) / 60000);
  return (
    <SheetModal visible={visible} title="When did you finish?" onClose={onClose}>
      <Text style={styles.lead}>
        Running {formatDuration(fullMinutes)} since {formatClockTime(startedAt)}. If it was left on, pick when you finished.
      </Text>
      <View style={styles.grid}>
        {choices.map((c) => (
          <TouchableOpacity
            key={c.time}
            style={styles.chip}
            onPress={() => { tapSelect(); onPick(c.at); }}
            disabled={busy}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`Finished at ${c.label}`}
          >
            <Text style={styles.chipText}>{c.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <BrandButton
        label={busy ? "Saving…" : `It's right — log ${formatDuration(fullMinutes)}`}
        variant="outline"
        onPress={() => onPick(now)}
        disabled={busy}
        style={{ marginTop: 14 }}
      />
      <BrandButton label="Back" variant="ghost" onPress={onClose} style={{ marginTop: 4 }} />
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: 14, color: colors.muted, lineHeight: 20, marginBottom: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: {
    minWidth: 82, minHeight: 44, paddingHorizontal: 10, borderRadius: radius.sm, borderWidth: 1,
    borderColor: colors.line, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center",
  },
  chipText: { fontSize: 13.5, fontWeight: "600", color: colors.ink, fontVariant: ["tabular-nums"] },
});
