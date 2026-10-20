import { useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { unfinishedByRoom, type ChecklistItem } from "../checklist";
import { colors, radius } from "../theme";
import { BrandButton, SheetModal } from "./ui";

// Shown when someone taps Finish with steps still unchecked. They can finish,
// but only after saying why; the reason is kept on the job for the owner.
const MAX_LISTED = 8;
const MIN_REASON = 3;

export function FinishSheet({ visible, items, busy, onClose, onReview, onFinish, onCheckAll }: {
  visible: boolean;
  items: ChecklistItem[];
  busy: boolean;
  onClose: () => void;
  onReview: () => void;
  onFinish: (reason: string) => void;
  // Everything was done, just not ticked: tick it all and finish.
  onCheckAll: () => void;
}) {
  const [reason, setReason] = useState("");
  const rooms = useMemo(() => unfinishedByRoom(items), [items]);
  const count = rooms.reduce((n, r) => n + r.steps.length, 0);
  const ready = reason.trim().length >= MIN_REASON;

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
      <Text style={styles.lead}>Did all of it but forgot to tick as you went? Check everything off and finish in one tap.</Text>
      <BrandButton
        label={busy ? "Saving…" : `Everything's done — check all ${count} & finish`}
        icon="checkmark-done"
        onPress={onCheckAll}
        disabled={busy}
        style={{ marginTop: 12 }}
      />
      <Text style={styles.divider}>If something really wasn&apos;t done, say why instead. The owner sees this note on the job.</Text>
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
      <Text style={styles.label}>Why weren&apos;t these done?</Text>
      <TextInput
        style={styles.input}
        multiline
        textAlignVertical="top"
        value={reason}
        onChangeText={setReason}
        placeholder="e.g. Fridge front wouldn't come clean, left it for you"
        placeholderTextColor={colors.faint}
        accessibilityLabel="Why weren't these done?"
      />
      <BrandButton
        label={busy ? "Saving…" : "Finish with this note"}
        icon="checkmark-circle"
        variant="outline"
        onPress={() => onFinish(reason.trim())}
        disabled={!ready || busy}
        style={{ marginTop: 12 }}
      />
      {!ready ? <Text style={styles.hint}>Write a few words to finish.</Text> : null}
      <BrandButton label="Back to checklist" icon="list" variant="ghost" onPress={onReview} style={{ marginTop: 4 }} />
    </SheetModal>
  );
}

const styles = StyleSheet.create({
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
