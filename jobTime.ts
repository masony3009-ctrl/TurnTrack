// Start times on jobs, and which jobs' dates the owner may change by hand.
// Nothing here imports app code, so `npm test` runs it straight under Node.

// A job's time is "HH:MM", 24-hour, Phoenix time ("14:00"). Absent or null
// means no set time, which is how every job started out.
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isTime(value: unknown): value is string {
  return typeof value === "string" && TIME.test(value);
}

// "14:00" -> "2:00 PM". Anything that isn't a time -> null.
export function formatTime(value?: string | null): string | null {
  if (!isTime(value)) return null;
  const [h, m] = value.split(":").map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

// The times offered in the picker: 7:00 AM to 7:00 PM in half hours, which
// covers every cleaning so far without a scrolling clock.
export const TIME_CHOICES: string[] = Array.from({ length: 25 }, (_, i) => {
  const minutes = 7 * 60 + i * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${minutes % 60 === 0 ? "00" : "30"}`;
});

// "Thu, Oct 29" + "14:00" -> "Thu, Oct 29 · 2:00 PM"; no time -> the date alone.
export function withTime(dateText: string, time?: string | null): string {
  const t = formatTime(time);
  return t ? `${dateText} · ${t}` : dateText;
}

// Jobs whose date comes from a calendar the syncs follow. Changing the date
// here would be undone on the next sync, so only the time is editable.
const SYNCED: Record<string, string> = {
  "airbnb-calendar": "Airbnb",
  "airbnb-ical": "Airbnb",
  "turno-calendar": "Turno",
  "turno-email": "Turno",
};

// "Airbnb" / "Turno" for a synced job, null for everything else (website
// requests, recurring and hand-added jobs).
export function syncedFrom(source?: string | null): string | null {
  return (source && SYNCED[source]) || null;
}

export function canEditDate(source?: string | null): boolean {
  return syncedFrom(source) === null;
}
