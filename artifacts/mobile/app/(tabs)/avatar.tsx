import { MaterialCommunityIcons } from "@expo/vector-icons";
import { haptic as buzz } from "@/lib/motion";
import { router, useIsFocused } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AvatarDisplay from "@/components/AvatarDisplay";
import AvatarBackdrop from "@/components/avatar/AvatarBackdrop";
import CartButton from "@/components/CartButton";
import FavoriteTeamsSheet from "@/components/FavoriteTeamsSheet";
import PlayerProfileSheet from "@/components/PlayerProfileSheet";
import PlayLimitsCard from "@/components/PlayLimitsCard";
import TeamChips from "@/components/TeamChips";
import ItemIcon from "@/components/avatar/ItemIcon";
import TokenBalance from "@/components/TokenBalance";
import { Button, Card, ErrorBanner, Pill, SegmentedControl } from "@/components/ui";
import { useAds } from "@/context/AdsContext";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { useCatalog } from "@/hooks/useCatalog";
import { useColors } from "@/hooks/useColors";
import { openWalkthrough, setOddsFormat, useOddsFormat } from "@/lib/settings";
import { SLOT_ICONS, SLOT_LABELS, SLOT_ORDER } from "@/types/catalog";
import { MAX_LOADOUT, MOVES_BY_ID } from "@/constants/moves";

/** Mirrors functions/src/lib/achievements.ts ACHIEVEMENTS.length. */
const ACHIEVEMENT_COUNT = 13;
import type { Slot } from "@/types/avatar";

/**
 * Locker: your character, live, with what it's wearing. All editing happens
 * in the character creator (/customize), which commits a whole look at once.
 */
export default function LockerScreen() {
  const c = useColors();
  const oddsFormat = useOddsFormat();
  const insets = useSafeAreaInsets();
  const { profile, balance, inventory, trophies, error, clearError, bets, loadout, equip, background } = useApp();
  const achievements = useMemo(() => trophies.filter((t) => t.kind === "achievement"), [trophies]);
  const leagueTrophies = useMemo(() => trophies.filter((t) => t.kind !== "achievement"), [trophies]);
  const { byId } = useCatalog();
  const { signOut } = useAuth();
  const { privacyOptionsRequired, openPrivacyOptions } = useAds();
  const focused = useIsFocused();
  const [editTeams, setEditTeams] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
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
      <View style={[styles.header, { paddingTop: (Platform.OS === "web" ? 24 : insets.top) + 12, borderBottomColor: c.border }]}>
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]} numberOfLines={1}>
            Locker
          </Text>
          <Text style={[styles.handle, { color: c.mutedForeground }]} numberOfLines={1}>
            {profile?.displayName ?? "Player"}
            {profile?.username ? ` · @${profile.username}` : ""}
          </Text>
        </View>
        <TokenBalance tokens={balance} />
        <CartButton from="locker" />
        <Pressable
          style={[styles.iconBtn, { backgroundColor: c.secondary, borderColor: c.border }]}
          onPress={openWalkthrough}
          accessibilityRole="button"
          accessibilityLabel="App walkthrough and info"
        >
          <MaterialCommunityIcons name="help-circle-outline" size={17} color={c.foreground} />
        </Pressable>
        <Pressable
          style={[styles.iconBtn, { backgroundColor: c.secondary, borderColor: c.border }]}
          onPress={signOut}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <MaterialCommunityIcons name="logout" size={15} color={c.mutedForeground} />
        </Pressable>
      </View>

      <ErrorBanner message={error} onDismiss={clearError} />

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Platform.OS === "web" ? 100 : insets.bottom + 84 }]} showsVerticalScrollIndicator={false}>
        {activePunishment ? (
          <Card style={{ gap: 4, borderColor: c.negative }}>
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

        <View style={[styles.stage, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={[styles.floor, { backgroundColor: c.secondary }]} />
          <View style={styles.stageInner}>
            <AvatarBackdrop id={background} />
            <AvatarDisplay avatar={profile?.avatar} equipped={equipped} catalog={byId} size="lg" active={focused} />
          </View>
          <View style={[styles.stageBar, { borderTopColor: c.border }]}>
            <Text style={[styles.stageHint, { color: c.mutedForeground }]}>Drag to turn · zoom to inspect</Text>
            <Button
              label="Scene"
              icon="image-filter-hdr"
              size="sm"
              variant="secondary"
              onPress={() => router.push({ pathname: "/shop", params: { tab: "backgrounds" } })}
            />
            <Button label="Customize" icon="tshirt-crew-outline" size="sm" onPress={() => open()} />
          </View>
        </View>

        <View style={styles.quickRow}>
          <Card onPress={() => router.push("/shop")} style={styles.quickCard} accessibilityLabel="Drip Shop">
            <MaterialCommunityIcons name="shopping-outline" size={20} color={c.primary} />
            <Text style={[styles.quickTitle, { color: c.foreground }]}>Drip Shop</Text>
            <Text style={[styles.quickSub, { color: c.mutedForeground }]}>Preview, buy, wear</Text>
          </Card>
          <Card onPress={() => router.push("/prizes")} style={styles.quickCard} accessibilityLabel="Prize boxes">
            <MaterialCommunityIcons name="gift-outline" size={20} color={c.primary} />
            <Text style={[styles.quickTitle, { color: c.foreground }]}>Prize boxes</Text>
            <Text style={[styles.quickSub, { color: c.mutedForeground }]}>
              {profile?.streak?.count
                ? `🔥 ${profile.streak.count}d streak${profile.streak.freezes ? " · 🧊" : ""}`
                : profile?.streak?.longest
                  ? `Best streak ${profile.streak.longest}d`
                  : "Free credits"}
            </Text>
          </Card>
          <Card onPress={() => router.push("/bets")} style={styles.quickCard} accessibilityLabel="Bet history">
            <MaterialCommunityIcons name="chart-line" size={20} color={c.accent} />
            <Text style={[styles.quickTitle, { color: c.foreground }]}>
              {wins}–{settled.length - wins}
            </Text>
            <Text style={[styles.quickSub, { color: c.mutedForeground }]}>
              {settled.length ? `${Math.round((wins / settled.length) * 100)}% hit rate` : "No results yet"}
            </Text>
          </Card>
        </View>

        <Card style={{ gap: 8 }}>
          <View style={styles.teamsHead}>
            <MaterialCommunityIcons name="trophy" size={18} color={c.primary} />
            <Text style={[styles.quickTitle, { color: c.foreground, flex: 1 }]}>Trophy Shelf ({trophies.length})</Text>
            <Text style={[styles.quickSub, { color: c.mutedForeground }]}>
              {achievements.length}/{ACHIEVEMENT_COUNT} achievements
            </Text>
          </View>
          {achievements.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {achievements.map((t) => (
                <View key={t.id} accessible accessibilityLabel={`Achievement: ${t.title}`} style={[styles.ach, { backgroundColor: c.alpha(c.primary, 0.12), borderColor: c.alpha(c.primary, 0.4) }]}>
                  <MaterialCommunityIcons name={(t.label ?? "trophy-award") as never} size={20} color={c.primary} />
                  <Text style={[styles.achText, { color: c.foreground }]} numberOfLines={2}>
                    {t.title}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.quickSub, { color: c.mutedForeground }]}>Win picks, keep a streak and add friends to earn achievements.</Text>
          )}
          {leagueTrophies.length ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {leagueTrophies.map((t, idx) => (
                <Pill key={`${t.id ?? t.leagueId}_${idx}`} label={`🏆 ${t.title || t.leagueName}`} tone="money" />
              ))}
            </View>
          ) : null}
        </Card>

        {/* Non-nested Card + Button to prevent <button> inside <button> on Web */}
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
            <Button label="Get more" size="sm" variant="ghost" icon="cart-outline" onPress={() => router.push({ pathname: "/shop", params: { tab: "moves" } })} />
          </View>
        </Card>

        <Card style={{ gap: 10 }}>
          <View style={styles.teamsHead}>
            <MaterialCommunityIcons name="heart-outline" size={18} color={c.primary} />
            <Text style={[styles.quickTitle, { color: c.foreground, flex: 1 }]}>Favorite teams</Text>
            <Button label={favoriteTeams.length ? "Edit" : "Add"} size="sm" variant="secondary" icon="pencil-outline" onPress={() => setEditTeams(true)} />
          </View>
          {favoriteTeams.length ? (
            <TeamChips teams={favoriteTeams} max={5} />
          ) : (
            <Text style={[styles.quickSub, { color: c.mutedForeground }]}>Pick up to 5 — they show on your profile and in league standings.</Text>
          )}
          {profile?.uid ? (
            <Button label="View my profile" size="sm" variant="ghost" icon="card-account-details-outline" onPress={() => setShowProfile(true)} />
          ) : null}
        </Card>

        <Card style={{ gap: 8 }}>
          <View style={styles.teamsHead}>
            <MaterialCommunityIcons name="swap-horizontal" size={18} color={c.primary} />
            <Text style={[styles.quickTitle, { color: c.foreground, flex: 1 }]}>Odds display</Text>
          </View>
          <SegmentedControl
            value={oddsFormat}
            onChange={(v) => void setOddsFormat(v)}
            options={[
              { value: "decimal", label: "Decimal (2.31x)" },
              { value: "american", label: "American (+131)" },
            ]}
          />
        </Card>

        <Card style={{ gap: 8 }}>
          <View style={styles.teamsHead}>
            <MaterialCommunityIcons name="help-circle-outline" size={18} color={c.accent} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.quickTitle, { color: c.foreground }]}>App Walkthrough & Guide</Text>
              <Text style={[styles.quickSub, { color: c.mutedForeground }]}>
                Learn how betting, tokens, leagues, loans, and chat work
              </Text>
            </View>
            <Button label="Tour" size="sm" variant="secondary" icon="compass-outline" onPress={openWalkthrough} />
          </View>
        </Card>

        <Text style={[styles.section, { color: c.foreground }]}>Wearing</Text>
        <View style={styles.slots}>
          {SLOT_ORDER.map((slot) => {
            const item = equipped[slot] ? byId.get(equipped[slot]!) : undefined;
            return (
              <Pressable
                key={slot}
                onPress={() => open(slot)}
                accessibilityRole="button"
                accessibilityLabel={`${SLOT_LABELS[slot]}: ${item?.name ?? "nothing"}. Change`}
                style={({ pressed }) => [styles.slot, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.85 : 1 }]}
              >
                <View style={[styles.slotArt, { backgroundColor: c.secondary }]}>
                  {item ? <ItemIcon item={item} size={44} /> : <MaterialCommunityIcons name={SLOT_ICONS[slot] as never} size={20} color={c.subtleForeground} />}
                </View>
                <Text style={[styles.slotLabel, { color: c.mutedForeground }]}>{SLOT_LABELS[slot].toUpperCase()}</Text>
                <Text style={[styles.slotValue, { color: item ? c.foreground : c.subtleForeground }]} numberOfLines={1}>
                  {item?.name ?? "—"}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.wardrobeHead}>
          <Text style={[styles.section, { color: c.foreground }]}>Wardrobe · {owned.length}</Text>
          <Text style={[styles.quickSub, { color: c.mutedForeground }]}>Tap to wear · hold to customize</Text>
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
                style={[styles.wItem, { backgroundColor: c.card, borderColor: on ? c.primary : c.border, borderWidth: on ? 2 : 1 }]}
              >
                <ItemIcon item={item} size={52} />
              </Pressable>
            );
          })}
        </View>

        <PlayLimitsCard />

        {privacyOptionsRequired ? (
          <Pressable
            onPress={openPrivacyOptions}
            accessibilityRole="button"
            accessibilityLabel="Privacy and ad choices"
            style={styles.privacy}
          >
            <MaterialCommunityIcons name="shield-account-outline" size={15} color={c.mutedForeground} />
            <Text style={[styles.privacyText, { color: c.mutedForeground }]}>Privacy & ad choices</Text>
          </Pressable>
        ) : null}
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
  ach: { width: 92, alignItems: "center", gap: 4, paddingVertical: 10, paddingHorizontal: 6, borderRadius: 14, borderWidth: 1 },
  achText: { fontSize: 11, fontFamily: "Inter_700Bold", textAlign: "center" },
  fill: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1, paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 22, fontFamily: "Inter_900Black" },
  handle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  iconBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 16, gap: 14 },
  stage: { borderRadius: 20, borderWidth: 1, overflow: "hidden" },
  floor: { position: "absolute", left: 0, right: 0, bottom: 52, height: 90 },
  stageInner: { height: 400 },
  stageBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  stageHint: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
  quickRow: { flexDirection: "row", gap: 8 },
  quickCard: { flex: 1, gap: 4, padding: 12 },
  quickTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  quickSub: { fontSize: 11, fontFamily: "Inter_400Regular" },
  teamsHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  moves: { flexDirection: "row", gap: 6 },
  moveSlot: { flex: 1, alignItems: "center", gap: 4, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 12, borderWidth: 1 },
  moveName: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  section: { fontSize: 16, fontFamily: "Inter_700Bold", marginTop: 4 },
  slots: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  slot: { width: "31.5%", flexGrow: 1, borderRadius: 14, borderWidth: 1, padding: 10, gap: 4 },
  slotArt: { height: 52, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  slotLabel: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  slotValue: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  wardrobe: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  wardrobeHead: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 8 },
  wItem: { width: 66, height: 66, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  privacy: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, marginTop: 4 },
  privacyText: { fontSize: 12, fontFamily: "Inter_500Medium" },
});
