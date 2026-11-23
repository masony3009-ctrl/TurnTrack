import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity } from "react-native";
import { blankForm, buildEvent, EVENT_TIMES, formOfEvent, newEventId, type EventForm, type OwnerEvent } from "../ownerEvents";
import { colors } from "../theme";
import { tapSuccess } from "./haptics";
import { deleteOwnerEvent, saveOwnerEvent } from "./ownerEventsStore";
import { TimeChips } from "./TimeChips";
import { BrandButton, DatePickerField, FormInput, SheetModal } from "./ui";

// Adds something that isn't a cleaning to the owner's calendar (a client
// meeting, a walkthrough), or edits one. Only the owner sees these.
export function OwnerEventSheet({ visible, day, event, onClose }: {
  visible: boolean;
  // The day a new event starts on.
  day: string;
  // The event being edited; null adds a new one.
  event: OwnerEvent | null;
  onClose: () => void;
}) {
  const start = event ? formOfEvent(event) : blankForm(day);
  const [form, setForm] = useState<EventForm>(start);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (visible) setForm(event ? formOfEvent(event) : blankForm(day));
    // A fresh form each time it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const set = (field: "title" | "place" | "note") => (value: string) => setForm(prev => ({ ...prev, [field]: value }));
  const dirty = JSON.stringify(form) !== JSON.stringify(start);

  const save = async () => {
    if (busy) return;
    const built = buildEvent(form, event?.id || newEventId(Date.now(), Math.random()), event?.createdAt || Date.now());
    if ("error" in built) {
      Alert.alert("Almost", built.error);
      return;
    }
    setBusy(true);
    try {
      await saveOwnerEvent(built);
      tapSuccess();
      onClose();
    } catch (e) {
      console.warn("save owner event failed:", e);
      Alert.alert("Couldn't save", "Nothing changed. Check your signal and try again.");
    }
    setBusy(false);
  };

  const remove = () => {
    if (!event) return;
    Alert.alert(`Delete "${event.title}"?`, "It comes off your calendar.", [
      { text: "Keep", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await deleteOwnerEvent(event.id);
            onClose();
          } catch (e) {
            console.warn("delete owner event failed:", e);
            Alert.alert("Couldn't delete", "It's still on the calendar. Check your signal and try again.");
          }
          setBusy(false);
        },
      },
    ]);
  };

  return (
    <SheetModal visible={visible} title={event ? "Edit event" : "Add to your calendar"} onClose={onClose} dirty={dirty}>
      <Text style={styles.hint}>For meetings and anything else that isn&apos;t a cleaning. Only you see these; the crew doesn&apos;t.</Text>
      <FormInput label="What" placeholder="e.g. Meet the owner · walkthrough" value={form.title} onChangeText={set("title")} autoCapitalize="sentences" />
      <FormInput label="Where (optional)" placeholder="Street address or place" value={form.place} onChangeText={set("place")} autoCapitalize="words" />
      <DatePickerField label="Day" value={form.dateKey} onChange={key => setForm(prev => ({ ...prev, dateKey: key }))} />
      <TimeChips label="Time" value={form.time} onChange={t => setForm(prev => ({ ...prev, time: t }))} choices={EVENT_TIMES} fold />
      <FormInput label="Notes (optional)" placeholder="Who you're meeting, their number, what to bring" value={form.note} onChangeText={set("note")} multiline />
      <BrandButton label={busy ? "Saving…" : event ? "Save" : "Add to calendar"} icon="checkmark" onPress={save} disabled={busy || (!!event && !dirty)} />
      {event ? (
        <TouchableOpacity style={styles.deleteLink} onPress={remove} disabled={busy} hitSlop={6} accessibilityRole="button">
          <Ionicons name="trash-outline" size={15} color={colors.danger} />
          <Text style={styles.deleteText}>Delete this event</Text>
        </TouchableOpacity>
      ) : null}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 12.5, color: colors.muted, marginBottom: 12 },
  deleteLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, marginTop: 6 },
  deleteText: { fontSize: 13.5, fontWeight: "600", color: colors.danger },
});
