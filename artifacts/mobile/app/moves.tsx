import { MaterialCommunityIcons } from "@expo/vector-icons";
import { haptic as buzz } from "@/lib/motion";
import { router, useIsFocused } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AvatarDisplay from "@/components/AvatarDisplay";
import TokenBalance from "@/components/TokenBalance";
import { BackButton, Button, ErrorBanner, Pill } from "@/components/ui";
import { DEFAULT_AVATAR } from "@/constants/avatarOptions";
import { MAX_LOADOUT } from "@/constants/moves";
import { useApp } from "@/context/AppContext";
import { useCatalog } from "@/hooks/useCatalog";
import { useColors } from "@/hooks/useColors";
import { useMoves } from "@/hooks/useMoves";

/**
 * Edit Moves: the moves you own; pick the (up to) four on your dance button.
 * Buying happens in the Drip Shop's Moves tab (/shop?tab=moves).
 */
export default function MovesScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const { profile, balance, ownedMoves, loadout, setLoadout, error, clearError } = useApp();
  const { byId: catalog } = useCatalog();
  const { moves, byId } = useMoves();

  const [selected, setSelected] = useState<string>(loadout[0] ?? "cheer");
  const [play, setPlay] = useState<{ id: string; n: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [gesture, setGesture] = useState(false);

  const preview = useCallback((id: string) => {
    setSelected(id);
    setNote(null);
    setPlay((p) => ({ id, n: (p?.n ?? 0) + 1 }));
  }, []);

  const toggle = useCallback(
    async (id: string) => {
      buzz.tick();
      if (loadout.includes(id)) {
        if (loadout.length === 1) return setNote("Keep at least one move on your dance button.");
        setNote(null);
        await setLoadout(loadout.filter((m) => m !== id));
      } else {
        if (loadout.length >= MAX_LOADOUT) return setNote(`Your dance button holds ${MAX_LOADOUT} moves — take one off first.`);
        setNote(null);
        await setLoadout([...loadout, id]);
      }
    },
    [loadout, setLoadout]
  );

  const sorted = useMemo(
    () => [...moves].filter((m) => ownedMoves.has(m.id)).sort((a, b) => a.price - b.price),
    [moves, ownedMoves]
  );
  const sel = byId.get(selected);
  const shop = () => router.push({ pathname: "/shop", params: { tab: "moves" } });
  const top = Platform.OS === "web" ? 24 : insets.top;
  const bottom = Platform.OS === "web" ? 32 : insets.bottom + 24;

  return (
    <View style={[styles.fill, { backgroundColor: c.background }]}>
      <View style={[styles.header, { paddingTop: top + 12, borderBottomColor: c.border }]}>
        <BackButton />
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>
            Edit Moves
          </Text>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>
            {`${ownedMoves.size} owned · ${loadout.length} of ${MAX_LOADOUT} on your dance button`}
          </Text>
        </View>
        <TokenBalance tokens={balance} />
      </View>

      <ErrorBanner message={error} onDismiss={clearError} />

      <ScrollView scrollEnabled={!gesture} contentContainerStyle={[styles.content, { paddingBottom: bottom }]} showsVerticalScrollIndicator={false}>
        {/* Preview: your own character, in your own outfit. */}
        <View style={[styles.stage, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.stageInner}>
            <AvatarDisplay
              avatar={profile?.avatar ?? DEFAULT_AVATAR}
              equipped={profile?.equipped ?? {}}
              catalog={catalog}
              size="lg"
              focus="hero"
              controls={false}
              onGesture={setGesture}
              move={play}
              active={focused}
            />
          </View>
          <View style={[styles.stageBar, { borderTopColor: c.border }]}>
            <View style={[styles.icon, { backgroundColor: c.alpha(c.rarity(sel?.rarity ?? "common"), 0.16) }]}>
              <MaterialCommunityIcons name={(sel?.icon ?? "music-note") as never} size={18} color={c.rarity(sel?.rarity ?? "common")} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowName, { color: c.foreground }]} numberOfLines={1}>
                {sel?.name ?? "Pick a move"}
              </Text>
              <Text style={[styles.rowMeta, { color: c.mutedForeground }]} numberOfLines={1}>
                {sel ? `${sel.rarity[0]!.toUpperCase()}${sel.rarity.slice(1)} · ${sel.seconds.toFixed(0)}s` : "Tap any move to preview it"}
              </Text>
            </View>
            <Button label="Play" icon="play" size="sm" onPress={() => preview(selected)} />
          </View>
        </View>

        {/* The dance button's four slots. */}
        <Text style={[styles.section, { color: c.foreground }]}>Your Dance Button</Text>
        <View style={styles.slots}>
          {Array.from({ length: MAX_LOADOUT }, (_, i) => {
            const id = loadout[i];
            const m = id ? byId.get(id) : undefined;
            if (!id || !m) {
              return (
                <View key={`empty-${i}`} style={[styles.slot, styles.slotEmpty, { borderColor: c.border }]}>
                  <MaterialCommunityIcons name="plus" size={18} color={c.subtleForeground} />
                  <Text style={[styles.slotText, { color: c.subtleForeground }]}>Empty</Text>
                </View>
              );
            }
            const color = c.rarity(m.rarity);
            return (
              <Pressable
                key={id}
                accessibilityRole="button"
                accessibilityLabel={`${m.name}, slot ${i + 1}. Preview`}
                onPress={() => preview(id)}
                style={({ pressed }) => [styles.slot, { backgroundColor: c.card, borderColor: selected === id ? c.primary : c.border, opacity: pressed ? 0.85 : 1 }]}
              >
                <View style={[styles.icon, { backgroundColor: c.alpha(color, 0.16) }]}>
                  <MaterialCommunityIcons name={m.icon as never} size={18} color={color} />
                </View>
                <Text style={[styles.slotText, { color: c.foreground }]} numberOfLines={1}>
                  {m.name}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Take ${m.name} off your dance button`}
                  onPress={() => toggle(id)}
                  hitSlop={8}
                  style={[styles.remove, { backgroundColor: c.secondary, borderColor: c.border }]}
                >
                  <MaterialCommunityIcons name="close" size={12} color={c.mutedForeground} />
                </Pressable>
              </Pressable>
            );
          })}
        </View>
        {note ? <Text style={[styles.note, { color: c.warning }]}>{note}</Text> : null}

        <Text style={[styles.section, { color: c.foreground }]}>Your Moves</Text>
        <View style={{ gap: 8 }}>
          {sorted.map((m) => {
            const on = loadout.includes(m.id);
            const color = c.rarity(m.rarity);
            return (
              <Pressable
                key={m.id}
                accessibilityRole="button"
                accessibilityLabel={`${m.name}. ${m.description}. Preview`}
                onPress={() => preview(m.id)}
                style={({ pressed }) => [
                  styles.row,
                  { backgroundColor: c.card, borderColor: selected === m.id ? c.alpha(c.primary, 0.7) : c.border, opacity: pressed ? 0.9 : 1 },
                ]}
              >
                <View style={[styles.rowIcon, { backgroundColor: c.alpha(color, 0.16), borderColor: c.alpha(color, 0.5) }]}>
                  <MaterialCommunityIcons name={m.icon as never} size={22} color={color} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <View style={styles.rowHead}>
                    <Text style={[styles.rowName, { color: c.foreground }]} numberOfLines={1}>
                      {m.name}
                    </Text>
                    <Text style={[styles.rarity, { color }]}>{m.rarity.toUpperCase()}</Text>
                  </View>
                  <Text style={[styles.rowMeta, { color: c.mutedForeground }]} numberOfLines={2}>
                    {m.description}
                  </Text>
                </View>
                <Button
                  label={on ? "On button" : "Add"}
                  icon={on ? "check" : "plus"}
                  size="sm"
                  variant={on ? "secondary" : "primary"}
                  onPress={() => toggle(m.id)}
                  accessibilityHint={on ? "Takes it off your dance button" : "Puts it on your dance button"}
                />
              </Pressable>
            );
          })}
        </View>
        <View style={styles.footer}>
          <Button label="Get more moves in the Shop" icon="cart-outline" onPress={shop} />
          <Pill label="Free: Cheer & Fist Pump" icon="gift-outline" />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1, paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 22, fontFamily: "Inter_900Black" },
  sub: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 1 },
  content: { padding: 16, gap: 12 },
  stage: { borderRadius: 20, borderWidth: 1, overflow: "hidden" },
  stageInner: { height: 360 },
  stageBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  section: { fontSize: 16, fontFamily: "Inter_700Bold", marginTop: 6 },
  slots: { flexDirection: "row", gap: 8 },
  slot: { flex: 1, minHeight: 92, borderRadius: 14, borderWidth: 1, padding: 8, alignItems: "center", justifyContent: "center", gap: 6 },
  slotEmpty: { borderStyle: "dashed" },
  slotText: { fontSize: 11, fontFamily: "Inter_600SemiBold", textAlign: "center" },
  remove: { position: "absolute", top: 5, right: 5, width: 20, height: 20, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  note: { fontSize: 12, fontFamily: "Inter_500Medium" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, borderWidth: 1 },
  rowIcon: { width: 46, height: 46, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  rowHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowName: { fontSize: 15, fontFamily: "Inter_700Bold", flexShrink: 1 },
  rowMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  rarity: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  footer: { alignItems: "center", marginTop: 6, gap: 12 },
});
