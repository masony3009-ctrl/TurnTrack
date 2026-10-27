import { Ionicons } from "@expo/vector-icons";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { OWNER_PHONE, OWNER_PHONE_LABEL } from "../business";
import { db } from "../firebase";
import { formatDuration, formatEntryDate, formatMoney, paymentsOf, weekStartMs, workedBetween } from "../payroll";
import { colors, radius, shadow } from "../theme";
import { Employee, TimeEntry } from "../types";
import { Card, EmptyState, ErrorState, ScreenHeader, SectionHeader } from "./ui";

const PAYMENTS_SHOWN = 10;

// A cleaner's own pay: what they're owed, this week and last, and what has
// been paid. Reads only their own time entries.
export function MyPay({ employee }: { employee: Employee }) {
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const firstName = employee.name.split(" ")[0];

  useEffect(() => {
    setEntries(null);
    return onSnapshot(
      query(collection(db, "timeEntries"), where("employeeId", "==", employee.id)),
      snap => {
        const loaded = snap.docs.map(d => ({ id: d.id, ...d.data() })) as TimeEntry[];
        loaded.sort((a, b) => b.endedAt - a.endedAt);
        setEntries(loaded);
        setLoadError(false);
      },
      error => {
        console.warn("my pay listener error:", error);
        setLoadError(true);
      }
    );
  }, [employee.id]);

  const all = useMemo(() => entries || [], [entries]);
  const unpaid = all.filter(e => !e.paid);
  const owed = Math.round(unpaid.reduce((sum, e) => sum + e.earned, 0) * 100) / 100;
  const owedMinutes = unpaid.reduce((sum, e) => sum + e.minutes, 0);
  const now = Date.now();
  const thisWeek = workedBetween(all, weekStartMs(now), weekStartMs(now) + 7 * 86400000);
  const lastWeek = workedBetween(all, weekStartMs(now, 1), weekStartMs(now));
  const payments = useMemo(() => paymentsOf(all), [all]);

  return (
    <View style={styles.container}>
      <ScreenHeader title="My pay" subtitle={`${firstName} · ${formatMoney(employee.hourlyRate)}/hr`} />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        <View style={[styles.hero, shadow.card]}>
          <Text style={styles.heroLabel}>OWED TO YOU</Text>
          {entries ? (
            <>
              <Text style={styles.heroAmount}>{formatMoney(owed)}</Text>
              <Text style={styles.heroSub}>
                {owed > 0 ? `${formatDuration(owedMinutes)} unpaid` : "All paid up"}
              </Text>
            </>
          ) : (
            <View style={styles.heroLoading}>
              <ActivityIndicator color={colors.white} />
              <Text style={styles.heroSub}>Loading your pay…</Text>
            </View>
          )}
        </View>

        {loadError ? (
          <ErrorState title="Couldn't load your pay" body="Check your signal. It updates on its own." />
        ) : null}

        {entries ? (
          <>
            <View style={styles.weekRow}>
              <WeekTile label="This week" minutes={thisWeek.minutes} earned={thisWeek.earned} count={thisWeek.count} />
              <WeekTile label="Last week" minutes={lastWeek.minutes} earned={lastWeek.earned} count={lastWeek.count} />
            </View>

            {unpaid.length > 0 ? (
              <>
                <SectionHeader title="Not paid yet" count={unpaid.length} />
                <Card>
                  {unpaid.map((entry, i) => (
                    <View key={entry.id} style={[styles.entryRow, i > 0 && styles.entryDivider]}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.entryTitle} numberOfLines={1}>{entry.jobAddress}</Text>
                        <Text style={styles.entryMeta}>{entry.jobDate} · {formatDuration(entry.minutes)}{entry.manual ? " · added by the owner" : ""}</Text>
                      </View>
                      <Text style={styles.entryAmount}>{formatMoney(entry.earned)}</Text>
                    </View>
                  ))}
                </Card>
              </>
            ) : null}

            <SectionHeader title="Payments" count={payments.length} />
            {payments.length === 0 ? (
              <EmptyState icon="wallet-outline" title="No payments yet" body="Payments show up here." />
            ) : (
              <Card>
                {payments.slice(0, PAYMENTS_SHOWN).map((p, i) => (
                  <View key={p.paidAt} style={[styles.entryRow, i > 0 && styles.entryDivider]}>
                    <Ionicons name="checkmark-circle" size={18} color={colors.teal} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.entryTitle}>{formatEntryDate(p.paidAt)}{p.method ? ` · ${p.method}` : ""}</Text>
                      <Text style={styles.entryMeta}>{p.count} cleaning{p.count === 1 ? "" : "s"}</Text>
                    </View>
                    <Text style={styles.entryAmount}>{formatMoney(p.amount)}</Text>
                  </View>
                ))}
              </Card>
            )}

            <TouchableOpacity style={styles.help} onPress={() => Linking.openURL(`tel:${OWNER_PHONE}`)} accessibilityRole="button">
              <Ionicons name="call-outline" size={15} color={colors.tealDark} />
              <Text style={styles.helpText}>Questions? Call {OWNER_PHONE_LABEL}</Text>
            </TouchableOpacity>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function WeekTile({ label, minutes, earned, count }: { label: string; minutes: number; earned: number; count: number }) {
  return (
    <View style={styles.weekTile} accessible accessibilityLabel={`${label}: ${formatDuration(minutes)}, ${formatMoney(earned)}`}>
      <Text style={styles.weekLabel}>{label}</Text>
      <Text style={styles.weekAmount}>{formatMoney(earned)}</Text>
      <Text style={styles.weekSub}>{count ? `${formatDuration(minutes)} · ${count} cleaning${count === 1 ? "" : "s"}` : "No time logged"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20 },
  hero: { backgroundColor: colors.dark, borderRadius: radius.lg, padding: 20, marginBottom: 12 },
  heroLabel: { fontSize: 11, fontWeight: "700", color: "#9FB4BE", letterSpacing: 1.5 },
  heroAmount: { fontSize: 34, fontWeight: "700", color: colors.white, marginTop: 4 },
  heroSub: { fontSize: 13, color: "#B9CAD2", marginTop: 4 },
  heroLoading: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  weekRow: { flexDirection: "row", gap: 10, marginBottom: 6 },
  weekTile: { flex: 1, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: 14 },
  weekLabel: { fontSize: 12, fontWeight: "600", color: colors.muted },
  weekAmount: { fontSize: 20, fontWeight: "800", color: colors.ink, marginTop: 3 },
  weekSub: { fontSize: 12, color: colors.muted, marginTop: 2 },
  entryRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, minHeight: 48 },
  entryDivider: { borderTopWidth: 1, borderTopColor: colors.bg },
  entryTitle: { fontSize: 14, fontWeight: "600", color: colors.ink },
  entryMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  entryAmount: { fontSize: 15, fontWeight: "700", color: colors.tealDark },
  help: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, marginTop: 8 },
  helpText: { fontSize: 13.5, fontWeight: "600", color: colors.tealDark },
});
