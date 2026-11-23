import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { collection, onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, PanResponder, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View, type ViewStyle } from "react-native";
import { tapSelect } from "../../components/haptics";
import { openInMaps } from "../../components/maps";
import { OwnerEventSheet } from "../../components/OwnerEventSheet";
import { useOwnerEvents } from "../../components/ownerEventsStore";
import { useProfile } from "../../components/ProfileProvider";
import { confirmRemoveTimeOff, TimeOffRow, TimeOffSheet } from "../../components/TimeOff";
import { AssigneeRow, BrandButton, Card, ColorDot, ErrorState, IconButton, Pill, ScreenHeader, SheetModal } from "../../components/ui";
import { useProperties } from "../../components/useProperties";
import { db } from "../../firebase";
import { crewLabel, crewOf, isOnCrew } from "../../crew";
import { formatTime } from "../../jobTime";
import { eventsByDay, type OwnerEvent } from "../../ownerEvents";
import {
  countsAsCleaning,
  countsByWeek,
  gridNames,
  houseLabel,
  monthGrid,
  monthKey,
  monthLabel,
  monthOfKey,
  monthTotals,
  scheduleMonths,
  stepMonth,
  swipeDirection,
  weekRangeLabel,
  weekStatus,
  weekSummary,
  type Month,
  type WeekCount,
} from "../../schedule";
import { cleanerColor, colors, radius, shadow, textOn, timeOffColor, tint, type, unassignedColor } from "../../theme";
import { blocksOn, conflictText, isAllDay, offSummary, shortHours, timeOffOf, upcomingTimeOff, type TimeOff } from "../../timeOff";
import { formatDayHeading, hasSameDayTurnover, jobDateKey, sortByDate, todayKey } from "../../turnover";
import { Employee, Job } from "../../types";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const CHIPS_PER_DAY = 3;
const EVENTS_PER_DAY = 2;
// How many of a cleaner's own time-off rows show before "Show all".
const OFF_SHOWN = 5;

// Someone's time off on one day, as the grid shows it.
type DayOff = { employee: Employee; blocks: TimeOff[] };

export default function CalendarScreen() {
  const router = useRouter();
  const { employees, state } = useProfile();
  // The weekly counts are business tracking: owners only.
  const isOwner = state.status === "owner";
  const self = state.status === "cleaner" ? state.employee : null;
  const selfId = self ? self.id : null;
  const ownerViewing = state.status === "cleaner" && state.ownerViewing;
  const properties = useProperties();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const today = todayKey();
  const [month, setMonth] = useState<Month>(monthOfKey(today));
  const [openDay, setOpenDay] = useState<string | null>(null);
  // The day the time-off form starts on; undefined = the form is closed.
  const [timeOffDay, setTimeOffDay] = useState<string | null | undefined>(undefined);
  // The owner's meetings and other things that aren't cleanings.
  const { events: ownerEvents, failed: eventsFailed } = useOwnerEvents(isOwner);
  const eventsOnDay = useMemo(() => eventsByDay(ownerEvents || []), [ownerEvents]);
  // The event form: which day it starts on, and the event when editing one.
  const [eventEdit, setEventEdit] = useState<{ day: string; event: OwnerEvent | null } | null>(null);
  // A cleaner's own list of time off shows the next few until they ask for all.
  const [showAllOff, setShowAllOff] = useState(false);
  const myOff = useMemo(() => (self ? upcomingTimeOff(timeOffOf(self), today) : []), [self, today]);
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

  const all = useMemo(() => jobs || [], [jobs]);
  const byDay = useMemo(() => {
    const map = new Map<string, Job[]>();
    sortByDate(all.filter(countsAsCleaning)).forEach(job => {
      const key = jobDateKey(job) as string;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(job);
    });
    return map;
  }, [all]);
  // What each cleaning is called on the grid, where a chip fits about eight
  // letters. Worked out over every cleaning, so a house keeps one name from
  // month to month.
  const gridLabel = useMemo(() => {
    const full = new Map<string, string>();
    all.filter(countsAsCleaning).forEach(job => full.set(job.id, houseLabel(job, properties)));
    const short = gridNames([...full.values()]);
    return (job: Job) => {
      const name = full.get(job.id) ?? houseLabel(job, properties);
      return short.get(name) ?? name;
    };
  }, [all, properties]);
  const weekCounts = useMemo(() => countsByWeek(all), [all]);
  const months = useMemo(() => scheduleMonths(all, today), [all, today]);
  const maxWeek = useMemo(() => Math.max(1, ...[...weekCounts.values()].map(c => c.total)), [weekCounts]);
  const grid = useMemo(() => monthGrid(month), [month]);
  // A cleaner's header counts their own cleanings; the owner's, everyone's.
  const totals = useMemo(() => monthTotals(selfId ? all.filter(j => isOnCrew(j, selfId)) : all, month), [all, month, selfId]);
  // Cleaners with a chip on this month's grid, so a cleaner who has since
  // left still gets a legend entry for their color.
  const shownCleaners = useMemo(() => {
    const ids = new Set<string>();
    grid.flat().forEach(key => (byDay.get(key) || []).forEach(j => crewOf(j).forEach(id => ids.add(id))));
    return ids;
  }, [grid, byDay]);
  const selectedKey = monthKey(month);

  useEffect(() => {
    const x = chipX.current.get(selectedKey);
    if (x !== undefined) chipsRef.current?.scrollTo({ x: Math.max(0, x - 120), animated: true });
  }, [selectedKey, months.length]);

  const employeeById = useMemo(() => new Map(employees.map(e => [e.id, e])), [employees]);
  // Whose time off this phone shows: everyone's for the owner, a cleaner only
  // their own (the reasons are between them and the owner).
  const timeOffPeople = useMemo(
    () => (isOwner ? employees.filter(e => e.active) : self ? [self] : []).filter(e => timeOffOf(e).length > 0),
    [isOwner, employees, self]
  );
  const offOn = (key: string): DayOff[] => timeOffPeople
    .map(employee => ({ employee, blocks: blocksOn(timeOffOf(employee), key) }))
    .filter(d => d.blocks.length > 0);
  // The owner's grid marks time off with a small badge per cleaner (their
  // initial); a cleaner's own grid says "Off" or the hours. Red all day,
  // purple part of it. The hours and reasons are in the day's sheet.
  const offChip = (d: DayOff): DayCellOff => {
    const allDay = d.blocks.some(isAllDay);
    return {
      id: d.employee.id,
      allDay,
      name: d.employee.name.split(" ")[0],
      mine: !isOwner && !ownerViewing,
      initial: isOwner ? d.employee.name.slice(0, 1).toUpperCase() : null,
      text: allDay ? "Off" : shortHours(d.blocks[0]),
    };
  };
  const colorFor = (job: Job) => (job.assignedTo ? cleanerColor(employeeById.get(job.assignedTo) || { id: job.assignedTo }) : unassignedColor);

  const pickMonth = (m: Month) => {
    tapSelect();
    setMonth(m);
  };

  // Swiping the grid sideways flips months: the grid follows the finger, slides
  // out, and the next month slides in from the other side. The handlers are
  // made once, so they read the current months and width through a ref.
  const { width } = useWindowDimensions();
  const slide = useRef(new Animated.Value(0)).current;
  const swipeState = useRef({ months, month, width });
  swipeState.current = { months, month, width };
  const pan = useRef(PanResponder.create({
    // Only clearly sideways drags: scrolling the page and tapping a day still work.
    onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => slide.setValue(g.dx),
    onPanResponderRelease: (_, g) => {
      const { months: ms, month: current, width: w } = swipeState.current;
      const dir = swipeDirection(g.dx, g.vx);
      const next = dir ? stepMonth(ms, current, dir) : null;
      if (!next) {
        Animated.spring(slide, { toValue: 0, useNativeDriver: true, bounciness: 6 }).start();
        return;
      }
      Animated.timing(slide, { toValue: -dir * w, duration: 140, useNativeDriver: true }).start(() => {
        tapSelect();
        setMonth(next);
        slide.setValue(dir * w);
        Animated.timing(slide, { toValue: 0, duration: 180, useNativeDriver: true }).start();
      });
    },
    onPanResponderTerminate: () => Animated.spring(slide, { toValue: 0, useNativeDriver: true }).start(),
  })).current;

  if (loadError) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Calendar" />
        <ErrorState title="Couldn't load the cleanings" body={`Check your signal. (${loadError})`} />
      </View>
    );
  }

  const dayJobs = openDay ? byDay.get(openDay) || [] : [];
  const dayEvents = openDay ? eventsOnDay.get(openDay) || [] : [];
  // Cleanings and meetings together in time order, the untimed ones last.
  const dayItems: DayItem[] = [
    ...dayJobs.map(job => ({ time: job.time || null, job })),
    ...dayEvents.map(ev => ({ time: ev.time, ev })),
  ].sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
  // From the day sheet, which has to finish closing before the form opens.
  const openEvent = (day: string, event: OwnerEvent | null) => {
    tapSelect();
    setOpenDay(null);
    setTimeout(() => setEventEdit({ day, event }), 450);
  };
  const dayOff = openDay ? offOn(openDay) : [];
  const monthTotal = totals.done + totals.left;
  // Opens the time-off form on this day (today when null).
  const blockDay = (key: string | null) => {
    tapSelect();
    if (!openDay) {
      setTimeOffDay(key);
      return;
    }
    // From the day sheet: it has to finish closing before the form opens.
    setOpenDay(null);
    setTimeout(() => setTimeOffDay(key), 450);
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title={monthLabel(month, true)}
        subtitle={!jobs ? "\u00A0" : self
          ? `${monthTotal} ${ownerViewing ? `for ${self.name.split(" ")[0]}` : "of your cleanings"} · ${totals.done} done, ${totals.left} to go`
          : `${monthTotal} cleaning${monthTotal === 1 ? "" : "s"} · ${totals.done} done, ${totals.left} to go`}
        right={<IconButton icon="today-outline" onPress={() => pickMonth(monthOfKey(today))} label="Go to this month" />}
      />

      <ScrollView ref={chipsRef} horizontal showsHorizontalScrollIndicator={false} style={styles.monthBar} contentContainerStyle={styles.monthBarContent}>
        {months.map((m, i) => {
          const key = monthKey(m);
          const showYear = m.month === 0 || (i === 0 && m.year !== monthOfKey(today).year);
          return (
            <View
              // Laid out afresh when months are added in front, so each chip
              // reports where it now sits.
              key={`${key}:${months.length}`}
              style={styles.monthChipWrap}
              onLayout={e => {
                const x = e.nativeEvent.layout.x;
                chipX.current.set(key, x);
                // The chips are laid out after the first render, so the bar is
                // put on the chosen month here, as soon as its place is known.
                if (key === selectedKey) chipsRef.current?.scrollTo({ x: Math.max(0, x - 120), animated: false });
              }}
            >
              {showYear ? <Text style={styles.yearMark}>{m.year}</Text> : null}
              <TouchableOpacity
                style={[styles.monthChip, key === selectedKey && styles.monthChipOn]}
                onPress={() => pickMonth(m)}
                hitSlop={{ top: 5, bottom: 5 }}
                accessibilityRole="button"
                accessibilityLabel={monthLabel(m, true)}
                accessibilityState={{ selected: key === selectedKey }}
              >
                <Text style={[styles.monthChipText, key === selectedKey && styles.monthChipTextOn]}>{monthLabel(m)}</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>

      {/* Widened by the card's bleed, so the scroll view doesn't clip the outer columns. */}
      <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {!jobs ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.teal} />
            <Text style={styles.loadingText}>Loading cleanings…</Text>
          </View>
        ) : (
          <>
            <Animated.View
              style={[styles.gridCard, { transform: [{ translateX: slide }] }]}
              accessibilityHint="Swipe left or right to change the month"
              {...pan.panHandlers}
            >
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
                      offs={offOn(key).map(offChip)}
                      events={eventsOnDay.get(key) || []}
                      // Any day opens: a cleaner blocks it out, the owner adds a cleaning.
                      tappable
                      label={gridLabel}
                      colorFor={colorFor}
                      onPress={() => { tapSelect(); setOpenDay(key); }}
                    />
                  ))}
                </View>
              ))}
            </Animated.View>

            <View style={styles.legend}>
              {employees.filter(e => e.active || shownCleaners.has(e.id)).map(e => (
                <View key={e.id} style={styles.legendItem}>
                  <ColorDot color={cleanerColor(e)} />
                  <Text style={styles.legendText}>{e.name.split(" ")[0]}</Text>
                </View>
              ))}
              <View style={styles.legendItem}>
                <View style={[styles.legendSwatch, styles.legendOpen]} />
                <Text style={styles.legendText}>Unassigned</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendSwatch, styles.legendDone]} />
                <Text style={styles.legendText}>Done</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendSwatch, styles.legendSameDay]} />
                <Text style={styles.legendText}>Same-day</Text>
              </View>
              {ownerEvents?.length ? (
                <View style={styles.legendItem}>
                  <View style={[styles.legendSwatch, styles.legendEvent]} />
                  <Text style={styles.legendText}>Meetings</Text>
                </View>
              ) : null}
              {timeOffPeople.length > 0 ? (
                <>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendSwatch, isOwner && styles.legendBadge, offLook(true)]} />
                    <Text style={styles.legendText}>Day off</Text>
                  </View>
                  <View style={styles.legendItem}>
                    <View style={[styles.legendSwatch, isOwner && styles.legendBadge, offLook(false)]} />
                    <Text style={styles.legendText}>Part day</Text>
                  </View>
                </>
              ) : null}
            </View>
            {eventsFailed ? <Text style={styles.eventsError}>Couldn&apos;t load your meetings. Check your signal; they show up once it&apos;s back.</Text> : null}

            {self ? (
              <>
                <Text style={styles.sectionTitle}>{ownerViewing ? `${self.name.split(" ")[0]}'s time off` : "Your time off"}</Text>
                <Text style={styles.sectionHint}>
                  {ownerViewing ? "Days and hours they can't work." : "Days and hours you can't work. The owner sees them before handing out cleanings."}
                </Text>
                <View style={styles.offCard}>
                  <BrandButton label="Block out time" icon="add" variant="outline" compact onPress={() => blockDay(null)} style={{ marginTop: 12 }} />
                  <Text style={styles.offTip}>Or tap a day on the calendar.</Text>
                  {(showAllOff ? myOff : myOff.slice(0, OFF_SHOWN)).map(block => (
                    <TimeOffRow key={block.id} block={block} today={today} onRemove={() => confirmRemoveTimeOff(self, block, ownerViewing)} />
                  ))}
                  {myOff.length > OFF_SHOWN ? (
                    <TouchableOpacity
                      style={styles.offMore}
                      onPress={() => { tapSelect(); setShowAllOff(v => !v); }}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: showAllOff }}
                    >
                      <Text style={styles.offMoreText}>{showAllOff ? "Show fewer" : `Show all ${myOff.length}`}</Text>
                      <Ionicons name={showAllOff ? "chevron-up" : "chevron-down"} size={15} color={colors.tealDark} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              </>
            ) : null}

            {isOwner ? <TeamTimeOff people={employees.filter(e => e.active)} today={today} /> : null}

            {isOwner ? <WeekCounts weekStarts={grid.map(row => row[0])} counts={weekCounts} maxWeek={maxWeek} today={today} /> : null}
          </>
        )}
      </ScrollView>

      <SheetModal visible={!!openDay} title={openDay ? formatDayHeading(openDay) : ""} onClose={() => setOpenDay(null)}>
        {dayOff.length > 0 ? (
          <View style={styles.dayOff}>
            <Text style={type.section}>{isOwner ? "Can't work" : ownerViewing ? "Off" : "You're off"}</Text>
            {dayOff.map(d => d.blocks.map(block => (
              <View key={`${d.employee.id}-${block.id}`} style={styles.dayOffRow}>
                <ColorDot color={cleanerColor(d.employee)} />
                <Text style={styles.dayOffText}>
                  {isOwner ? <Text style={styles.dayOffName}>{d.employee.name.split(" ")[0]}  </Text> : null}
                  <Text style={{ color: timeOffColor(isAllDay(block)), fontWeight: "600" }}>{conflictText({ block, blocking: true })}</Text>
                </Text>
              </View>
            )))}
          </View>
        ) : null}
        {self && openDay && openDay >= today && !dayOff.some(d => d.blocks.some(isAllDay)) ? (
          <BrandButton
            label={dayOff.length > 0 ? "Block out more time this day" : "I can't work this day"}
            icon="remove-circle-outline"
            variant="outline"
            compact
            onPress={() => blockDay(openDay)}
            style={{ marginBottom: 12 }}
          />
        ) : null}
        {isOwner && openDay ? (
          <View style={styles.sheetAdds}>
            {openDay >= today ? (
              <BrandButton
                label="Add cleaning"
                icon="add"
                variant="outline"
                compact
                onPress={() => {
                  const day = openDay;
                  setOpenDay(null);
                  router.navigate({ pathname: "/", params: { add: day, at: String(Date.now()) } });
                }}
                style={styles.sheetAdd}
              />
            ) : null}
            <BrandButton
              label={openDay >= today ? "Add meeting" : "Add a meeting or other event"}
              icon="calendar-outline"
              variant="outline"
              compact
              onPress={() => openEvent(openDay, null)}
              style={styles.sheetAdd}
            />
          </View>
        ) : null}
        {dayItems.length === 0 ? (
          <Text style={styles.emptyDay}>{isOwner ? "Nothing on this day yet." : "No cleanings this day."}</Text>
        ) : (
          dayItems.map(item => {
            if (item.ev) {
              const ev = item.ev;
              return (
                <Card key={ev.id} accent={colors.ink} onPress={() => openDay && openEvent(openDay, ev)}>
                  <View style={styles.pillRow}>
                    <Pill label={formatTime(ev.time) || "No set time"} tone="neutral" icon="time-outline" />
                    <Pill label="Only you see this" tone="neutral" icon="lock-closed-outline" />
                  </View>
                  <Text style={styles.sheetHouse}>{ev.title}</Text>
                  {ev.place ? (
                    <TouchableOpacity
                      style={styles.eventPlace}
                      onPress={() => ev.place && openInMaps(ev.place)}
                      hitSlop={6}
                      accessibilityRole="link"
                      accessibilityLabel={`Directions to ${ev.place}`}
                    >
                      <Ionicons name="location-outline" size={15} color={colors.tealDark} />
                      <Text style={styles.eventPlaceText} numberOfLines={2}>{ev.place}</Text>
                    </TouchableOpacity>
                  ) : null}
                  {ev.note ? <Text style={styles.eventNote}>{ev.note}</Text> : null}
                </Card>
              );
            }
            const job = item.job;
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
                  {isOnCrew(job, selfId) ? <Pill label="Yours" tone="teal" /> : null}
                  <Pill label={job.type} tone="neutral" />
                </View>
                <Text style={styles.sheetHouse}>{houseLabel(job, properties)}</Text>
                <Text style={styles.sheetAddress} numberOfLines={1}>{job.address}</Text>
                <View style={{ marginTop: 8 }}>
                  <AssigneeRow name={crewLabel(job, id => employeeById.get(id)?.name)} color={colorFor(job)} photo={assignee?.photo} />
                </View>
              </Card>
            );
          })
        )}
      </SheetModal>

      {isOwner ? (
        <OwnerEventSheet
          visible={!!eventEdit}
          day={eventEdit?.day || today}
          event={eventEdit?.event || null}
          onClose={() => setEventEdit(null)}
        />
      ) : null}

      {self ? (
        <TimeOffSheet
          visible={timeOffDay !== undefined}
          employee={self}
          ownerViewing={ownerViewing}
          jobs={all}
          houseOf={job => houseLabel(job, properties)}
          startDay={timeOffDay ?? null}
          onClose={() => setTimeOffDay(undefined)}
        />
      ) : null}
    </View>
  );
}

// The owner's look at who has time off coming up, cleaner by cleaner. Each
// cleaner is folded up to one line until the owner taps their name; the grid
// above already marks every day someone is off.
function TeamTimeOff({ people, today }: { people: Employee[]; today: string }) {
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const withTime = people.map(e => ({ e, blocks: upcomingTimeOff(timeOffOf(e), today) })).filter(p => p.blocks.length > 0);
  const toggle = (id: string) => {
    tapSelect();
    setOpenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  return (
    <>
      <Text style={styles.sectionTitle}>Time off</Text>
      <Text style={styles.sectionHint}>
        {withTime.length ? "When your cleaners can't work. Tap a name for their days." : "Nobody has blocked out time. Cleaners add it from their Calendar tab."}
      </Text>
      {withTime.length ? (
        <View style={styles.offCard}>
          {withTime.map(({ e, blocks }, i) => {
            const open = openIds.has(e.id);
            const summary = offSummary(blocks, today);
            return (
              <View key={e.id} style={i > 0 ? styles.offPersonNext : null}>
                <TouchableOpacity
                  style={styles.offPersonHead}
                  onPress={() => toggle(e.id)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  accessibilityLabel={`${e.name}'s time off. ${summary}`}
                >
                  <ColorDot color={cleanerColor(e)} />
                  <View style={styles.offPersonText}>
                    <Text style={styles.dayOffName}>{e.name}</Text>
                    <Text style={styles.offSummaryText}>{summary}</Text>
                  </View>
                  <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
                </TouchableOpacity>
                {open ? blocks.map(block => <TimeOffRow key={block.id} block={block} today={today} onRemove={() => confirmRemoveTimeOff(e, block, true)} />) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </>
  );
}

// One line of the day sheet: a cleaning or one of the owner's events.
type DayItem = { time: string | null; job: Job; ev?: undefined } | { time: string | null; ev: OwnerEvent; job?: undefined };

// Someone's time off in a day cell. initial is set on the owner's grid (a
// badge per cleaner); a cleaner's own grid shows text instead.
// mine = the person holding the phone is the one who is off.
type DayCellOff = { id: string; allDay: boolean; name: string; mine: boolean; initial: string | null; text: string };

// Red and solid for a whole day off, purple and dashed for part of one.
function offLook(allDay: boolean): ViewStyle {
  const color = timeOffColor(allDay);
  return { borderColor: color, backgroundColor: tint(color, 0.14), borderStyle: allDay ? "solid" : "dashed" };
}

// What a screen reader says for a day: "Monday, November 23. 2 cleanings, 1 other event. Shane is off all day."
function dayCellLabel(dayKey: string, jobs: number, events: number, offs: DayCellOff[]): string {
  const on = [
    jobs ? `${jobs} cleaning${jobs === 1 ? "" : "s"}` : "",
    events ? `${events} other event${events === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(", ");
  const off = offs.map(o => `${o.mine ? "You're" : `${o.name} is`} off ${o.allDay ? "all day" : "part of the day"}.`).join(" ");
  return [`${formatDayHeading(dayKey)}.`, on ? `${on}.` : "Nothing booked.", off].filter(Boolean).join(" ");
}

function DayCell({ dayKey, inMonth, isToday, jobs, offs, events, tappable, label, colorFor, onPress }: {
  dayKey: string;
  inMonth: boolean;
  isToday: boolean;
  jobs: Job[];
  // Who can't work this day, at the foot of the cell.
  offs: DayCellOff[];
  // The owner's meetings and such, as outlined chips after the cleanings.
  events: OwnerEvent[];
  // Open even with nothing on it.
  tappable: boolean;
  label: (job: Job) => string;
  colorFor: (job: Job) => string;
  onPress: () => void;
}) {
  const shownEvents = events.slice(0, EVENTS_PER_DAY);
  const extra = Math.max(0, jobs.length - CHIPS_PER_DAY) + events.length - shownEvents.length;
  return (
    <TouchableOpacity
      style={[styles.cell, !inMonth && styles.cellOut]}
      onPress={onPress}
      activeOpacity={0.6}
      disabled={!tappable && jobs.length === 0 && offs.length === 0 && events.length === 0}
      accessibilityRole="button"
      accessibilityLabel={dayCellLabel(dayKey, jobs.length, events.length, offs)}
    >
      <View style={[styles.dayNum, isToday && styles.dayNumToday]}>
        <Text style={[styles.dayNumText, !inMonth && styles.dayNumOut, isToday && styles.dayNumTodayText]}>{Number(dayKey.slice(8))}</Text>
      </View>
      {jobs.slice(0, CHIPS_PER_DAY).map(job => {
        const color = colorFor(job);
        const unassigned = color === unassignedColor;
        // A cleaning still to do keeps its cleaner's full color; one nobody
        // has yet is gray with an outline, so it can't pass for finished. A
        // finished one goes pale with gray text: still readable, clearly
        // behind you. The left edge is only ever gold, for a same-day turnover.
        const background = job.done ? tint(color, 0.16) : unassigned ? tint(color, 0.3) : color;
        const text = job.done ? colors.muted : unassigned ? colors.ink : textOn(color);
        return (
          <View
            key={job.id}
            style={[styles.chip, { backgroundColor: background }, unassigned && !job.done && styles.chipOpen, hasSameDayTurnover(job) && styles.chipSameDay]}
          >
            <Text style={[styles.chipText, { color: text }]} numberOfLines={1}>{label(job)}</Text>
          </View>
        );
      })}
      {shownEvents.map(ev => (
        <View key={ev.id} style={[styles.chip, styles.chipEvent]}>
          <Text style={[styles.chipText, { color: colors.ink }]} numberOfLines={1}>{ev.title}</Text>
        </View>
      ))}
      {extra > 0 ? <Text style={styles.more}>+{extra} more</Text> : null}
      {offs.length > 0 ? (
        <View style={styles.offRow}>
          {offs.map(off => off.initial ? (
            <View key={off.id} style={[styles.offBadge, offLook(off.allDay)]}>
              <Text style={[styles.offBadgeText, { color: timeOffColor(off.allDay) }]} maxFontSizeMultiplier={1.3}>{off.initial}</Text>
            </View>
          ) : (
            <View key={off.id} style={[styles.chip, styles.chipOff, offLook(off.allDay)]}>
              <Text style={styles.chipOffText} numberOfLines={2}>{off.text.length > 6 ? off.text.replace("–", "\n–") : off.text}</Text>
            </View>
          ))}
        </View>
      ) : null}
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
      <Text style={styles.sectionHint}>Sunday to Saturday</Text>
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
  scroll: { marginHorizontal: -12 },
  scrollContent: { paddingBottom: 40, paddingHorizontal: 12 },
  // A ScrollView may shrink by default, and the tall page under this one
  // squeezed it until the chips were cut off. It keeps its full height.
  monthBar: { flexGrow: 0, flexShrink: 0, marginBottom: 12, marginHorizontal: -20 },
  monthBarContent: { paddingHorizontal: 20, paddingVertical: 2, gap: 8, alignItems: "center" },
  monthChipWrap: { flexDirection: "row", alignItems: "center", gap: 8 },
  yearMark: { fontSize: 15, fontWeight: "800", color: colors.ink, marginHorizontal: 4 },
  monthChip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  monthChipOn: { backgroundColor: colors.dark, borderColor: colors.dark },
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
  cellOut: { backgroundColor: colors.tealFaint },
  dayNum: { alignSelf: "center", width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  dayNumToday: { backgroundColor: colors.tealDark },
  dayNumText: { fontSize: 12.5, fontWeight: "700", color: colors.ink },
  dayNumOut: { color: colors.faint },
  dayNumTodayText: { color: colors.white },
  // A name too long for the chip is cut off at its edge, not shortened with
  // "…", which costs a letter of a name that only has room for eight.
  chip: { borderRadius: 4, paddingHorizontal: 3, paddingVertical: 2, overflow: "hidden" },
  // Still needs a cleaner. Listed before the same-day edge, which wins on the left.
  chipOpen: { borderWidth: 1, borderColor: unassignedColor, paddingVertical: 1 },
  chipSameDay: { borderLeftWidth: 3, borderLeftColor: colors.gold },
  chipText: { width: 160, maxWidth: 160, fontSize: 10, fontWeight: "700", letterSpacing: -0.2, color: colors.white },
  more: { fontSize: 10, fontWeight: "700", color: colors.muted, textAlign: "center" },
  // Time off sits at the foot of the cell, so the cleanings line up under
  // the dates across a week.
  offRow: { marginTop: "auto", paddingTop: 2, flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 3 },
  offBadge: { width: 17, height: 17, borderRadius: 9, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  offBadgeText: { fontSize: 9, fontWeight: "800" },
  chipOff: { width: "100%", borderWidth: 1.5 },
  chipOffText: { fontSize: 9.5, fontWeight: "700", lineHeight: 12, color: colors.ink, textAlign: "center" },
  chipEvent: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.ink },
  legend: { flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 8, marginTop: 12, paddingHorizontal: 2 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendText: { fontSize: 12, fontWeight: "600", color: colors.muted },
  legendSwatch: { width: 14, height: 10, borderRadius: 3, borderWidth: 1.5, borderColor: "transparent" },
  legendDone: { backgroundColor: tint(colors.muted, 0.2), borderWidth: 0 },
  legendOpen: { backgroundColor: tint(unassignedColor, 0.3), borderWidth: 1, borderColor: unassignedColor },
  legendSameDay: { backgroundColor: tint(unassignedColor, 0.3), borderWidth: 0, borderLeftWidth: 3, borderLeftColor: colors.gold },
  legendEvent: { borderWidth: 1, borderColor: colors.ink, backgroundColor: colors.card },
  legendBadge: { width: 12, height: 12, borderRadius: 6 },
  eventsError: { fontSize: 12.5, color: colors.danger, marginTop: 10, paddingHorizontal: 2 },
  sheetAdds: { flexDirection: "row", gap: 8, marginBottom: 12 },
  sheetAdd: { flex: 1 },
  eventPlace: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4, minHeight: 32 },
  eventPlaceText: { flex: 1, fontSize: 13.5, fontWeight: "600", color: colors.tealDark },
  eventNote: { fontSize: 13.5, color: colors.ink, lineHeight: 19, marginTop: 4 },
  offCard: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 14, paddingBottom: 12, ...shadow.card },
  offTip: { fontSize: 12, color: colors.muted, textAlign: "center", marginTop: 8 },
  offMore: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, minHeight: 44, marginTop: 4 },
  offMoreText: { fontSize: 13.5, fontWeight: "600", color: colors.tealDark },
  dayOff: { backgroundColor: colors.bg, borderRadius: radius.md, padding: 12, marginBottom: 12, gap: 6 },
  dayOffRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dayOffText: { flex: 1, fontSize: 14, color: colors.ink },
  dayOffName: { fontSize: 14, fontWeight: "700", color: colors.ink },
  sectionTitle: { ...type.section, marginTop: 24, paddingHorizontal: 2 },
  offPersonNext: { borderTopWidth: 1, borderTopColor: colors.line, marginTop: 8 },
  offPersonHead: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, paddingTop: 10 },
  offPersonText: { flex: 1, gap: 1 },
  offSummaryText: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  sectionHint: { fontSize: 12.5, color: colors.muted, marginTop: 4, marginBottom: 10, paddingHorizontal: 2 },
  weekCard: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, paddingVertical: 4, ...shadow.card },
  weekRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 11, gap: 10 },
  weekRowNow: { backgroundColor: colors.tealFaint },
  // Widths are minimums, so large system text wraps instead of clipping.
  weekLabelCol: { minWidth: 104, flexShrink: 1, gap: 4, alignItems: "flex-start" },
  weekRange: { fontSize: 13.5, fontWeight: "700", color: colors.ink },
  barTrack: { flex: 1, height: 10, borderRadius: 5, backgroundColor: colors.bg, overflow: "hidden" },
  barFill: { position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 5 },
  barPast: { backgroundColor: colors.teal },
  barAhead: { backgroundColor: tint(colors.teal, 0.35) },
  weekCount: { minWidth: 72, flexShrink: 1, textAlign: "right", fontSize: 13, fontWeight: "700", color: colors.ink },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  sheetHouse: { fontSize: 16.5, fontWeight: "700", color: colors.ink },
  sheetAddress: { fontSize: 13.5, color: colors.muted, marginTop: 2 },
  emptyDay: { fontSize: 14, color: colors.muted, paddingVertical: 12 },
});
