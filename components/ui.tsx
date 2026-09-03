import { Ionicons } from "@expo/vector-icons";
import { ReactNode, useEffect, useState } from "react";
import { Alert, AlertButton, Dimensions, Image, KeyboardAvoidingView, KeyboardTypeOptions, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, ViewStyle } from "react-native";
import { Calendar } from "react-native-calendars";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatElapsed } from "../payroll";
import { cleanerPalette, colors, initialsOf, radius, shadow, tint, type } from "../theme";
import { formatDayHeading, todayKey } from "../turnover";

// iOS drops an Alert presented while a Modal is still dismissing. Use this
// after closing a sheet.
export function alertSoon(title: string, message?: string, buttons?: AlertButton[]) {
  setTimeout(() => Alert.alert(title, message, buttons), 450);
}

export function FormInput({ label, value, onChangeText, placeholder, keyboardType, autoCapitalize, secure, multiline, autoFocus }: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  secure?: boolean;
  multiline?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMultiline]}
        multiline={multiline}
        textAlignVertical={multiline ? "top" : undefined}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        secureTextEntry={secure}
        autoFocus={autoFocus}
        // "oneTimeCode" stops iOS from covering PIN fields with its
        // Strong Password autofill overlay, which blocks manual typing.
        textContentType={secure ? "oneTimeCode" : undefined}
        autoCorrect={false}
      />
    </View>
  );
}

// Date field that opens a month grid in a sheet. Value is a "YYYY-MM-DD" key.
export function DatePickerField({ label, value, onChange }: {
  label: string;
  value: string | null;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TouchableOpacity style={[styles.input, styles.dateField]} onPress={() => setOpen(true)} activeOpacity={0.7}>
        <Ionicons name="calendar-clear-outline" size={17} color={value ? colors.tealDark : colors.faint} />
        <Text style={[styles.dateFieldText, !value && { color: colors.faint }]}>
          {value ? formatDayHeading(value) : "Pick a date"}
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.faint} />
      </TouchableOpacity>
      <SheetModal visible={open} title={label} onClose={() => setOpen(false)}>
        <View style={styles.datePickerWrap}>
          <Calendar
            current={value || todayKey()}
            minDate={undefined}
            markedDates={value ? { [value]: { selected: true, selectedColor: colors.teal } } : {}}
            onDayPress={(day: { dateString: string }) => { onChange(day.dateString); setOpen(false); }}
            theme={calendarTheme}
          />
        </View>
        <BrandButton label="Today" icon="today-outline" variant="outline" onPress={() => { onChange(todayKey()); setOpen(false); }} style={{ marginTop: 12 }} />
      </SheetModal>
    </View>
  );
}

export const calendarTheme = {
  backgroundColor: colors.card,
  calendarBackground: colors.card,
  todayTextColor: colors.teal,
  selectedDayBackgroundColor: colors.teal,
  selectedDayTextColor: colors.white,
  dotColor: colors.teal,
  arrowColor: colors.teal,
  textDayFontSize: 14,
  textMonthFontSize: 15,
  textMonthFontWeight: "700" as const,
  textDayHeaderFontSize: 11,
  monthTextColor: colors.ink,
  dayTextColor: colors.ink,
  textDisabledColor: colors.line,
  textSectionTitleColor: colors.faint,
};

export function ScreenHeader({ title, subtitle, right, onBack, backLabel }: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.headerWrap, { paddingTop: Math.max(insets.top, 20) + 8 }]}>
      <View style={{ flex: 1 }}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} style={styles.backRow} hitSlop={10}>
            <Ionicons name="chevron-back" size={20} color={colors.tealDark} />
            <Text style={styles.backText}>{backLabel || "Back"}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={type.wordmark}>TurnTrack</Text>
        )}
        <Text style={[type.title, { marginTop: 2 }]} numberOfLines={2}>{title}</Text>
        {subtitle ? <Text style={[type.subtitle, { marginTop: 3 }]}>{subtitle}</Text> : null}
      </View>
      {right ? <View style={[styles.headerRight, onBack && { marginTop: 0 }]}>{right}</View> : null}
    </View>
  );
}

export function IconButton({ icon, onPress, tint: tintColor, badge }: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  tint?: string;
  badge?: boolean;
}) {
  return (
    <TouchableOpacity style={styles.iconBtn} onPress={onPress} hitSlop={6}>
      <Ionicons name={icon} size={21} color={tintColor || colors.tealDark} />
      {badge ? <View style={styles.iconBadge} /> : null}
    </TouchableOpacity>
  );
}

export function Card({ children, style, tone, accent, onPress }: {
  children: ReactNode;
  style?: ViewStyle | ViewStyle[];
  tone?: "default" | "gold" | "danger";
  // Left stripe color, used for the assigned cleaner.
  accent?: string;
  onPress?: () => void;
}) {
  const body = (
    <View
      style={[
        styles.card,
        tone === "gold" && styles.cardGold,
        tone === "danger" && styles.cardDanger,
        accent ? { borderLeftWidth: 4, borderLeftColor: accent } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
  if (!onPress) return body;
  return <TouchableOpacity onPress={onPress} activeOpacity={0.75}>{body}</TouchableOpacity>;
}

export function Pill({ label, tone = "teal", icon, color }: {
  label: string;
  tone?: "teal" | "gold" | "danger" | "neutral" | "solid" | "custom";
  icon?: keyof typeof Ionicons.glyphMap;
  color?: string;
}) {
  const palette = {
    teal: { bg: colors.tealSoft, fg: colors.tealDark },
    gold: { bg: colors.goldSoft, fg: colors.goldDark },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
    neutral: { bg: colors.bg, fg: colors.muted },
    solid: { bg: colors.teal, fg: colors.white },
    custom: { bg: tint(color || colors.teal, 0.16), fg: color || colors.tealDark },
  }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }]}>
      {icon ? <Ionicons name={icon} size={12} color={palette.fg} style={{ marginRight: 4 }} /> : null}
      <Text style={[styles.pillText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

export function SectionHeader({ title, count, tone }: { title: string; count?: number; tone?: "default" | "warn" | "live" }) {
  const color = tone === "warn" ? colors.goldDark : tone === "live" ? colors.teal : colors.faint;
  return (
    <View style={styles.sectionHeader}>
      {tone === "live" ? <View style={styles.liveDot} /> : null}
      <Text style={[type.section, { color }]}>{title}</Text>
      {typeof count === "number" ? <Text style={[styles.sectionCount, { color }]}>{count}</Text> : null}
    </View>
  );
}

export function Avatar({ name, size = 40, muted, photo, color }: {
  name: string;
  size?: number;
  muted?: boolean;
  photo?: string | null;
  color?: string;
}) {
  const bg = muted ? colors.bg : color ? tint(color, 0.18) : colors.tealSoft;
  const fg = muted ? colors.faint : color || colors.tealDark;
  if (photo) {
    return (
      <Image
        source={{ uri: photo }}
        style={{ width: size, height: size, borderRadius: size / 2, opacity: muted ? 0.55 : 1, borderWidth: color ? 2 : 0, borderColor: color }}
      />
    );
  }
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: bg }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.38, color: fg }]}>{initialsOf(name)}</Text>
    </View>
  );
}

// Who a job belongs to, colored consistently everywhere.
export function AssigneeRow({ name, color, photo, size = 22 }: {
  name?: string | null;
  color: string;
  photo?: string | null;
  size?: number;
}) {
  if (!name) {
    return (
      <View style={styles.assigneeRow}>
        <Ionicons name="person-add-outline" size={size - 4} color={colors.goldDark} />
        <Text style={styles.unassigned}>Unassigned</Text>
      </View>
    );
  }
  return (
    <View style={styles.assigneeRow}>
      <Avatar name={name} photo={photo} color={color} size={size} />
      <Text style={[styles.assignee, { color }]} numberOfLines={1}>{name}</Text>
    </View>
  );
}

export function BrandButton({ label, onPress, variant = "primary", icon, style, disabled, compact }: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "outline" | "ghost" | "danger" | "gold" | "dark";
  icon?: keyof typeof Ionicons.glyphMap;
  style?: ViewStyle | ViewStyle[];
  disabled?: boolean;
  compact?: boolean;
}) {
  const isSolid = variant === "primary" || variant === "danger" || variant === "gold" || variant === "dark";
  const bg = variant === "primary" ? colors.teal
    : variant === "danger" ? colors.danger
    : variant === "gold" ? colors.gold
    : variant === "dark" ? colors.dark
    : "transparent";
  const fg = isSolid ? colors.white : variant === "ghost" ? colors.muted : colors.tealDark;
  return (
    <TouchableOpacity
      style={[
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: bg },
        variant === "outline" && styles.buttonOutline,
        disabled && { opacity: 0.45 },
        style,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
    >
      {icon ? <Ionicons name={icon} size={compact ? 15 : 18} color={fg} style={{ marginRight: 7 }} /> : null}
      <Text style={[styles.buttonText, compact && { fontSize: 13.5 }, { color: fg }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// Sticky action bar pinned above the home indicator (Breezeway/Jobber pattern).
export function BottomBar({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 14) }, shadow.raised]}>
      {children}
    </View>
  );
}

export function Fab({ icon, onPress, label }: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  label?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <TouchableOpacity style={[styles.fab, { bottom: 16 + Math.max(insets.bottom - 8, 0) }, shadow.raised]} onPress={onPress} activeOpacity={0.85}>
      <Ionicons name={icon} size={22} color={colors.white} />
      {label ? <Text style={styles.fabLabel}>{label}</Text> : null}
    </TouchableOpacity>
  );
}

// Live "h:mm:ss" that re-renders only itself.
export function ElapsedTimer({ startedAt, style }: { startedAt: number; style?: any }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  return <Text style={[styles.timerText, style]}>{formatElapsed(startedAt, now)}</Text>;
}

export function SheetModal({ visible, title, onClose, children }: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.sheetOverlay}>
          <TouchableOpacity style={{ flex: 1 }} onPress={onClose} />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) + 8 }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetTitleRow}>
              <Text style={styles.sheetTitle}>{title}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={10} style={styles.sheetClose}>
                <Ionicons name="close" size={20} color={colors.muted} />
              </TouchableOpacity>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
              style={{ maxHeight: Dimensions.get("window").height * 0.72 }}
            >
              {children}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function EmptyState({ icon, title, body }: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}) {
  return (
    <Card style={styles.empty}>
      <View style={styles.emptyIconWrap}>
        <Ionicons name={icon} size={26} color={colors.teal} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </Card>
  );
}

export function ErrorState({ title, body }: { title: string; body: string }) {
  return (
    <Card tone="danger" style={styles.empty}>
      <View style={[styles.emptyIconWrap, { backgroundColor: colors.dangerSoft }]}>
        <Ionicons name="alert-circle" size={26} color={colors.danger} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.danger }]}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </Card>
  );
}

export function ColorDot({ color, size = 10, style }: { color: string; size?: number; style?: ViewStyle }) {
  return <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
}

export function ColorPicker({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={styles.swatchRow}>
        {cleanerPalette.map(hex => {
          const selected = hex === value;
          return (
            <TouchableOpacity
              key={hex}
              onPress={() => onChange(hex)}
              style={[styles.swatch, { backgroundColor: hex }, selected && styles.swatchSelected]}
              hitSlop={4}
            >
              {selected ? <Ionicons name="checkmark" size={16} color={colors.white} /> : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

// One tappable checklist line. 48pt tall so it's an easy target with gloves on.
export function ChecklistRow({ text, done, onPress, disabled }: {
  text: string;
  done: boolean;
  onPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity style={styles.checkRow} onPress={onPress} disabled={disabled || !onPress} activeOpacity={0.6}>
      <View style={[styles.checkCircle, done && styles.checkCircleActive]}>
        {done && <Ionicons name="checkmark" size={15} color={colors.white} />}
      </View>
      <Text style={[styles.checkItem, done && styles.checkItemDone]}>{text}</Text>
    </TouchableOpacity>
  );
}

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`, backgroundColor: color || colors.teal }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  inputLabel: { fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 6, letterSpacing: 0.3 },
  input: {
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, minHeight: 48,
    paddingHorizontal: 13, paddingVertical: 12, fontSize: 15.5, color: colors.ink, backgroundColor: colors.bg,
  },
  inputMultiline: { minHeight: 180, lineHeight: 21 },
  dateField: { flexDirection: "row", alignItems: "center", gap: 9 },
  dateFieldText: { flex: 1, fontSize: 15.5, color: colors.ink },
  datePickerWrap: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, overflow: "hidden" },
  swatchRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  swatch: {
    width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "transparent",
  },
  swatchSelected: { borderColor: colors.ink },
  headerWrap: { flexDirection: "row", alignItems: "flex-end", paddingBottom: 14 },
  headerRight: { flexDirection: "row", gap: 8, marginBottom: 2 },
  backRow: { flexDirection: "row", alignItems: "center", marginBottom: 6, alignSelf: "flex-start", marginLeft: -4 },
  backText: { fontSize: 15, fontWeight: "600", color: colors.tealDark },
  iconBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: colors.card,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: colors.line,
  },
  iconBadge: { position: "absolute", top: 9, right: 10, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.gold },
  card: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: colors.line, ...shadow.card,
  },
  cardGold: { borderColor: "#F0D9A6", backgroundColor: "#FFFDF8" },
  cardDanger: { borderColor: "#F3C8C8", backgroundColor: "#FDF7F7" },
  pill: {
    flexDirection: "row", alignItems: "center", alignSelf: "flex-start",
    borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4,
  },
  pillText: { fontSize: 11.5, fontWeight: "700" },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 6, marginBottom: 10, paddingHorizontal: 2 },
  sectionCount: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.teal },
  avatar: { alignItems: "center", justifyContent: "center" },
  avatarText: { fontWeight: "700" },
  assigneeRow: { flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 1 },
  assignee: { fontSize: 13.5, fontWeight: "700", flexShrink: 1 },
  unassigned: { fontSize: 13.5, fontWeight: "700", color: colors.goldDark },
  button: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    borderRadius: radius.md, minHeight: 50, paddingVertical: 13, paddingHorizontal: 16,
  },
  buttonCompact: { minHeight: 40, paddingVertical: 9, paddingHorizontal: 13 },
  buttonOutline: { borderWidth: 1.5, borderColor: colors.teal, backgroundColor: colors.card },
  buttonText: { fontSize: 15, fontWeight: "700" },
  bottomBar: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    backgroundColor: colors.card, paddingHorizontal: 20, paddingTop: 12,
    borderTopWidth: 1, borderTopColor: colors.line, gap: 10,
  },
  fab: {
    position: "absolute", right: 20, flexDirection: "row", alignItems: "center",
    backgroundColor: colors.teal, borderRadius: radius.pill, paddingHorizontal: 18, height: 54,
  },
  fabLabel: { color: colors.white, fontSize: 15, fontWeight: "700", marginLeft: 8 },
  timerText: { fontSize: 40, fontWeight: "800", color: colors.ink, letterSpacing: 1, fontVariant: ["tabular-nums"] },
  sheetOverlay: { flex: 1, backgroundColor: "rgba(30, 42, 50, 0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingHorizontal: 20, paddingTop: 10,
  },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: 12 },
  sheetTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  sheetTitle: { fontSize: 18, fontWeight: "700", color: colors.ink },
  sheetClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingVertical: 28 },
  emptyIconWrap: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: colors.tealSoft,
    alignItems: "center", justifyContent: "center", marginBottom: 12,
  },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: colors.ink, marginBottom: 6 },
  emptyBody: { fontSize: 13.5, color: colors.muted, textAlign: "center", lineHeight: 19, paddingHorizontal: 10 },
  checkRow: {
    flexDirection: "row", alignItems: "center", gap: 12, minHeight: 48, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.bg,
  },
  checkCircle: {
    width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: colors.line,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.card,
  },
  checkCircleActive: { backgroundColor: colors.teal, borderColor: colors.teal },
  checkItem: { flex: 1, fontSize: 15, color: colors.ink, lineHeight: 20 },
  checkItemDone: { color: colors.faint, textDecorationLine: "line-through" },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.bg, overflow: "hidden", marginTop: 10, marginBottom: 6 },
  progressFill: { height: 6, borderRadius: 3 },
});
