import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { formatTime, TIME_CHOICES } from "../jobTime";
import { colors, radius } from "../theme";
import { tapSelect } from "./haptics";

// Chips per row; a short last row is padded out so its chips stay the same width.
const PER_ROW = 4;
// A chip is at least this wide at normal text size: room for "12:30 PM".
const CHIP_MIN = 78;

// Start-time picker: half-hour chips, 7 AM to 7 PM, plus "No set time". Plain
// buttons rather than a native clock, so it ships in an over-the-air update.
// choices narrows the times offered; noneLabel null drops the no-time chip.
// fold shows just the chosen time until it is tapped, for forms where the
// time is one field among several.
export function TimeChips({ label, value, onChange, choices = TIME_CHOICES, noneLabel = "No set time", fold = false }: {
  label: string;
  value: string | null;
  onChange: (time: string | null) => void;
  choices?: string[];
  noneLabel?: string | null;
  fold?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Chips widen with the phone's text size, so with big text a row holds
  // three instead of four and no time wraps onto two lines.
  const { fontScale } = useWindowDimensions();
  const sized = { minWidth: Math.round(CHIP_MIN * Math.min(fontScale, 1.6)) };
  const pick = (t: string | null) => {
    tapSelect();
    onChange(t);
    if (fold) setOpen(false);
  };
  const shown = value ? formatTime(value) || value : noneLabel || "Pick a time";
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      {fold ? (
        <TouchableOpacity
          style={styles.field}
          onPress={() => { tapSelect(); setOpen(prev => !prev); }}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${shown}`}
          accessibilityHint={open ? "Hides the times" : "Shows the times to pick from"}
          accessibilityState={{ expanded: open }}
        >
          <Ionicons name="time-outline" size={17} color={value ? colors.tealDark : colors.faint} />
          <Text style={[styles.fieldText, !value && { color: colors.muted }]}>{shown}</Text>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.faint} />
        </TouchableOpacity>
      ) : null}
      {!fold || open ? (
        <View style={[styles.grid, fold && styles.gridFolded]} accessibilityRole="radiogroup" accessibilityLabel={label}>
          {noneLabel !== null ? <Chip text={noneLabel} selected={value === null} onPress={() => pick(null)} wide /> : null}
          {choices.map((t) => (
            <Chip key={t} text={formatTime(t) || t} selected={value === t} onPress={() => pick(t)} sized={sized} />
          ))}
          {Array.from({ length: (PER_ROW - (choices.length % PER_ROW)) % PER_ROW }, (_, i) => <View key={`pad${i}`} style={[styles.pad, sized]} />)}
        </View>
      ) : null}
    </View>
  );
}

function Chip({ text, selected, onPress, wide, sized }: { text: string; selected: boolean; onPress: () => void; wide?: boolean; sized?: { minWidth: number } }) {
  return (
    <TouchableOpacity
      style={[styles.chip, sized, wide && styles.chipWide, selected && styles.chipOn]}
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
  // Matches the date field beside it in a form.
  field: {
    flexDirection: "row", alignItems: "center", gap: 9, minHeight: 48, paddingHorizontal: 13, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.bg,
  },
  fieldText: { flex: 1, fontSize: 15.5, color: colors.ink },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  gridFolded: { marginTop: 8 },
  // Four to a row on a phone, three when the text is large or the phone small.
  chip: {
    flexBasis: "22%", flexGrow: 1, minWidth: CHIP_MIN, minHeight: 44, paddingHorizontal: 6, borderRadius: radius.sm, borderWidth: 1,
    borderColor: colors.line, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center",
  },
  // The no-time choice gets a row to itself above the times.
  chipWide: { flexBasis: "100%" },
  // Invisible, so the chips on a short last row don't stretch.
  pad: { flexBasis: "22%", flexGrow: 1, minWidth: CHIP_MIN, height: 0 },
  chipOn: { backgroundColor: colors.tealDark, borderColor: colors.tealDark },
  chipText: { fontSize: 13.5, fontWeight: "600", color: colors.ink, fontVariant: ["tabular-nums"] },
  chipTextOn: { color: colors.white },
});
