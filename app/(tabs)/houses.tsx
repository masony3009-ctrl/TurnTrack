import { Ionicons } from "@expo/vector-icons";
import { arrayRemove, collection, deleteField, doc, FieldPath, onSnapshot, runTransaction, updateDoc, writeBatch } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { tapSelect, tapSuccess } from "../../components/haptics";
import { HouseSheet } from "../../components/HouseSheet";
import { useProfile } from "../../components/ProfileProvider";
import { EmptyState, ErrorState, IconButton, ScreenHeader, SectionHeader } from "../../components/ui";
import { useProperties } from "../../components/useProperties";
import { useSupplies } from "../../components/useSupplies";
import { db } from "../../firebase";
import {
  deepCleanStatus, groupByHouse, hostOwed, houseMoney, OTHER_HOUSE, perCleaning, PERIOD_LABELS, periodRange, sumMoney, unlinkedClients,
  type DeepCleanStatus, type HouseMoney, type Period,
} from "../../money";
import { formatDollars, formatDuration, formatEntryDate } from "../../payroll";
import { houseKey, patchRegistry, type Property, type RegistryChanges } from "../../properties";
import { type SupplyReport } from "../../supplies";
import { colors, radius, shadow } from "../../theme";
import { formatShortDate, todayKey } from "../../turnover";
import { Job } from "../../types";

const PERIODS: Period[] = ["month", "lastMonth", "year", "all"];
const CHIP_LABELS: Record<Period, string> = { month: "Month", lastMonth: "Last month", year: "Year", all: "All" };

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
};

type Flag = { text: string; tone: "warn" | "danger" | "muted" };

// Only what needs doing, as short as it can be said.
function flagsOf(r: Row): Flag[] {
  const out: Flag[] = [];
  if (!r.house) return out;
  if (r.owed.amount > 0) out.push({ text: `Owes ${formatDollars(r.owed.amount)}`, tone: "danger" });
  if (r.deep?.due) out.push({ text: "Deep clean due", tone: "warn" });
  else if (r.deep?.booked) out.push({ text: `Deep clean ${formatShortDate(r.deep.booked)}`, tone: "muted" });
  if (r.supplies) out.push({ text: `Low on ${r.supplies.items.length}`, tone: "warn" });
  if (!r.house.doorCode) out.push({ text: "No door code", tone: "warn" });
  if (!r.house.price) out.push({ text: "No price", tone: "warn" });
  return out;
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
        label: g.house ? g.house.short || g.house.name : "Other clients",
        money: houseMoney(g, range),
        per: perCleaning(houseMoney(g, null)),
        deep: g.house ? deepCleanStatus(g.jobs, today) : null,
        owed: hostOwed(g.jobs as Job[], g.house),
        supplies: suppliesByKey.get(g.key) || null,
      }))
      .sort((a, b) =>
        Number(a.key === OTHER_HOUSE) - Number(b.key === OTHER_HOUSE) ||
        b.money.revenue - a.money.revenue ||
        b.money.cleanings - a.money.cleanings ||
        a.label.localeCompare(b.label)
      );
  }, [groups, period, today, suppliesByKey]);
  const clients = useMemo(() => unlinkedClients(groups.get(OTHER_HOUSE)?.jobs || [], today), [groups, today]);
  const totals = useMemo(() => sumMoney(rows.map(r => r.money)), [rows]);
  const houseCount = rows.filter(r => r.house).length;

  const saveHouse = async (name: string, changes: RegistryChanges, aliases: string[]) => {
    if (adding && properties.some(p => houseKey(p.name) === houseKey(name))) {
      Alert.alert("Already on the list", `${name} is already a house. Tap it to edit.`);
      return;
    }
    setSaving(true);
    try {
      // Read and write in one go so an edit never drops a house the scripts
      // added a moment ago, or fields only they know about.
      await runTransaction(db, async tx => {
        const ref = doc(db, "settings", "properties");
        const snap = await tx.get(ref);
        tx.set(ref, { items: patchRegistry(snap.data()?.items, name, changes, aliases), updatedAt: Date.now() }, { merge: true });
      });
      tapSuccess();
      setEditing(null);
      setAdding(false);
    } catch (e) {
      console.warn("save house failed:", e);
      Alert.alert("Couldn't save", "Nothing changed. Check your signal and try again.");
    }
    setSaving(false);
  };

  const restockItem = async (report: SupplyReport, item: string) => {
    tapSelect();
    try {
      await updateDoc(doc(db, "settings", "supplies"), new FieldPath("houses", report.key, "items"), arrayRemove(item));
    } catch (e) {
      console.warn("restock failed:", e);
      Alert.alert("Couldn't update the list", "Check your signal and try again.");
    }
  };

  const restockAll = (report: SupplyReport) => {
    Alert.alert("All restocked?", `Clear ${report.name}'s list?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        onPress: async () => {
          try {
            await updateDoc(doc(db, "settings", "supplies"), new FieldPath("houses", report.key), deleteField());
            tapSuccess();
          } catch (e) {
            console.warn("restock all failed:", e);
            Alert.alert("Couldn't update the list", "Check your signal and try again.");
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
        Alert.alert("Couldn't mark it paid", "Check your signal and try again.");
      }
    };
    const n = row.owed.jobs.length;
    Alert.alert(`${row.label} paid?`, `${formatDollars(row.owed.amount)} for ${n} cleaning${n === 1 ? "" : "s"}.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Zelle", onPress: () => settle("Zelle") },
      { text: "Check", onPress: () => settle("Check") },
      { text: "Cash", onPress: () => settle("Cash") },
    ]);
  };

  if (!isOwner) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Houses" />
        <EmptyState icon="lock-closed-outline" title="Owner only" body="Only the owner sees house prices and earnings." />
      </View>
    );
  }

  const untimed = totals.cleanings - totals.timed;
  const margin = totals.revenue > 0 ? Math.round((totals.profit / totals.revenue) * 100) : null;
  const notes = [
    totals.unpriced > 0 ? `${totals.unpriced} without a price` : null,
    untimed > 0 && totals.timed > 0 ? `Pay counts the ${totals.timed} timed cleaning${totals.timed === 1 ? "" : "s"} of ${totals.cleanings}` : null,
    untimed > 0 && totals.timed === 0 ? "No timed cleanings, so no pay counted" : null,
  ].filter(Boolean);

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Houses"
        subtitle={jobs ? `${houseCount} house${houseCount === 1 ? "" : "s"}` : "Loading houses…"}
        right={<IconButton icon="add" onPress={() => { setEditing(null); setAdding(true); }} label="Add a house" />}
      />

      <HouseSheet
        visible={adding || !!editing}
        house={editing}
        clients={clients}
        busy={saving}
        onClose={() => { setEditing(null); setAdding(false); }}
        onSave={saveHouse}
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {loadError && !jobs ? (
          <ErrorState title="Couldn't load the houses" body={`Check your signal. (${loadError})`} />
        ) : !jobs ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.teal} />
            <Text style={styles.loadingText}>Loading houses…</Text>
          </View>
        ) : (
          <>
            {supplies.length > 0 ? (
              <>
                <SectionHeader title="Shopping list · tap when restocked" count={supplies.length} tone="warn" />
                <View style={[styles.list, styles.listGold]}>
                  {supplies.map((report, i) => (
                    <View key={report.key} style={[styles.shopRow, i > 0 && styles.divider]}>
                      <View style={styles.rowTop}>
                        <Text style={styles.name} numberOfLines={1}>{report.name}</Text>
                        <TouchableOpacity onPress={() => restockAll(report)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Clear ${report.name}'s list`}>
                          <Text style={styles.link}>Clear</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={styles.itemRow}>
                        {report.items.map(item => (
                          <TouchableOpacity
                            key={item}
                            style={styles.item}
                            onPress={() => restockItem(report, item)}
                            accessibilityRole="button"
                            accessibilityLabel={`${item}. Tap once it's restocked`}
                          >
                            <Text style={styles.itemText}>{item}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <Text style={styles.meta}>{[report.by?.split(" ")[0], report.at ? formatEntryDate(report.at) : null].filter(Boolean).join(" · ")}</Text>
                    </View>
                  ))}
                </View>
              </>
            ) : null}

            <View style={styles.periodRow}>
              {PERIODS.map(p => (
                <TouchableOpacity
                  key={p}
                  style={[styles.periodChip, period === p && styles.periodChipOn]}
                  onPress={() => { tapSelect(); setPeriod(p); }}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: period === p }}
                >
                  <Text style={[styles.periodText, period === p && styles.periodTextOn]} numberOfLines={1}>{CHIP_LABELS[p]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={[styles.hero, shadow.card]}>
              <Text style={styles.heroLabel}>EARNED · {PERIOD_LABELS[period].toUpperCase()}</Text>
              <Text style={styles.heroAmount}>{formatDollars(totals.revenue)}</Text>
              <View style={styles.heroStats}>
                <HeroStat label="Cleanings" value={String(totals.cleanings)} />
                <HeroStat label="Pay" value={formatDollars(Math.round(totals.labor))} />
                <HeroStat label={margin !== null ? `Profit · ${margin}%` : "Profit"} value={totals.revenue > 0 ? formatDollars(Math.round(totals.profit)) : "—"} />
              </View>
              {totals.booked > 0 ? (
                <Text style={styles.heroSub}>+ {totals.booked} booked{totals.bookedRevenue > 0 ? ` · ${formatDollars(totals.bookedRevenue)}` : ""}</Text>
              ) : null}
            </View>
            {notes.length ? <Text style={styles.notes}>{notes.join(" · ")}</Text> : null}

            <SectionHeader title="By house" count={houseCount} />
            {rows.length === 0 ? (
              <EmptyState icon="home-outline" title="No houses yet" body="Tap + to add one." />
            ) : (
              <View style={styles.list}>
                {rows.map((row, i) => (
                  <HouseRow
                    key={row.key}
                    row={row}
                    first={i === 0}
                    onPress={row.house ? () => { setAdding(false); setEditing(row.house); } : () => { setEditing(null); setAdding(true); }}
                    onMarkPaid={() => markHostPaid(row)}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.heroStat}>
      <Text style={styles.heroStatValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.heroStatLabel}>{label}</Text>
    </View>
  );
}

// One line per house: what it earned, what a cleaning there is worth, and
// anything that needs doing. Tap to edit the house.
function HouseRow({ row, first, onPress, onMarkPaid }: { row: Row; first: boolean; onPress: () => void; onMarkPaid: () => void }) {
  const { house, money, per } = row;
  const losing = per.margin !== null && per.margin < 0;
  const detail = [
    `${money.cleanings} done`,
    money.booked ? `${money.booked} booked` : null,
    per.minutes !== null ? formatDuration(per.minutes) : house?.price ? `${formatDollars(house.price)} each` : null,
  ].filter(Boolean).join(" · ");
  const flags = flagsOf(row);
  const body = (
    <View style={[styles.row, !first && styles.divider]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>{row.label}</Text>
        <Text style={styles.meta} numberOfLines={2}>
          {detail}
          {per.margin !== null ? (
            <Text style={[styles.margin, losing && { color: colors.danger }]}>
              {losing ? ` · loses ${formatDollars(Math.round(-per.margin))}` : ` · ${formatDollars(Math.round(per.margin))} kept`}
            </Text>
          ) : null}
        </Text>
        {flags.length ? (
          <View style={styles.flagRow}>
            {flags.map(f => (
              <Text key={f.text} style={[styles.flag, f.tone === "danger" ? styles.flagDanger : f.tone === "warn" ? styles.flagWarn : styles.flagMuted]}>{f.text}</Text>
            ))}
            {row.owed.amount > 0 ? (
              <TouchableOpacity onPress={onMarkPaid} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Mark ${row.label} paid`}>
                <Text style={styles.link}>Mark paid</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>
      <Text style={[styles.money, money.revenue === 0 && { color: colors.faint }]}>{formatDollars(money.revenue)}</Text>
      <Ionicons name={house ? "chevron-forward" : "add-circle-outline"} size={house ? 16 : 18} color={house ? colors.faint : colors.tealDark} />
    </View>
  );
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} accessibilityRole="button" accessibilityHint={house ? "Edit this house" : "Make one of these a house"}>
      {body}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20 },
  loading: { alignItems: "center", paddingVertical: 48, gap: 10 },
  loadingText: { fontSize: 14, color: colors.muted },
  list: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, marginBottom: 12, ...shadow.card },
  listGold: { borderColor: colors.gold, backgroundColor: colors.goldSoft },
  divider: { borderTopWidth: 1, borderTopColor: colors.line },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, minHeight: 52 },
  shopRow: { paddingVertical: 11 },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  name: { fontSize: 15, fontWeight: "700", color: colors.ink, flexShrink: 1 },
  meta: { fontSize: 12.5, color: colors.muted, marginTop: 2 },
  margin: { fontWeight: "700", color: colors.tealDark },
  money: { fontSize: 15.5, fontWeight: "700", color: colors.tealDark },
  link: { fontSize: 13, fontWeight: "700", color: colors.tealDark },
  flagRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 5 },
  flag: { fontSize: 11.5, fontWeight: "700", paddingHorizontal: 7, paddingVertical: 2, borderRadius: radius.pill, overflow: "hidden" },
  flagWarn: { color: colors.goldDark, backgroundColor: colors.goldSoft },
  flagDanger: { color: colors.danger, backgroundColor: colors.dangerSoft },
  flagMuted: { color: colors.muted, backgroundColor: colors.bg },
  itemRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  item: { minHeight: 34, paddingHorizontal: 11, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.gold, justifyContent: "center" },
  itemText: { fontSize: 13, fontWeight: "600", color: colors.goldDark },
  periodRow: { flexDirection: "row", gap: 6, marginBottom: 10 },
  periodChip: {
    flex: 1, minHeight: 36, paddingHorizontal: 6, borderRadius: radius.pill, borderWidth: 1,
    borderColor: colors.line, backgroundColor: colors.card, alignItems: "center", justifyContent: "center",
  },
  periodChipOn: { backgroundColor: colors.dark, borderColor: colors.dark },
  periodText: { fontSize: 12.5, fontWeight: "600", color: colors.muted },
  periodTextOn: { color: colors.white },
  hero: { backgroundColor: colors.dark, borderRadius: radius.lg, padding: 18, marginBottom: 8 },
  heroLabel: { fontSize: 11, fontWeight: "700", color: "#9FB4BE", letterSpacing: 1.5 },
  heroAmount: { fontSize: 32, fontWeight: "700", color: colors.white, marginTop: 2 },
  heroStats: { flexDirection: "row", gap: 8, marginTop: 10 },
  heroStat: { flex: 1, backgroundColor: "rgba(255,255,255,0.07)", borderRadius: radius.sm, paddingVertical: 7, paddingHorizontal: 9 },
  heroStatValue: { fontSize: 14, fontWeight: "700", color: colors.white },
  heroStatLabel: { fontSize: 11, color: "#9FB4BE", marginTop: 1 },
  heroSub: { fontSize: 12.5, color: "#B9CAD2", marginTop: 8 },
  notes: { fontSize: 12, color: colors.muted, paddingHorizontal: 4, marginBottom: 4 },
});
