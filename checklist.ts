// The cleaning checklist: how the owner's template becomes the list a cleaner
// works through, and how that list reads back room by room. Nothing here
// imports app code, so `npm test` runs it straight under Node.

export type ChecklistItem = {
  text: string;
  done: boolean;
  // Room label ("Kitchen"), not a tickable step. Comes from a template line
  // ending in a colon.
  heading?: boolean;
  // A tip for the step, or on a heading, the note for the whole room.
  // Absent rather than null when there is none: Firestore rejects undefined.
  note?: string | null;
  // Stamped when someone ticks the step and cleared when they untick it, so
  // the owner can see what got done and when. Absent on steps ticked before
  // stamping existed.
  doneAt?: number | null;
  doneBy?: string | null;
  // Headings only: when the owner was told the room was finished, so a room
  // that is unticked and finished again doesn't notify twice.
  notifiedAt?: number | null;
  // Headings only: set when someone added the room to this one cleaning
  // ("Add a room"), rather than it coming from the template.
  addedAt?: number | null;
  addedBy?: string | null;
};

// Fallback for a brand-new install with no template saved yet.
export const DEFAULT_CHECKLIST: string[] = [
  "Strip all beds",
  "Wash and dry all laundry",
  "Clean and sanitize all kitchen appliances",
  "Clean bathrooms",
  "Vacuum + mop floors",
  "Restock supplies",
  "Wipe + sanitize surfaces",
  "Check for damages",
];

// Template lines, as the owner types them in the editor:
//   "Kitchen:"                       a room
//   "> Microfiber for everything"    the note for the room above it
//   "Oven | Wipe the door glass"     a step, with an optional tip after the bar
//   "Bathroom #:"                    a room repeated once per full bathroom
//   "Half bath:"                     a room only houses with a half bath get
//   "Bedroom (optional):"            a room left out until someone adds it
// Bathroom, half bath and optional rooms can also be added to one cleaning
// by hand ("Add a room"), for a house with more rooms than its count says.
const NOTE_PREFIX = /^\s*>\s?/;
const REPEAT_MARK = "#";
const OPTIONAL_MARK = /\s*\(optional\)\s*$/i;

export function isNoteLine(line: string): boolean {
  return NOTE_PREFIX.test(line);
}

export function isHeadingLine(line: string): boolean {
  return !line.includes("|") && !isNoteLine(line) && /:\s*$/.test(line);
}

function headingText(line: string): string {
  return line.replace(/:\s*$/, "").trim();
}

function isHalfBath(title: string): boolean {
  return /^half[\s-]*bath/i.test(title);
}

function isOptional(title: string): boolean {
  return OPTIONAL_MARK.test(title);
}

// "Bathroom #" -> "Bathroom", "Bedroom (optional)" -> "Bedroom".
function baseTitle(title: string): string {
  return title.replace(OPTIONAL_MARK, "").replace(/\s*#\s*/, " ").replace(/\s+/g, " ").trim();
}

// The kind of room a heading on a job is: "Bathroom 2" and "Bathrooms (all)"
// are both "Bathroom".
function headingBase(text: string): string {
  return text.replace(/s \(all\)$/, "").replace(/ \d+$/, "").trim();
}

export function parseStepLine(line: string): { text: string; note: string | null } {
  const bar = line.indexOf("|");
  if (bar === -1) return { text: line.trim(), note: null };
  const note = line.slice(bar + 1).trim();
  return { text: line.slice(0, bar).trim(), note: note || null };
}

type TemplateRoom = { title: string | null; note: string | null; steps: string[] };

// Groups template lines into rooms. Steps before the first heading form an
// untitled room, which is how every template written before rooms existed
// still works.
function templateRooms(lines: string[]): TemplateRoom[] {
  const rooms: TemplateRoom[] = [];
  let room: TemplateRoom = { title: null, note: null, steps: [] };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (isHeadingLine(line)) {
      if (room.title !== null || room.steps.length > 0) rooms.push(room);
      room = { title: headingText(line), note: null, steps: [] };
    } else if (isNoteLine(line)) {
      const text = line.replace(NOTE_PREFIX, "").trim();
      if (text) room.note = room.note ? `${room.note} ${text}` : text;
    } else {
      room.steps.push(line);
    }
  }
  if (room.title !== null || room.steps.length > 0) rooms.push(room);
  return rooms;
}

// How many copies of a "Bathroom #" room a house gets, and their titles.
// An unknown count (0 in the registry) gives one room covering every
// bathroom, so a house we haven't filled in yet still gets a usable list.
export function repeatTitles(title: string, bathrooms?: number | null): string[] {
  const full = typeof bathrooms === "number" && Number.isFinite(bathrooms) ? Math.floor(bathrooms) : 0;
  const bare = baseTitle(title);
  if (full < 1) return [`${bare}s (all)`];
  if (full === 1) return [bare];
  return Array.from({ length: full }, (_, i) => title.replace(REPEAT_MARK, String(i + 1)).trim());
}

export function hasHalfBath(bathrooms?: number | null): boolean {
  if (typeof bathrooms !== "number" || !Number.isFinite(bathrooms) || bathrooms < 1) return false;
  return bathrooms - Math.floor(bathrooms) >= 0.5;
}

function headingItem(title: string, note: string | null): ChecklistItem {
  return note ? { text: title, done: false, heading: true, note } : { text: title, done: false, heading: true };
}

function stepItem(line: string): ChecklistItem {
  const { text, note } = parseStepLine(line);
  return note ? { text, done: false, note } : { text, done: false };
}

export function buildChecklist(template?: string[] | null, opts?: { bathrooms?: number | null }): ChecklistItem[] {
  const source = template && template.length > 0 ? template : DEFAULT_CHECKLIST;
  const bathrooms = opts?.bathrooms;
  const out: ChecklistItem[] = [];
  for (const room of templateRooms(source)) {
    if (room.title === null) {
      out.push(...room.steps.map(stepItem));
      continue;
    }
    if (isOptional(room.title)) continue;
    if (isHalfBath(room.title) && !hasHalfBath(bathrooms)) continue;
    const titles = room.title.includes(REPEAT_MARK) ? repeatTitles(room.title, bathrooms) : [room.title];
    for (const title of titles) {
      out.push(headingItem(title, room.note), ...room.steps.map(stepItem));
    }
  }
  return out;
}

// The plain list phones on an older app version read from `items`: no notes,
// one shared bathroom room, and no half bath (the shared room covers it).
export function legacyItems(lines: string[]): string[] {
  const out: string[] = [];
  for (const room of templateRooms(lines)) {
    if (room.title !== null) {
      if (isHalfBath(room.title) || isOptional(room.title)) continue;
      const title = room.title.includes(REPEAT_MARK) ? repeatTitles(room.title, 0)[0] : room.title;
      out.push(`${title}:`);
    }
    out.push(...room.steps.map(s => parseStepLine(s).text));
  }
  return out;
}

// The template as stored at settings/checklist: `lines` (rooms, notes) when
// the owner has saved one from this version, else the older plain `items`.
export function templateFromDoc(data: { lines?: unknown; items?: unknown } | null | undefined): string[] {
  const pick = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "") : []);
  const lines = pick(data?.lines);
  if (lines.length > 0) return lines;
  const items = pick(data?.items);
  return items.length > 0 ? items : DEFAULT_CHECKLIST;
}

export function templateStats(lines: string[]): { rooms: number; steps: number } {
  const rooms = templateRooms(lines);
  return {
    rooms: rooms.filter(r => r.title !== null).length,
    steps: rooms.reduce((n, r) => n + r.steps.length, 0),
  };
}

export type ChecklistProgress = {
  done: number;
  total: number;
  // The most recent tick, so a card can say "last check 2:31 PM".
  lastAt: number | null;
  lastBy: string | null;
};

export function checklistProgress(items?: ChecklistItem[] | null): ChecklistProgress {
  let done = 0;
  let total = 0;
  let lastAt: number | null = null;
  let lastBy: string | null = null;
  for (const item of items || []) {
    // Headings are labels, not work: they never count toward progress.
    if (item.heading) continue;
    total++;
    if (!item.done) continue;
    done++;
    if (typeof item.doneAt === "number" && (lastAt === null || item.doneAt > lastAt)) {
      lastAt = item.doneAt;
      lastBy = item.doneBy || null;
    }
  }
  return { done, total, lastAt, lastBy };
}

export type RoomSection = {
  // Stable for a given list: the heading's index, or "start" for steps that
  // come before any heading.
  key: string;
  title: string;
  note: string | null;
  headingIndex: number | null;
  steps: { item: ChecklistItem; index: number }[];
  done: number;
  total: number;
  complete: boolean;
  // Earliest and latest tick in the room, and who made the latest.
  firstAt: number | null;
  lastAt: number | null;
  lastBy: string | null;
  // Added to this cleaning by hand, and by whom.
  added: boolean;
  addedBy: string | null;
};

export function roomSections(items?: ChecklistItem[] | null): RoomSection[] {
  const sections: RoomSection[] = [];
  let current: RoomSection | null = null;
  const open = (title: string, headingIndex: number | null, heading: ChecklistItem | null): RoomSection => ({
    key: headingIndex === null ? "start" : `h${headingIndex}`,
    title,
    note: heading?.note || null,
    headingIndex,
    steps: [], done: 0, total: 0, complete: false, firstAt: null, lastAt: null, lastBy: null,
    added: !!heading?.addedAt,
    addedBy: heading?.addedAt ? heading.addedBy || null : null,
  });
  (items || []).forEach((item, index) => {
    if (item.heading) {
      current = open(item.text, index, item);
      sections.push(current);
      return;
    }
    if (!current) {
      current = open("Checklist", null, null);
      sections.push(current);
    }
    current.steps.push({ item, index });
    current.total++;
    if (!item.done) return;
    current.done++;
    if (typeof item.doneAt !== "number") return;
    if (current.firstAt === null || item.doneAt < current.firstAt) current.firstAt = item.doneAt;
    if (current.lastAt === null || item.doneAt > current.lastAt) {
      current.lastAt = item.doneAt;
      current.lastBy = item.doneBy || null;
    }
  });
  // A heading with nothing under it is not a room anyone has to finish.
  return sections
    .filter(s => s.total > 0)
    .map(s => ({ ...s, complete: s.done === s.total }));
}

// Whole minutes between a room's first and last tick, or null when that is
// under a minute or not known.
export function roomMinutes(room: RoomSection): number | null {
  if (room.firstAt === null || room.lastAt === null) return null;
  const minutes = Math.round((room.lastAt - room.firstAt) / 60000);
  return minutes >= 1 ? minutes : null;
}

// Ticks or unticks one step. When the tick finishes a room for the first
// time, the room's heading is stamped and the room is returned so the caller
// can tell the owner; the stamp travels in the same write as the tick.
export function toggleStep(
  items: ChecklistItem[],
  index: number,
  actor: string | null,
  now: number,
): { items: ChecklistItem[]; finishedRoom: RoomSection | null } {
  const target = items[index];
  if (!target || target.heading) return { items, finishedRoom: null };
  const updated = items.map((item, i) => {
    if (i !== index) return item;
    return item.done
      ? { ...item, done: false, doneAt: null, doneBy: null }
      : { ...item, done: true, doneAt: now, doneBy: actor };
  });
  if (target.done) return { items: updated, finishedRoom: null };
  const room = roomSections(updated).find(s => s.steps.some(st => st.index === index));
  if (!room || !room.complete || room.headingIndex === null) return { items: updated, finishedRoom: null };
  const heading = updated[room.headingIndex];
  if (heading.notifiedAt) return { items: updated, finishedRoom: null };
  updated[room.headingIndex] = { ...heading, notifiedAt: now };
  return { items: updated, finishedRoom: room };
}

// Whether a job's stored list is its own: something was ticked, or a room was
// added by hand. Until then the list is just a copy of the template.
export function ownsList(items?: ChecklistItem[] | null): boolean {
  return (items || []).some(item => (item.heading ? !!item.addedAt : item.done));
}

// The list a job shows. Until a job owns its list, it shows the current
// template for its house, so a template change (or a list back-filled before
// rooms existed) never leaves a cleaner on a stale list. Once it owns its
// list, or the job is finished, it keeps it.
export function checklistForJob(input: {
  stored?: ChecklistItem[] | null;
  done: boolean;
  template: string[] | null;
  bathrooms?: number | null;
}): ChecklistItem[] {
  const stored = input.stored && input.stored.length > 0 ? input.stored : null;
  if (stored && (input.done || ownsList(stored) || input.template === null)) return stored;
  return buildChecklist(input.template, { bathrooms: input.bathrooms });
}

export type AddableRoom = { base: string; note: string | null; steps: string[] };

// Rooms that can be added to one cleaning by hand: the per-bathroom room,
// the half bath, and any room marked (optional), in template order.
export function addableRooms(template?: string[] | null): AddableRoom[] {
  const out: AddableRoom[] = [];
  for (const room of templateRooms(template && template.length > 0 ? template : [])) {
    if (room.title === null || room.steps.length === 0) continue;
    if (!room.title.includes(REPEAT_MARK) && !isHalfBath(room.title) && !isOptional(room.title)) continue;
    const base = baseTitle(room.title);
    if (!out.some(r => r.base === base)) out.push({ base, note: room.note, steps: room.steps });
  }
  return out;
}

// Index just past the room whose heading is at `headingIndex`.
function roomEnd(items: ChecklistItem[], headingIndex: number): number {
  for (let i = headingIndex + 1; i < items.length; i++) if (items[i].heading) return i;
  return items.length;
}

// Adds another room of a kind to one cleaning. Rooms of that kind get
// numbered ("Bathroom" becomes "Bathroom 1", "Bathrooms (all)" too, and the
// new one is "Bathroom 2"), and the new room goes after the last of its kind,
// or where the template puts that kind of room.
export function addRoom(
  items: ChecklistItem[],
  template: string[],
  base: string,
  by: string | null,
  now: number,
): ChecklistItem[] {
  const room = addableRooms(template).find(r => r.base === base);
  if (!room) return items;
  const out = items.slice();
  const same: number[] = [];
  out.forEach((item, i) => {
    if (item.heading && headingBase(item.text) === base) same.push(i);
  });
  if (same.length > 0) {
    same.forEach((i, k) => {
      if (!/ \d+$/.test(out[i].text)) out[i] = { ...out[i], text: `${base} ${k + 1}` };
    });
  }
  const title = same.length === 0 ? base : `${base} ${same.length + 1}`;
  const heading: ChecklistItem = { ...headingItem(title, room.note), addedAt: now, addedBy: by };
  const block = [heading, ...room.steps.map(stepItem)];

  let at = out.length;
  if (same.length > 0) {
    at = roomEnd(out, same[same.length - 1]);
  } else {
    const order = templateRooms(template).filter(r => r.title !== null).map(r => baseTitle(r.title as string));
    const later = new Set(order.slice(order.indexOf(base) + 1));
    const next = out.findIndex(item => item.heading && later.has(headingBase(item.text)));
    if (next !== -1) at = next;
  }
  out.splice(at, 0, ...block);
  return out;
}

// Takes back a room added by hand, as long as nothing in it is ticked.
export function removeRoom(items: ChecklistItem[], headingIndex: number): ChecklistItem[] {
  const heading = items[headingIndex];
  if (!heading || !heading.heading || !heading.addedAt) return items;
  const end = roomEnd(items, headingIndex);
  if (items.slice(headingIndex + 1, end).some(item => item.done)) return items;
  return [...items.slice(0, headingIndex), ...items.slice(end)];
}

// The room the cleaner is in: wherever the most recent tick landed.
export function currentRoom(items?: ChecklistItem[] | null): string | null {
  let best: RoomSection | null = null;
  for (const room of roomSections(items)) {
    if (room.lastAt !== null && (best === null || best.lastAt === null || room.lastAt > best.lastAt)) best = room;
  }
  return best ? best.title : null;
}

// Unchecked steps grouped by room, for the "finish with a reason" sheet.
export function unfinishedByRoom(items?: ChecklistItem[] | null): { title: string; steps: string[] }[] {
  return roomSections(items)
    .filter(room => !room.complete)
    .map(room => ({ title: room.title, steps: room.steps.filter(st => !st.item.done).map(st => st.item.text) }));
}
