export function computeEarned(minutes: number, hourlyRate: number): number {
  return Math.round((minutes / 60) * hourlyRate * 100) / 100;
}

export function minutesBetween(startMs: number, endMs: number): number {
  return Math.max(1, Math.round((endMs - startMs) / 60000));
}

export function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

export function formatElapsed(startMs: number, nowMs: number): string {
  const totalSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = m.toString().padStart(2, "0");
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function formatEntryDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function parseRate(input: string): number | null {
  const cleaned = input.replace(/[^0-9.]/g, "");
  const rate = parseFloat(cleaned);
  if (isNaN(rate) || rate <= 0 || rate > 500) return null;
  return Math.round(rate * 100) / 100;
}
