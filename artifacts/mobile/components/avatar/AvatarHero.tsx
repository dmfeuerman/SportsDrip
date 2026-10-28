import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import AvatarDisplay from "@/components/AvatarDisplay";
import { Pill } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { SLOT_ICONS, type CatalogItem } from "@/types/catalog";
import type { AvatarConfig, Equipped } from "@/types/avatar";

export const AVATAR_HERO_HEIGHT = 500;

/**
 * The character card from the top of Home: live 3D stage at hero framing,
 * glow, celebrate button and "wearing" pills. Used for the signed-in player
 * and for anyone else's profile so every full-size avatar looks the same.
 */
export default function AvatarHero({
  avatar,
  equipped,
  catalog,
  header,
  active = true,
  onGesture,
  style,
}: {
  /** null while the profile is still loading. */
  avatar: Partial<AvatarConfig> | null | undefined;
  equipped: Equipped | null | undefined;
  catalog: Map<string, CatalogItem>;
  /** Overlay row across the top of the card. */
  header?: React.ReactNode;
  active?: boolean;
  /** True while a spin / pinch owns the touch, so the parent can pause scrolling. */
  onGesture?: (active: boolean) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  // Taps alternate between the cheer and the win fist pump.
  const [gesture, setGesture] = useState<{ n: number; cheer: number; win: { kind: "win"; id: number } | null }>({ n: 0, cheer: 0, win: null });
  const celebrate = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setGesture((g) => (g.n % 2 === 0 ? { ...g, n: g.n + 1, cheer: g.cheer + 1 } : { ...g, n: g.n + 1, win: { kind: "win", id: g.n + 1 } }));
  }, []);
  const wearing = useMemo(
    () =>
      Object.values(equipped ?? {})
        .map((id) => (id ? catalog.get(id) : undefined))
        .filter((i): i is CatalogItem => !!i),
    [equipped, catalog]
  );

  return (
    <View style={[styles.hero, { backgroundColor: c.elevated, borderColor: c.alpha(c.primary, 0.22) }, style]}>
      <LinearGradient
        pointerEvents="none"
        colors={[c.alpha(c.primary, c.isDark ? 0.16 : 0.1), "transparent", c.alpha(c.primary, c.isDark ? 0.22 : 0.12)]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.avatar}>
        {avatar ? (
          <AvatarDisplay
            avatar={avatar}
            equipped={equipped ?? {}}
            catalog={catalog}
            size="lg"
            controls={false}
            onGesture={onGesture}
            focus="hero"
            cheerSignal={gesture.cheer}
            reaction={gesture.win}
            active={active}
          />
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator color={c.mutedForeground} />
          </View>
        )}
      </View>
      {avatar ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Celebrate${wearing.length ? `. Wearing ${wearing.map((i) => i.name).join(", ")}` : ""}`}
          onPress={celebrate}
          hitSlop={6}
          style={({ pressed }) => [styles.dance, { backgroundColor: c.primary, opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] }]}
        >
          <MaterialCommunityIcons name="human-handsup" size={26} color={c.primaryForeground} />
          <MaterialCommunityIcons name="music-note" size={13} color={c.primaryForeground} style={styles.danceNote} />
        </Pressable>
      ) : null}
      {header ? (
        <View style={styles.top} pointerEvents="box-none">
          {header}
        </View>
      ) : null}
      <View style={styles.bottom} pointerEvents="box-none">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.wearing} contentContainerStyle={styles.wearingRow}>
          {wearing.length ? wearing.map((i) => <Pill key={i.id} label={i.name} icon={SLOT_ICONS[i.slot] as never} />) : <Pill label="Nothing equipped yet" />}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { height: AVATAR_HERO_HEIGHT, borderRadius: 26, borderWidth: 1, overflow: "hidden" },
  avatar: { position: "absolute", left: 0, right: 0, top: 56, bottom: 52 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  top: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  dance: { position: "absolute", right: 12, bottom: 62, width: 50, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center" },
  danceNote: { position: "absolute", top: 7, right: 8 },
  bottom: { position: "absolute", left: 14, right: 14, bottom: 14, flexDirection: "row", alignItems: "center", gap: 8 },
  wearing: { flex: 1 },
  wearingRow: { gap: 6, alignItems: "center" },
});
