import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { canEditDate } from "../jobTime";
import { findProperty, type Property } from "../properties";
import { repeatLabel, REPEATS, type Repeat, type Series } from "../recurring";
import { colors, radius } from "../theme";
import { JOB_TYPES, type Job } from "../types";
import { tapSelect } from "./haptics";
import { BrandButton, FormInput, SheetModal } from "./ui";

export type JobDetails = {
  type: string;
  sameDayTurnover: boolean;
  property: string | null;
  address: string;
  notes: string | null;
  // Set to start repeating this cleaning from its day; null leaves it alone.
  repeat: Repeat | null;
};

type Form = { type: string; sameDay: boolean; house: Property | null; address: string; notes: string; repeat: Repeat | null };

function formOf(job: Job, properties: Property[]): Form {
  return {
    type: job.type || JOB_TYPES[0],
    sameDay: job.sameDayTurnover === true,
    house: findProperty(properties, job),
    address: job.address || "",
    notes: job.notes || "",
    repeat: null,
  };
}

// The owner fixes what a cleaning was created with: its kind, the same-day
// flag, which house and address, and notes for the crew. A cleaning a sync
// keeps in step with Airbnb or Turno keeps its house, address and same-day
// flag from there; changing them here would be undone on the next sync.
export function EditJobSheet({ visible, job, properties, series, busy, onClose, onSave, onStopRepeat }: {
  visible: boolean;
  job: Job;
  properties: Property[];
  // The repeat this cleaning belongs to, if any.
  series: Series | null;
  busy: boolean;
  onClose: () => void;
  onSave: (details: JobDetails) => void;
  onStopRepeat: () => void;
}) {
  const [form, setForm] = useState<Form>(() => formOf(job, properties));
  useEffect(() => {
    if (visible) setForm(formOf(job, properties));
    // A fresh form each time it opens; edits from elsewhere while it's open don't clobber typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const synced = !canEditDate(job.source);
  const types = JOB_TYPES.includes(form.type) ? JOB_TYPES : [form.type, ...JOB_TYPES];
  const start = formOf(job, properties);
  const dirty = form.type !== start.type || form.sameDay !== start.sameDay || form.house?.name !== start.house?.name ||
    form.address !== start.address || form.notes !== start.notes || form.repeat !== null;

  const pickHouse = (house: Property | null) => {
    tapSelect();
    setForm(prev => ({ ...prev, house, address: house ? house.address : prev.address }));
  };

  const save = () => {
    const address = form.address.trim() || job.address;
    onSave({
      type: form.type,
      sameDayTurnover: form.sameDay,
      property: form.house ? form.house.name : synced ? job.property || null : null,
      address,
      notes: form.notes.trim() || null,
      repeat: form.repeat,
    });
  };

  return (
    <SheetModal visible={visible} title="Edit details" onClose={onClose} dirty={dirty}>
      <Text style={styles.label}>Kind of cleaning</Text>
      <View style={styles.grid}>
        {types.map(t => (
          <Chip key={t} text={t} on={form.type === t} onPress={() => { tapSelect(); setForm(prev => ({ ...prev, type: t })); }} />
        ))}
      </View>

      <TouchableOpacity
        style={[styles.toggleRow, form.sameDay && styles.toggleRowOn, synced && { opacity: 0.55 }]}
        onPress={() => { if (synced) return; tapSelect(); setForm(prev => ({ ...prev, sameDay: !prev.sameDay })); }}
        activeOpacity={synced ? 1 : 0.7}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: form.sameDay, disabled: synced }}
      >
        <Ionicons name={form.sameDay ? "checkbox" : "square-outline"} size={24} color={form.sameDay ? colors.goldDark : colors.faint} />
        <View style={{ flex: 1 }}>
          <Text style={styles.toggleText}>Same-day turnover</Text>
          <Text style={styles.toggleSub}>{synced ? "Follows the booking calendar" : "New guests arrive the same day"}</Text>
        </View>
      </TouchableOpacity>

      {synced ? (
        <Text style={styles.hint}>This cleaning comes from a booking calendar, so its house and address follow the booking.</Text>
      ) : (
        <>
          <Text style={styles.label}>House</Text>
          <View style={styles.grid}>
            {properties.map(p => (
              <Chip key={p.name} text={p.short || p.name} on={form.house?.name === p.name} onPress={() => pickHouse(p)} />
            ))}
            <Chip text="Not a listed house" on={!form.house} onPress={() => pickHouse(null)} />
          </View>
          <FormInput label="Address" placeholder="Street, city, ZIP" value={form.address} onChangeText={t => setForm(prev => ({ ...prev, address: t }))} autoCapitalize="words" />
        </>
      )}

      {series ? (
        <View style={styles.repeatRow}>
          <Ionicons name="repeat" size={18} color={colors.tealDark} />
          <Text style={styles.repeatText}>{repeatLabel(series.every)}{series.until ? ` · stopped after ${series.until}` : ""}</Text>
          {!series.until ? (
            <TouchableOpacity onPress={onStopRepeat} hitSlop={8} accessibilityRole="button">
              <Text style={styles.stopText}>Stop repeating</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : !synced ? (
        <>
          <Text style={styles.label}>Repeats</Text>
          <View style={styles.grid}>
            <Chip text="Doesn't repeat" on={form.repeat === null} onPress={() => { tapSelect(); setForm(prev => ({ ...prev, repeat: null })); }} />
            {REPEATS.map(r => (
              <Chip key={r.value} text={r.label} on={form.repeat === r.value} onPress={() => { tapSelect(); setForm(prev => ({ ...prev, repeat: r.value })); }} />
            ))}
          </View>
        </>
      ) : null}

      <FormInput
        label="Notes for the crew (optional)"
        placeholder="e.g. Owner's dog is home · extra towels in the garage"
        value={form.notes}
        onChangeText={t => setForm(prev => ({ ...prev, notes: t }))}
        multiline
      />
      <BrandButton label={busy ? "Saving…" : "Save"} icon="checkmark" onPress={save} disabled={busy || !dirty} />
    </SheetModal>
  );
}

function Chip({ text, on, onPress }: { text: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.chip, on && styles.chipOn]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{text}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: "600", color: colors.muted, marginBottom: 8 },
  hint: { fontSize: 13, color: colors.muted, marginBottom: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1.5,
    borderColor: colors.line, backgroundColor: colors.card, minHeight: 40, justifyContent: "center", maxWidth: "100%",
  },
  chipOn: { backgroundColor: colors.tealDark, borderColor: colors.tealDark },
  chipText: { fontSize: 13.5, fontWeight: "600", color: colors.ink },
  chipTextOn: { color: colors.white },
  toggleRow: {
    flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card, marginBottom: 14,
  },
  toggleRowOn: { borderColor: colors.gold, backgroundColor: colors.goldSoft },
  toggleText: { fontSize: 15, fontWeight: "600", color: colors.ink },
  toggleSub: { fontSize: 12.5, color: colors.muted, marginTop: 1 },
  repeatRow: {
    flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: radius.md,
    backgroundColor: colors.tealSoft, marginBottom: 14,
  },
  repeatText: { flex: 1, fontSize: 14.5, fontWeight: "600", color: colors.ink },
  stopText: { fontSize: 14, fontWeight: "700", color: colors.danger },
});
