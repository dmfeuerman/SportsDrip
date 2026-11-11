import { MaterialCommunityIcons } from "@expo/vector-icons";
import { haptic as buzz } from "@/lib/motion";
import { reportChallengeAction } from "@/lib/api";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import Animated, { FadeIn, FadeOut, ZoomIn } from "react-native-reanimated";
import AvatarDisplay from "@/components/AvatarDisplay";
import { useBackdropCam, ZoomingBackdrop } from "@/components/avatar/AvatarBackdrop";
import { Pill } from "@/components/ui";
import { loadoutOf, MOVES_BY_ID } from "@/constants/moves";
import { useColors } from "@/hooks/useColors";
import { SLOT_ICONS, type CatalogItem } from "@/types/catalog";
import type { AvatarConfig, Equipped } from "@/types/avatar";

export const AVATAR_HERO_HEIGHT = 500;

/**
 * The character card from the top of Home: live 3D stage at hero framing in
 * front of the player's background, dance button, and a footer (the level bar
 * on Home; "wearing" pills by default). Used for the signed-in player
 * and for anyone else's profile so every full-size avatar looks the same.
 *
 * The dance button offers the player's loadout (up to four moves): with one
 * move it just plays it; with more it fans them out to pick from.
 */
export default function AvatarHero({
  avatar,
  equipped,
  catalog,
  moves,
  onEditMoves,
  header,
  footer,
  background,
  active = true,
  onGesture,
  style,
}: {
  /** null while the profile is still loading. */
  avatar: Partial<AvatarConfig> | null | undefined;
  equipped: Equipped | null | undefined;
  catalog: Map<string, CatalogItem>;
  /** Their dance-move loadout (the default when absent). */
  moves?: string[] | null;
  /** Own card only: a shortcut from the move picker to the Moves screen. */
  onEditMoves?: () => void;
  /** Overlay row across the top of the card. */
  header?: React.ReactNode;
  /** Replaces the "wearing" pills along the bottom (Home puts the level bar here). */
  footer?: React.ReactNode;
  /** Scene behind the character (constants/backgrounds.ts); the Locker Room when absent. */
  background?: string | null;
  active?: boolean;
  /** True while a spin / pinch owns the touch, so the parent can pause scrolling. */
  onGesture?: (active: boolean) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const loadout = useMemo(() => loadoutOf(moves), [moves]);
  const [move, setMove] = useState<{ id: string; n: number } | null>(null);
  const [picking, setPicking] = useState(false);
  const play = useCallback((id: string) => {
    buzz.light();
    setPicking(false);
    setMove((m) => ({ id, n: (m?.n ?? 0) + 1 }));
    reportChallengeAction("danced");
  }, []);
  // Tapping the character cycles through the loadout, one move per tap.
  const nextMove = useRef(0);
  const onTapCharacter = useCallback(() => {
    if (!loadout.length) return;
    play(loadout[nextMove.current++ % loadout.length]!);
  }, [loadout, play]);
  const cam = useBackdropCam();
  const onDance = useCallback(() => {
    if (loadout.length === 1 && !onEditMoves) return play(loadout[0]!);
    buzz.tick();
    setPicking((p) => !p);
  }, [loadout, onEditMoves, play]);
  const wearing = useMemo(
    () =>
      Object.values(equipped ?? {})
        .map((id) => (id ? catalog.get(id) : undefined))
        .filter((i): i is CatalogItem => !!i),
    [equipped, catalog]
  );

  return (
    <View style={[styles.hero, { backgroundColor: c.elevated, borderColor: c.alpha(c.primary, 0.22) }, style]}>
      <ZoomingBackdrop id={background} cam={cam} />
      <View style={[styles.avatar, footer ? { bottom: 70 } : null]}>
        {avatar ? (
          <AvatarDisplay
            avatar={avatar}
            equipped={equipped ?? {}}
            catalog={catalog}
            size="lg"
            controls={false}
            onGesture={onGesture}
            focus="hero"
            move={move}
            active={active}
            backdropCam={cam}
            onTap={onTapCharacter}
          />
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator color={c.mutedForeground} />
          </View>
        )}
      </View>
      {avatar && picking ? (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPicking(false)} accessibilityLabel="Close moves" />
          <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(120)} style={[styles.wheel, footer ? { bottom: 150 } : null]} pointerEvents="box-none">
            {onEditMoves ? (
              <Animated.View entering={ZoomIn.duration(160)}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Edit moves"
                  onPress={() => {
                    setPicking(false);
                    onEditMoves();
                  }}
                  hitSlop={4}
                  style={({ pressed }) => [styles.moveChip, { backgroundColor: c.alpha(c.elevated, 0.94), borderColor: c.border, opacity: pressed ? 0.8 : 1 }]}
                >
                  <MaterialCommunityIcons name="pencil-outline" size={16} color={c.mutedForeground} />
                  <Text style={[styles.moveText, { color: c.mutedForeground }]}>Edit Moves</Text>
                </Pressable>
              </Animated.View>
            ) : null}
            {[...loadout].reverse().map((id, i) => {
              const m = MOVES_BY_ID.get(id);
              return (
                <Animated.View key={id} entering={ZoomIn.delay(30 * i).duration(170)}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Dance: ${m?.name ?? id}`}
                    onPress={() => play(id)}
                    hitSlop={4}
                    style={({ pressed }) => [
                      styles.moveChip,
                      { backgroundColor: c.alpha(c.elevated, 0.94), borderColor: c.alpha(c.primary, 0.45), opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] },
                    ]}
                  >
                    <View style={[styles.moveIcon, { backgroundColor: c.alpha(c.primary, 0.16) }]}>
                      <MaterialCommunityIcons name={(m?.icon ?? "music-note") as never} size={16} color={c.primary} />
                    </View>
                    <Text style={[styles.moveText, { color: c.foreground }]} numberOfLines={1}>
                      {m?.name ?? id}
                    </Text>
                  </Pressable>
                </Animated.View>
              );
            })}
          </Animated.View>
        </>
      ) : null}
      {avatar ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Dance${wearing.length ? `. Wearing ${wearing.map((i) => i.name).join(", ")}` : ""}`}
          accessibilityState={{ expanded: picking }}
          onPress={onDance}
          hitSlop={6}
          style={({ pressed }) => [styles.dance, footer ? { bottom: 92 } : null, { backgroundColor: c.primary, opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] }]}
        >
          <MaterialCommunityIcons name={picking ? "close" : "human-handsup"} size={picking ? 22 : 26} color={c.primaryForeground} />
          {!picking ? <MaterialCommunityIcons name="music-note" size={13} color={c.primaryForeground} style={styles.danceNote} /> : null}
        </Pressable>
      ) : null}
      {header ? (
        <View style={styles.top} pointerEvents="box-none">
          {header}
        </View>
      ) : null}
      <View style={styles.bottom} pointerEvents="box-none">
        {footer ?? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.wearing} contentContainerStyle={styles.wearingRow}>
            {wearing.length ? wearing.map((i) => <Pill key={i.id} label={i.name} icon={SLOT_ICONS[i.slot] as never} />) : <Pill label="Nothing Equipped Yet" />}
          </ScrollView>
        )}
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
  wheel: { position: "absolute", right: 12, bottom: 120, alignItems: "flex-end", gap: 8 },
  moveChip: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 6, paddingRight: 14, paddingVertical: 6, borderRadius: 22, borderWidth: 1, minHeight: 40 },
  moveIcon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  moveText: { fontSize: 14, fontFamily: "Inter_600SemiBold", maxWidth: 160 },
  bottom: { position: "absolute", left: 12, right: 12, bottom: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  wearing: { flex: 1 },
  wearingRow: { gap: 6, alignItems: "center" },
});
