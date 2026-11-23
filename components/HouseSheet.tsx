import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import { Alert, Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { parsePrice, type Client } from "../money";
import { MAX_HOUSE_PHOTOS } from "../notePhotos";
import { aliasesToLink, videoLink, videoSite, type Property, type RegistryChanges } from "../properties";
import { DEFAULT_CLEANER_PAY, formatDollars } from "../payroll";
import { colors, radius, type } from "../theme";
import { formatShortDate, todayKey } from "../turnover";
import { parseChecklistText } from "../types";
import { tapSelect } from "./haptics";
import { NotePhotosEditor } from "./NotePhotos";
import { TimeChips } from "./TimeChips";
import { BrandButton, DatePickerField, FormInput, SheetModal } from "./ui";

type Form = {
  name: string;
  address: string;
  short: string;
  price: string;
  cleanerPay: string;
  bedrooms: string;
  bathrooms: string;
  doorCode: string;
  garageCode: string;
  supplyCode: string;
  lockboxCode: string;
  lockboxSpot: string;
  billedFrom: string | null;
  steps: string;
  forwardsFrom: string;
  notes: string;
  video: string;
  checkOutTime: string | null;
  checkInTime: string | null;
};

// Checkout from 8 AM to noon, check-in from 2 PM to 6 PM, on the half hour.
const CHECKOUT_TIMES = ["08:00", "09:00", "10:00", "10:30", "11:00", "11:30", "12:00"];
const CHECKIN_TIMES = ["14:00", "15:00", "15:30", "16:00", "16:30", "17:00", "18:00"];

function formOf(house: Property | null): Form {
  return {
    name: house?.name || "",
    address: house?.address || "",
    short: house?.short || "",
    price: house?.price ? String(house.price) : "",
    cleanerPay: house?.cleanerPay ? String(house.cleanerPay) : "",
    bedrooms: house?.bedrooms ? String(house.bedrooms) : "",
    bathrooms: house?.bathrooms ? String(house.bathrooms) : "",
    doorCode: house?.doorCode || "",
    garageCode: house?.garageCode || "",
    supplyCode: house?.supplyCode || "",
    lockboxCode: house?.lockboxCode || "",
    lockboxSpot: house?.lockboxSpot || "",
    billedFrom: house?.billedFrom || null,
    steps: (house?.checklist || []).join("\n"),
    forwardsFrom: house?.forwardsFrom || "",
    notes: house?.notes || "",
    video: house?.walkthroughUrl || "",
    checkOutTime: house?.checkOutTime || null,
    checkInTime: house?.checkInTime || null,
  };
}

// "2", "2.5" -> the number; "" -> 0; anything else -> null.
function roomCount(text: string): number | null {
  const t = text.trim();
  if (!t) return 0;
  if (!/^\d{1,2}(\.5)?$/.test(t)) return null;
  return Number(t);
}

const CLIENTS_SHOWN = 5;

// Which form fields each saved value comes from.
const FIELDS_OF: Record<string, (keyof Form)[]> = {
  address: ["address"],
  short: ["short"],
  price: ["price"],
  cleanerPay: ["cleanerPay"],
  bedrooms: ["bedrooms"],
  bathrooms: ["bathrooms"],
  doorCode: ["doorCode"],
  garageCode: ["garageCode"],
  supplyCode: ["supplyCode"],
  lockboxCode: ["lockboxCode"],
  lockboxSpot: ["lockboxCode", "lockboxSpot"],
  billedFrom: ["billedFrom"],
  checklist: ["steps"],
  forwardsFrom: ["forwardsFrom"],
  notes: ["notes"],
  walkthroughUrl: ["video"],
  checkOutTime: ["checkOutTime"],
  checkInTime: ["checkInTime"],
};

// Edits one house in the registry, or adds one (house = null). Codes typed
// here show up on every cleaning at that house, past and future. Cleanings
// that aren't under a house yet can be linked to it, so their money counts.
export function HouseSheet({ visible, house, clients, busy, onClose, onSave, onDelete }: {
  visible: boolean;
  house: Property | null;
  clients: Client[];
  busy: boolean;
  onClose: () => void;
  onSave: (name: string, changes: RegistryChanges, aliases: string[]) => void;
  onDelete?: (house: Property) => void;
}) {
  const [form, setForm] = useState<Form>(formOf(house));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setForm(formOf(house));
    setPicked(new Set());
    setShowAll(false);
  }, [visible, house]);
  const set = (field: keyof Form) => (value: string) => setForm(prev => ({ ...prev, [field]: value }));
  const adding = !house;
  const billed = form.billedFrom !== null;
  const linked = clients.filter(c => picked.has(c.key));
  const linkedCount = linked.reduce((n, c) => n + c.jobs.length, 0);

  // Picking the first place fills in what it already knows; nothing typed is overwritten.
  const pick = (client: Client) => {
    tapSelect();
    const on = !picked.has(client.key);
    setPicked(prev => {
      const next = new Set(prev);
      if (on) next.add(client.key);
      else next.delete(client.key);
      return next;
    });
    if (!on || !adding) return;
    setForm(prev => ({
      ...prev,
      name: prev.name || client.name,
      address: prev.address || client.address,
      price: prev.price || (client.price ? String(client.price) : ""),
    }));
  };

  const save = () => {
    const name = form.name.trim();
    if (!name || !form.address.trim()) {
      Alert.alert("Name and address", adding ? "Add both to save a new house." : "A house needs a name and an address.");
      return;
    }
    const price = form.price.trim() ? parsePrice(form.price) : null;
    if (form.price.trim() && price === null) {
      Alert.alert("Check the price", "Enter dollars, like 150.");
      return;
    }
    const cleanerPay = form.cleanerPay.trim() ? parsePrice(form.cleanerPay) : null;
    if (form.cleanerPay.trim() && cleanerPay === null) {
      Alert.alert("Check the cleaner pay", `Enter dollars, like ${DEFAULT_CLEANER_PAY}.`);
      return;
    }
    const bedrooms = roomCount(form.bedrooms);
    const bathrooms = roomCount(form.bathrooms);
    if (bedrooms === null || bathrooms === null) {
      Alert.alert("Check the rooms", "Use numbers, like 3 and 2.5.");
      return;
    }
    const steps = parseChecklistText(form.steps);
    const forwardsFrom = form.forwardsFrom.trim();
    if (forwardsFrom && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forwardsFrom)) {
      Alert.alert("Check the email", "Enter the one address the host forwards from, like host@example.com.");
      return;
    }
    const video = form.video.trim() ? videoLink(form.video) : undefined;
    if (form.video.trim() && !video) {
      Alert.alert("Check the video link", "Paste the whole share link, like https://youtu.be/… or https://drive.google.com/….");
      return;
    }
    const changes: RegistryChanges = {
      short: form.short.trim() || null,
      price,
      cleanerPay,
      bedrooms,
      bathrooms,
      doorCode: form.doorCode.trim() || null,
      garageCode: form.garageCode.trim() || null,
      supplyCode: form.supplyCode.trim() || null,
      lockboxCode: form.lockboxCode.trim() || null,
      // Where the lock box is only means something while there is one.
      lockboxSpot: (form.lockboxCode.trim() && form.lockboxSpot.trim()) || null,
      billedFrom: form.billedFrom,
      checklist: steps.length ? steps : null,
      forwardsFrom: forwardsFrom || null,
      notes: form.notes.trim() || null,
      walkthroughUrl: video || null,
      checkOutTime: form.checkOutTime,
      checkInTime: form.checkInTime,
    };
    changes.address = form.address.trim();
    if (!adding && house) {
      // Send only the fields touched in this sheet. The rest stay as the
      // registry has them now, which may be newer than when this opened.
      const before = formOf(house);
      for (const [key, fields] of Object.entries(FIELDS_OF)) {
        if (fields.every(f => form[f] === before[f])) delete changes[key];
      }
    }
    if (!adding && house && name !== house.name) changes.name = name;
    const base: Property = house || { name, address: form.address.trim(), aliases: [], bedrooms: 0, bathrooms: 0 };
    onSave(base.name, changes, aliasesToLink(base, linked.flatMap(c => c.jobs)));
  };

  // The share link the owner just copied in YouTube or Drive.
  const pasteVideo = async () => {
    tapSelect();
    const link = videoLink(await Clipboard.getStringAsync().catch(() => ""));
    if (!link) {
      Alert.alert("No link copied", "In YouTube or Google Drive, tap Share, then Copy link. Then come back and tap Paste link.");
      return;
    }
    setForm(prev => ({ ...prev, video: link }));
  };
  const videoNow = videoLink(form.video);
  const watchVideo = () => {
    if (!videoNow) return;
    Linking.openURL(videoNow).catch(() => Alert.alert("Couldn't open the video", "Check the link, then try again."));
  };

  const shown = showAll ? clients : clients.slice(0, CLIENTS_SHOWN);
  const linkList = clients.length ? (
    <>
      <Text style={styles.group}>{adding ? "Link cleanings already in" : "Link more cleanings"}</Text>
      {shown.map(c => (
        <ClientRow key={c.key} client={c} on={picked.has(c.key)} onPress={() => pick(c)} />
      ))}
      {clients.length > CLIENTS_SHOWN && !showAll ? (
        <TouchableOpacity onPress={() => setShowAll(true)} hitSlop={8} style={styles.more} accessibilityRole="button">
          <Text style={styles.moreText}>Show {clients.length - CLIENTS_SHOWN} more</Text>
        </TouchableOpacity>
      ) : null}
    </>
  ) : null;
  const linkLabel = linkedCount ? ` · ${linkedCount} cleaning${linkedCount === 1 ? "" : "s"}` : "";

  return (
    <SheetModal
      visible={visible}
      title={adding ? "Add a house" : house.short || house.name}
      onClose={onClose}
      dirty={picked.size > 0 || JSON.stringify(form) !== JSON.stringify(formOf(house))}
    >
      {adding ? linkList : null}
      {adding && clients.length ? <Text style={styles.group}>House</Text> : null}
      <FormInput label="Listing name" placeholder="e.g. Desert Oasis" value={form.name} onChangeText={set("name")} autoCapitalize="words" />
      {!adding && house && form.name.trim() !== house.name ? (
        <Text style={styles.hint}>Cleanings filed under &quot;{house.name}&quot; stay with this house.</Text>
      ) : null}
      <FormInput label="Short name (what the app calls it)" placeholder="e.g. Desert Oasis" value={form.short} onChangeText={set("short")} autoCapitalize="words" />
      <FormInput label="Address" placeholder="Street, city, ZIP" value={form.address} onChangeText={set("address")} autoCapitalize="words" />
      <View style={styles.pair}>
        <View style={{ flex: 1 }}>
          <FormInput label="Price per cleaning ($)" placeholder="e.g. 150" value={form.price} onChangeText={set("price")} keyboardType="decimal-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <FormInput label="Cleaner pay ($)" placeholder={String(DEFAULT_CLEANER_PAY)} value={form.cleanerPay} onChangeText={set("cleanerPay")} keyboardType="decimal-pad" />
        </View>
      </View>
      <Text style={styles.hint}>Each cleaner on a cleaning here earns the cleaner pay, however long it takes. Empty = {formatDollars(DEFAULT_CLEANER_PAY)}.</Text>
      <View style={styles.pair}>
        <View style={{ flex: 1 }}>
          <FormInput label="Bedrooms" placeholder="3" value={form.bedrooms} onChangeText={set("bedrooms")} keyboardType="number-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <FormInput label="Bathrooms" placeholder="2.5" value={form.bathrooms} onChangeText={set("bathrooms")} keyboardType="decimal-pad" />
        </View>
      </View>
      <TimeChips label="Guests check out by" value={form.checkOutTime} onChange={t => setForm(prev => ({ ...prev, checkOutTime: t }))} choices={CHECKOUT_TIMES} noneLabel="Not set" fold />
      <TimeChips label="Next guests check in at" value={form.checkInTime} onChange={t => setForm(prev => ({ ...prev, checkInTime: t }))} choices={CHECKIN_TIMES} noneLabel="Not set" fold />
      <Text style={styles.group}>Codes</Text>
      <FormInput label="Front door" placeholder="Not set" value={form.doorCode} onChangeText={set("doorCode")} autoCapitalize="none" />
      <FormInput label="Garage" placeholder="Not set" value={form.garageCode} onChangeText={set("garageCode")} autoCapitalize="none" />
      <View style={styles.pair}>
        <View style={{ flex: 1 }}>
          <FormInput label="Lock box" placeholder="Not set" value={form.lockboxCode} onChangeText={set("lockboxCode")} autoCapitalize="none" />
        </View>
        <View style={{ flex: 1 }}>
          <FormInput label="Lock box location" placeholder="e.g. gas meter" value={form.lockboxSpot} onChangeText={set("lockboxSpot")} autoCapitalize="none" />
        </View>
      </View>
      <FormInput label="Supply closet" placeholder="Not set" value={form.supplyCode} onChangeText={set("supplyCode")} autoCapitalize="none" />
      <Text style={styles.group}>For the crew</Text>
      <FormInput
        label="Walkthrough video"
        placeholder="Paste a YouTube or Google Drive link"
        value={form.video}
        onChangeText={set("video")}
        keyboardType="url"
        autoCapitalize="none"
      />
      <View style={styles.videoActions}>
        <TouchableOpacity style={styles.videoAction} onPress={pasteVideo} hitSlop={6} accessibilityRole="button">
          <Ionicons name="clipboard-outline" size={16} color={colors.tealDark} />
          <Text style={styles.videoActionText}>Paste link</Text>
        </TouchableOpacity>
        {videoNow ? (
          <TouchableOpacity style={styles.videoAction} onPress={watchVideo} hitSlop={6} accessibilityRole="button">
            <Ionicons name="play-circle-outline" size={17} color={colors.tealDark} />
            <Text style={styles.videoActionText}>Watch{videoSite(videoNow) ? ` in ${videoSite(videoNow)}` : ""}</Text>
          </TouchableOpacity>
        ) : null}
        {form.video ? (
          <TouchableOpacity style={styles.videoAction} onPress={() => setForm(prev => ({ ...prev, video: "" }))} hitSlop={6} accessibilityRole="button">
            <Ionicons name="close-circle-outline" size={16} color={colors.muted} />
            <Text style={[styles.videoActionText, { color: colors.muted }]}>Clear</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <Text style={styles.hint}>
        One video for the house, so the crew sees how it should look without asking. Film it on your phone, upload it to YouTube as Unlisted
        (or to Google Drive, shared with anyone who has the link), copy the share link, then tap Paste link and Save.
      </Text>
      <FormInput
        label="House notes"
        placeholder={"Parking, trash day, where the linens are, the alarm"}
        value={form.notes}
        onChangeText={set("notes")}
        multiline
      />
      {house ? (
        <NotePhotosEditor owner={{ kind: "house", name: house.name, max: MAX_HOUSE_PHOTOS }} ids={house.notePhotos || []} />
      ) : (
        <Text style={styles.hint}>Save the house first, then you can add photos to its notes.</Text>
      )}
      <Text style={styles.group}>Checklist</Text>
      <Text style={styles.hint}>Only this house gets these, at the end of every cleaning here. One step per line.</Text>
      <FormInput
        label="Extra steps"
        placeholder={"Open the blinds\nLeave a few lights on | Living room and kitchen"}
        value={form.steps}
        onChangeText={set("steps")}
        multiline
      />
      <Text style={styles.group}>Airbnb emails</Text>
      <Text style={styles.hint}>If the host forwards their Airbnb emails, their bookings and cancellations add and cancel cleanings here.</Text>
      <FormInput
        label="Host forwards from"
        placeholder="host@example.com"
        value={form.forwardsFrom}
        onChangeText={set("forwardsFrom")}
        keyboardType="email-address"
        autoCapitalize="none"
      />

      <TouchableOpacity
        style={[styles.toggleRow, billed && styles.toggleRowOn]}
        onPress={() => { tapSelect(); setForm(prev => ({ ...prev, billedFrom: prev.billedFrom ? null : todayKey() })); }}
        activeOpacity={0.7}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: billed }}
      >
        <Ionicons name={billed ? "checkbox" : "square-outline"} size={24} color={billed ? colors.teal : colors.faint} />
        <View style={{ flex: 1 }}>
          <Text style={styles.toggleText}>Host pays us directly</Text>
          <Text style={styles.toggleSub}>Not through Turno · tracks what they owe</Text>
        </View>
      </TouchableOpacity>
      {billed ? (
        <DatePickerField label="Starting" value={form.billedFrom} onChange={(key) => setForm(prev => ({ ...prev, billedFrom: key }))} />
      ) : null}
      {adding ? null : linkList}
      <BrandButton label={busy ? "Saving…" : (adding ? "Add house" : "Save") + linkLabel} icon="checkmark" onPress={save} disabled={busy} />
      {!adding && house && onDelete ? (
        <TouchableOpacity style={[styles.deleteLink, busy && { opacity: 0.45 }]} onPress={() => onDelete(house)} disabled={busy} hitSlop={6} accessibilityRole="button">
          <Ionicons name="trash-outline" size={15} color={colors.danger} />
          <Text style={styles.deleteText}>Delete this house</Text>
        </TouchableOpacity>
      ) : null}
    </SheetModal>
  );
}

function ClientRow({ client, on, onPress }: { client: Client; on: boolean; onPress: () => void }) {
  const today = todayKey();
  const n = client.jobs.length;
  const sub = [
    client.next ? (client.next === today ? "Today" : `Next ${formatShortDate(client.next)}`) : client.last ? `Last ${formatShortDate(client.last)}` : null,
    n > 1 ? `${n} cleanings` : null,
    client.contact,
  ].filter(Boolean).join(" · ");
  return (
    <TouchableOpacity
      style={[styles.clientRow, on && styles.toggleRowOn]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
    >
      <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? colors.teal : colors.faint} />
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleText} numberOfLines={1}>{client.label}</Text>
        {sub ? <Text style={styles.toggleSub} numberOfLines={1}>{sub}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  deleteLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44, marginTop: 6 },
  videoActions: { flexDirection: "row", flexWrap: "wrap", gap: 18, marginTop: -4, marginBottom: 8 },
  videoAction: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 36 },
  videoActionText: { fontSize: 13.5, fontWeight: "700", color: colors.tealDark },
  deleteText: { fontSize: 13.5, fontWeight: "600", color: colors.danger },
  pair: { flexDirection: "row", gap: 10 },
  group: { ...type.section, marginTop: 14, marginBottom: 8 },
  hint: { fontSize: 12, color: colors.muted, marginTop: -4, marginBottom: 8 },
  toggleRow: {
    flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 12, marginBottom: 14, backgroundColor: colors.bg,
  },
  toggleRowOn: { backgroundColor: colors.tealFaint, borderColor: colors.tealSoft },
  clientRow: {
    flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, marginBottom: 6, backgroundColor: colors.bg, minHeight: 48,
  },
  more: { alignSelf: "flex-start", paddingVertical: 4, marginBottom: 8 },
  moreText: { fontSize: 13, fontWeight: "700", color: colors.tealDark },
  toggleText: { fontSize: 14.5, fontWeight: "600", color: colors.ink },
  toggleSub: { fontSize: 12, color: colors.muted, marginTop: 1 },
});
