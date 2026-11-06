import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import GameQuickView from "@/components/GameQuickView";
import { CloseButton } from "@/components/ui";
import { SPORT_ICONS } from "@/constants/leagueTypes";
import { useColors } from "@/hooks/useColors";
import { useKickoffSoon } from "@/hooks/useKickoffSoon";
import { onOpenKickoffSheet } from "@/lib/kickoffSheet";

/** Every unbet game starting within the hour; tap one to bet. */
export default function KickoffSheet() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { games, now } = useKickoffSoon();
  const [open, setOpen] = useState(false);
  const [gameId, setGameId] = useState<string | null>(null);

  useEffect(() => onOpenKickoffSheet(() => setOpen(true)), []);

  return (
    <>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: c.background, borderColor: c.border, paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.head}>
            <Text style={[styles.title, { color: c.foreground }]}>Starting within the hour</Text>
            <CloseButton onPress={() => setOpen(false)} />
          </View>
          {games.length === 0 ? (
            <Text style={[styles.sub, { color: c.mutedForeground }]}>You're in on everything starting soon.</Text>
          ) : (
            <ScrollView style={{ maxHeight: 420 }}>
              {games.map((g) => (
                <Pressable
                  key={g.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Bet on ${g.awayTeam.abbreviation} at ${g.homeTeam.abbreviation}`}
                  onPress={() => {
                    setOpen(false);
                    setGameId(g.id);
                  }}
                  style={({ pressed }) => [styles.row, { borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}
                >
                  <MaterialCommunityIcons name={(g.sportIcon || SPORT_ICONS[g.sport] || "clock-outline") as never} size={18} color={c.mutedForeground} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.teams, { color: c.foreground }]}>
                      {g.awayTeam.abbreviation} @ {g.homeTeam.abbreviation}
                    </Text>
                    <Text style={[styles.sub, { color: c.mutedForeground }]}>{g.sport}</Text>
                  </View>
                  <Text style={[styles.mins, { color: c.accent }]}>{Math.max(1, Math.round((g.startsAt - now) / 60_000))} min</Text>
                  <MaterialCommunityIcons name="chevron-right" size={20} color={c.mutedForeground} />
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>
      {gameId ? <GameQuickView gameId={gameId} onClose={() => setGameId(null)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 16, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  title: { fontSize: 18, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  teams: { fontSize: 15, fontWeight: "700" },
  sub: { fontSize: 12 },
  mins: { fontSize: 13, fontWeight: "700" },
});
