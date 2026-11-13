// How the Jobs list reads: which house a card is for, the weeks the long
// "Coming up" list is broken into, and what a search matches.
//
// Pure (no React, no Firebase) so it runs under node --test.

import { tidyAddress, type Property } from "./properties.ts";
import { addDaysToKey, weekStartKey } from "./schedule.ts";
import { dateFromKey, jobDateKey, type JobLike } from "./turnover.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// A card leads with the house people call it by, the address under it. A
// place that isn't a listed house leads with its street.
export function cardTitle(job: { address?: string | null; property?: string | null; type?: string | null }, house: Property | null): { title: string; subtitle: string | null } {
  const address = tidyAddress(job.address);
  if (house) return { title: house.short || house.name, subtitle: address || null };
  const [street, ...rest] = address.split(",").map((p) => p.trim()).filter(Boolean);
  return {
    title: street || String(job.property || "").trim() || job.type || "Cleaning",
    subtitle: rest.length ? rest.join(", ") : null,
  };
}

export type WeekGroup<J> = { start: string; label: string; jobs: J[] };

// "Next week", "Week of Nov 29".
export function weekLabel(start: string, today: string): string {
  if (start === addDaysToKey(weekStartKey(today), 7)) return "Next week";
  const d = dateFromKey(start);
  if (!d) return "Later";
  // A week in another year says which.
  const year = start.slice(0, 4) === today.slice(0, 4) ? "" : `, ${d.getFullYear()}`;
  return `Week of ${MONTHS[d.getMonth()]} ${d.getDate()}${year}`;
}

// Cleanings split into Sunday-to-Saturday weeks, in date order. Ones with no
// readable date go in a last "Later" group.
export function weeksOf<J extends JobLike>(jobs: J[], today: string): WeekGroup<J>[] {
  const byStart = new Map<string, J[]>();
  const undated: J[] = [];
  for (const job of jobs) {
    const key = jobDateKey(job);
    if (!key) { undated.push(job); continue; }
    const start = weekStartKey(key);
    if (!byStart.has(start)) byStart.set(start, []);
    (byStart.get(start) as J[]).push(job);
  }
  const groups = [...byStart.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([start, list]) => ({ start, label: weekLabel(start, today), jobs: list }));
  if (undated.length) groups.push({ start: "", label: "Later", jobs: undated });
  return groups;
}

function words(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/[^a-z0-9#]+/g, " ").trim();
}

// Every word typed has to appear somewhere in what the card shows: the house,
// its address, who's on it, the kind of cleaning.
export function matchesSearch(fields: (string | null | undefined)[], query: string): boolean {
  const want = words(query).split(" ").filter(Boolean);
  if (want.length === 0) return true;
  const hay = ` ${words(fields.filter(Boolean).join(" "))} `;
  return want.every((w) => hay.includes(w));
}
