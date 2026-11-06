import React, { useMemo, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable, TouchableOpacity } from "@/components/fx/Tap";
import { CloseButton } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { haptic as buzz } from "@/lib/motion";

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export interface PickedAge {
  age: number;
  /** 1–12 */
  birthMonth: number;
  /** "27 · born in June" */
  label: string;
}

export function ageMonthLabel(age: number, birthMonth: number): string {
  return `${age} · born in ${MONTHS[birthMonth - 1]}`;
}

/**
 * Age + birth month. Nothing is preselected and the cutoff isn't shown, so
 * the screen doesn't steer anyone toward a "right" answer.
 */
export default function AgeMonthPickerModal({ visible, onClose, onConfirm }: { visible: boolean; onClose: () => void; onConfirm: (v: PickedAge) => void }) {
  const colors = useColors();
  const [age, setAge] = useState<number | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const ages = useMemo(() => Array.from({ length: 91 }, (_, i) => i + 10), []);
  const ready = age !== null && month !== null;

  const confirm = () => {
    if (age === null || month === null) return;
    buzz.tick();
    onConfirm({ age, birthMonth: month, label: ageMonthLabel(age, month) });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[s.scrim, { backgroundColor: colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[s.modal, { backgroundColor: colors.elevated, borderColor: colors.border }]}>
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={[s.title, { color: colors.foreground }]}>Your Age & Birth Month</Text>
              <Text style={[s.subtitle, { color: colors.mutedForeground }]}>We send a gift on the 1st of your birth month.</Text>
            </View>
            <CloseButton onPress={onClose} />
          </View>

          <View style={s.columns}>
            <Column label="AGE" colors={colors}>
              {ages.map((a) => (
                <Option key={a} label={String(a)} active={age === a} onPress={() => setAge(a)} colors={colors} />
              ))}
            </Column>
            <Column label="BIRTH MONTH" colors={colors} flex={1.6}>
              {MONTHS.map((m, i) => (
                <Option key={m} label={m} active={month === i + 1} onPress={() => setMonth(i + 1)} colors={colors} />
              ))}
            </Column>
          </View>

          <TouchableOpacity
            style={[s.btn, { backgroundColor: colors.primary }, !ready && { opacity: 0.5 }]}
            onPress={confirm}
            disabled={!ready}
            activeOpacity={0.85}
            accessibilityState={{ disabled: !ready }}
          >
            <Text style={[s.btnText, { color: colors.primaryForeground }]}>Confirm</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function Column({ label, colors, flex = 1, children }: { label: string; colors: ReturnType<typeof useColors>; flex?: number; children: React.ReactNode }) {
  return (
    <View style={[s.col, { flex }]}>
      <Text style={[s.colLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <ScrollView style={[s.scroll, { borderColor: colors.border, backgroundColor: colors.secondary }]} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
    </View>
  );
}

function Option({ label, active, onPress, colors }: { label: string; active: boolean; onPress: () => void; colors: ReturnType<typeof useColors> }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: active }} style={[s.option, active && { backgroundColor: colors.primary }]}>
      <Text style={[s.optionText, { color: active ? colors.primaryForeground : colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  modal: { width: "100%", maxWidth: 400, borderRadius: 22, borderWidth: 1, padding: 20, gap: 14 },
  header: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { fontSize: 18, fontFamily: "Inter_800ExtraBold" },
  subtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  columns: { flexDirection: "row", gap: 8, height: 220 },
  col: { gap: 6 },
  colLabel: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.8, textAlign: "center" },
  scroll: { flex: 1, borderWidth: 1, borderRadius: 12 },
  option: { paddingVertical: 9, alignItems: "center", borderRadius: 8, marginHorizontal: 4, marginVertical: 2 },
  optionText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  btn: { paddingVertical: 14, borderRadius: 14, alignItems: "center", marginTop: 4 },
  btnText: { fontSize: 16, fontFamily: "Inter_700Bold" },
});
