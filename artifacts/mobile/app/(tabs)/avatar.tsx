import { MaterialCommunityIcons } from "@expo/vector-icons";
import { haptic as buzz } from "@/lib/motion";
import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AvatarDisplay from "@/components/AvatarDisplay";
import type { StageInsets } from "@/components/avatar/AvatarStage";
import { useBackdropCam, ZoomingBackdrop } from "@/components/avatar/AvatarBackdrop";
import CartButton from "@/components/CartButton";
import FavoriteTeamsSheet from "@/components/FavoriteTeamsSheet";
import PlayerProfileSheet from "@/components/PlayerProfileSheet";
import TeamChips from "@/components/TeamChips";
import ItemIcon from "@/components/avatar/ItemIcon";
import TokenBalance from "@/components/TokenBalance";
import { Button, Card, ErrorBanner } from "@/components/ui";
import { GlassDomeSheen, LiquidGlass, ObsidianBackdrop } from "@/components/ui/LiquidGlass";
import { useApp } from "@/context/AppContext";
import { useCatalog } from "@/hooks/useCatalog";
import { useColors } from "@/hooks/useColors";
import { openTourMenu } from "@/lib/tour/store";
import { TourTarget, useTourScroll } from "@/components/tour/TourTarget";
import { SLOT_ICONS, SLOT_LABELS, SLOT_ORDER } from "@/types/catalog";
import { loadoutOf, MAX_LOADOUT, MOVES_BY_ID } from "@/constants/moves";
import { ACHIEVEMENTS } from "@/constants/achievements";

const ACHIEVEMENT_COUNT = ACHIEVEMENTS.length;
import type { Slot } from "@/types/avatar";

/**
 * Locker: your character, live, with what it's wearing. All editing happens
 * in the character creator (/customize), which commits a whole look at once.
 */
export default function LockerScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width: winW } = useWindowDimensions();
  const { profile, balance, inventory, trophies, error, clearError, bets, loadout, equip, background } = useApp();
  const achievements = useMemo(() => trophies.filter((t) => t.kind === "achievement"), [trophies]);
  const leagueTrophies = useMemo(() => trophies.filter((t) => t.kind !== "achievement"), [trophies]);
  const { byId } = useCatalog();
  const focused = useIsFocused();
  // Stage: the backdrop zooms with the camera; tapping the character cycles through the loadout.
  const cam = useBackdropCam();
  const stageW = Math.max(200, winW - 32);
  const svgScale = Math.max(stageW / 100, 400 / 140);
  const podiumY = 98.5 * svgScale - (140 * svgScale - 400) / 2;
  const stageInsets = useRef<StageInsets>({ top: 8, bottom: 65 });
  stageInsets.current.top = 8;
  stageInsets.current.bottom = Math.max(0, 400 - 8 - (podiumY - 8) / 0.901);
  const [stageMove, setStageMove] = useState<{ id: string; n: number } | null>(null);
  const nextMove = useRef(0);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const tourScroll = useTourScroll(scrollRef);
  const [editTeams, setEditTeams] = useState(false);
  // "Edit my profile → Favorite Teams" lands here with ?editTeams=1.
  const params = useLocalSearchParams<{ editTeams?: string; profile?: string }>();
  useEffect(() => {
    if (params.editTeams !== "1") return;
    setEditTeams(true);
    router.setParams({ editTeams: undefined } as never);
  }, [params.editTeams]);
  const [showProfile, setShowProfile] = useState(false);
  // Home's record pills land here with ?profile=1.
  useEffect(() => {
    if (params.profile !== "1") return;
    setShowProfile(true);
    router.setParams({ profile: undefined } as never);
  }, [params.profile]);
  const favoriteTeams = profile?.favoriteTeams ?? [];
  const activePunishment = profile?.punishment && profile.punishment.expiresAt > Date.now() ? profile.punishment : null;

  const saved = profile?.equipped;
  // Wardrobe taps show on the character at once; each entry clears when the
  // profile snapshot catches up (or the call fails).
  const [pending, setPending] = useState<Partial<Record<Slot, string | null>>>({});
  const equipped = useMemo(() => {
    const out: Partial<Record<Slot, string>> = { ...(saved ?? {}) };
    for (const [slot, id] of Object.entries(pending) as [Slot, string | null][]) {
      if (id) out[slot] = id;
      else delete out[slot];
    }
    return out;
  }, [saved, pending]);
  useEffect(() => {
    setPending((p) => {
      const next = { ...p };
      let changed = false;
      for (const [slot, id] of Object.entries(p) as [Slot, string | null][]) {
        if ((saved?.[slot] ?? null) === id) {
          delete next[slot];
          changed = true;
        }
      }
      return changed ? next : p;
    });
  }, [saved]);
  const wear = useCallback(
    async (slot: Slot, itemId: string) => {
      const next = equipped[slot] === itemId ? null : itemId;
      buzz.light();
      setPending((p) => ({ ...p, [slot]: next }));
      const ok = await equip(slot, next);
      if (!ok)
        setPending((p) => {
          const { [slot]: _drop, ...rest } = p;
          return rest;
        });
    },
    [equip, equipped]
  );
  const owned = useMemo(
    () => inventory.map((id) => byId.get(id)).filter((i): i is NonNullable<typeof i> => !!i),
    [inventory, byId]
  );
  const settled = bets.filter((b) => b.status === "won" || b.status === "lost");
  const wins = settled.filter((b) => b.status === "won").length;
  const open = (category?: Slot | "body") =>
    router.push(category ? { pathname: "/customize", params: { category } } : "/customize");

  return (
    <View style={[styles.fill, { backgroundColor: c.background }]}>
      <ObsidianBackdrop />
      <LiquidGlass
        variant="bar"
        borderColor={c.isDark ? c.alpha("#FFFFFF", 0.14) : c.alpha(c.foreground, 0.1)}
        contentStyle={[styles.header, { paddingTop: (Platform.OS === "web" ? 24 : insets.top) + 12 }]}
      >
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]} numberOfLines={1}>
            Locker
          </Text>
          <Text style={[styles.handle, { color: c.mutedForeground }]} numberOfLines={1}>
            {profile?.displayName ?? "Player"}
            {profile?.username ? ` · @${profile.username}` : ""}
          </Text>
        </View>
        <TokenBalance tokens={balance} earn glass />
        <TourTarget id="locker.help">
        <Pressable
          onPress={openTourMenu}
          accessibilityRole="button"
          accessibilityLabel="Tutorials"
        >
          <LiquidGlass variant="pill" interactive contentStyle={styles.iconBtn}>
            <MaterialCommunityIcons name="help-circle-outline" size={17} color={c.foreground} />
          </LiquidGlass>
        </Pressable>
        </TourTarget>
      </LiquidGlass>

      <ErrorBanner message={error} onDismiss={clearError} />

      <ScrollView ref={scrollRef} onScroll={tourScroll.onScroll} scrollEventThrottle={tourScroll.scrollEventThrottle} contentContainerStyle={[styles.content, { paddingBottom: Platform.OS === "web" ? 100 : insets.bottom + 84 }]} showsVerticalScrollIndicator={false}>
        <tourScroll.Provider>
        {activePunishment ? (
          <Card tone="negative" style={{ gap: 4 }}>
            <View style={styles.teamsHead}>
              <MaterialCommunityIcons name="emoticon-sad-outline" size={18} color={c.negative} />
              <Text style={[styles.quickTitle, { color: c.foreground, flex: 1 }]}>
                Last-Place Punishment · {activePunishment.leagueName}
              </Text>
            </View>
            <Text style={[styles.quickSub, { color: c.mutedForeground }]}>
              Equipped until {new Date(activePunishment.expiresAt).toLocaleDateString()}.
            </Text>
          </Card>
        ) : null}

        <TourTarget id="locker.stage">
        <LiquidGlass variant="hero" radius={26} contentStyle={styles.stage}>
          <View style={[styles.floor, { backgroundColor: c.alpha(c.secondary, 0.5) }]} />
          <View style={styles.stageInner}>
            <ZoomingBackdrop id={background} cam={cam} />
            <AvatarDisplay
              avatar={profile?.avatar}
              equipped={equipped}
              catalog={byId}
              size="lg"
              active={focused}
              backdropCam={cam}
              insets={stageInsets}
              move={stageMove}
              onTap={() => {
                const loadout = loadoutOf(profile?.moves);
                if (!loadout.length) return;
                const id = loadout[nextMove.current++ % loadout.length]!;
                setStageMove((m) => ({ id, n: (m?.n ?? 0) + 1 }));
              }}
            />
          </View>
          <View pointerEvents="box-none" style={styles.shoulders}>
            <TourTarget id="locker.cart"><CartButton from="locker" /></TourTarget>
            <TourTarget id="locker.settings">
            <Pressable
              onPress={() => router.push("/settings" as never)}
              accessibilityRole="button"
              accessibilityLabel="Settings"
            >
              <LiquidGlass variant="pill" interactive contentStyle={styles.iconBtn}>
                <MaterialCommunityIcons name="cog-outline" size={17} color={c.foreground} />
              </LiquidGlass>
            </Pressable>
            </TourTarget>
          </View>
          <View style={[styles.stageBar, { borderTopColor: c.isDark ? "rgba(255,255,255,0.12)" : c.border }]}>
            <TourTarget id="locker.scene">
            <Button
              label="Scene"
              icon="image-filter-hdr"
              size="sm"
              variant="secondary"
              onPress={() => router.push({ pathname: "/customize", params: { category: "scenes" } })}
            />
            </TourTarget>
            <TourTarget id="locker.shop"><Button label="Drip Shop" icon="shopping-outline" size="sm" onPress={() => router.push({ pathname: "/customize", params: { category: "hat" } })} /></TourTarget>
          </View>
        </LiquidGlass>

        </TourTarget>
        <TourTarget id="locker.quick">
        <View style={styles.quickRow}>
          <Pressable
            onPress={() => router.push("/bets")}
            accessibilityRole="button"
            accessibilityLabel="My bets"
            style={({ pressed }) => [styles.bentoTile, { backgroundColor: c.isDark ? "#12203A" : c.card, borderColor: c.isDark ? "rgba(130, 182, 250, 0.48)" : c.border, opacity: pressed ? 0.86 : 1 }]}
          >
            <GlassDomeSheen id="locker_bets" glowColor="#60A5FA" intensity={0.44} />
            <View style={styles.teamsHead}>
              <Text style={[styles.bentoKicker, { color: c.isDark ? "rgba(226,238,255,0.85)" : c.mutedForeground, flex: 1 }]}>MY BETS</Text>
              <MaterialCommunityIcons name="chevron-right" size={16} color={c.isDark ? "rgba(255,255,255,0.65)" : c.mutedForeground} />
            </View>
            <Text style={[styles.quickBig, { color: c.isDark ? "#FFFFFF" : c.foreground }]}>
              {wins}–{settled.length - wins}
            </Text>
            <Text style={[styles.quickSub, { color: c.isDark ? "rgba(203, 218, 240, 0.78)" : c.mutedForeground }]}>
              {settled.length ? `${Math.round((wins / settled.length) * 100)}% hit rate` : "No results yet"}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => router.push("/trophies" as never)}
            accessibilityRole="button"
            accessibilityLabel="Trophy shelf"
            style={({ pressed }) => [styles.bentoTile, { backgroundColor: c.isDark ? "#241B0F" : c.card, borderColor: c.isDark ? "rgba(250, 212, 110, 0.52)" : c.border, opacity: pressed ? 0.86 : 1 }]}
          >
            <GlassDomeSheen id="locker_trophies" glowColor="#EAB308" intensity={0.48} />
            <View style={styles.teamsHead}>
              <Text style={[styles.bentoKicker, { color: c.isDark ? "#E6C98C" : c.mutedForeground, flex: 1 }]}>TROPHY SHELF</Text>
              <MaterialCommunityIcons name="chevron-right" size={16} color={c.isDark ? "rgba(255,238,206,0.7)" : c.mutedForeground} />
            </View>
            <Text style={[styles.quickBig, { color: c.isDark ? "#FCE3A1" : c.foreground }]}>{trophies.length}</Text>
            <Text style={[styles.quickSub, { color: c.isDark ? "rgba(255, 238, 206, 0.78)" : c.mutedForeground }]}>
              {achievements.length}/{ACHIEVEMENT_COUNT} achievements{leagueTrophies.length ? ` · ${leagueTrophies.length} league` : ""}
            </Text>
          </Pressable>
        </View>

        </TourTarget>
        {/* Non-nested Card + Button to prevent <button> inside <button> on Web */}
        <TourTarget id="locker.moves">
        <Card style={{ gap: 10 }}>
          <View style={styles.teamsHead}>
            <MaterialCommunityIcons name="human-handsup" size={18} color={c.primary} />
            <Text style={[styles.quickTitle, { color: c.foreground, flex: 1 }]}>Moves</Text>
            <Button label="Edit" size="sm" variant="secondary" icon="music-note" onPress={() => router.push("/moves")} />
          </View>
          <Pressable
            onPress={() => router.push("/moves")}
            accessibilityLabel="Moves: your dance button"
            style={styles.moves}
          >
            {Array.from({ length: MAX_LOADOUT }, (_, i) => {
              const m = loadout[i] ? MOVES_BY_ID.get(loadout[i]!) : undefined;
              return (
                <View key={i} style={[styles.moveSlot, { backgroundColor: m ? c.secondary : "transparent", borderColor: c.border, borderStyle: m ? "solid" : "dashed" }]}>
                  <MaterialCommunityIcons name={(m?.icon ?? "plus") as never} size={18} color={m ? c.rarity(m.rarity) : c.subtleForeground} />
                  <Text style={[styles.moveName, { color: m ? c.foreground : c.subtleForeground }]} numberOfLines={1}>
                    {m?.name ?? "Empty"}
                  </Text>
                </View>
              );
            })}
          </Pressable>
          <View style={styles.teamsHead}>
            <Text style={[styles.quickSub, { color: c.mutedForeground, flex: 1 }]}>Tap the dance button on your character to pick one.</Text>
            <Button label="Get More" size="sm" variant="ghost" icon="cart-outline" onPress={() => router.push({ pathname: "/customize", params: { category: "moves" } })} />
          </View>
        </Card>

        </TourTarget>
        <Card style={{ gap: 10 }}>
          <View style={styles.teamsHead}>
            <MaterialCommunityIcons name="heart-outline" size={18} color={c.primary} />
            <Text style={[styles.quickTitle, { color: c.foreground, flex: 1 }]}>Favorite Teams</Text>
            <Button label={favoriteTeams.length ? "Edit" : "Add"} size="sm" variant="secondary" icon="pencil-outline" onPress={() => setEditTeams(true)} />
          </View>
          {favoriteTeams.length ? (
            <TeamChips teams={favoriteTeams} max={5} />
          ) : (
            <Text style={[styles.quickSub, { color: c.mutedForeground }]}>Pick up to 5 — they show on your profile and in league standings.</Text>
          )}
          {profile?.uid ? (
            <Button label="View My Profile" size="sm" variant="ghost" icon="card-account-details-outline" onPress={() => setShowProfile(true)} />
          ) : null}
        </Card>

        <TourTarget id="locker.wearing" style={{ gap: 12 }}>
        <Text style={[styles.section, { color: c.foreground }]}>WEARING</Text>
        <View style={styles.slots}>
          {SLOT_ORDER.map((slot) => {
            const item = equipped[slot] ? byId.get(equipped[slot]!) : undefined;
            return (
              <Pressable
                key={slot}
                onPress={() => open(slot)}
                accessibilityRole="button"
                accessibilityLabel={`${SLOT_LABELS[slot]}: ${item?.name ?? "nothing"}. Change`}
                style={({ pressed }) => [styles.slotWrap, { opacity: pressed ? 0.85 : 1 }]}
              >
                <LiquidGlass variant="tile" radius={16} interactive contentStyle={styles.slot}>
                  <View style={[styles.slotArt, { backgroundColor: c.alpha(c.foreground, 0.06) }]}>
                    {item ? <ItemIcon item={item} size={44} /> : <MaterialCommunityIcons name={SLOT_ICONS[slot] as never} size={20} color={c.subtleForeground} />}
                  </View>
                  <Text style={[styles.slotLabel, { color: c.mutedForeground }]}>{SLOT_LABELS[slot].toUpperCase()}</Text>
                  <Text style={[styles.slotValue, { color: item ? c.foreground : c.subtleForeground }]} numberOfLines={1}>
                    {item?.name ?? "—"}
                  </Text>
                </LiquidGlass>
              </Pressable>
            );
          })}
        </View>

        </TourTarget>
        <TourTarget id="locker.wardrobe" style={{ gap: 12 }}>
        <View style={styles.wardrobeHead}>
          <Text style={[styles.section, { color: c.foreground }]}>WARDROBE · {owned.length}</Text>
          <Text style={[styles.quickSub, { color: c.mutedForeground }]}>Tap to wear · Hold to edit</Text>
        </View>
        <View style={styles.wardrobe}>
          {owned.map((item) => {
            const on = equipped[item.slot] === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => void wear(item.slot, item.id)}
                onLongPress={() => open(item.slot)}
                accessibilityRole="button"
                accessibilityLabel={`${item.name}${on ? ", wearing" : ""}`}
                accessibilityHint={on ? "Takes it off" : "Puts it on"}
              >
                <LiquidGlass
                  variant="tile"
                  radius={16}
                  interactive
                  tintColor={on ? c.alpha(c.primary, 0.2) : undefined}
                  borderColor={on ? c.primary : undefined}
                  borderWidth={on ? 1.75 : 1}
                  contentStyle={styles.wItem}
                >
                  <ItemIcon item={item} size={50} />
                </LiquidGlass>
              </Pressable>
            );
          })}
        </View>
        </TourTarget>
        </tourScroll.Provider>
      </ScrollView>

      <FavoriteTeamsSheet visible={editTeams} initial={favoriteTeams} initialReminders={!!profile?.teamReminders} uid={profile?.uid} onClose={() => setEditTeams(false)} />
      <PlayerProfileSheet
        uid={showProfile ? profile?.uid ?? null : null}
        onClose={() => setShowProfile(false)}
        seed={profile ? { displayName: profile.displayName, username: profile.username, avatar: profile.avatar, equipped: profile.equipped, moves: profile.moves, favoriteTeams } : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 24, fontFamily: "Inter_900Black", letterSpacing: -0.5 },
  handle: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 1 },
  iconBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, gap: 14 },
  stage: { overflow: "hidden" },
  floor: { position: "absolute", left: 0, right: 0, bottom: 52, height: 90 },
  shoulders: { position: "absolute", left: 0, right: 0, top: 20, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 18, zIndex: 5 },
  stageInner: { height: 380, overflow: "hidden" },
  stageBar: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  quickRow: { flexDirection: "row", gap: 10 },
  bentoTile: { flex: 1, borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, gap: 4, overflow: "hidden" },
  bentoKicker: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.9 },
  quickTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  quickBig: { fontSize: 26, fontFamily: "Inter_900Black", letterSpacing: -0.6, fontVariant: ["tabular-nums"], marginTop: 2 },
  quickSub: { fontSize: 11.5, fontFamily: "Inter_500Medium" },
  teamsHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  moves: { flexDirection: "row", gap: 6 },
  moveSlot: { flex: 1, alignItems: "center", gap: 4, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 12, borderWidth: 1 },
  moveName: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  section: { fontSize: 12, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.1, marginTop: 4 },
  slots: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  slotWrap: { width: "31.5%", flexGrow: 1 },
  slot: { padding: 10, gap: 4 },
  slotArt: { height: 52, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  slotLabel: { fontSize: 10.5, fontFamily: "Inter_700Bold", letterSpacing: 0.6 },
  slotValue: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  wardrobe: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  wardrobeHead: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 8 },
  wItem: { width: 66, height: 66, alignItems: "center", justifyContent: "center" },
  privacy: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, marginTop: 4 },
  privacyText: { fontSize: 12, fontFamily: "Inter_500Medium" },
});
