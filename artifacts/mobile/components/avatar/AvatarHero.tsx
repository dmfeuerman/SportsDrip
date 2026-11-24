import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { haptic as buzz } from "@/lib/motion";
import { reportChallengeAction } from "@/lib/api";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import Animated, { FadeIn, FadeOut, ZoomIn } from "react-native-reanimated";
import AvatarDisplay from "@/components/AvatarDisplay";
import type { StageInsets } from "@/components/avatar/AvatarStage";
import { useBackdropCam, ZoomingBackdrop } from "@/components/avatar/AvatarBackdrop";
import { Pill } from "@/components/ui";
import { loadoutOf, MOVES_BY_ID } from "@/constants/moves";
import { useColors } from "@/hooks/useColors";
import { SLOT_ICONS, type CatalogItem } from "@/types/catalog";
import type { AvatarConfig, Equipped } from "@/types/avatar";

export const AVATAR_HERO_HEIGHT = 540;

/**
 * The character card from the top of Home: live 3D stage at hero framing in
 * front of the player's background, dance button, and a footer (the bankroll
 * HUD + level bar on Home; "wearing" pills by default). Used for the signed-in
 * player and for anyone else's profile so every full-size avatar looks the same.
 */
export default function AvatarHero({
  avatar,
  equipped,
  catalog,
  moves,
  onEditMoves,
  header,
  floatingRight,
  footer,
  footerHeight,
  hideFooter = false,
  bleed = false,
  glassDance = false,
  topPad = 0,
  background,
  active = true,
  loadingSpinner = false,
  onGesture,
  cropBottom = 0,
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
  /** Optional floating quick-action pills on the right edge of the 3D stage. */
  floatingRight?: React.ReactNode;
  /** Replaces the "wearing" pills along the bottom (Home puts the bankroll HUD + level bar here). */
  footer?: React.ReactNode;
  /** Bottom clearance for taller custom footers (defaults to 70 when footer is provided). */
  footerHeight?: number;
  /** Omit the bottom footer/wearing pills entirely (when the HUD lives below the hero). */
  hideFooter?: boolean;
  /** Edge-to-edge hero that fades smoothly into the screen background (Home). */
  bleed?: boolean;
  /** Translucent glass dance button styling for the 2026 Home hero. */
  glassDance?: boolean;
  /** Top safe-area inset when `bleed` extends behind the status bar. */
  topPad?: number;
  /** Scene behind the character (constants/backgrounds.ts); the Locker Room when absent. */
  background?: string | null;
  active?: boolean;
  /** Show a spinner instead of the cached 2D stand-in until the live 3D stage draws. */
  loadingSpinner?: boolean;
  /** True while a spin / pinch owns the touch, so the parent can pause scrolling. */
  onGesture?: (active: boolean) => void;
  /**
   * Cards only: trims this many points off the bottom of the card. The stage
   * keeps its full height behind the clip, so the character stays the same
   * size and position; only floor is cut (the footer and dance button move up
   * with the edge).
   */
  cropBottom?: number;
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

  const heroH = bleed && hideFooter ? 404 + topPad : bleed ? AVATAR_HERO_HEIGHT + topPad : AVATAR_HERO_HEIGHT;
  const footOffset = hideFooter ? 14 : footer ? (footerHeight ?? 70) : 52;
  const topInset = bleed ? topPad + 48 : 76;
  const autoBottom = bleed && hideFooter ? 16 : Math.max(footOffset, 110);
  const stageInsets = useRef<StageInsets>({ top: topInset, bottom: autoBottom });
  stageInsets.current.top = topInset;
  stageInsets.current.bottom = autoBottom;
  const fadeBase = c.background;

  return (
    <View
      style={[
        bleed ? styles.heroBleedWrap : styles.heroShadow,
        { backgroundColor: bleed ? c.background : c.elevated },
        bleed && { height: heroH },
        !bleed && cropBottom > 0 && { height: AVATAR_HERO_HEIGHT - cropBottom },
        style,
      ]}
    >
    <View
      style={[
        styles.hero,
        bleed
          ? styles.heroBleed
          : { backgroundColor: c.elevated, borderColor: c.isDark ? "rgba(125, 175, 235, 0.28)" : c.alpha(c.primary, 0.28) },
      ]}
    >
      <View style={[StyleSheet.absoluteFill, !bleed && cropBottom > 0 && { bottom: -cropBottom }]} pointerEvents="box-none">
      <ZoomingBackdrop
        id={background}
        cam={cam}
        align={bleed && hideFooter ? "top" : "mid"}
        offsetY={bleed && hideFooter ? 12 : 0}
        baseScale={bleed && hideFooter ? 1.06 : 1}
      />
      {bleed ? (
        <>
          <LinearGradient
            colors={[c.background, c.alpha(c.background, 0.38), "transparent"]}
            locations={[0, 0.45, 1]}
            style={[styles.topFade, { height: topPad + 56 }]}
            pointerEvents="none"
          />
          <LinearGradient
            colors={["transparent", c.alpha(fadeBase, 0.55), fadeBase]}
            locations={[0, 0.58, 1]}
            style={[styles.bottomFade, { height: hideFooter ? 92 : Math.max(150, footOffset + 22) }]}
            pointerEvents="none"
          />
        </>
      ) : null}
      <View style={styles.avatar}>
        {/* Null while the profile loads: the stage shows its spinner, never a stand-in body. */}
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
          insets={stageInsets}
          onTap={onTapCharacter}
          loadingSpinner={loadingSpinner}
        />
      </View>
      </View>
      {avatar && picking ? (
        <>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPicking(false)} accessibilityLabel="Close moves" />
          <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(120)} style={[styles.wheel, { bottom: footOffset + 80 }]} pointerEvents="box-none">
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
          style={({ pressed }) => [
            styles.dance,
            { bottom: footOffset + 16 },
            glassDance
              ? {
                  backgroundColor: "rgba(255, 255, 255, 0.14)",
                  borderWidth: 1,
                  borderColor: "rgba(255, 255, 255, 0.28)",
                }
              : { backgroundColor: c.primary },
            { opacity: pressed ? 0.8 : 1, transform: [{ scale: pressed ? 0.94 : 1 }] },
          ]}
        >
          <MaterialCommunityIcons name={picking ? "close" : "human-handsup"} size={picking ? 22 : 25} color={glassDance ? "#FFFFFF" : c.primaryForeground} />
          {!picking ? <MaterialCommunityIcons name="music-note" size={13} color={glassDance ? "#FFFFFF" : c.primaryForeground} style={styles.danceNote} /> : null}
        </Pressable>
      ) : null}
      {header ? (
        <View style={[styles.top, bleed && { paddingTop: topPad + 12 }]} pointerEvents="box-none">
          {header}
        </View>
      ) : null}
      {floatingRight ? (
        <View style={[styles.floatingRight, bleed && { top: topPad + 108 }]} pointerEvents="box-none">
          {floatingRight}
        </View>
      ) : null}
      {!hideFooter ? (
        <View style={styles.bottom} pointerEvents="box-none">
          {footer ?? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.wearing} contentContainerStyle={styles.wearingRow}>
              {wearing.length ? wearing.map((i) => <Pill key={i.id} label={i.name} icon={SLOT_ICONS[i.slot] as never} />) : <Pill label="Nothing Equipped Yet" />}
            </ScrollView>
          )}
        </View>
      ) : null}
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heroShadow: {
    height: AVATAR_HERO_HEIGHT,
    borderRadius: 26,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.38,
    shadowRadius: 18,
    elevation: 10,
  },
  heroBleedWrap: { height: AVATAR_HERO_HEIGHT },
  hero: { flex: 1, borderRadius: 26, borderWidth: 1.5, overflow: "hidden" },
  heroBleed: { borderRadius: 0, borderWidth: 0 },
  topFade: { position: "absolute", left: 0, right: 0, top: 0 },
  bottomFade: { position: "absolute", left: 0, right: 0, bottom: 0 },
  avatar: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  top: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  floatingRight: { position: "absolute", right: 0, top: 108, alignItems: "flex-end", gap: 10 },
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
