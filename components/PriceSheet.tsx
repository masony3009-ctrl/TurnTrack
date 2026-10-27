import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { parsePrice } from "../money";
import { formatMoney } from "../payroll";
import { colors, radius } from "../theme";
import { tapSelect } from "./haptics";
import { BrandButton, FormInput, SheetModal } from "./ui";

// The owner sets what one cleaning pays (a deep clean, a one-off, a special
// rate) and, for a host who pays us directly, whether it has been paid.
export function PriceSheet({ visible, price, housePrice, billed, hostPaid, busy, onClose, onSave }: {
  visible: boolean;
  // The job's own price, if it has one.
  price: number | null;
  // What the house charges when the job has no price of its own (null: none).
  housePrice: number | null;
  // The host pays us directly for this cleaning, so it can be marked paid.
  billed: boolean;
  hostPaid: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (next: { price: number | null; hostPaid: boolean }) => void;
}) {
  const [text, setText] = useState("");
  const [paid, setPaid] = useState(false);
  useEffect(() => {
    if (!visible) return;
    setText(price ? String(price) : "");
    setPaid(hostPaid);
  }, [visible, price, hostPaid]);

  const save = () => {
    const trimmed = text.trim();
    const next = trimmed ? parsePrice(trimmed) : null;
    if (trimmed && next === null) {
      Alert.alert("Check the price", "Type the dollar amount, like 150 or 175.50.");
      return;
    }
    onSave({ price: next, hostPaid: billed && paid });
  };

  return (
    <SheetModal visible={visible} title="What this cleaning pays" onClose={onClose}>
      <FormInput
        label="Price for this cleaning ($)"
        placeholder={housePrice ? String(housePrice) : "e.g. 150"}
        value={text}
        onChangeText={setText}
        keyboardType="decimal-pad"
      />
      <Text style={styles.hint}>
        {housePrice
          ? `Leave it empty to use the house price, ${formatMoney(housePrice)}.`
          : "This house has no regular price yet. Set one on the Houses tab, or price this cleaning here."}
      </Text>
      {billed ? (
        <TouchableOpacity
          style={[styles.toggleRow, paid && styles.toggleRowOn]}
          onPress={() => { tapSelect(); setPaid(!paid); }}
          activeOpacity={0.7}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: paid }}
        >
          <Ionicons name={paid ? "checkbox" : "square-outline"} size={24} color={paid ? colors.teal : colors.faint} />
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleText}>The host has paid for this one</Text>
            <Text style={styles.toggleSub}>Paid cleanings drop off what the host owes on the Houses tab</Text>
          </View>
        </TouchableOpacity>
      ) : null}
      <BrandButton label={busy ? "Saving…" : "Save"} icon="checkmark" onPress={save} disabled={busy} />
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, color: colors.muted, lineHeight: 18, marginTop: -4, marginBottom: 14 },
  toggleRow: {
    flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md, padding: 12, marginBottom: 14, backgroundColor: colors.bg,
  },
  toggleRowOn: { backgroundColor: colors.tealFaint, borderColor: colors.tealSoft },
  toggleText: { fontSize: 14.5, fontWeight: "600", color: colors.ink },
  toggleSub: { fontSize: 12, color: colors.muted, marginTop: 1 },
});
