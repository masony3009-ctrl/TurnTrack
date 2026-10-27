import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { checklistProgress, unfinishedByRoom, type ChecklistItem } from "../checklist";
import { SUPPLY_CHOICES } from "../supplies";
import { tapSelect } from "./haptics";
import { colors, radius } from "../theme";
import { BrandButton, SheetModal } from "./ui";

// Shown on every Finish. With everything ticked it just offers an optional
// note for the owner (damage, anything odd). With steps unchecked the cleaner
// can tick them all in one go, or finish after saying why they weren't done.
// Either way they can tap what's running low, which lands on the owner's
// shopping list for that house.
const MAX_LISTED = 8;
const MIN_REASON = 3;

export function FinishSheet({ visible, items, busy, onClose, onReview, onFinish, onCheckAll }: {
  visible: boolean;
  items: ChecklistItem[];
  busy: boolean;
  onClose: () => void;
  onReview: () => void;
  // note: optional when everything is ticked, required (the reason) otherwise.
  onFinish: (note: string | null, supplies: string[]) => void;
  // Everything was done, just not ticked: tick it all and finish.
  onCheckAll: (note: string | null, supplies: string[]) => void;
}) {
  const [text, setText] = useState("");
  const [supplies, setSupplies] = useState<string[]>([]);
  useEffect(() => {
    if (!visible) {
      setText("");
      setSupplies([]);
    }
  }, [visible]);
  const toggleSupply = (item: string) => {
    tapSelect();
    setSupplies(prev => (prev.includes(item) ? prev.filter(s => s !== item) : [...prev, item]));
  };
  const picker = <SupplyPicker selected={supplies} onToggle={toggleSupply} />;
  const rooms = useMemo(() => unfinishedByRoom(items), [items]);
  const total = checklistProgress(items).total;
  const count = rooms.reduce((n, r) => n + r.steps.length, 0);
  const note = text.trim() || null;
  const ready = text.trim().length >= MIN_REASON;

  if (count === 0) {
    return (
      <SheetModal visible={visible} title="Finish cleaning" onClose={onClose}>
        <Text style={styles.lead}>{total > 0 ? `All ${total} steps checked.` : "Ready to stop the clock."}</Text>
        {picker}
        <Text style={[styles.label, { marginTop: 14 }]}>Note for the owner (optional)</Text>
        <TextInput
          style={styles.input}
          multiline
          textAlignVertical="top"
          value={text}
          onChangeText={setText}
          placeholder="Damage, something broken, anything odd"
          placeholderTextColor={colors.faint}
          accessibilityLabel="Note for the owner"
        />
        <BrandButton label={busy ? "Saving…" : "Finish cleaning"} icon="checkmark-circle" onPress={() => onFinish(note, supplies)} disabled={busy} style={{ marginTop: 12 }} />
        <BrandButton label="Back to checklist" icon="list" variant="ghost" onPress={onReview} style={{ marginTop: 4 }} />
      </SheetModal>
    );
  }

  // Room by room, capped so a mostly-skipped list stays readable.
  let budget = MAX_LISTED;
  const listed = rooms.map(room => {
    const steps = room.steps.slice(0, Math.max(budget, 0));
    budget -= steps.length;
    return { title: room.title, steps };
  }).filter(r => r.steps.length > 0);
  const hidden = count - listed.reduce((n, r) => n + r.steps.length, 0);

  return (
    <SheetModal visible={visible} title={`${count} step${count === 1 ? "" : "s"} not checked`} onClose={onClose}>
      {picker}
      <Text style={[styles.lead, { marginTop: 16 }]}>Did it all but forgot to tick?</Text>
      <BrandButton
        label={busy ? "Saving…" : `Check all ${count} & finish`}
        icon="checkmark-done"
        onPress={() => onCheckAll(note, supplies)}
        disabled={busy}
        style={{ marginTop: 12 }}
      />
      <Text style={styles.divider}>Or say why these weren&apos;t done:</Text>
      <View style={styles.list}>
        {listed.map(room => (
          <View key={room.title} style={styles.room}>
            <Text style={styles.roomTitle}>{room.title}</Text>
            {room.steps.map((step, i) => (
              <Text key={i} style={styles.step}>• {step}</Text>
            ))}
          </View>
        ))}
        {hidden > 0 ? <Text style={styles.more}>+{hidden} more</Text> : null}
      </View>
      <TextInput
        style={styles.input}
        multiline
        textAlignVertical="top"
        value={text}
        onChangeText={setText}
        placeholder="e.g. Fridge front wouldn't come clean, left it for you"
        placeholderTextColor={colors.faint}
        accessibilityLabel="Why weren't these done?"
      />
      <BrandButton
        label={busy ? "Saving…" : "Finish with this note"}
        icon="checkmark-circle"
        variant="outline"
        onPress={() => onFinish(note, supplies)}
        disabled={!ready || busy}
        style={{ marginTop: 12 }}
      />
      {!ready ? <Text style={styles.hint}>Add a few words to finish.</Text> : null}
      <BrandButton label="Back to checklist" icon="list" variant="ghost" onPress={onReview} style={{ marginTop: 4 }} />
    </SheetModal>
  );
}

// Multi-select chips for supplies that are running low at the house.
function SupplyPicker({ selected, onToggle }: { selected: string[]; onToggle: (item: string) => void }) {
  return (
    <View style={styles.supplies}>
      <Text style={styles.label}>Running low?</Text>
      <View style={styles.supplyGrid}>
        {SUPPLY_CHOICES.map(item => {
          const on = selected.includes(item);
          return (
            <TouchableOpacity
              key={item}
              style={[styles.supplyChip, on && styles.supplyChipOn]}
              onPress={() => onToggle(item)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
            >
              <Text style={[styles.supplyText, on && styles.supplyTextOn]}>{on ? "✓ " : ""}{item}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  supplies: { marginTop: 16 },
  supplyGrid: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  supplyChip: {
    minHeight: 38, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1,
    borderColor: colors.line, backgroundColor: colors.bg, justifyContent: "center",
  },
  supplyChipOn: { backgroundColor: colors.goldSoft, borderColor: colors.gold },
  supplyText: { fontSize: 13.5, fontWeight: "600", color: colors.ink },
  supplyTextOn: { color: colors.goldDark },
  lead: { fontSize: 14, color: colors.muted, lineHeight: 20 },
  divider: {
    fontSize: 13.5, color: colors.muted, lineHeight: 19, marginTop: 18, paddingTop: 14,
    borderTopWidth: 1, borderTopColor: colors.line,
  },
  list: { marginTop: 12, marginBottom: 14, gap: 10 },
  room: { gap: 2 },
  roomTitle: { fontSize: 13, fontWeight: "800", color: colors.ink },
  step: { fontSize: 14, color: colors.ink, lineHeight: 20 },
  more: { fontSize: 13, color: colors.muted, fontWeight: "600" },
  label: { fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6, letterSpacing: 0.3 },
  input: {
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, minHeight: 96,
    paddingHorizontal: 13, paddingVertical: 12, fontSize: 15.5, lineHeight: 21, color: colors.ink, backgroundColor: colors.bg,
  },
  hint: { fontSize: 12.5, color: colors.muted, textAlign: "center", marginTop: 6 },
});
