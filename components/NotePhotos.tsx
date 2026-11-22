import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, LayoutChangeEvent, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { photoCount, photosLeft } from "../notePhotos";
import { colors, radius } from "../theme";
import { tapSelect, tapSuccess } from "./haptics";
import { attachPhotos, cachedPhoto, deletePhotos, loadPhoto, pickAndStorePhotos, removePhoto, type PhotoOwner } from "./notePhotoStore";

type Loaded = Record<string, string | "missing" | "failed">;

const isPhoto = (v: string | undefined): v is string => typeof v === "string" && v.startsWith("data:");

// Three thumbnails to a row, sized to whatever width the note has.
function useThumbSize(): [number, (e: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    setWidth(prev => (prev === w ? prev : w));
  };
  return [width ? Math.floor((width - GAP * 2) / 3) : 0, onLayout];
}

// Reads the photos for these ids (each once per app session).
function usePhotos(ids: string[]): Loaded {
  const key = ids.join(",");
  const [loaded, setLoaded] = useState<Loaded>(() => {
    const start: Loaded = {};
    ids.forEach(id => { const c = cachedPhoto(id); if (c) start[id] = c; });
    return start;
  });
  useEffect(() => {
    let live = true;
    key.split(",").filter(Boolean).forEach(id => {
      loadPhoto(id)
        .then(value => { if (live) setLoaded(prev => ({ ...prev, [id]: value })); })
        .catch(e => {
          console.warn("photo load failed:", id, e);
          if (live) setLoaded(prev => ({ ...prev, [id]: "failed" }));
        });
    });
    return () => { live = false; };
  }, [key]);
  return loaded;
}

function Thumb({ value, size, onPress, label }: { value: string | "missing" | "failed" | undefined; size: number; onPress?: () => void; label: string }) {
  const body = value === undefined ? (
    <ActivityIndicator color={colors.teal} />
  ) : value === "missing" || value === "failed" ? (
    <Ionicons name={value === "failed" ? "cloud-offline-outline" : "image-outline"} size={22} color={colors.faint} />
  ) : (
    <Image source={{ uri: value }} style={StyleSheet.absoluteFill} resizeMode="cover" />
  );
  return (
    <TouchableOpacity
      style={[styles.thumb, { width: size, height: size }]}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.8}
      accessibilityRole={onPress ? "imagebutton" : "image"}
      accessibilityLabel={label}
    >
      {body}
    </TouchableOpacity>
  );
}

// Square thumbnails three to a row; tapping one opens it full screen.
export function PhotoGrid({ ids }: { ids: string[] }) {
  const loaded = usePhotos(ids);
  const [open, setOpen] = useState<number | null>(null);
  const [size, onLayout] = useThumbSize();
  if (!ids.length) return null;
  const ready = ids.filter(id => isPhoto(loaded[id]));
  return (
    <>
      <View style={styles.grid} onLayout={onLayout}>
        {size ? ids.map((id, i) => (
          <Thumb
            key={id}
            value={loaded[id]}
            size={size}
            label={`Photo ${i + 1} of ${ids.length}`}
            onPress={isPhoto(loaded[id]) ? () => { tapSelect(); setOpen(ready.indexOf(id)); } : undefined}
          />
        )) : null}
      </View>
      <PhotoViewer photos={ready.map(id => loaded[id]).filter(isPhoto)} start={open} onClose={() => setOpen(null)} />
    </>
  );
}

// Full screen, swipe between photos.
function PhotoViewer({ photos, start, onClose }: { photos: string[]; start: number | null; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [at, setAt] = useState(0);
  useEffect(() => { if (start !== null) setAt(start); }, [start]);
  return (
    <Modal visible={start !== null} animationType="fade" onRequestClose={onClose} supportedOrientations={["portrait"]}>
      <View style={styles.viewer}>
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: (start || 0) * width, y: 0 }}
          onMomentumScrollEnd={e => setAt(Math.round(e.nativeEvent.contentOffset.x / width))}
        >
          {photos.map((uri, i) => (
            <Image key={i} source={{ uri }} style={{ width, height }} resizeMode="contain" accessibilityLabel={`Photo ${i + 1} of ${photos.length}`} />
          ))}
        </ScrollView>
        <View style={[styles.viewerTop, { top: insets.top + 8 }]}>
          <Text style={styles.viewerCount}>{photos.length > 1 ? `${at + 1} of ${photos.length}` : ""}</Text>
          <TouchableOpacity style={styles.viewerClose} onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close the photo">
            <Ionicons name="close" size={26} color={colors.white} />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// The owner's photo list on a note: thumbnails with a remove button, and an
// add tile while there's room. Photos save the moment they're added or
// removed, apart from the rest of the form.
export function NotePhotosEditor({ owner, ids: start }: { owner: PhotoOwner; ids: string[] }) {
  const [ids, setIds] = useState(start);
  const startKey = start.join(",");
  useEffect(() => { setIds(startKey ? startKey.split(",") : []); }, [startKey]);
  const [adding, setAdding] = useState(false);
  const loaded = usePhotos(ids);
  const room = photosLeft(ids.length, owner.max);
  const [size, onLayout] = useThumbSize();

  const add = async () => {
    if (adding || room === 0) return;
    tapSelect();
    setAdding(true);
    let stored: string[] = [];
    try {
      const picked = await pickAndStorePhotos(room, owner);
      stored = picked.ids;
      if (stored.length) {
        await attachPhotos(owner, stored);
        setIds(prev => [...prev, ...stored.filter(id => !prev.includes(id))]);
        tapSuccess();
      }
      if (picked.skipped) {
        Alert.alert("Some photos were too big", `${photoCount(picked.skipped)} couldn't be shrunk enough to save. Try a smaller one or a screenshot of it.`);
      }
    } catch (e) {
      console.warn("add photos failed:", e);
      if (stored.length) deletePhotos(stored);
      Alert.alert("Couldn't add the photos", "Nothing was added. Check your signal and try again.");
    }
    setAdding(false);
  };

  const remove = (id: string) => {
    Alert.alert("Remove this photo?", "The crew won't see it any more.", [
      { text: "Keep", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await removePhoto(owner, id);
            setIds(prev => prev.filter(v => v !== id));
          } catch (e) {
            console.warn("remove photo failed:", e);
            Alert.alert("Couldn't remove the photo", "It's still there. Check your signal and try again.");
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.editor}>
      <View style={styles.grid} onLayout={onLayout}>
        {size ? ids.map((id, i) => (
          <View key={id}>
            <Thumb value={loaded[id]} size={size} label={`Photo ${i + 1}`} />
            <TouchableOpacity style={styles.remove} onPress={() => remove(id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove photo ${i + 1}`}>
              <Ionicons name="close" size={15} color={colors.white} />
            </TouchableOpacity>
          </View>
        )) : null}
        {size && room > 0 ? (
          <TouchableOpacity
            style={[styles.thumb, styles.addTile, { width: size, height: size }]}
            onPress={add}
            disabled={adding}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Add photos"
          >
            {adding ? (
              <>
                <ActivityIndicator color={colors.tealDark} />
                <Text style={styles.addText}>Saving…</Text>
              </>
            ) : (
              <>
                <Ionicons name="images-outline" size={24} color={colors.tealDark} />
                <Text style={styles.addText}>Add photos</Text>
              </>
            )}
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={styles.hint}>
        {room > 0 ? `Saved as soon as you add them · up to ${owner.max}` : `That's the most a note holds (${owner.max}). Remove one to add another.`}
      </Text>
    </View>
  );
}

const GAP = 8;

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP, marginTop: 10 },
  thumb: { borderRadius: radius.sm, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  addTile: { borderStyle: "dashed", borderColor: colors.tealDark, backgroundColor: colors.tealFaint, gap: 4 },
  addText: { fontSize: 12, fontWeight: "700", color: colors.tealDark },
  remove: {
    position: "absolute", top: 4, right: 4, width: 24, height: 24, borderRadius: 12,
    backgroundColor: "rgba(30,42,50,0.75)", alignItems: "center", justifyContent: "center",
  },
  editor: { marginTop: -4, marginBottom: 14 },
  hint: { fontSize: 12, color: colors.muted, marginTop: 6 },
  viewer: { flex: 1, backgroundColor: "#000" },
  viewerTop: { position: "absolute", left: 16, right: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  viewerCount: { fontSize: 15, fontWeight: "700", color: colors.white },
  viewerClose: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
});
