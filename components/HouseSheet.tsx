import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { parsePrice } from "../money";
import { type Property, type RegistryChanges } from "../properties";
import { colors, radius } from "../theme";
import { todayKey } from "../turnover";
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

// Edits one house in the registry, or adds one (house = null). Codes typed
// here show up on every cleaning at that house, past and future.
export function HouseSheet({ visible, house, busy, onClose, onSave }: {
  visible: boolean;
  house: Property | null;
  busy: boolean;
  onClose: () => void;
  onSave: (name: string, changes: RegistryChanges) => void;
}) {
  const [form, setForm] = useState<Form>(formOf(house));
  useEffect(() => {
    if (visible) setForm(formOf(house));
  }, [visible, house]);
  const set = (field: keyof Form) => (value: string) => setForm(prev => ({ ...prev, [field]: value }));
  const adding = !house;
  const billed = form.billedFrom !== null;

  const save = () => {
    const name = form.name.trim();
    if (adding && (!name || !form.address.trim())) {
      Alert.alert("Name and address", "A new house needs a name and its street address.");
      return;
    }
    const price = form.price.trim() ? parsePrice(form.price) : null;
    if (form.price.trim() && price === null) {
      Alert.alert("Check the price", "Type the dollar amount for a regular cleaning, like 150.");
      return;
    }
    const bedrooms = roomCount(form.bedrooms);
    const bathrooms = roomCount(form.bathrooms);
    if (bedrooms === null || bathrooms === null) {
      Alert.alert("Check the rooms", "Bedrooms and bathrooms are numbers, like 3 and 2.5.");
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
    onSave(adding ? name : house.name, changes);
  };

  return (
    <SheetModal visible={visible} title={adding ? "Add a house" : house.short || house.name} onClose={onClose}>
      {adding ? (
        <>
          <FormInput label="Name (as it shows in Airbnb or Turno)" placeholder="e.g. Desert Oasis" value={form.name} onChangeText={set("name")} autoCapitalize="words" />
          <FormInput label="Street address" placeholder="Street, city, ZIP" value={form.address} onChangeText={set("address")} autoCapitalize="words" />
        </>
      ) : (
        <Text style={styles.address}>{house.address}</Text>
      )}
      <FormInput label="What we call it (short name)" placeholder="e.g. Desert Oasis" value={form.short} onChangeText={set("short")} autoCapitalize="words" />
      <FormInput label="Regular cleaning price ($)" placeholder="e.g. 150" value={form.price} onChangeText={set("price")} keyboardType="decimal-pad" />
      <View style={styles.pair}>
        <View style={{ flex: 1 }}>
          <FormInput label="Bedrooms" placeholder="3" value={form.bedrooms} onChangeText={set("bedrooms")} keyboardType="number-pad" />
        </View>
        <View style={{ flex: 1 }}>
          <FormInput label="Bathrooms" placeholder="2.5" value={form.bathrooms} onChangeText={set("bathrooms")} keyboardType="decimal-pad" />
        </View>
      </View>
      <Text style={styles.group}>Access codes · cleaners see these once a cleaning is theirs</Text>
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
          <Text style={styles.toggleText}>The host pays us directly</Text>
          <Text style={styles.toggleSub}>Not through Turno. The app keeps a running total of what they owe.</Text>
        </View>
      </TouchableOpacity>
      {billed ? (
        <DatePickerField label="Count cleanings from" value={form.billedFrom} onChange={(key) => setForm(prev => ({ ...prev, billedFrom: key }))} />
      ) : null}
      <BrandButton label={busy ? "Saving…" : adding ? "Add house" : "Save"} icon="checkmark" onPress={save} disabled={busy} />
    </SheetModal>
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
  toggleText: { fontSize: 14.5, fontWeight: "600", color: colors.ink },
  toggleSub: { fontSize: 12, color: colors.muted, marginTop: 1 },
});
