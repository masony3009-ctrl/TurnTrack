import { Ionicons } from "@expo/vector-icons";
import { arrayRemove, collection, deleteField, doc, FieldPath, onSnapshot, runTransaction, updateDoc, writeBatch } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { tapSelect, tapSuccess } from "../../components/haptics";
import { HouseSheet } from "../../components/HouseSheet";
import { useProfile } from "../../components/ProfileProvider";
import { BrandButton, Card, EmptyState, ErrorState, IconButton, Pill, ScreenHeader, SectionHeader } from "../../components/ui";
import { useProperties } from "../../components/useProperties";
import { useSupplies } from "../../components/useSupplies";
import { db } from "../../firebase";
import {
  deepCleanStatus, DEEP_CLEAN_EVERY, groupByHouse, hostOwed, houseMoney, OTHER_HOUSE, perCleaning, PERIOD_LABELS, periodRange, sumMoney,
  type DeepCleanStatus, type HouseMoney, type Period,
} from "../../money";
import { formatDuration, formatEntryDate, formatMoney } from "../../payroll";
import { houseKey, patchRegistry, type Property, type RegistryChanges } from "../../properties";
import { type SupplyReport } from "../../supplies";
import { colors, radius, shadow } from "../../theme";
import { formatShortDate, todayKey } from "../../turnover";
import { Job } from "../../types";

const PERIODS: Period[] = ["month", "lastMonth", "year", "all"];

type Row = {
  key: string;
  house: Property | null;
  label: string;
  // Finished and booked cleanings in the chosen period.
  money: HouseMoney;
  // Averages over every timed cleaning on record, steadier than one month's.
  per: ReturnType<typeof perCleaning>;
  deep: DeepCleanStatus | null;
  owed: { amount: number; jobs: Job[] };
  supplies: SupplyReport | null;
  // Every cleaning on record at the house.
  total: number;
};

function needsAttention(r: Row): boolean {
  if (!r.house) return false;
  return !!r.supplies || !!r.deep?.due || r.owed.amount > 0 || !r.house.doorCode || (!r.house.price && r.total > 0);
}

function deepLine(d: DeepCleanStatus): string {
  if (d.booked) return `Deep clean booked for ${formatShortDate(d.booked)}`;
  const n = `${d.since} cleaning${d.since === 1 ? "" : "s"}`;
  const base = d.lastDeep ? `${n} since the last deep clean (${formatShortDate(d.lastDeep)})` : `${n} and no deep clean on record`;
  return d.due ? `${base} · time to pitch one to the host` : base;
}

export default function HousesScreen() {
  const { state } = useProfile();
  const isOwner = state.status === "owner";
  const properties = useProperties();
  const supplies = useSupplies(isOwner);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("month");
  const [editing, setEditing] = useState<Property | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const today = todayKey();

  // Money and door codes are the owner's: cleaners' phones never load this.
  useEffect(() => {
    if (!isOwner) return;
    return onSnapshot(
      collection(db, "jobs"),
      snap => { setJobs(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Job[]); setLoadError(null); },
      error => setLoadError(error.message)
    );
  }, [isOwner]);

  const groups = useMemo(() => groupByHouse(jobs || [], properties), [jobs, properties]);
  const suppliesByKey = useMemo(() => new Map(supplies.map(s => [s.key, s])), [supplies]);
  const rows: Row[] = useMemo(() => {
    const range = periodRange(period, today);
    return [...groups.values()]
      .filter(g => g.house || g.jobs.length > 0)
      .map(g => ({
        key: g.key,
        house: g.house,
        label: g.house ? g.house.short || g.house.name : "Other addresses",
        money: houseMoney(g, range),
        per: perCleaning(houseMoney(g, null)),
        deep: g.house ? deepCleanStatus(g.jobs, today) : null,
        owed: hostOwed(g.jobs as Job[], g.house),
        supplies: suppliesByKey.get(g.key) || null,
        total: g.jobs.length,
      }))
      .sort((a, b) =>
        Number(a.key === OTHER_HOUSE) - Number(b.key === OTHER_HOUSE) ||
        b.money.revenue - a.money.revenue ||
        b.money.cleanings - a.money.cleanings ||
        b.total - a.total ||
        a.label.localeCompare(b.label)
      );
  }, [groups, period, today, suppliesByKey]);
  const totals = useMemo(() => sumMoney(rows.map(r => r.money)), [rows]);
  const attention = rows.filter(needsAttention).length;
  const houseCount = rows.filter(r => r.house).length;

  const saveHouse = async (name: string, changes: RegistryChanges) => {
    if (adding && properties.some(p => houseKey(p.name) === houseKey(name))) {
      Alert.alert("Already on the list", `There's already a house called ${name}. Tap it to edit it instead.`);
      return;
    }
    setSaving(true);
    try {
      // Read and write in one go so an edit never drops a house the scripts
      // added a moment ago, or fields only they know about.
      await runTransaction(db, async tx => {
        const ref = doc(db, "settings", "properties");
        const snap = await tx.get(ref);
        tx.set(ref, { items: patchRegistry(snap.data()?.items, name, changes), updatedAt: Date.now() }, { merge: true });
      });
      tapSuccess();
      setEditing(null);
      setAdding(false);
    } catch (e) {
      console.warn("save house failed:", e);
      Alert.alert("Couldn't save the house", "Nothing changed. Saving a house needs a connection; check your signal and try again.");
    }
    setSaving(false);
  };

  const restockItem = async (report: SupplyReport, item: string) => {
    tapSelect();
    try {
      await updateDoc(doc(db, "settings", "supplies"), new FieldPath("houses", report.key, "items"), arrayRemove(item));
    } catch (e) {
      console.warn("restock failed:", e);
      Alert.alert("Couldn't update the list", "It's still on the shopping list. Check your connection and try again.");
    }
  };

  const restockAll = (report: SupplyReport) => {
    Alert.alert("All restocked?", `Clear everything on ${report.name}'s list?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear it",
        onPress: async () => {
          try {
            await updateDoc(doc(db, "settings", "supplies"), new FieldPath("houses", report.key), deleteField());
            tapSuccess();
          } catch (e) {
            console.warn("restock all failed:", e);
            Alert.alert("Couldn't update the list", "It's still on the shopping list. Check your connection and try again.");
          }
        },
      },
    ]);
  };

  const markHostPaid = (row: Row) => {
    const settle = async (method: string) => {
      try {
        const batch = writeBatch(db);
        const at = Date.now();
        row.owed.jobs.forEach(j => batch.update(doc(db, "jobs", j.id), { hostPaid: true, hostPaidAt: at, hostPaidMethod: method }));
        await batch.commit();
        tapSuccess();
      } catch (e) {
        console.warn("mark host paid failed:", e);
        Alert.alert("Couldn't mark it paid", "The cleanings still show as owed. Check your connection and try again.");
      }
    };
    const n = row.owed.jobs.length;
    Alert.alert(
      "Host paid?",
      `Mark ${formatMoney(row.owed.amount)} for ${n} cleaning${n === 1 ? "" : "s"} at ${row.label} as paid?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Paid by Zelle", onPress: () => settle("Zelle") },
        { text: "Paid by check", onPress: () => settle("Check") },
        { text: "Paid in cash", onPress: () => settle("Cash") },
      ]
    );
  };

  if (!isOwner) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Houses" />
        <EmptyState icon="lock-closed-outline" title="Owner only" body="House prices and earnings are only on the owner's profile." />
      </View>
    );
  }

  const untimed = totals.cleanings - totals.timed;
  const margin = totals.revenue > 0 ? Math.round((totals.profit / totals.revenue) * 100) : null;

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Houses"
        subtitle={jobs ? `${houseCount} house${houseCount === 1 ? "" : "s"}${attention ? ` · ${attention} need${attention === 1 ? "s" : ""} attention` : ""}` : "Loading houses…"}
        right={<IconButton icon="add" onPress={() => { setEditing(null); setAdding(true); }} label="Add a house" />}
      />

      <HouseSheet
        visible={adding || !!editing}
        house={editing}
        busy={saving}
        onClose={() => { setEditing(null); setAdding(false); }}
        onSave={saveHouse}
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {loadError && !jobs ? (
          <ErrorState title="Couldn't load the houses" body={`Check your connection and try again. (${loadError})`} />
        ) : !jobs ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.teal} />
            <Text style={styles.loadingText}>Loading houses…</Text>
          </View>
        ) : (
          <>
            {supplies.length > 0 ? (
              <>
                <SectionHeader title="Shopping list" count={supplies.length} tone="warn" />
                {supplies.map(report => (
                  <Card key={report.key} tone="gold">
                    <View style={styles.rowTop}>
                      <Text style={styles.houseName} numberOfLines={1}>{report.name}</Text>
                      <TouchableOpacity onPress={() => restockAll(report)} hitSlop={8} accessibilityRole="button">
                        <Text style={styles.link}>All restocked</Text>
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.sub}>
                      Flagged {report.by ? `by ${report.by.split(" ")[0]} ` : ""}{report.at ? formatEntryDate(report.at) : ""} · tap an item once it&apos;s restocked
                    </Text>
                    <View style={styles.itemRow}>
                      {report.items.map(item => (
                        <TouchableOpacity
                          key={item}
                          style={styles.item}
                          onPress={() => restockItem(report, item)}
                          accessibilityRole="button"
                          accessibilityLabel={`${item}. Tap once it's restocked`}
                        >
                          <Ionicons name="cart-outline" size={14} color={colors.goldDark} />
                          <Text style={styles.itemText}>{item}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </Card>
                ))}
              </>
            ) : null}

            <SectionHeader title="Money" />
            <View style={styles.periodRow}>
              {PERIODS.map(p => (
                <TouchableOpacity
                  key={p}
                  style={[styles.periodChip, period === p && styles.periodChipOn]}
                  onPress={() => { tapSelect(); setPeriod(p); }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: period === p }}
                >
                  <Text style={[styles.periodText, period === p && styles.periodTextOn]} numberOfLines={1}>{PERIOD_LABELS[p]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={[styles.hero, shadow.card]}>
              <Text style={styles.heroLabel}>EARNED · {PERIOD_LABELS[period].toUpperCase()}</Text>
              <Text style={styles.heroAmount}>{formatMoney(totals.revenue)}</Text>
              <Text style={styles.heroSub}>
                {totals.cleanings} cleaning{totals.cleanings === 1 ? "" : "s"} done · pay {formatMoney(totals.labor)} · {totals.revenue > 0
                  ? `profit ${formatMoney(totals.profit)}${margin !== null ? ` (${margin}%)` : ""}`
                  : "set house prices to see profit"}
              </Text>
              {totals.booked > 0 ? (
                <Text style={styles.heroSub}>
                  {totals.booked} more on the schedule{totals.bookedRevenue > 0 ? ` · ${formatMoney(totals.bookedRevenue)} to come` : ""}
                </Text>
              ) : null}
            </View>
            {totals.unpriced > 0 || untimed > 0 ? (
              <View style={styles.gaps}>
                <Ionicons name="information-circle-outline" size={16} color={colors.muted} />
                <Text style={styles.gapsText}>
                  {[
                    totals.unpriced > 0 ? `${totals.unpriced} finished cleaning${totals.unpriced === 1 ? " has" : "s have"} no price, so ${totals.unpriced === 1 ? "it isn't" : "they aren't"} in the total. Tap a house to set its price.` : null,
                    untimed > 0 ? `${untimed} ran without the timer, so ${untimed === 1 ? "its" : "their"} pay isn't counted and profit reads high.` : null,
                  ].filter(Boolean).join(" ")}
                </Text>
              </View>
            ) : null}

            <SectionHeader title="By house" count={houseCount} />
            {rows.length === 0 ? (
              <EmptyState icon="home-outline" title="No houses yet" body="Tap + to add a house, with its price and door codes." />
            ) : (
              rows.map(row => <HouseCard key={row.key} row={row} onPress={row.house ? () => { setAdding(false); setEditing(row.house); } : undefined} onMarkPaid={() => markHostPaid(row)} />)
            )}
            <Text style={styles.footnote}>
              Pay and time per cleaning average every cleaning that had the timer running. A house is flagged for a deep clean after {DEEP_CLEAN_EVERY} regular cleanings without one.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function HouseCard({ row, onPress, onMarkPaid }: { row: Row; onPress?: () => void; onMarkPaid: () => void }) {
  const { house, money, per, deep, owed } = row;
  const losing = per.margin !== null && per.margin < 0;
  return (
    <Card onPress={onPress}>
      <View style={styles.rowTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.houseName} numberOfLines={1}>{row.label}</Text>
          <Text style={styles.sub} numberOfLines={1}>
            {house
              ? [
                house.bedrooms ? `${house.bedrooms} bd` : null,
                house.bathrooms ? `${house.bathrooms} ba` : null,
                house.price ? `${formatMoney(house.price)} a cleaning` : null,
              ].filter(Boolean).join(" · ") || "Tap to add details"
              : "One-off cleanings at addresses not on the house list"}
          </Text>
        </View>
        <View style={styles.moneyCol}>
          <Text style={styles.money}>{formatMoney(money.revenue)}</Text>
          <Text style={styles.moneySub}>{money.cleanings} done{money.booked ? ` · ${money.booked} to go` : ""}</Text>
        </View>
      </View>

      <Text style={[styles.line, per.minutes === null && { color: colors.faint }]}>
        {per.minutes === null
          ? "No timed cleanings yet, so no average time or pay"
          : `Avg ${formatDuration(per.minutes)} · ${formatMoney(per.labor || 0)} pay`}
        {per.margin !== null ? (
          <Text style={[styles.margin, losing && { color: colors.danger }]}>
            {losing ? ` · loses ${formatMoney(-per.margin)} a cleaning` : ` · ${formatMoney(per.margin)} left a cleaning`}
          </Text>
        ) : null}
      </Text>
      {deep ? <Text style={[styles.line, deep.due && { color: colors.goldDark, fontWeight: "700" }]}>{deepLine(deep)}</Text> : null}

      {house ? (
        <View style={styles.pillRow}>
          {!house.price && row.total > 0 ? <Pill label="No price" tone="gold" icon="pricetag-outline" /> : null}
          {!house.doorCode ? <Pill label="No door code" tone="gold" icon="keypad-outline" /> : null}
          {deep?.due ? <Pill label="Deep clean due" tone="gold" icon="sparkles-outline" /> : null}
          {row.supplies ? <Pill label={`Low on ${row.supplies.items.length}`} tone="gold" icon="cart-outline" /> : null}
          {owed.amount > 0 ? <Pill label={`Host owes ${formatMoney(owed.amount)}`} tone="danger" icon="cash-outline" /> : null}
        </View>
      ) : null}
      {owed.amount > 0 ? (
        <BrandButton label={`Mark ${formatMoney(owed.amount)} paid`} icon="checkmark-circle" variant="outline" compact onPress={onMarkPaid} style={{ marginTop: 10, alignSelf: "flex-start" }} />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20 },
  loading: { alignItems: "center", paddingVertical: 48, gap: 10 },
  loadingText: { fontSize: 14, color: colors.muted },
  rowTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  houseName: { fontSize: 16.5, fontWeight: "700", color: colors.ink, flexShrink: 1 },
  sub: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  link: { fontSize: 13, fontWeight: "700", color: colors.tealDark },
  itemRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 10 },
  item: {
    flexDirection: "row", alignItems: "center", gap: 5, minHeight: 36, paddingHorizontal: 11,
    borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.gold,
  },
  itemText: { fontSize: 13.5, fontWeight: "600", color: colors.goldDark },
  periodRow: { flexDirection: "row", gap: 6, marginBottom: 10 },
  periodChip: {
    flex: 1, minHeight: 38, paddingHorizontal: 6, borderRadius: radius.pill, borderWidth: 1,
    borderColor: colors.line, backgroundColor: colors.card, alignItems: "center", justifyContent: "center",
  },
  periodChipOn: { backgroundColor: colors.dark, borderColor: colors.dark },
  periodText: { fontSize: 12.5, fontWeight: "600", color: colors.muted },
  periodTextOn: { color: colors.white },
  hero: { backgroundColor: colors.dark, borderRadius: radius.lg, padding: 20, marginBottom: 10 },
  heroLabel: { fontSize: 11, fontWeight: "700", color: "#9FB4BE", letterSpacing: 1.5 },
  heroAmount: { fontSize: 34, fontWeight: "700", color: colors.white, marginTop: 4 },
  heroSub: { fontSize: 13, color: "#B9CAD2", marginTop: 4, lineHeight: 18 },
  gaps: { flexDirection: "row", gap: 7, paddingHorizontal: 4, marginBottom: 6 },
  gapsText: { flex: 1, fontSize: 12.5, color: colors.muted, lineHeight: 18 },
  moneyCol: { alignItems: "flex-end" },
  money: { fontSize: 17, fontWeight: "700", color: colors.tealDark },
  moneySub: { fontSize: 12, color: colors.muted, marginTop: 1 },
  line: { fontSize: 13, color: colors.ink, marginTop: 8, lineHeight: 18 },
  margin: { fontWeight: "700", color: colors.tealDark },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  footnote: { fontSize: 12, color: colors.faint, lineHeight: 17, marginTop: 6, paddingHorizontal: 4 },
});
