import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable, TouchableOpacity } from "@/components/fx/Tap";
import { CloseButton } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { haptic as buzz } from "@/lib/motion";

export function calculateAgeFromDob(year: number, month: number, day: number): number {
  const now = new Date();
  let age = now.getFullYear() - year;
  const m = now.getMonth() + 1 - month;
  if (m < 0 || (m === 0 && now.getDate() < day)) age--;
  return age;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface PickedDob {
  /** "Jun 15, 2002" */
  label: string;
  /** "2002-06-15" */
  iso: string;
  age: number;
}

/** Month / day / year picker; the age is worked out from the date. */
export default function DobPickerModal({ visible, onClose, onConfirm }: { visible: boolean; onClose: () => void; onConfirm: (dob: PickedDob) => void }) {
  const colors = useColors();
  const [dobYear, setDobYear] = useState(2002);
  const [dobMonth, setDobMonth] = useState(6);
  const [dobDay, setDobDay] = useState(15);
  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const list: number[] = [];
    for (let y = currentYear - 13; y >= 1930; y--) list.push(y);
    return list;
  }, []);
  const daysInMonth = useMemo(() => {
    const count = new Date(dobYear, dobMonth, 0).getDate();
    return Array.from({ length: count }, (_, i) => i + 1);
  }, [dobYear, dobMonth]);

  const confirm = () => {
    const day = Math.min(dobDay, daysInMonth.length);
    buzz.tick();
    onConfirm({
      label: `${MONTHS[dobMonth - 1]} ${day}, ${dobYear}`,
      iso: `${dobYear}-${String(dobMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      age: calculateAgeFromDob(dobYear, dobMonth, day),
    });
  };

  return (
            <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={onClose}
      >
        <View style={[s.modalScrim, { backgroundColor: colors.overlay }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
          <View style={[s.dobModal, { backgroundColor: colors.elevated, borderColor: colors.border }]}>
            <View style={s.dobHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[s.dobTitle, { color: colors.foreground }]}>Select Date of Birth</Text>
                <Text style={[s.dobSubtitle, { color: colors.mutedForeground }]}>
                  Automatically calculates your verified age
                </Text>
              </View>
              <CloseButton onPress={onClose} />
            </View>

            <View style={s.dobColumns}>
              {/* Month */}
              <View style={s.dobCol}>
                <Text style={[s.dobColLabel, { color: colors.mutedForeground }]}>MONTH</Text>
                <ScrollView style={[s.dobScroll, { borderColor: colors.border, backgroundColor: colors.secondary }]} showsVerticalScrollIndicator={false}>
                  {MONTHS.map((m, idx) => {
                    const active = dobMonth === idx + 1;
                    return (
                      <Pressable
                        key={m}
                        onPress={() => setDobMonth(idx + 1)}
                        style={[s.dobOption, active && { backgroundColor: colors.primary }]}
                      >
                        <Text style={[s.dobOptionText, { color: active ? colors.primaryForeground : colors.foreground }]}>
                          {m}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Day */}
              <View style={s.dobCol}>
                <Text style={[s.dobColLabel, { color: colors.mutedForeground }]}>DAY</Text>
                <ScrollView style={[s.dobScroll, { borderColor: colors.border, backgroundColor: colors.secondary }]} showsVerticalScrollIndicator={false}>
                  {daysInMonth.map((d) => {
                    const active = dobDay === d;
                    return (
                      <Pressable
                        key={d}
                        onPress={() => setDobDay(d)}
                        style={[s.dobOption, active && { backgroundColor: colors.primary }]}
                      >
                        <Text style={[s.dobOptionText, { color: active ? colors.primaryForeground : colors.foreground }]}>
                          {d}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Year */}
              <View style={s.dobCol}>
                <Text style={[s.dobColLabel, { color: colors.mutedForeground }]}>YEAR</Text>
                <ScrollView style={[s.dobScroll, { borderColor: colors.border, backgroundColor: colors.secondary }]} showsVerticalScrollIndicator={false}>
                  {years.map((y) => {
                    const active = dobYear === y;
                    return (
                      <Pressable
                        key={y}
                        onPress={() => setDobYear(y)}
                        style={[s.dobOption, active && { backgroundColor: colors.primary }]}
                      >
                        <Text style={[s.dobOptionText, { color: active ? colors.primaryForeground : colors.foreground }]}>
                          {y}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            </View>

            <View style={[s.dobPreview, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
              <MaterialCommunityIcons name="information-outline" size={16} color={colors.primary} />
              <Text style={[s.dobPreviewText, { color: colors.foreground }]}>
                Calculated age: {calculateAgeFromDob(dobYear, dobMonth, Math.min(dobDay, daysInMonth.length))} years old
              </Text>
            </View>

            <TouchableOpacity
              style={[s.btn, { backgroundColor: colors.primary }]}
              onPress={confirm}
              activeOpacity={0.85}
            >
              <Text style={[s.btnText, { color: colors.primaryForeground }]}>Confirm Date of Birth</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
  );
}

const s = StyleSheet.create({
  btn: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 4,
  },
  btnText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  modalScrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  dobModal: { width: "100%", maxWidth: 400, borderRadius: 22, borderWidth: 1, padding: 20, gap: 14 },
  dobHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  dobTitle: { fontSize: 18, fontFamily: "Inter_800ExtraBold" },
  dobSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  dobColumns: { flexDirection: "row", gap: 8, height: 190 },
  dobCol: { flex: 1, gap: 6 },
  dobColLabel: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.8, textAlign: "center" },
  dobScroll: { flex: 1, borderWidth: 1, borderRadius: 12 },
  dobOption: { paddingVertical: 9, alignItems: "center", borderRadius: 8, marginHorizontal: 4, marginVertical: 2 },
  dobOptionText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  dobPreview: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
  dobPreviewText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
