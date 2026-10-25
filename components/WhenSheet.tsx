import { useEffect, useState } from "react";
import { StyleSheet, Text } from "react-native";
import { canEditDate, syncedFrom } from "../jobTime";
import { colors } from "../theme";
import { TimeChips } from "./TimeChips";
import { BrandButton, DatePickerField, SheetModal } from "./ui";

// The owner's "Date & time" editor for one job. Jobs a calendar sync follows
// (Airbnb, Turno) keep the date that calendar gives them; only the time can
// change, since the sync would move a hand-edited date straight back.
export function WhenSheet({ visible, source, dateKey, time, busy, onClose, onSave }: {
  visible: boolean;
  source?: string | null;
  dateKey: string | null;
  time: string | null;
  busy: boolean;
  onClose: () => void;
  onSave: (next: { dateKey: string | null; time: string | null }) => void;
}) {
  const [day, setDay] = useState<string | null>(dateKey);
  const [at, setAt] = useState<string | null>(time);
  // Start from the job as it is now each time the sheet opens.
  useEffect(() => {
    if (visible) { setDay(dateKey); setAt(time); }
  }, [visible, dateKey, time]);

  const dateEditable = canEditDate(source);
  const from = syncedFrom(source);
  const changed = day !== dateKey || at !== time;

  return (
    <SheetModal visible={visible} title="Date & time" onClose={onClose}>
      {dateEditable ? (
        <DatePickerField label="Date" value={day} onChange={setDay} />
      ) : (
        <Text style={styles.note}>The date comes from {from}, so it changes when the booking does. You can still set a start time.</Text>
      )}
      <TimeChips label="Start time" value={at} onChange={setAt} />
      <BrandButton
        label={busy ? "Saving…" : "Save"}
        icon="checkmark"
        onPress={() => onSave({ dateKey: day, time: at })}
        disabled={busy || !changed || (dateEditable && !day)}
      />
      <BrandButton label="Cancel" variant="ghost" onPress={onClose} style={{ marginTop: 4 }} />
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  note: { fontSize: 13.5, color: colors.muted, lineHeight: 19, marginBottom: 12 },
});
