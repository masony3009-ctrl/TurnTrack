import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { parsePrice, type Client } from "../money";
import { aliasesToLink, type Property, type RegistryChanges } from "../properties";
import { colors, radius } from "../theme";
import { formatShortDate, todayKey } from "../turnover";
import { tapSelect } from "./haptics";
import { BrandButton, DatePickerField, FormInput, SheetModal } from "./ui";

type Form = {
  name: string;
  address: string;
  short: string;
  price: string;
  bedrooms: string;
  bathrooms: string;
  doorCode: string;
  garageCode: string;
  supplyCode: string;
  billedFrom: string | null;
};

function formOf(house: Property | null): Form {
  return {
    name: house?.name || "",
    address: house?.address || "",
    short: house?.short || "",
    price: house?.price ? String(house.price) : "",
    bedrooms: house?.bedrooms ? String(house.bedrooms) : "",
    bathrooms: house?.bathrooms ? String(house.bathrooms) : "",
    doorCode: house?.doorCode || "",
    garageCode: house?.garageCode || "",
    supplyCode: house?.supplyCode || "",
    billedFrom: house?.billedFrom || null,
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

// Edits one house in the registry, or adds one (house = null). Codes typed
// here show up on every cleaning at that house, past and future. Cleanings
// that aren't under a house yet can be linked to it, so their money counts.
export function HouseSheet({ visible, house, clients, busy, onClose, onSave }: {
  visible: boolean;
  house: Property | null;
  clients: Client[];
  busy: boolean;
  onClose: () => void;
  onSave: (name: string, changes: RegistryChanges, aliases: string[]) => void;
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
    if (adding && (!name || !form.address.trim())) {
      Alert.alert("Name and address", "Add both to save a new house.");
      return;
    }
    const price = form.price.trim() ? parsePrice(form.price) : null;
    if (form.price.trim() && price === null) {
      Alert.alert("Check the price", "Enter dollars, like 150.");
      return;
    }
    const bedrooms = roomCount(form.bedrooms);
    const bathrooms = roomCount(form.bathrooms);
    if (bedrooms === null || bathrooms === null) {
      Alert.alert("Check the rooms", "Use numbers, like 3 and 2.5.");
      return;
    }
    const changes: RegistryChanges = {
      short: form.short.trim() || null,
      price,
      bedrooms,
      bathrooms,
      doorCode: form.doorCode.trim() || null,
      garageCode: form.garageCode.trim() || null,
      supplyCode: form.supplyCode.trim() || null,
      billedFrom: form.billedFrom,
    };
    if (adding) changes.address = form.address.trim();
    const base: Property = house || { name, address: form.address.trim(), aliases: [], bedrooms: 0, bathrooms: 0 };
    onSave(base.name, changes, aliasesToLink(base, linked.flatMap(c => c.jobs)));
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
    <SheetModal visible={visible} title={adding ? "Add a house" : house.short || house.name} onClose={onClose}>
      {adding ? linkList : null}
      {adding ? (
        <>
          {clients.length ? <Text style={styles.group}>House</Text> : null}
          <FormInput label="Listing name" placeholder="e.g. Desert Oasis" value={form.name} onChangeText={set("name")} autoCapitalize="words" />
          <FormInput label="Address" placeholder="Street, city, ZIP" value={form.address} onChangeText={set("address")} autoCapitalize="words" />
        </>
      ) : (
        <Text style={styles.address}>{house.address}</Text>
      )}
      <FormInput label="Short name" placeholder="e.g. Desert Oasis" value={form.short} onChangeText={set("short")} autoCapitalize="words" />
      <FormInput label="Price per cleaning ($)" placeholder="e.g. 150" value={form.price} onChangeText={set("price")} keyboardType="decimal-pad" />
      <View style={styles.pair}>
        <View style={{ flex: 1 }}>
          <FormInput label="Bedrooms" placeholder="3" value={form.bedrooms} onChangeText={set("bedrooms")} keyboardType="number-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <FormInput label="Bathrooms" placeholder="2.5" value={form.bathrooms} onChangeText={set("bathrooms")} keyboardType="decimal-pad" />
        </View>
      </View>
      <Text style={styles.group}>Codes</Text>
      <FormInput label="Front door" placeholder="Not set" value={form.doorCode} onChangeText={set("doorCode")} autoCapitalize="none" />
      <FormInput label="Garage" placeholder="Not set" value={form.garageCode} onChangeText={set("garageCode")} autoCapitalize="none" />
      <FormInput label="Supply closet" placeholder="Not set" value={form.supplyCode} onChangeText={set("supplyCode")} autoCapitalize="none" />

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
  address: { fontSize: 13.5, color: colors.muted, marginBottom: 12 },
  pair: { flexDirection: "row", gap: 10 },
  group: { fontSize: 12.5, fontWeight: "700", color: colors.ink, marginTop: 4, marginBottom: 8 },
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
