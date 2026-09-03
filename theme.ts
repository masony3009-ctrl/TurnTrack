export const colors = {
  teal: "#0AA5A0",
  tealDark: "#087F7B",
  tealSoft: "#E0F3F2",
  tealFaint: "#F0FAF9",
  ink: "#233038",
  dark: "#1E2A32",
  muted: "#5C6B76",
  faint: "#93A3AD",
  bg: "#F3F7F7",
  card: "#FFFFFF",
  line: "#E3E9EC",
  gold: "#F2A93B",
  goldSoft: "#FCF1DD",
  goldDark: "#8A5B10",
  danger: "#D64545",
  dangerSoft: "#FBEBEB",
  white: "#FFFFFF",
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
};

export const shadow = {
  card: {
    shadowColor: "#1E2A32",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  raised: {
    shadowColor: "#1E2A32",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
    elevation: 6,
  },
};

export const type = {
  wordmark: { fontSize: 11, fontWeight: "700" as const, color: colors.teal, letterSpacing: 2.5, textTransform: "uppercase" as const },
  title: { fontSize: 26, fontWeight: "700" as const, color: colors.ink },
  subtitle: { fontSize: 14, color: colors.muted },
  section: { fontSize: 11, fontWeight: "700" as const, color: colors.faint, letterSpacing: 1.2, textTransform: "uppercase" as const },
  body: { fontSize: 15, color: colors.ink },
  bodyBold: { fontSize: 15, fontWeight: "600" as const, color: colors.ink },
  caption: { fontSize: 12.5, color: colors.muted },
};

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Distinct colors for cleaners so the calendar and job cards show at a glance
// who has which cleaning. Teal and gold are reserved for the app itself.
export const cleanerPalette: string[] = [
  "#E5624F", // coral
  "#7B61D1", // violet
  "#2F8BD6", // sky
  "#6FA321", // lime
  "#C9408F", // magenta
  "#D98A12", // amber
  "#2E4A9E", // navy
  "#8C8A1A", // olive
  "#8E3B6B", // plum
  "#3A9E7A", // jade
];

export const unassignedColor = colors.gold;

type Colorable = { id: string; color?: string | null } | null | undefined;

// A cleaner's color, falling back to a stable palette pick for older
// employee records that were created before colors existed.
export function cleanerColor(employee: Colorable): string {
  if (!employee) return unassignedColor;
  if (employee.color) return employee.color;
  let hash = 0;
  for (const ch of employee.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return cleanerPalette[hash % cleanerPalette.length];
}

export function pickUnusedColor(employees: { color?: string | null }[]): string {
  const used = new Set(employees.map(e => e.color).filter(Boolean));
  return cleanerPalette.find(c => !used.has(c)) || cleanerPalette[employees.length % cleanerPalette.length];
}

// "#RRGGBB" -> translucent tint for backgrounds behind colored text.
export function tint(hex: string, alpha = 0.16): string {
  const a = Math.round(alpha * 255).toString(16).padStart(2, "0");
  return `${hex}${a}`;
}
