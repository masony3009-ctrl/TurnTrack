// The house registry at settings/properties. It is the one place a street
// address or a door code is written down; the Apps Script, the Airbnb sync and
// the app all read it, so changing a code here changes it everywhere at once
// rather than needing every existing job rewritten.
export type Property = {
  name: string;
  // What people call the house ("Desert Oasis"), for notifications.
  short?: string;
  address: string;
  aliases: string[];
  bedrooms: number;
  bathrooms: number;
  // Absent when we simply do not have that code for that house.
  doorCode?: string;
  garageCode?: string;
  supplyCode?: string;
  // What a regular cleaning here pays us, in dollars. Deep cleans and one-offs
  // are priced on the job instead.
  price?: number;
  // "YYYY-MM-DD": the host pays us directly (not through Turno) for cleanings
  // from this day on, so the app tracks what they still owe.
  billedFrom?: string;
};

export type AccessCode = { label: string; code: string };

// Same shape as dedupeKey() in the Apps Script and the Airbnb sync, so all
// three agree on when two names mean the same house.
function normalize(v: string | null | undefined): string {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// A stable id for a house, safe to use as a Firestore map key.
export function houseKey(name: string | null | undefined): string {
  return normalize(name);
}

// Match on the property name first, then the address, then the aliases.
// Aliases are deliberately narrow in the registry: two houses on the same
// street are different houses, so neither owns the bare street name.
// Anything carrying a property name and an address - a Job, or a bare pair.
export type PropertyLike = { property?: string | null; address?: string | null };

export function findProperty(properties: Property[], job: PropertyLike | null | undefined): Property | null {
  if (!job) return null;
  const hay = `${normalize(job.property)} ${normalize(job.address)}`;
  const propertyKey = normalize(job.property);
  const addressKey = normalize(job.address);

  for (const p of properties) {
    const name = normalize(p.name);
    if (name && (name === propertyKey || name === addressKey)) return p;
  }
  for (const p of properties) {
    const address = normalize(p.address);
    if (address && address === addressKey) return p;
  }
  for (const p of properties) {
    if (normalize(p.name) && hay.includes(normalize(p.name))) return p;
    for (const alias of p.aliases || []) {
      const a = normalize(alias);
      if (a && hay.includes(a)) return p;
    }
  }
  return null;
}

// Only the codes we actually have, in the order someone walking up to the
// house needs them.
export function accessCodes(p: Property | null): AccessCode[] {
  if (!p) return [];
  const out: AccessCode[] = [];
  if (p.doorCode) out.push({ label: "Front door", code: p.doorCode });
  if (p.garageCode) out.push({ label: "Garage", code: p.garageCode });
  if (p.supplyCode) out.push({ label: "Supply closet", code: p.supplyCode });
  return out;
}

export function parseProperties(raw: unknown): Property[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
    .map((v) => ({
      name: String(v.name ?? ""),
      short: v.short ? String(v.short) : undefined,
      address: String(v.address ?? ""),
      aliases: Array.isArray(v.aliases) ? v.aliases.map(String) : [],
      bedrooms: Number(v.bedrooms ?? 0),
      bathrooms: Number(v.bathrooms ?? 0),
      doorCode: v.doorCode ? String(v.doorCode) : undefined,
      garageCode: v.garageCode ? String(v.garageCode) : undefined,
      supplyCode: v.supplyCode ? String(v.supplyCode) : undefined,
      price: Number(v.price) > 0 ? Number(v.price) : undefined,
      billedFrom: typeof v.billedFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.billedFrom) ? v.billedFrom : undefined,
    }));
}

// The street part of a job's address ("4 Oak Rd" out of "4 Oak Rd, Mesa, AZ"),
// or its property name when there's no address.
export function streetOf(job: PropertyLike): string {
  return String(job.address || job.property || "").split(",")[0].trim();
}

// An address with the repeats and "USA" some sources tack on taken out:
// "4 Oak Rd, Mesa, AZ 85201, USA, Mesa, Mesa" -> "4 Oak Rd, Mesa, AZ 85201".
export function tidyAddress(raw: string | null | undefined): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const part of String(raw || "").split(",")) {
    const p = part.trim();
    const k = normalize(p);
    if (!k || k === "usa" || seen.has(k)) continue;
    seen.add(k);
    parts.push(p);
  }
  return parts.join(", ");
}

// The aliases a house needs so every one of these jobs files under it. Most
// need none (the name or address already matches); the rest get their street
// address, which a neighbour's house never shares.
export function aliasesToLink(house: Property, jobs: PropertyLike[]): string[] {
  const added: string[] = [];
  for (const job of jobs) {
    const current = { ...house, aliases: [...house.aliases, ...added] };
    if (findProperty([current], job)) continue;
    const alias = [streetOf(job), String(job.address || ""), String(job.property || "")]
      .map((a) => a.trim())
      .find((a) => normalize(a).length >= 3 && findProperty([{ ...current, aliases: [...current.aliases, a] }], job));
    if (alias) added.push(alias);
  }
  return added;
}

export type RegistryChanges = Record<string, string | number | string[] | null>;

// Applies an edit to the raw settings/properties items, keeping every field
// this app doesn't know about (the scripts may store their own). A null or
// empty value removes the field. A name that isn't in the list adds a house.
// addAliases are added to the ones the house already has, never replacing them.
export function patchRegistry(raw: unknown, name: string, changes: RegistryChanges, addAliases: string[] = []): Record<string, unknown>[] {
  const items = Array.isArray(raw)
    ? raw.filter((v): v is Record<string, unknown> => !!v && typeof v === "object").map((v) => ({ ...v }))
    : [];
  let target = items.find((v) => v.name === name);
  if (!target) {
    target = { name, address: "", aliases: [], bedrooms: 0, bathrooms: 0 };
    items.push(target);
  }
  for (const [field, value] of Object.entries(changes)) {
    if (field === "name") continue;
    if (value === null || value === "") delete target[field];
    else target[field] = value;
  }
  if (addAliases.length) {
    const aliases = Array.isArray(target.aliases) ? target.aliases.map(String) : [];
    const have = new Set(aliases.map(normalize));
    for (const a of addAliases) {
      const k = normalize(a);
      if (!k || have.has(k)) continue;
      have.add(k);
      aliases.push(a.trim());
    }
    target.aliases = aliases;
  }
  return items;
}
