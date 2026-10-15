import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { roomMinutes, roomSections, type AddableRoom, type ChecklistItem, type RoomSection } from "../checklist";
import { formatClockTime } from "../payroll";
import { colors, radius } from "../theme";
import { tapSelect } from "./haptics";
import { ChecklistRow, ProgressBar } from "./ui";

const firstName = (name: string | null | undefined) => (name ? name.split(" ")[0] : null);

// The checklist as rooms. A room opens to its steps and the tips for them,
// one room at a time, and finishing the open room moves on to the next
// unfinished one. The owner sees the same list live: when each room was
// finished, by whom, and how long it took.
export function RoomChecklist({ items, canWork, closed, onToggle, roomsToAdd, onAddRoom, onRemoveRoom }: {
  items: ChecklistItem[];
  canWork: boolean;
  // The job is finished, so anything unticked was skipped.
  closed?: boolean;
  onToggle: (index: number) => void;
  // Kinds of room that can be added to this cleaning. Leave out
  // onAddRoom to hide adding altogether.
  roomsToAdd?: AddableRoom[];
  onAddRoom?: (base: string) => void;
  onRemoveRoom?: (headingIndex: number) => void;
}) {
  const [adding, setAdding] = useState(false);
  const rooms = useMemo(() => roomSections(items), [items]);
  const firstUnfinished = rooms.find(r => !r.complete)?.key ?? null;
  // undefined = nobody has picked a room yet, so follow the work. A key that
  // no longer exists (the list was rebuilt) falls back the same way.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const openKey = picked === null ? null : picked !== undefined && rooms.some(r => r.key === picked) ? picked : firstUnfinished;

  const wasComplete = useRef<Map<string, boolean> | null>(null);
  useEffect(() => {
    const before = wasComplete.current;
    wasComplete.current = new Map(rooms.map(r => [r.key, r.complete]));
    const open = rooms.find(r => r.key === openKey);
    if (before && open && open.complete && before.get(open.key) === false) {
      setPicked(rooms.find(r => !r.complete)?.key ?? null);
    }
  }, [rooms, openKey]);

  if (rooms.length === 0) {
    return <Text style={styles.empty}>No checklist for this job yet.</Text>;
  }

  return (
    <View style={styles.list}>
      {rooms.map(room => (
        <Room
          key={room.key}
          room={room}
          expanded={room.key === openKey}
          canWork={canWork}
          closed={closed === true}
          onHeaderPress={() => {
            tapSelect();
            setPicked(room.key === openKey ? null : room.key);
          }}
          onToggle={onToggle}
          onRemove={onRemoveRoom && room.added && room.done === 0 && room.headingIndex !== null
            ? () => onRemoveRoom(room.headingIndex as number)
            : undefined}
        />
      ))}
      {onAddRoom && roomsToAdd && roomsToAdd.length > 0 ? (
        adding ? (
          <View style={styles.addPanel}>
            <Text style={styles.addTitle}>Add a room to this cleaning</Text>
            <Text style={styles.addHint}>For a room this house&apos;s list is missing. Only this cleaning changes.</Text>
            {roomsToAdd.map(r => (
              <TouchableOpacity
                key={r.base}
                style={styles.addOption}
                onPress={() => { tapSelect(); setAdding(false); onAddRoom(r.base); }}
                accessibilityRole="button"
                accessibilityLabel={`Add a ${r.base}, ${r.steps.length} steps`}
              >
                <Ionicons name="add-circle" size={20} color={colors.teal} />
                <Text style={styles.addOptionText}>{r.base}</Text>
                <Text style={styles.addOptionMeta}>{r.steps.length} steps</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.addCancel} onPress={() => setAdding(false)} hitSlop={6}>
              <Text style={styles.addCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.addButton} onPress={() => { tapSelect(); setAdding(true); }} accessibilityRole="button">
            <Ionicons name="add" size={18} color={colors.tealDark} />
            <Text style={styles.addButtonText}>Add a room</Text>
          </TouchableOpacity>
        )
      ) : null}
    </View>
  );
}

function roomStatus(room: RoomSection, closed: boolean): { text: string; tone: "done" | "live" | "idle" | "missed" } {
  if (room.complete) {
    const parts = [
      room.lastAt ? `Done ${formatClockTime(room.lastAt)}` : "Done",
      firstName(room.lastBy),
      roomMinutes(room) ? `${roomMinutes(room)} min` : null,
    ];
    return { text: parts.filter(Boolean).join(" · "), tone: "done" };
  }
  const left = room.total - room.done;
  if (closed) return { text: `${left} not done`, tone: "missed" };
  if (room.done > 0) {
    return { text: `${room.done} of ${room.total}${room.lastAt ? ` · last ${formatClockTime(room.lastAt)}` : ""}`, tone: "live" };
  }
  const added = room.added ? ` · added${room.addedBy ? ` by ${firstName(room.addedBy)}` : ""}` : "";
  return { text: `${room.total} step${room.total === 1 ? "" : "s"}${added}`, tone: "idle" };
}

const STATUS_ICON = {
  done: { name: "checkmark-circle", color: colors.teal },
  live: { name: "radio-button-on", color: colors.teal },
  idle: { name: "ellipse-outline", color: colors.faint },
  missed: { name: "alert-circle", color: colors.danger },
} as const;

function Room({ room, expanded, canWork, closed, onHeaderPress, onToggle, onRemove }: {
  room: RoomSection;
  expanded: boolean;
  canWork: boolean;
  closed: boolean;
  onHeaderPress: () => void;
  onToggle: (index: number) => void;
  onRemove?: () => void;
}) {
  const status = roomStatus(room, closed);
  const icon = STATUS_ICON[status.tone];
  return (
    <View style={[styles.room, room.complete && styles.roomDone, expanded && styles.roomOpen]}>
      <TouchableOpacity
        style={styles.header}
        onPress={onHeaderPress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${room.title}, ${room.done} of ${room.total} done. ${status.text}`}
      >
        <Ionicons name={icon.name} size={24} color={icon.color} />
        <View style={styles.headerText}>
          <Text style={styles.title}>{room.title}</Text>
          <Text style={[styles.status, status.tone === "done" && styles.statusDone, status.tone === "missed" && styles.statusMissed]}>
            {status.text}
          </Text>
        </View>
        <Text style={styles.count}>{room.done}/{room.total}</Text>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
      </TouchableOpacity>
      {status.tone === "live" && !expanded ? (
        <View style={styles.barWrap}><ProgressBar value={room.done / room.total} /></View>
      ) : null}
      {expanded ? (
        <View style={styles.body}>
          {room.note ? (
            <View style={styles.note}>
              <Ionicons name="bulb-outline" size={16} color={colors.tealDark} />
              <Text style={styles.noteText}>{room.note}</Text>
            </View>
          ) : null}
          {room.steps.map(({ item, index }) => (
            <ChecklistRow
              key={index}
              text={item.text}
              done={item.done}
              note={item.note}
              missed={closed && !item.done}
              meta={item.done && item.doneAt ? [formatClockTime(item.doneAt), firstName(item.doneBy)].filter(Boolean).join(" · ") : undefined}
              onPress={canWork && !closed ? () => onToggle(index) : undefined}
            />
          ))}
          {onRemove ? (
            <TouchableOpacity style={styles.removeRow} onPress={onRemove} hitSlop={6} accessibilityRole="button">
              <Ionicons name="trash-outline" size={15} color={colors.danger} />
              <Text style={styles.removeText}>Remove this room</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8, marginTop: 10 },
  empty: { fontSize: 13.5, color: colors.muted, marginTop: 10 },
  room: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.card, overflow: "hidden" },
  roomDone: { backgroundColor: colors.tealFaint, borderColor: colors.tealSoft },
  roomOpen: { borderColor: colors.teal },
  header: { flexDirection: "row", alignItems: "center", gap: 11, minHeight: 58, paddingHorizontal: 12, paddingVertical: 9 },
  headerText: { flex: 1 },
  title: { fontSize: 15.5, fontWeight: "700", color: colors.ink },
  status: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  statusDone: { color: colors.tealDark, fontWeight: "600" },
  statusMissed: { color: colors.danger, fontWeight: "700" },
  count: { fontSize: 13, fontWeight: "700", color: colors.tealDark, fontVariant: ["tabular-nums"] },
  barWrap: { paddingHorizontal: 12, marginTop: -8 },
  body: { paddingHorizontal: 12, paddingBottom: 4, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.card },
  note: {
    flexDirection: "row", gap: 8, alignItems: "flex-start", backgroundColor: colors.tealFaint,
    borderRadius: radius.sm, padding: 10, marginTop: 10, marginBottom: 2,
  },
  noteText: { flex: 1, fontSize: 13.5, color: colors.ink, lineHeight: 19 },
  removeRow: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, alignSelf: "flex-start" },
  removeText: { fontSize: 13.5, fontWeight: "600", color: colors.danger },
  addButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 48,
    borderWidth: 1, borderStyle: "dashed", borderColor: colors.teal, borderRadius: radius.md,
  },
  addButtonText: { fontSize: 14.5, fontWeight: "700", color: colors.tealDark },
  addPanel: { borderWidth: 1, borderColor: colors.teal, borderRadius: radius.md, padding: 12, backgroundColor: colors.card },
  addTitle: { fontSize: 15, fontWeight: "700", color: colors.ink },
  addHint: { fontSize: 12.5, color: colors.muted, marginTop: 2, marginBottom: 6 },
  addOption: {
    flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48,
    borderBottomWidth: 1, borderBottomColor: colors.bg,
  },
  addOptionText: { flex: 1, fontSize: 15, fontWeight: "600", color: colors.ink },
  addOptionMeta: { fontSize: 12.5, color: colors.muted },
  addCancel: { alignItems: "center", justifyContent: "center", minHeight: 44 },
  addCancelText: { fontSize: 14, fontWeight: "600", color: colors.muted },
});
