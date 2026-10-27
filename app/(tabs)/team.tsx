import { Ionicons } from "@expo/vector-icons";
import { addDoc, collection, deleteDoc, doc, getDocs, query, updateDoc, where, writeBatch } from "firebase/firestore";
import { useMemo, useState } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { pickProfilePhoto } from "../../components/photo";
import { useProfile } from "../../components/ProfileProvider";
import { alertSoon, Avatar, BrandButton, Card, ColorPicker, EmptyState, Fab, FormInput, Pill, ScreenHeader, SheetModal } from "../../components/ui";
import { tapSuccess } from "../../components/haptics";
import { db } from "../../firebase";
import { formatMoney, parseRate } from "../../payroll";
import { cleanerColor, colors, pickUnusedColor, radius } from "../../theme";
import { Employee, Job } from "../../types";

// A cleaner who is deactivated or deleted should stop receiving pushes and
// lose their signed-in phones, so their device records go too.
async function removeDevicesFor(employeeId: string) {
  const snap = await getDocs(query(collection(db, "devices"), where("employeeId", "==", employeeId)));
  if (snap.empty) return;
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

// A cleaner's unfinished jobs. Ones with a timer running can't just be handed
// back: somebody has to finish or discard that time first.
async function openJobsOf(employeeId: string): Promise<{ waiting: Job[]; running: Job[] }> {
  const snap = await getDocs(query(collection(db, "jobs"), where("assignedTo", "==", employeeId)));
  const open = snap.docs.map(d => ({ id: d.id, ...d.data() }) as Job).filter(j => !j.done && !j.cancelled);
  return { waiting: open.filter(j => !j.startedAt), running: open.filter(j => !!j.startedAt) };
}

// Puts a leaving cleaner's jobs back in the unassigned pool, so they show as
// needing someone and another cleaner can take them.
async function releaseJobs(jobs: Job[]) {
  for (let i = 0; i < jobs.length; i += 400) {
    const batch = writeBatch(db);
    jobs.slice(i, i + 400).forEach(j => batch.update(doc(db, "jobs", j.id), { assignedTo: null, assignedToName: null }));
    await batch.commit();
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export default function TeamScreen() {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [phone, setPhone] = useState("");
  const [zelle, setZelle] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [color, setColor] = useState<string>("");
  const { state, viewAs, employees: allEmployees } = useProfile();
  const isOwner = state.status === "owner";
  const self = state.status === "cleaner" ? state.employee : null;

  // Active cleaners first, then by name (the provider sorts by name only).
  const employees = useMemo(() => [...allEmployees].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return String(a.name || "").localeCompare(String(b.name || ""));
  }), [allEmployees]);

  const visibleEmployees = isOwner ? employees : employees.filter(e => e.active);
  const orderedEmployees = self
    ? [...visibleEmployees].sort((a, b) => (a.id === self.id ? -1 : b.id === self.id ? 1 : 0))
    : visibleEmployees;

  const openAdd = () => {
    setEditingId(null);
    setName("");
    setRate("");
    setPhone("");
    setZelle("");
    setPhoto(null);
    setColor(pickUnusedColor(employees));
    setShowForm(true);
  };

  const openEdit = (emp: Employee) => {
    setEditingId(emp.id);
    setName(emp.name);
    setRate(emp.hourlyRate.toString());
    setPhone(emp.phone || "");
    setZelle(emp.zelle || "");
    setPhoto(emp.photo || null);
    setColor(cleanerColor(emp));
    setShowForm(true);
  };

  const choosePhoto = async () => {
    const uri = await pickProfilePhoto();
    if (uri) setPhoto(uri);
  };

  const save = async () => {
    if (!isOwner) {
      if (!self) return;
      try {
        await updateDoc(doc(db, "employees", self.id), {
          phone: phone.trim(),
          zelle: zelle.trim(),
          photo,
        });
        setShowForm(false);
      } catch (e) {
        console.warn("save profile failed:", e);
        Alert.alert("Couldn't save", "Your profile didn't save. Check your connection and try again.");
      }
      return;
    }

    if (!name.trim()) {
      Alert.alert("Missing name", "Enter the cleaner's name.");
      return;
    }
    const hourlyRate = parseRate(rate);
    if (hourlyRate === null) {
      Alert.alert("Invalid rate", "Enter an hourly rate like 20 or 22.50.");
      return;
    }
    const data = {
      name: name.trim(),
      hourlyRate,
      phone: phone.trim(),
      zelle: zelle.trim(),
      photo,
      color: color || pickUnusedColor(employees),
    };
    try {
      if (editingId) {
        await updateDoc(doc(db, "employees", editingId), data);
      } else {
        await addDoc(collection(db, "employees"), { ...data, active: true, createdAt: Date.now() });
      }
      tapSuccess();
      setShowForm(false);
      if (!editingId) alertSoon("Cleaner added", `${data.name} can now sign in on their phone and create a PIN.`);
    } catch (e) {
      console.warn("save cleaner failed:", e);
      Alert.alert("Couldn't save", "The cleaner didn't save. Check your connection and the Firestore security rules (employees collection), then try again.");
    }
  };

  // Taking someone off the team: their phones are signed out and their
  // unfinished jobs go back to unassigned. Asks first, with the numbers.
  const takeOff = async (emp: Employee, mode: "deactivate" | "delete") => {
    let open: { waiting: Job[]; running: Job[] };
    try {
      open = await openJobsOf(emp.id);
    } catch (e) {
      console.warn("loading cleaner's jobs failed:", e);
      Alert.alert("Couldn't check their jobs", "Check your connection and try again.");
      return;
    }
    const first = emp.name.split(" ")[0];
    if (open.running.length) {
      Alert.alert(
        "Timer still running",
        `${first} is on the clock at ${open.running.map(j => j.property || j.address).join(", ")}. Finish or discard that timer from the job first, so their time is settled.`
      );
      return;
    }
    const jobsLine = open.waiting.length
      ? ` Their ${plural(open.waiting.length, "unfinished job")} go back to unassigned.`
      : "";
    const body = mode === "delete"
      ? `Delete ${emp.name}? Their phone is signed out and their past time entries stay in payroll history.${jobsLine} If they might come back, deactivate instead.`
      : `Deactivate ${emp.name}? Their phone is signed out until you reactivate them.${jobsLine}`;
    Alert.alert(mode === "delete" ? "Delete cleaner" : "Deactivate cleaner", body, [
      { text: "Cancel", style: "cancel" },
      {
        text: mode === "delete" ? "Delete" : "Deactivate",
        style: "destructive",
        onPress: async () => {
          try {
            await releaseJobs(open.waiting);
            if (mode === "delete") await deleteDoc(doc(db, "employees", emp.id));
            else await updateDoc(doc(db, "employees", emp.id), { active: false });
            setShowForm(false);
            tapSuccess();
          } catch (e) {
            console.warn(`${mode} cleaner failed:`, e);
            Alert.alert("Couldn't finish that", "Check your connection and try again. Any jobs already handed back stay unassigned.");
            return;
          }
          try {
            await removeDevicesFor(emp.id);
          } catch (e) {
            console.warn("remove devices failed:", e);
            alertSoon("Their phone may still be signed in", `${first} is off the team, but signing their phone out didn't go through. Their phone signs itself out the next time it opens TurnTrack.`);
          }
        },
      },
    ]);
  };

  const toggleActive = async (emp: Employee) => {
    if (emp.active) {
      takeOff(emp, "deactivate");
      return;
    }
    try {
      await updateDoc(doc(db, "employees", emp.id), { active: true });
      tapSuccess();
    } catch (e) {
      console.warn("reactivate failed:", e);
      Alert.alert("Couldn't update", "Check your connection and try again.");
    }
  };

  const remove = (emp: Employee) => takeOff(emp, "delete");

  const activeCount = employees.filter(e => e.active).length;
  const canSeePay = (emp: Employee) => isOwner || self?.id === emp.id;

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Team"
        subtitle={isOwner ? `${activeCount} active cleaner${activeCount === 1 ? "" : "s"}` : "Your crew"}
      />

      <SheetModal
        visible={showForm}
        title={!isOwner ? "Edit your profile" : editingId ? "Edit cleaner" : "New cleaner"}
        onClose={() => setShowForm(false)}
      >
        <View style={styles.photoRow}>
          <Avatar name={name || "?"} photo={photo} color={color || undefined} size={58} />
          <View style={styles.photoActions}>
            <BrandButton
              label={photo ? "Change photo" : "Add photo"}
              icon="image-outline"
              variant="outline"
              onPress={choosePhoto}
              style={styles.photoBtn}
            />
            {photo && (
              <TouchableOpacity onPress={() => setPhoto(null)} style={styles.removePhoto}>
                <Text style={styles.removePhotoText}>Remove photo</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        {isOwner && (
          <FormInput label="Name" placeholder="Full name" value={name} onChangeText={setName} />
        )}
        {isOwner && (
          <FormInput label="Hourly rate" placeholder="e.g. 20" value={rate} onChangeText={setRate} keyboardType="decimal-pad" />
        )}
        {isOwner && (
          <ColorPicker label="Calendar color" value={color} onChange={setColor} />
        )}
        <FormInput label="Phone (optional)" placeholder="(480) 555-1234" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <FormInput label="Zelle phone or email (optional)" placeholder="Where pay gets sent" value={zelle} onChangeText={setZelle} autoCapitalize="none" />
        <BrandButton
          label={!isOwner ? "Save profile" : editingId ? "Save changes" : "Add cleaner"}
          icon="checkmark"
          onPress={save}
        />
        {isOwner && editingId && employees.find(e => e.id === editingId)?.pin ? (
          <TouchableOpacity
            style={styles.resetPinLink}
            onPress={async () => {
              try {
                await updateDoc(doc(db, "employees", editingId), { pin: null });
                Alert.alert("PIN reset", "They'll create a new PIN the next time they sign in.");
              } catch (e) {
                console.warn("pin reset failed:", e);
                Alert.alert("Couldn't reset", "The PIN reset didn't save. Try again.");
              }
            }}
          >
            <Ionicons name="key-outline" size={15} color={colors.tealDark} />
            <Text style={styles.resetPinText}>Reset their PIN</Text>
          </TouchableOpacity>
        ) : null}
        {isOwner && editingId && (
          <TouchableOpacity
            style={styles.deleteLink}
            onPress={() => {
              const emp = employees.find(e => e.id === editingId);
              if (emp) remove(emp);
            }}
          >
            <Ionicons name="trash-outline" size={15} color={colors.danger} />
            <Text style={styles.deleteLinkText}>Delete cleaner</Text>
          </TouchableOpacity>
        )}
      </SheetModal>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 96 }}>
        {orderedEmployees.length === 0 && (
          <EmptyState
            icon="people-outline"
            title="No cleaners yet"
            body={isOwner
              ? "Add your first cleaner below."
              : "No one on the team yet."}
          />
        )}
        {orderedEmployees.map(emp => {
          const isSelf = self?.id === emp.id;
          const tappable = isOwner || isSelf;
          return (
            <TouchableOpacity
              key={emp.id}
              onPress={() => {
                if (isOwner) openEdit(emp);
                else if (isSelf) openEdit(emp);
              }}
              activeOpacity={tappable ? 0.7 : 1}
            >
              <Card style={!emp.active ? styles.cardInactive : undefined}>
                <View style={styles.cardTop}>
                  <Avatar name={emp.name} photo={emp.photo} color={cleanerColor(emp)} muted={!emp.active} size={44} />
                  <View style={styles.nameBlock}>
                    <Text style={styles.name}>{emp.name}</Text>
                    {canSeePay(emp) && <Text style={styles.rate}>{formatMoney(emp.hourlyRate)}/hr</Text>}
                  </View>
                  {isSelf ? (
                    <Pill label="You" tone="solid" />
                  ) : isOwner ? (
                    <Pill label={emp.active ? "Active" : "Inactive"} tone={emp.active ? "teal" : "neutral"} />
                  ) : null}
                </View>
                {(emp.phone || (canSeePay(emp) && emp.zelle)) ? (
                  <View style={styles.contactBlock}>
                    {emp.phone ? (
                      <View style={styles.contactRow}>
                        <TouchableOpacity
                          style={styles.contactLink}
                          onPress={() => Linking.openURL(`tel:${emp.phone}`)}
                          accessibilityRole="button"
                          accessibilityLabel={`Call ${emp.name}`}
                        >
                          <Ionicons name="call-outline" size={15} color={colors.tealDark} />
                          <Text style={styles.contactLinkText}>{emp.phone}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.contactLink}
                          onPress={() => Linking.openURL(`sms:${emp.phone}`)}
                          accessibilityRole="button"
                          accessibilityLabel={`Text ${emp.name}`}
                        >
                          <Ionicons name="chatbubble-outline" size={15} color={colors.tealDark} />
                          <Text style={styles.contactLinkText}>Text</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                    {canSeePay(emp) && emp.zelle ? (
                      <View style={styles.contactRow}>
                        <Ionicons name="card-outline" size={14} color={colors.faint} />
                        <Text style={styles.contactText}>Zelle: {emp.zelle}</Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
                {isSelf && (
                  <View style={styles.editHintRow}>
                    <Ionicons name="create-outline" size={13} color={colors.tealDark} />
                    <Text style={styles.editHintText}>Tap to edit your profile</Text>
                  </View>
                )}
                {isOwner && (
                  <View style={styles.ownerActions}>
                    <TouchableOpacity style={styles.toggleBtn} onPress={() => toggleActive(emp)}>
                      <Ionicons name={emp.active ? "pause-outline" : "play-outline"} size={13} color={colors.tealDark} />
                      <Text style={styles.toggleBtnText}>{emp.active ? "Deactivate" : "Reactivate"}</Text>
                    </TouchableOpacity>
                    {emp.active && (
                      <TouchableOpacity style={styles.toggleBtn} onPress={() => viewAs(emp)}>
                        <Ionicons name="eye-outline" size={13} color={colors.tealDark} />
                        <Text style={styles.toggleBtnText}>View as {emp.name.split(" ")[0]}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </Card>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {isOwner && <Fab icon="person-add" label="Add cleaner" onPress={openAdd} />}
    </View>
  );
}

const styles = StyleSheet.create({
  ownerActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20 },
  cardInactive: { opacity: 0.55 },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  nameBlock: { flex: 1 },
  name: { fontSize: 16, fontWeight: "700", color: colors.ink },
  rate: { fontSize: 13.5, fontWeight: "600", color: colors.tealDark, marginTop: 1 },
  contactBlock: { marginTop: 12, gap: 5 },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  contactLink: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingRight: 10 },
  contactLinkText: { fontSize: 14, fontWeight: "600", color: colors.tealDark },
  contactText: { fontSize: 13, color: colors.muted },
  editHintRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 10 },
  editHintText: { fontSize: 12.5, fontWeight: "600", color: colors.tealDark },
  toggleBtn: {
    flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", marginTop: 12,
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm,
    paddingHorizontal: 12, minHeight: 44, backgroundColor: colors.bg,
  },
  toggleBtnText: { fontSize: 12.5, fontWeight: "600", color: colors.tealDark },
  photoRow: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 16 },
  photoActions: { flex: 1, gap: 6 },
  photoBtn: { paddingVertical: 9 },
  removePhoto: { alignSelf: "center", padding: 2 },
  removePhotoText: { fontSize: 12.5, fontWeight: "600", color: colors.danger },
  resetPinLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 10, minHeight: 44 },
  resetPinText: { color: colors.tealDark, fontSize: 13.5, fontWeight: "600" },
  deleteLink: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, marginTop: 4, minHeight: 44 },
  deleteLinkText: { color: colors.danger, fontSize: 13.5, fontWeight: "600" },
});
