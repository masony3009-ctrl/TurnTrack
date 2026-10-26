import { useRouter } from "expo-router";
import { collection, onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { tapSelect } from "../../components/haptics";
import { useProfile } from "../../components/ProfileProvider";
import { AssigneeRow, Card, ColorDot, ErrorState, IconButton, Pill, ScreenHeader, SheetModal } from "../../components/ui";
import { useProperties } from "../../components/useProperties";
import { db } from "../../firebase";
import { formatTime } from "../../jobTime";
import {
  countsAsCleaning,
  countsByWeek,
  houseLabel,
  monthGrid,
  monthKey,
  monthLabel,
  monthOfKey,
  monthTotals,
  scheduleMonths,
  weekRangeLabel,
  weekStatus,
  weekSummary,
  type Month,
  type WeekCount,
} from "../../schedule";
import { cleanerColor, colors, radius, shadow, tint, unassignedColor } from "../../theme";
import { formatDayHeading, hasSameDayTurnover, jobDateKey, sortByDate, todayKey } from "../../turnover";
import { Job } from "../../types";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const CHIPS_PER_DAY = 3;

export default function CalendarScreen() {
  const router = useRouter();
  const { employees, state } = useProfile();
  // The weekly counts are business tracking: owners only.
  const isOwner = state.status === "owner";
  const selfId = state.status === "cleaner" ? state.employee.id : null;
  const properties = useProperties();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const today = todayKey();
  const [month, setMonth] = useState<Month>(monthOfKey(today));
  const [openDay, setOpenDay] = useState<string | null>(null);
  const chipsRef = useRef<ScrollView>(null);
  const chipX = useRef(new Map<string, number>());

  // Every job ever, not just the visible ones: past weeks need their history.
  useEffect(() => {
    return onSnapshot(
      collection(db, "jobs"),
      snapshot => setJobs(snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Job[]),
      error => setLoadError(error.message)
    );
  }, []);

  const all = jobs || [];
  const byDay = useMemo(() => {
    const map = new Map<string, Job[]>();
    sortByDate(all.filter(countsAsCleaning)).forEach(job => {
      const key = jobDateKey(job) as string;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(job);
    });
    return map;
  }, [all]);
  const weekCounts = useMemo(() => countsByWeek(all), [all]);
  const months = useMemo(() => scheduleMonths(all, today), [all, today]);
  const maxWeek = useMemo(() => Math.max(1, ...[...weekCounts.values()].map(c => c.total)), [weekCounts]);
  const grid = monthGrid(month);
  const totals = monthTotals(all, month, today);
  const selectedKey = monthKey(month);

  useEffect(() => {
    const x = chipX.current.get(selectedKey);
    if (x !== undefined) chipsRef.current?.scrollTo({ x: Math.max(0, x - 120), animated: true });
  }, [selectedKey, months.length]);

  const employeeById = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);
  const colorFor = (job: Job) => (job.assignedTo ? cleanerColor(employeeById.get(job.assignedTo) || { id: job.assignedTo }) : unassignedColor);

  const pickMonth = (m: Month) => {
    tapSelect();
    setMonth(m);
  };

  if (loadError) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Calendar" />
        <ErrorState title="Couldn't load the cleanings" body={`Check the connection and try again. (${loadError})`} />
      </View>
    );
  }

  const dayJobs = openDay ? byDay.get(openDay) || [] : [];
  const monthTotal = totals.had + totals.ahead;

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={monthLabel(month, true)}
        subtitle={jobs ? `${monthTotal} cleaning${monthTotal === 1 ? "" : "s"} · ${totals.had} so far, ${totals.ahead} to go` : "Loading cleanings…"}
        right={<IconButton icon="today-outline" onPress={() => pickMonth(monthOfKey(today))} />}
      />

      <ScrollView ref={chipsRef} horizontal showsHorizontalScrollIndicator={false} style={styles.monthBar} contentContainerStyle={styles.monthBarContent}>
        {months.map((m, i) => {
          const key = monthKey(m);
          const showYear = m.month === 0 || (i === 0 && m.year !== monthOfKey(today).year);
          return (
            <View key={key} style={styles.monthChipWrap} onLayout={e => chipX.current.set(key, e.nativeEvent.layout.x)}>
              {showYear ? <Text style={styles.yearMark}>{m.year}</Text> : null}
              <TouchableOpacity style={[styles.monthChip, key === selectedKey && styles.monthChipOn]} onPress={() => pickMonth(m)}>
                <Text style={[styles.monthChipText, key === selectedKey && styles.monthChipTextOn]}>{monthLabel(m)}</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
        {!jobs ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.teal} />
            <Text style={styles.loadingText}>Loading cleanings…</Text>
          </View>
        ) : (
          <>
            <View style={styles.gridCard}>
              <View style={styles.weekdayRow}>
                {WEEKDAYS.map((d, i) => <Text key={i} style={styles.weekday}>{d}</Text>)}
              </View>
              {grid.map(row => (
                <View key={row[0]} style={styles.gridRow}>
                  {row.map(key => (
                    <DayCell
                      key={key}
                      dayKey={key}
                      inMonth={key.startsWith(selectedKey)}
                      isToday={key === today}
                      jobs={byDay.get(key) || []}
                      label={job => houseLabel(job, properties)}
                      colorFor={colorFor}
                      onPress={() => { tapSelect(); setOpenDay(key); }}
                    />
                  ))}
                </View>
              ))}
            </View>

            <View style={styles.legend}>
              {employees.filter(e => e.active).map(e => (
                <View key={e.id} style={styles.legendItem}>
                  <ColorDot color={cleanerColor(e)} />
                  <Text style={styles.legendText}>{e.name.split(" ")[0]}</Text>
                </View>
              ))}
              <View style={styles.legendItem}>
                <ColorDot color={unassignedColor} />
                <Text style={styles.legendText}>Unassigned</Text>
              </View>
              <View style={styles.legendItem}>
                <ColorDot color={colors.gold} />
                <Text style={styles.legendText}>Same-day</Text>
              </View>
            </View>

            {isOwner ? <WeekCounts weekStarts={grid.map(row => row[0])} counts={weekCounts} maxWeek={maxWeek} today={today} /> : null}
          </>
        )}
      </ScrollView>

      <SheetModal visible={!!openDay} title={openDay ? formatDayHeading(openDay) : ""} onClose={() => setOpenDay(null)}>
        {dayJobs.length === 0 ? (
          <Text style={styles.emptyDay}>No cleanings this day.</Text>
        ) : (
          dayJobs.map(job => {
            const assignee = job.assignedTo ? employeeById.get(job.assignedTo) : undefined;
            const time = formatTime(job.time);
            return (
              <Card
                key={job.id}
                accent={colorFor(job)}
                tone={hasSameDayTurnover(job) ? "gold" : "default"}
                onPress={() => { setOpenDay(null); router.push({ pathname: "/job", params: { id: job.id } }); }}
              >
                <View style={styles.pillRow}>
                  {job.done ? <Pill label="Done" tone="neutral" icon="checkmark" /> : null}
                  {job.startedAt ? <Pill label="In progress" tone="solid" icon="time" /> : null}
                  {hasSameDayTurnover(job) ? <Pill label="Same-day" tone="gold" icon="alert-circle" /> : null}
                  {time ? <Pill label={time} tone="neutral" icon="time-outline" /> : null}
                  {selfId && job.assignedTo === selfId ? <Pill label="Yours" tone="teal" /> : null}
                  <Pill label={job.type} tone="neutral" />
                </View>
                <Text style={styles.sheetHouse}>{houseLabel(job, properties)}</Text>
                <Text style={styles.sheetAddress} numberOfLines={1}>{job.address}</Text>
                <View style={{ marginTop: 8 }}>
                  <AssigneeRow name={job.assignedToName} color={colorFor(job)} photo={assignee?.photo} />
                </View>
              </Card>
            );
          })
        )}
      </SheetModal>
    </View>
  );
}

function DayCell({ dayKey, inMonth, isToday, jobs, label, colorFor, onPress }: {
  dayKey: string;
  inMonth: boolean;
  isToday: boolean;
  jobs: Job[];
  label: (job: Job) => string;
  colorFor: (job: Job) => string;
  onPress: () => void;
}) {
  const extra = jobs.length - CHIPS_PER_DAY;
  return (
    <TouchableOpacity style={[styles.cell, !inMonth && styles.cellOut]} onPress={onPress} activeOpacity={0.6} disabled={jobs.length === 0}>
      <View style={[styles.dayNum, isToday && styles.dayNumToday]}>
        <Text style={[styles.dayNumText, !inMonth && styles.dayNumOut, isToday && styles.dayNumTodayText]}>{Number(dayKey.slice(8))}</Text>
      </View>
      {jobs.slice(0, CHIPS_PER_DAY).map(job => {
        const color = colorFor(job);
        const unassigned = color === unassignedColor;
        return (
          <View
            key={job.id}
            style={[
              styles.chip,
              { backgroundColor: unassigned ? tint(unassignedColor, 0.28) : color },
              hasSameDayTurnover(job) && styles.chipSameDay,
              job.done && styles.chipDone,
            ]}
          >
            <Text style={[styles.chipText, unassigned && { color: colors.ink }]} numberOfLines={1} ellipsizeMode="clip">
              {label(job)}
            </Text>
          </View>
        );
      })}
      {extra > 0 ? <Text style={styles.more}>+{extra} more</Text> : null}
    </TouchableOpacity>
  );
}

// One row per Sunday-Saturday week of the month on screen. Bars share one
// scale across every week on record, so months compare at a glance.
function WeekCounts({ weekStarts, counts, maxWeek, today }: {
  weekStarts: string[];
  counts: Map<string, WeekCount>;
  maxWeek: number;
  today: string;
}) {
  return (
    <>
      <Text style={styles.sectionTitle}>Cleanings per week</Text>
      <Text style={styles.sectionHint}>Sunday to Saturday. Past weeks count what we had, this week what&apos;s done, later weeks what&apos;s booked.</Text>
      <View style={styles.weekCard}>
        {weekStarts.map(start => {
          const count = counts.get(start);
          const status = weekStatus(start, today);
          const total = count?.total || 0;
          const done = count?.done || 0;
          return (
            <View key={start} style={[styles.weekRow, status === "current" && styles.weekRowNow]}>
              <View style={styles.weekLabelCol}>
                <Text style={styles.weekRange}>{weekRangeLabel(start)}</Text>
                {status === "current" ? <Pill label="This week" tone="teal" /> : null}
              </View>
              <View style={styles.barTrack}>
                {status === "current" ? (
                  <>
                    <View style={[styles.barFill, styles.barAhead, { width: `${(total / maxWeek) * 100}%` }]} />
                    <View style={[styles.barFill, styles.barPast, { width: `${(done / maxWeek) * 100}%` }]} />
                  </>
                ) : (
                  <View style={[styles.barFill, status === "past" ? styles.barPast : styles.barAhead, { width: `${(total / maxWeek) * 100}%` }]} />
                )}
              </View>
              <Text style={[styles.weekCount, status === "future" && { color: colors.muted }]}>{weekSummary(count, status)}</Text>
            </View>
          );
        })}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20 },
  monthBar: { flexGrow: 0, marginBottom: 12, marginHorizontal: -20 },
  monthBarContent: { paddingHorizontal: 20, gap: 8, alignItems: "center" },
  monthChipWrap: { flexDirection: "row", alignItems: "center", gap: 8 },
  yearMark: { fontSize: 15, fontWeight: "800", color: colors.ink, marginHorizontal: 4 },
  monthChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  monthChipOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  monthChipText: { fontSize: 14, fontWeight: "700", color: colors.ink },
  monthChipTextOn: { color: colors.white },
  loading: { alignItems: "center", paddingVertical: 48, gap: 10 },
  loadingText: { fontSize: 14, color: colors.muted },
  gridCard: {
    marginHorizontal: -12, backgroundColor: colors.card, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.line, overflow: "hidden", ...shadow.card,
  },
  weekdayRow: { flexDirection: "row", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.line },
  weekday: { flex: 1, textAlign: "center", fontSize: 12, fontWeight: "700", color: colors.faint },
  gridRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.line },
  cell: { flex: 1, minHeight: 84, paddingHorizontal: 2, paddingTop: 4, paddingBottom: 4, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.line, gap: 2 },
  cellOut: { backgroundColor: colors.tealFaint, opacity: 0.75 },
  dayNum: { alignSelf: "center", width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  dayNumToday: { backgroundColor: colors.teal },
  dayNumText: { fontSize: 12.5, fontWeight: "700", color: colors.ink },
  dayNumOut: { color: colors.faint },
  dayNumTodayText: { color: colors.white },
  chip: { borderRadius: 4, paddingHorizontal: 3, paddingVertical: 2 },
  chipSameDay: { borderLeftWidth: 3, borderLeftColor: colors.gold },
  chipDone: { opacity: 0.5 },
  chipText: { fontSize: 10, fontWeight: "700", color: colors.white },
  more: { fontSize: 10, fontWeight: "700", color: colors.muted, textAlign: "center" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 12, paddingHorizontal: 2 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendText: { fontSize: 12, fontWeight: "600", color: colors.muted },
  sectionTitle: { fontSize: 17, fontWeight: "700", color: colors.ink, marginTop: 24 },
  sectionHint: { fontSize: 12.5, color: colors.muted, marginTop: 3, marginBottom: 10 },
  weekCard: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, paddingVertical: 4, ...shadow.card },
  weekRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 11, gap: 10 },
  weekRowNow: { backgroundColor: colors.tealFaint },
  weekLabelCol: { width: 104, gap: 4, alignItems: "flex-start" },
  weekRange: { fontSize: 13.5, fontWeight: "700", color: colors.ink },
  barTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.bg, overflow: "hidden" },
  barFill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 5 },
  barPast: { backgroundColor: colors.teal },
  barAhead: { backgroundColor: tint(colors.teal, 0.35) },
  weekCount: { width: 96, textAlign: "right", fontSize: 13, fontWeight: "700", color: colors.ink },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  sheetHouse: { fontSize: 16.5, fontWeight: "700", color: colors.ink },
  sheetAddress: { fontSize: 13.5, color: colors.muted, marginTop: 2 },
  emptyDay: { fontSize: 14, color: colors.muted, paddingVertical: 12 },
});
