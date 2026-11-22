// Photos on notes: a house's notes for the crew, and a cleaning's own notes.
// Each photo is its own document (settings/photo_…) holding a small JPEG as a
// data URI. The house (in the registry) or the cleaning keeps only the list of
// ids, so nothing is read until someone opens a screen that shows them.
// Nothing here imports app code, so `npm test` runs it straight under Node.

// The long side of a photo after resizing, in pixels. Sharp on a phone
// screen, small enough that a dozen photos read quickly on a cell signal.
export const PHOTO_EDGE = 1280;
// A Firestore document holds at most 1 MiB. A photo whose data URI is longer
// than this after compressing gets shrunk again.
export const MAX_PHOTO_CHARS = 700_000;
export const MAX_HOUSE_PHOTOS = 12;
export const MAX_JOB_PHOTOS = 6;

// Firestore auto ids are 20 letters and digits.
const ID = /^[A-Za-z0-9_-]{6,40}$/;

// The photo ids stored on a house or a cleaning: valid strings only, each once.
export function photoIdsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || !ID.test(v) || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

// How to resize a picked photo so its long side is at most `edge`: by width
// for a wide or square photo, by height for a tall one. Null when it is
// already small enough (or its size is unknown).
export function fitWithin(width: number, height: number, edge: number = PHOTO_EDGE): { width: number } | { height: number } | null {
  if (!(width > 0) || !(height > 0)) return null;
  if (width <= edge && height <= edge) return null;
  return width >= height ? { width: edge } : { height: edge };
}

// How many more photos fit, never below zero.
export function photosLeft(have: number, max: number): number {
  return Math.max(0, max - have);
}

// "1 photo", "3 photos".
export function photoCount(n: number): string {
  return `${n} photo${n === 1 ? "" : "s"}`;
}

// The ids after adding some (each once, in order, never past max) or taking one out.
export function withPhotos(current: string[], added: string[], max: number): string[] {
  return photoIdsOf([...current, ...added]).slice(0, max);
}

export function withoutPhoto(current: string[], id: string): string[] {
  return current.filter((v) => v !== id);
}
