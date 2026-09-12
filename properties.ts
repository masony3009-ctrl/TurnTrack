// The house registry at settings/properties. It is the one place a street
// address or a door code is written down; the Apps Script, the Airbnb sync and
// the app all read it, so changing a code here changes it everywhere at once
// rather than needing every existing job rewritten.
export type Property = {
  name: string;
  address: string;
  aliases: string[];
  bedrooms: number;
  bathrooms: number;
  // Absent when we simply do not have that code for that house.
  doorCode?: string;
  garageCode?: string;
  supplyCode?: string;
};

export type AccessCode = { label: string; code: string };

// Same shape as dedupeKey() in the Apps Script and the Airbnb sync, so all
// three agree on when two names mean the same house.
function normalize(v: string | null | undefined): string {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
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
      address: String(v.address ?? ""),
      aliases: Array.isArray(v.aliases) ? v.aliases.map(String) : [],
      bedrooms: Number(v.bedrooms ?? 0),
      bathrooms: Number(v.bathrooms ?? 0),
      doorCode: v.doorCode ? String(v.doorCode) : undefined,
      garageCode: v.garageCode ? String(v.garageCode) : undefined,
      supplyCode: v.supplyCode ? String(v.supplyCode) : undefined,
    }));
}
