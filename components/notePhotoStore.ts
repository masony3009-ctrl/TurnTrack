import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { arrayRemove, arrayUnion, collection, deleteDoc, doc, getDoc, runTransaction, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { fitWithin, MAX_PHOTO_CHARS, photoIdsOf, PHOTO_EDGE, withPhotos, withoutPhoto } from "../notePhotos";
import { patchRegistry } from "../properties";

// Where note photos live: one document per photo, { data, width, height,
// for, createdAt }, data being a JPEG data URI. They sit in /settings under
// ids starting "photo_" because the database rules already let the app read
// and write there; nothing lists that collection, so they stay out of the way.
const PHOTOS = "settings";
const newPhotoId = () => `photo_${doc(collection(db, PHOTOS)).id}`;

export type PhotoOwner = { kind: "house"; name: string; max: number } | { kind: "job"; id: string; max: number };

type Shrunk = { data: string; width: number; height: number };

// One picked photo, resized and compressed until it fits in a document.
async function shrink(asset: ImagePicker.ImagePickerAsset): Promise<Shrunk | null> {
  const tries = [{ edge: PHOTO_EDGE, compress: 0.6 }, { edge: 1024, compress: 0.45 }, { edge: 800, compress: 0.35 }];
  for (const t of tries) {
    const fit = fitWithin(asset.width, asset.height, t.edge);
    const out = await ImageManipulator.manipulateAsync(asset.uri, fit ? [{ resize: fit }] : [], {
      compress: t.compress,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    });
    if (out.base64 && out.base64.length <= MAX_PHOTO_CHARS) {
      return { data: `data:image/jpeg;base64,${out.base64}`, width: out.width, height: out.height };
    }
  }
  return null;
}

// Lets the owner pick up to `room` photos from the phone, stores each one, and
// returns the new ids (empty when they backed out). Photos too big to store
// even after shrinking are skipped; `skipped` says how many.
export async function pickAndStorePhotos(room: number, owner: PhotoOwner): Promise<{ ids: string[]; skipped: number }> {
  if (room <= 0) return { ids: [], skipped: 0 };
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsMultipleSelection: room > 1,
    selectionLimit: room,
    quality: 1,
  });
  if (result.canceled || !result.assets?.length) return { ids: [], skipped: 0 };
  const ids: string[] = [];
  let skipped = 0;
  for (const asset of result.assets.slice(0, room)) {
    const photo = await shrink(asset);
    if (!photo) {
      skipped += 1;
      continue;
    }
    const ref = doc(db, PHOTOS, newPhotoId());
    await setDoc(ref, {
      ...photo,
      for: owner.kind === "house" ? `house:${owner.name}` : `job:${owner.id}`,
      createdAt: Date.now(),
    });
    ids.push(ref.id);
  }
  return { ids, skipped };
}

// Puts stored photos on the house or the cleaning. The registry is read and
// written in one go so a photo never drops an edit made a moment ago.
export async function attachPhotos(owner: PhotoOwner, ids: string[]): Promise<void> {
  if (!ids.length) return;
  if (owner.kind === "job") {
    await updateDoc(doc(db, "jobs", owner.id), { notePhotos: arrayUnion(...ids) });
    return;
  }
  await runTransaction(db, async (tx) => {
    const ref = doc(db, "settings", "properties");
    const snap = await tx.get(ref);
    const items: unknown = snap.data()?.items;
    const house = Array.isArray(items) ? items.find((v) => v && typeof v === "object" && (v as { name?: unknown }).name === owner.name) : null;
    if (!house) throw new Error(`${owner.name} is no longer a house`);
    const next = withPhotos(photoIdsOf((house as { notePhotos?: unknown }).notePhotos), ids, owner.max);
    tx.set(ref, { items: patchRegistry(items, owner.name, { notePhotos: next }), updatedAt: Date.now() }, { merge: true });
  });
}

// Takes a photo off the house or the cleaning, then deletes it.
export async function removePhoto(owner: PhotoOwner, id: string): Promise<void> {
  if (owner.kind === "job") {
    await updateDoc(doc(db, "jobs", owner.id), { notePhotos: arrayRemove(id) });
  } else {
    await runTransaction(db, async (tx) => {
      const ref = doc(db, "settings", "properties");
      const snap = await tx.get(ref);
      const items: unknown = snap.data()?.items;
      const house = Array.isArray(items) ? items.find((v) => v && typeof v === "object" && (v as { name?: unknown }).name === owner.name) : null;
      if (!house) return;
      const next = withoutPhoto(photoIdsOf((house as { notePhotos?: unknown }).notePhotos), id);
      tx.set(ref, { items: patchRegistry(items, owner.name, { notePhotos: next.length ? next : null }), updatedAt: Date.now() }, { merge: true });
    });
  }
  await deletePhotos([id]);
}

// Deletes stored photos nothing points at any more. Best effort: a photo left
// behind costs a little storage and nothing else.
export async function deletePhotos(ids: string[]): Promise<void> {
  // Only ever a photo: never another settings document, whatever the list says.
  await Promise.all(ids.filter(id => id.startsWith("photo_")).map(id => deleteDoc(doc(db, PHOTOS, id)).catch((e: unknown) => console.warn("photo delete failed:", id, e))));
}

// Photos already read this session, so opening the same cleaning twice
// doesn't read them twice. "missing" = deleted or never stored.
const cache = new Map<string, string | "missing">();
const loading = new Map<string, Promise<string | "missing">>();

export function cachedPhoto(id: string): string | "missing" | undefined {
  return cache.get(id);
}

export function loadPhoto(id: string): Promise<string | "missing"> {
  const have = cache.get(id);
  if (have) return Promise.resolve(have);
  if (!id.startsWith("photo_")) return Promise.resolve("missing");
  const pending = loading.get(id);
  if (pending) return pending;
  const work = getDoc(doc(db, PHOTOS, id))
    .then((snap) => {
      const data = snap.data()?.data;
      const value = typeof data === "string" && data.startsWith("data:image/") ? data : "missing";
      cache.set(id, value);
      return value;
    })
    .finally(() => loading.delete(id));
  loading.set(id, work);
  return work;
}
