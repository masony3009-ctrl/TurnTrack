// The owner's own things on the calendar that aren't cleanings: meeting a new
// client at their house, a walkthrough, an errand. Only owner phones read or
// show them. They live as one list at settings/ownerEvents.
// Nothing here imports app code, so `npm test` runs it straight under Node.

export type OwnerEvent = {
  id: string;
  dateKey: string;
  // "HH:MM" 24-hour, or null for no set time.
  time: string | null;
  // What it is: "Meet the owner", "Walkthrough".
  title: string;
  // Where, as typed: a street address or a place name. Opens in Maps.
  place: string | null;
  note: string | null;
  createdAt: number;
};

export type EventForm = { dateKey: string; time: string | null; title: string; place: string; note: string };

export const TITLE_MAX = 80;
export const PLACE_MAX = 160;
export const NOTE_MAX = 500;
// Past events stay this long, then drop off the list the next time it's saved.
export const KEEP_DAYS = 400;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

// The times offered: 7:00 AM to 8:00 PM in half hours. Meetings run later
// than cleanings do.
export const EVENT_TIMES: string[] = Array.from({ length: 27 }, (_, i) => {
  const minutes = 7 * 60 + i * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${minutes % 60 === 0 ? "00" : "30"}`;
});

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function isOwnerEvent(v: unknown): v is OwnerEvent {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return typeof e.id === "string" && e.id !== "" &&
    typeof e.dateKey === "string" && DAY.test(e.dateKey) &&
    (e.time === null || e.time === undefined || (typeof e.time === "string" && TIME.test(e.time))) &&
    typeof e.title === "string" && e.title.trim() !== "";
}

// Earliest first; on one day, no set time first, then by time, then the order they were added.
export function sortEvents(events: OwnerEvent[]): OwnerEvent[] {
  return [...events].sort((a, b) =>
    a.dateKey.localeCompare(b.dateKey) ||
    (a.time || "").localeCompare(b.time || "") ||
    a.createdAt - b.createdAt
  );
}

// The stored list, with anything malformed dropped and every field in shape.
export function eventsOf(raw: unknown): OwnerEvent[] {
  if (!Array.isArray(raw)) return [];
  return sortEvents(raw.filter(isOwnerEvent).map((e) => ({
    id: e.id,
    dateKey: e.dateKey,
    time: e.time || null,
    title: e.title.trim(),
    place: text(e.place),
    note: text(e.note),
    createdAt: typeof e.createdAt === "number" ? e.createdAt : 0,
  })));
}

export function eventsByDay(events: OwnerEvent[]): Map<string, OwnerEvent[]> {
  const map = new Map<string, OwnerEvent[]>();
  for (const e of sortEvents(events)) {
    if (!map.has(e.dateKey)) map.set(e.dateKey, []);
    map.get(e.dateKey)!.push(e);
  }
  return map;
}

// The event a form describes, or what's wrong with it.
export function buildEvent(form: EventForm, id: string, createdAt: number): OwnerEvent | { error: string } {
  const title = form.title.trim();
  if (!title) return { error: "Say what it is, like \"Meet the owner\"." };
  if (title.length > TITLE_MAX) return { error: `Keep the name under ${TITLE_MAX} characters.` };
  if (!DAY.test(form.dateKey)) return { error: "Pick a day." };
  if (form.time !== null && !TIME.test(form.time)) return { error: "Pick a time, or No set time." };
  const place = form.place.trim();
  if (place.length > PLACE_MAX) return { error: `Keep the place under ${PLACE_MAX} characters.` };
  const note = form.note.trim();
  if (note.length > NOTE_MAX) return { error: `Keep the notes under ${NOTE_MAX} characters.` };
  return { id, dateKey: form.dateKey, time: form.time, title, place: place || null, note: note || null, createdAt };
}

// "YYYY-MM-DD" n days before another, by the calendar (no time zones involved).
export function daysBefore(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) - n * 86_400_000);
  return t.toISOString().slice(0, 10);
}

// The list as it's saved: old events dropped, the rest in order.
export function keepRecent(events: OwnerEvent[], today: string): OwnerEvent[] {
  const cutoff = daysBefore(today, KEEP_DAYS);
  return sortEvents(events.filter((e) => e.dateKey >= cutoff));
}

// Adds an event, or replaces the one with the same id.
export function putEvent(events: OwnerEvent[], event: OwnerEvent, today: string): OwnerEvent[] {
  return keepRecent([...events.filter((e) => e.id !== event.id), event], today);
}

export function dropEvent(events: OwnerEvent[], id: string, today: string): OwnerEvent[] {
  return keepRecent(events.filter((e) => e.id !== id), today);
}

export function newEventId(now: number, random: number): string {
  return `ev${now.toString(36)}${Math.floor(random * 1e8).toString(36)}`;
}

export function blankForm(dateKey: string): EventForm {
  return { dateKey, time: null, title: "", place: "", note: "" };
}

export function formOfEvent(e: OwnerEvent): EventForm {
  return { dateKey: e.dateKey, time: e.time, title: e.title, place: e.place || "", note: e.note || "" };
}
