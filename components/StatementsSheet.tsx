import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Alert, Share, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { OWNER_PHONE_LABEL } from "../business";
import type { HouseJobs, MoneyJob } from "../money";
import { formatDollars } from "../payroll";
import { monthName, statementsFor, statementText, type Statement } from "../statements";
import { colors, radius } from "../theme";
import { formatShortDate } from "../turnover";
import { tapSelect, tapSuccess } from "./haptics";
import { BrandButton, SheetModal } from "./ui";

const BUSINESS = { name: "Handyman Cleaners", phone: OWNER_PHONE_LABEL };

// "2026-11" and the two months before it.
function recentMonths(today: string): string[] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return [0, 1, 2].map(back => {
    const d = new Date(y, m - 1 - back, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

// A statement for each host who pays us directly, to send them as a message.
export function StatementsSheet({ visible, groups, today, onClose }: {
  visible: boolean;
  groups: HouseJobs<MoneyJob & { id: string }>[];
  today: string;
  onClose: () => void;
}) {
  const months = recentMonths(today);
  const [month, setMonth] = useState(months[0]);
  const statements = statementsFor(groups, month);
  const billed = groups.some(g => !!g.house?.billedFrom);

  const share = async (st: Statement) => {
    try {
      await Share.share({ message: statementText(st, month, BUSINESS) });
    } catch (e) {
      console.warn("share statement failed:", e);
      Alert.alert("Couldn't open sharing", "Use Copy instead and paste it into a text or email.");
    }
  };
  const copy = async (st: Statement) => {
    try {
      await Clipboard.setStringAsync(statementText(st, month, BUSINESS));
      tapSuccess();
      Alert.alert("Copied", `${st.label}'s statement is copied. Paste it into a text or email.`);
    } catch (e) {
      console.warn("copy statement failed:", e);
      Alert.alert("Couldn't copy", "Try Share instead.");
    }
  };

  return (
    <SheetModal visible={visible} title="Statements" onClose={onClose}>
      <View style={styles.monthRow}>
        {months.map(m => (
          <TouchableOpacity
            key={m}
            style={[styles.monthChip, month === m && styles.monthChipOn]}
            onPress={() => { tapSelect(); setMonth(m); }}
            accessibilityRole="radio"
            accessibilityState={{ selected: month === m }}
          >
            <Text style={[styles.monthText, month === m && styles.monthTextOn]}>{monthName(m).split(" ")[0]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {!billed ? (
        <Text style={styles.empty}>
          No house is billed directly yet. Open a house and turn on &quot;Host pays us directly&quot; to make statements for its host.
        </Text>
      ) : statements.length === 0 ? (
        <Text style={styles.empty}>Nothing to bill for {monthName(month)}: no finished cleanings and nothing owed from before.</Text>
      ) : (
        statements.map(st => (
          <View key={st.key} style={styles.card}>
            <Text style={styles.title}>{st.label}</Text>
            <Text style={styles.summary}>
              {st.lines.length} cleaning{st.lines.length === 1 ? "" : "s"} · {formatDollars(st.total)}
              {st.owed ? ` · ${formatDollars(st.owed)} owed` : st.total ? " · all paid" : ""}
              {st.earlierOwed ? ` · ${formatDollars(st.earlierOwed)} from before` : ""}
            </Text>
            {st.lines.map(l => (
              <Text key={l.jobId} style={styles.line} numberOfLines={1}>
                {formatShortDate(l.dateKey)} · {st.houses.length > 1 ? `${l.house} · ` : ""}
                {l.price === null ? "no price" : formatDollars(l.price)}
                {l.price !== null && l.paid ? " · paid" : ""}
              </Text>
            ))}
            {st.unpriced ? <Text style={styles.warn}>{st.unpriced} without a price: set it on the cleaning or the house.</Text> : null}
            <View style={styles.actions}>
              <BrandButton label="Share" icon="share-outline" compact onPress={() => share(st)} style={{ flex: 1 }} />
              <BrandButton label="Copy" icon="copy-outline" variant="outline" compact onPress={() => copy(st)} style={{ flex: 1 }} />
            </View>
          </View>
        ))
      )}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  monthRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  monthChip: {
    paddingHorizontal: 14, minHeight: 38, justifyContent: "center", borderRadius: radius.pill,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
  },
  monthChipOn: { backgroundColor: colors.dark, borderColor: colors.dark },
  monthText: { fontSize: 13.5, fontWeight: "600", color: colors.muted },
  monthTextOn: { color: colors.white },
  empty: { fontSize: 14, color: colors.muted, lineHeight: 20, marginBottom: 12 },
  card: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 14, marginBottom: 12, gap: 4 },
  title: { fontSize: 16, fontWeight: "700", color: colors.ink },
  summary: { fontSize: 13, fontWeight: "600", color: colors.tealDark, marginBottom: 4 },
  line: { fontSize: 13, color: colors.ink },
  warn: { fontSize: 12.5, fontWeight: "600", color: colors.goldDark, marginTop: 2 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
});
