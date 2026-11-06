import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { doc, onSnapshot } from "firebase/firestore";
import React, { useEffect, useMemo, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut, ZoomIn } from "react-native-reanimated";
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Path, Rect, Stop } from "react-native-svg";
import { Pressable } from "@/components/fx/Tap";
import { Button, ScreenHeader, useBottomPad } from "@/components/ui";
import { ACHIEVEMENTS, METALS, type TrophyMetal } from "@/constants/achievements";
import TrophyArt, { achievementLook, trophyLook, type TrophyDesign } from "@/components/TrophyArt";
import type { TrophyItem } from "@/constants/leagueTypes";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { haptic } from "@/lib/motion";
import * as api from "@/lib/api";
import { DEMO } from "@/lib/demo";
import { getDb } from "@/lib/firebase";

interface Piece {
  key: string;
  title: string;
  icon: string;
  metal: TrophyMetal;
  /** Which piece of hardware it is: every trophy and achievement has its own. */
  design: TrophyDesign;
  earned: boolean;
  sub: string;
  detail: string;
  awardedAt?: number;
  /** users/{uid}/trophies doc id, when earned. */
  trophyId?: string;
  /** Achievements: players who hold it / all players. */
  rarity?: number | null;
}

const PER_SHELF = 3;
const WOOD = { hi: "#7A4B28", mid: "#5A3418", lo: "#2E1A0B" };

function leaguePiece(t: TrophyItem, i: number): Piece {
  const kind = t.kind;
  const { metal, design } = trophyLook(t);
  const name = t.title || t.leagueName || "League Trophy";
  const what =
    kind === "champion" ? "League Champion" : kind === "h2h_champion" ? "Head-to-Head Champion" : kind === "lock_of_week" ? "Lock of the Week" : kind === "last_place" ? "Last Place" : "League Trophy";
  return {
    key: `${t.id ?? t.leagueId}_${i}`,
    trophyId: t.id,
    title: name,
    icon: kind === "last_place" ? "emoticon-sad-outline" : kind === "lock_of_week" ? "lock" : "trophy",
    metal,
    design,
    earned: true,
    sub: t.leagueName && t.leagueName !== name ? t.leagueName : what,
    detail: [what, t.leagueName, t.rank ? `Finished #${t.rank}` : null].filter(Boolean).join(" · "),
    awardedAt: t.awardedAt,
  };
}

/**
 * Trophy Case: every trophy and achievement on lit glass shelves. League
 * hardware sits on the top shelf; achievements fill the rest, with locked
 * ones shown as dark silhouettes that say how to earn them.
 */
export default function TrophiesScreen() {
  const c = useColors();
  const bottom = useBottomPad(false);
  const { trophies, profile, writeProfile } = useApp();
  const [open, setOpen] = useState<Piece | null>(null);
  const [stats, setStats] = useState<{ players: number; counts: Record<string, number> } | null>(null);
  const [pinned, setPinned] = useState<string | null | undefined>(undefined);
  const featured = pinned !== undefined ? pinned : profile?.featuredTrophy ?? null;
  useEffect(() => {
    if (DEMO) return;
    const db = getDb();
    if (!db) return;
    return onSnapshot(doc(db, "meta", "achievementStats"), (s) => setStats(s.exists() ? (s.data() as typeof stats) : null), () => {});
  }, []);
  const pin = async (id: string | null) => {
    haptic.medium();
    writeProfile({ featuredTrophy: id }, () => api.setFeaturedTrophy({ trophyId: id }));
  };

  const { league, achievements, earnedCount } = useMemo(() => {
    const got = new Map(trophies.filter((t) => t.kind === "achievement").map((t) => [t.achievementId ?? t.id.replace(/^ach_/, ""), t]));
    const achievements: Piece[] = ACHIEVEMENTS.map((a) => {
      const t = got.get(a.id);
      return {
        key: a.id,
        title: a.title,
        icon: a.icon,
        metal: a.metal,
        design: achievementLook(a.id).design,
        earned: !!t,
        sub: t ? new Date(t.awardedAt).toLocaleDateString() : a.how,
        detail: a.how,
        awardedAt: t?.awardedAt,
        trophyId: t?.id,
        rarity: stats && stats.players > 0 ? (stats.counts[a.id] ?? 0) / stats.players : null,
      };
    }).sort((x, y) => Number(y.earned) - Number(x.earned));
    const league = trophies
      .filter((t) => t.kind !== "achievement")
      .sort((a, b) => (b.awardedAt ?? 0) - (a.awardedAt ?? 0))
      .map(leaguePiece);
    return { league, achievements, earnedCount: achievements.filter((a) => a.earned).length };
  }, [trophies, stats]);

  const shelves = (items: Piece[]) => {
    const rows: Piece[][] = [];
    for (let i = 0; i < items.length; i += PER_SHELF) rows.push(items.slice(i, i + PER_SHELF));
    return rows;
  };

  const tap = (p: Piece) => {
    haptic.light();
    setOpen(p);
  };

  return (
    <View style={[styles.fill, { backgroundColor: c.background }]}>
      <ScreenHeader
        back
        title="Trophy Case"
        subtitle={`${earnedCount}/${ACHIEVEMENTS.length} achievements · ${league.length} league trophi${league.length === 1 ? "y" : "es"}`}
      />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottom }]} showsVerticalScrollIndicator={false}>
        <LinearGradient colors={[WOOD.hi, WOOD.mid, WOOD.lo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cabinet}>
          <View style={styles.crown}>
            <LinearGradient colors={[METALS.gold.hi, METALS.gold.mid]} style={styles.nameplate}>
              <Text style={styles.nameplateText}>HALL OF DRIP</Text>
            </LinearGradient>
          </View>
          <View style={styles.glass}>
            {/* Back panel + spotlight from the top */}
            <LinearGradient colors={["#1B2230", "#0D1118", "#080A0F"]} style={StyleSheet.absoluteFill} />
            <LinearGradient colors={["rgba(255,236,190,0.22)", "rgba(255,236,190,0)"]} style={styles.spot} />

            <Text style={styles.shelfLabel}>LEAGUE HARDWARE</Text>
            {league.length ? (
              shelves(league).map((row, r) => <Shelf key={`l${r}`} row={row} base={r * PER_SHELF} onPress={tap} pinnedId={featured} />)
            ) : (
              <>
                <View style={styles.emptyShelf}>
                  <MaterialCommunityIcons name="trophy-outline" size={22} color="rgba(255,255,255,0.28)" />
                  <Text style={styles.emptyText}>Win a league to put a cup here</Text>
                </View>
                <Plank />
              </>
            )}

            <Text style={[styles.shelfLabel, { marginTop: 18 }]}>ACHIEVEMENTS</Text>
            {shelves(achievements).map((row, r) => (
              <Shelf key={`a${r}`} row={row} base={(league.length + r) * PER_SHELF} onPress={tap} pinnedId={featured} />
            ))}

            {/* Glass reflection */}
            <LinearGradient
              pointerEvents="none"
              colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.07)", "rgba(255,255,255,0)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0.6 }}
              locations={[0.25, 0.4, 0.55]}
              style={StyleSheet.absoluteFill}
            />
          </View>
        </LinearGradient>
      </ScrollView>

      <Modal visible={!!open} transparent animationType="none" onRequestClose={() => setOpen(null)} statusBarTranslucent>
        {open ? (
          <Animated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(140)} style={[styles.scrim, { backgroundColor: c.overlay }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpen(null)} accessibilityRole="button" accessibilityLabel="Close" />
            <Animated.View entering={ZoomIn.springify().damping(14)} style={[styles.detail, { backgroundColor: c.elevated, borderColor: open.earned ? METALS[open.metal].mid : c.border }]}>
              <Trophy piece={open} size={140} />
              <Text style={[styles.detailTitle, { color: c.foreground }]}>{open.title}</Text>
              <Text style={[styles.detailSub, { color: open.earned ? METALS[open.metal].mid : c.mutedForeground }]}>
                {open.earned ? `${open.metal.toUpperCase()} · EARNED` : "LOCKED"}
              </Text>
              {open.rarity != null ? (
                <Text style={[styles.rarity, { color: c.accent }]}>
                  {open.rarity < 0.005 ? "<0.5%" : `${Math.round(open.rarity * 1000) / 10}%`} of players have this
                </Text>
              ) : null}
              <Text style={[styles.detailBody, { color: c.mutedForeground }]}>
                {open.earned
                  ? `${open.detail}${open.awardedAt ? `\nAwarded ${new Date(open.awardedAt).toLocaleDateString()}` : ""}`
                  : `How to earn: ${open.detail}`}
              </Text>
              {open.earned && open.trophyId ? (
                <Button
                  label={featured === open.trophyId ? "Unpin From Profile" : "Pin to Profile"}
                  icon={featured === open.trophyId ? "pin-off-outline" : "pin-outline"}
                  onPress={() => void pin(featured === open.trophyId ? null : open.trophyId!)}
                  style={{ alignSelf: "stretch" }}
                />
              ) : null}
              <Button label="Close" variant="secondary" onPress={() => setOpen(null)} style={{ alignSelf: "stretch" }} />
            </Animated.View>
          </Animated.View>
        ) : null}
      </Modal>
    </View>
  );
}

function Shelf({ row, base, onPress, pinnedId }: { row: Piece[]; base: number; onPress: (p: Piece) => void; pinnedId?: string | null }) {
  return (
    <>
      <View style={styles.row}>
        {row.map((p, i) => (
          <Animated.View key={p.key} entering={FadeInDown.delay(Math.min(base + i, 14) * 45).springify().damping(16)} style={styles.slot}>
            <Pressable onPress={() => onPress(p)} accessibilityRole="button" accessibilityLabel={`${p.title}${p.earned ? "" : ", locked"}`} style={styles.slotPress}>
              <Trophy piece={p} size={66} />
              {p.trophyId && p.trophyId === pinnedId ? (
                <View style={styles.pinBadge}>
                  <MaterialCommunityIcons name="pin" size={12} color="#4A2C05" />
                </View>
              ) : null}
              <Text style={[styles.slotTitle, { color: p.earned ? "#F4F1EA" : "rgba(255,255,255,0.4)" }]} numberOfLines={1}>
                {p.title}
              </Text>
              <Text style={styles.slotSub} numberOfLines={1}>
                {p.sub}
              </Text>
            </Pressable>
          </Animated.View>
        ))}
        {Array.from({ length: PER_SHELF - row.length }, (_, i) => (
          <View key={`gap${i}`} style={styles.slot} />
        ))}
      </View>
      <Plank />
    </>
  );
}

function Plank() {
  return (
    <View style={styles.plankWrap}>
      <LinearGradient colors={[WOOD.hi, WOOD.mid]} style={styles.plankTop} />
      <LinearGradient colors={[WOOD.mid, WOOD.lo]} style={styles.plankFront} />
      <LinearGradient colors={["rgba(0,0,0,0.55)", "rgba(0,0,0,0)"]} style={styles.plankShadow} />
    </View>
  );
}

/** A trophy on the shelf: its own design (components/TrophyArt.tsx), locked ones dark with a padlock. */
function Trophy({ piece, size }: { piece: Piece; size: number }) {
  return <TrophyArt design={piece.design} metal={piece.metal} earned={piece.earned} icon={piece.icon} size={size} uid={piece.key} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: 16 },
  cabinet: { borderRadius: 18, padding: 10, paddingTop: 0, shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  crown: { alignItems: "center", paddingVertical: 10 },
  nameplate: { paddingHorizontal: 16, paddingVertical: 4, borderRadius: 4 },
  nameplateText: { color: "#4A2C05", fontSize: 11, letterSpacing: 2.5, fontFamily: "Inter_900Black" },
  glass: { borderRadius: 10, overflow: "hidden", paddingHorizontal: 8, paddingTop: 14, paddingBottom: 6, borderWidth: 2, borderColor: "rgba(0,0,0,0.5)" },
  spot: { position: "absolute", top: 0, left: "15%", right: "15%", height: 220, borderBottomLeftRadius: 200, borderBottomRightRadius: 200 },
  shelfLabel: { color: "rgba(255,236,190,0.55)", fontSize: 10, letterSpacing: 2, fontFamily: "Inter_800ExtraBold", textAlign: "center", marginBottom: 6 },
  row: { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 4 },
  slot: { flex: 1, alignItems: "center" },
  slotPress: { alignItems: "center", paddingTop: 6, paddingHorizontal: 2, width: "100%" },
  slotTitle: { fontSize: 11, fontFamily: "Inter_700Bold", marginTop: 2, maxWidth: "100%" },
  slotSub: { fontSize: 9, fontFamily: "Inter_500Medium", color: "rgba(255,255,255,0.4)", marginBottom: 4, maxWidth: "100%" },
  plankWrap: { marginHorizontal: -8, marginBottom: 16 },
  plankTop: { height: 6 },
  plankFront: { height: 10, borderBottomWidth: 1, borderBottomColor: "rgba(0,0,0,0.6)" },
  plankShadow: { height: 12, marginBottom: -12 },
  emptyShelf: { alignItems: "center", gap: 6, paddingVertical: 26 },
  emptyText: { color: "rgba(255,255,255,0.4)", fontSize: 12, fontFamily: "Inter_600SemiBold" },
  glow: { position: "absolute", opacity: 0.16 },
  pinBadge: { position: "absolute", top: 4, right: "22%", width: 20, height: 20, borderRadius: 10, backgroundColor: "#F2B925", alignItems: "center", justifyContent: "center" },
  iconWrap: { position: "absolute", left: 0, alignItems: "center", justifyContent: "center" },
  scrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  detail: { width: "100%", maxWidth: 360, borderRadius: 22, borderWidth: 1.5, padding: 20, alignItems: "center", gap: 6 },
  detailTitle: { fontSize: 22, fontFamily: "Inter_900Black", textAlign: "center", marginTop: 6 },
  detailSub: { fontSize: 11, letterSpacing: 1.5, fontFamily: "Inter_800ExtraBold" },
  rarity: { fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  detailBody: { fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "center", lineHeight: 19, marginBottom: 10 },
});
