// Low supplies a cleaner flags at the finish, kept per house at
// settings/supplies until the owner restocks them.
//
// Pure (no React, no Firebase) so it runs under node --test.

// What runs out at a rental. Picked from chips, so the shopping list spells
// each thing the same way every time.
export const SUPPLY_CHOICES = [
  "Toilet paper",
  "Paper towels",
  "Trash bags",
  "Dish soap",
  "Dishwasher pods",
  "Laundry detergent",
  "Hand soap",
  "Shampoo & body wash",
  "Coffee",
  "Sponges",
  "Cleaning spray",
];

export type SupplyReport = {
  key: string;
  // The house's display name when it was reported.
  name: string;
  items: string[];
  at: number;
  by: string | null;
  jobId: string | null;
};

// settings/supplies -> houses that still need something, most recent first.
export function parseSupplies(data: unknown): SupplyReport[] {
  const houses = (data as { houses?: unknown } | null | undefined)?.houses;
  if (!houses || typeof houses !== "object") return [];
  const out: SupplyReport[] = [];
  for (const [key, raw] of Object.entries(houses as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const v = raw as Record<string, unknown>;
    const items = Array.isArray(v.items) ? [...new Set(v.items.map(String).filter(Boolean))] : [];
    if (items.length === 0) continue;
    out.push({
      key,
      name: String(v.name || key),
      items,
      at: Number(v.at) || 0,
      by: v.by ? String(v.by) : null,
      jobId: v.jobId ? String(v.jobId) : null,
    });
  }
  return out.sort((a, b) => b.at - a.at);
}

// "Toilet paper, coffee and trash bags"
export function supplyList(items: string[]): string {
  const words = items.map((s, i) => (i === 0 ? s : s.charAt(0).toLowerCase() + s.slice(1)));
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

// The owner's push for a finish that left a note or flagged supplies.
export function finishReportText(
  who: string,
  house: string,
  note: { text: string; skipped: number } | null,
  supplies: string[]
): { title: string; body: string } {
  const skipped = note && note.skipped > 0 ? ` · ${note.skipped} step${note.skipped === 1 ? "" : "s"} not done` : "";
  const title = note ? `Note from ${who} · ${house}${skipped}` : `${who} flagged low supplies · ${house}`;
  const list = supplyList(supplies);
  const low = list ? `Low on ${list.charAt(0).toLowerCase()}${list.slice(1)}.` : "";
  return { title, body: [low, note?.text || ""].filter(Boolean).join(" ") };
}
