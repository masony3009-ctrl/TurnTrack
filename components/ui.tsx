import { Ionicons } from "@expo/vector-icons";
import { ReactNode } from "react";
import { Dimensions, Image, KeyboardAvoidingView, KeyboardTypeOptions, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, ViewStyle } from "react-native";
import { colors, initialsOf, radius, shadow, type } from "../theme";

export function FormInput({ label, value, onChangeText, placeholder, keyboardType, autoCapitalize, secure }: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  secure?: boolean;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        secureTextEntry={secure}
        // "oneTimeCode" stops iOS from covering PIN fields with its
        // Strong Password autofill overlay, which blocks manual typing.
        textContentType={secure ? "oneTimeCode" : undefined}
        autoCorrect={false}
      />
    </View>
  );
}

export function ScreenHeader({ title, subtitle, right }: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <View style={styles.headerWrap}>
      <View style={{ flex: 1 }}>
        <Text style={type.wordmark}>TurnTrack</Text>
        <Text style={[type.title, { marginTop: 2 }]}>{title}</Text>
        {subtitle ? <Text style={[type.subtitle, { marginTop: 2 }]}>{subtitle}</Text> : null}
      </View>
      {right ? <View style={styles.headerRight}>{right}</View> : null}
    </View>
  );
}

export function IconButton({ icon, onPress, tint }: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  tint?: string;
}) {
  return (
    <TouchableOpacity style={styles.iconBtn} onPress={onPress} hitSlop={6}>
      <Ionicons name={icon} size={20} color={tint || colors.tealDark} />
    </TouchableOpacity>
  );
}

export function Card({ children, style, tone }: {
  children: ReactNode;
  style?: ViewStyle | ViewStyle[];
  tone?: "default" | "gold" | "danger";
}) {
  return (
    <View
      style={[
        styles.card,
        tone === "gold" && styles.cardGold,
        tone === "danger" && styles.cardDanger,
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Pill({ label, tone = "teal", icon }: {
  label: string;
  tone?: "teal" | "gold" | "danger" | "neutral" | "solid";
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const palette = {
    teal: { bg: colors.tealSoft, fg: colors.tealDark },
    gold: { bg: colors.goldSoft, fg: colors.goldDark },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
    neutral: { bg: colors.bg, fg: colors.muted },
    solid: { bg: colors.teal, fg: colors.white },
  }[tone];
  return (
    <View style={[styles.pill, { backgroundColor: palette.bg }]}>
      {icon ? <Ionicons name={icon} size={12} color={palette.fg} style={{ marginRight: 4 }} /> : null}
      <Text style={[styles.pillText, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

export function Avatar({ name, size = 40, muted, photo }: {
  name: string;
  size?: number;
  muted?: boolean;
  photo?: string | null;
}) {
  if (photo) {
    return (
      <Image
        source={{ uri: photo }}
        style={{ width: size, height: size, borderRadius: size / 2, opacity: muted ? 0.55 : 1 }}
      />
    );
  }
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: muted ? colors.bg : colors.tealSoft },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.38, color: muted ? colors.faint : colors.tealDark }]}>
        {initialsOf(name)}
      </Text>
    </View>
  );
}

export function BrandButton({ label, onPress, variant = "primary", icon, style }: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "outline" | "ghost" | "danger" | "gold";
  icon?: keyof typeof Ionicons.glyphMap;
  style?: ViewStyle | ViewStyle[];
}) {
  const isSolid = variant === "primary" || variant === "danger" || variant === "gold";
  const bg = variant === "primary" ? colors.teal : variant === "danger" ? colors.danger : variant === "gold" ? colors.gold : "transparent";
  const fg = isSolid ? colors.white : variant === "ghost" ? colors.muted : colors.tealDark;
  return (
    <TouchableOpacity
      style={[
        styles.button,
        { backgroundColor: bg },
        variant === "outline" && styles.buttonOutline,
        style,
      ]}
      onPress={onPress}
    >
      {icon ? <Ionicons name={icon} size={17} color={fg} style={{ marginRight: 7 }} /> : null}
      <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function Fab({ icon, onPress, label }: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  label?: string;
}) {
  return (
    <TouchableOpacity style={[styles.fab, shadow.raised]} onPress={onPress}>
      <Ionicons name={icon} size={22} color={colors.white} />
      {label ? <Text style={styles.fabLabel}>{label}</Text> : null}
    </TouchableOpacity>
  );
}

export function SheetModal({ visible, title, onClose, children }: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.sheetOverlay}>
          <TouchableOpacity style={{ flex: 1 }} onPress={onClose} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetTitleRow}>
              <Text style={styles.sheetTitle}>{title}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.faint} />
              </TouchableOpacity>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
              style={{ maxHeight: Dimensions.get("window").height * 0.7 }}
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

const styles = StyleSheet.create({
  inputLabel: { fontSize: 12, fontWeight: "600", color: colors.muted, marginBottom: 5, letterSpacing: 0.3 },
  input: {
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.md,
    paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, color: colors.ink, backgroundColor: colors.bg,
  },
  headerWrap: { flexDirection: "row", alignItems: "flex-start", paddingTop: 60, paddingBottom: 16 },
  headerRight: { flexDirection: "row", gap: 8, marginTop: 14 },
  iconBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.card,
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: colors.line,
  },
  card: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: colors.line, ...shadow.card,
  },
  cardGold: { borderColor: colors.gold, borderWidth: 1.5 },
  cardDanger: { borderColor: "#F3C8C8", backgroundColor: "#FDF7F7" },
  pill: {
    flexDirection: "row", alignItems: "center", alignSelf: "flex-start",
    borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4,
  },
  pillText: { fontSize: 11.5, fontWeight: "600" },
  avatar: { alignItems: "center", justifyContent: "center" },
  avatarText: { fontWeight: "700" },
  button: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    borderRadius: radius.md, paddingVertical: 13, paddingHorizontal: 16,
  },
  buttonOutline: { borderWidth: 1.5, borderColor: colors.teal, backgroundColor: colors.card },
  buttonText: { fontSize: 14.5, fontWeight: "600" },
  fab: {
    position: "absolute", right: 20, bottom: 24, flexDirection: "row", alignItems: "center",
    backgroundColor: colors.teal, borderRadius: radius.pill, paddingHorizontal: 18, height: 52,
  },
  fabLabel: { color: colors.white, fontSize: 15, fontWeight: "600", marginLeft: 8 },
  sheetOverlay: { flex: 1, backgroundColor: "rgba(30, 42, 50, 0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingHorizontal: 20, paddingBottom: 36, paddingTop: 10,
  },
  sheetHandle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.line, marginBottom: 12 },
  sheetTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  sheetTitle: { fontSize: 18, fontWeight: "700", color: colors.ink },
  empty: { alignItems: "center", paddingVertical: 28 },
  emptyIconWrap: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: colors.tealSoft,
    alignItems: "center", justifyContent: "center", marginBottom: 12,
  },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: colors.ink, marginBottom: 6 },
  emptyBody: { fontSize: 13.5, color: colors.muted, textAlign: "center", lineHeight: 19, paddingHorizontal: 10 },
});
