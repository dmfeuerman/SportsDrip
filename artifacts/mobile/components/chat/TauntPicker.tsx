import { MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import AvatarDisplay from "@/components/AvatarDisplay";
import { Pressable } from "@/components/fx/Tap";
import KeyboardSheet from "@/components/KeyboardSheet";
import { Button } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { useCatalog } from "@/hooks/useCatalog";
import { useColors } from "@/hooks/useColors";
import { useMoves } from "@/hooks/useMoves";
import { haptic } from "@/lib/motion";

const LAST_MOVE_KEY = "sportdrip.taunt.lastMove.v1";

/**
 * Pick which dance to taunt with: every move you own, your loadout first, with
 * a live preview of your own character doing it. Sending closes the sheet at
 * once; the taunt is already in the chat (hooks/useSendTaunt.ts).
 */
export default function TauntPicker({
  visible,
  targetName,
  onClose,
  onPick,
}: {
  visible: boolean;
  targetName: string;
  onClose: () => void;
  onPick: (moveId: string) => void;
}) {
  const c = useColors();
  const { profile, ownedMoves, loadout } = useApp();
  const { byId: catalog } = useCatalog();
  const { moves } = useMoves();
  const owned = useMemo(() => {
    const list = moves.filter((m) => ownedMoves.has(m.id));
    const rank = (id: string) => {
      const i = loadout.indexOf(id);
      return i === -1 ? loadout.length : i;
    };
    return list.sort((a, b) => rank(a.id) - rank(b.id));
  }, [moves, ownedMoves, loadout]);

  const [selected, setSelected] = useState<string | null>(null);
  const [n, setN] = useState(0);

  // Opens on the last taunt you sent (if you still own it), else the first loadout move.
  useEffect(() => {
    if (!visible) return;
    let live = true;
    AsyncStorage.getItem(LAST_MOVE_KEY)
      .then((last) => {
        if (!live) return;
        setSelected(last && ownedMoves.has(last) ? last : (owned[0]?.id ?? "cheer"));
        setN((x) => x + 1);
      })
      .catch(() => {
        if (live) setSelected(owned[0]?.id ?? "cheer");
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pick = (id: string) => {
    haptic.tick();
    setSelected(id);
    setN((x) => x + 1);
  };
  const current = owned.find((m) => m.id === selected) ?? null;

  const send = () => {
    if (!current) return;
    AsyncStorage.setItem(LAST_MOVE_KEY, current.id).catch(() => {});
    onPick(current.id);
    onClose();
  };

  return (
    <KeyboardSheet visible={visible} onClose={onClose} maxHeight="90%">
      <View style={styles.body}>
        <Text style={[styles.title, { color: c.foreground }]}>Taunt {targetName}</Text>
        <Text style={[styles.sub, { color: c.mutedForeground }]}>Pick a dance. It plays in your chat as your character.</Text>

        <View style={[styles.stage, { backgroundColor: c.secondary, borderColor: c.border }]}>
          {visible && profile && selected ? (
            <AvatarDisplay
              avatar={profile.avatar}
              equipped={profile.equipped}
              catalog={catalog}
              size="lg"
              interactive={false}
              focus="dance"
              move={{ id: selected, n }}
            />
          ) : null}
        </View>

        <ScrollView style={styles.list} contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false}>
          {owned.map((m) => {
            const on = m.id === selected;
            const rarity = c.rarity(m.rarity);
            return (
              <Pressable
                key={m.id}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${m.name}. ${m.description}`}
                onPress={() => pick(m.id)}
                style={[
                  styles.move,
                  { backgroundColor: on ? c.alpha(c.primary, 0.14) : c.card, borderColor: on ? c.primary : c.border, borderWidth: on ? 1.5 : 1 },
                ]}
              >
                <View style={[styles.icon, { backgroundColor: c.alpha(rarity, 0.16), borderColor: c.alpha(rarity, 0.5) }]}>
                  <MaterialCommunityIcons name={m.icon as never} size={20} color={rarity} />
                </View>
                <Text style={[styles.moveName, { color: c.foreground }]} numberOfLines={1}>
                  {m.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <Pressable
          accessibilityRole="link"
          onPress={() => {
            onClose();
            router.push({ pathname: "/customize", params: { category: "moves" } });
          }}
          style={styles.more}
        >
          <MaterialCommunityIcons name="shopping-outline" size={14} color={c.primary} />
          <Text style={[styles.moreText, { color: c.primary }]}>Get more moves in the Drip Shop</Text>
        </Pressable>

        <Button label={current ? `Send ${current.name}` : "Pick a dance"} icon="human-handsup" disabled={!current} onPress={send} />
      </View>
    </KeyboardSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 10, paddingHorizontal: 16, paddingBottom: 8 },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 13, fontFamily: "Inter_500Medium" },
  stage: { height: 260, borderRadius: 18, borderWidth: 1, overflow: "hidden" },
  list: { maxHeight: 190 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  move: { width: "31.5%", alignItems: "center", gap: 6, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 6 },
  icon: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  moveName: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  more: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", paddingVertical: 4 },
  moreText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
