import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import PressableScale from "@/components/fx/PressableScale";
import Shimmer from "@/components/fx/Shimmer";
import TeamCrest from "@/components/TeamCrest";
import { FormChips, StreakBadge } from "@/components/TeamMeta";
import { LiquidGlass } from "@/components/ui/LiquidGlass";
import type { TeamSide } from "@/types/game";
import type { BoardLeagueSide } from "@/context/LeagueContext";
import { useColors } from "@/hooks/useColors";
import { haptic } from "@/lib/motion";
import { fairProbabilities, formatOdds, formatPercent, kickoffLabel, untilKickoff } from "@/lib/odds";
import { useOddsFormat } from "@/lib/settings";
import { isPriced, type Game } from "@/types/game";

const SPORT_WEIGHT: Record<string, number> = { NFL: 5, NBA: 3, NCAAF: 3, MLB: 2, NHL: 2, NCAAB: 2, Soccer: 2 };

/**
 * Game of the Night: the upcoming game (next 24h) with the most of your
 * league-mates on it; else one with your favorite team; else the biggest
 * matchup on the board, preferring prime time and a close line.
 */
export function pickFeatured(games: Game[], sides: Map<string, BoardLeagueSide[]>, favorites: Set<string>, now: number): Game | null {
  const pool = games.filter((g) => g.status === "upcoming" && !g.disrupted && g.startsAt > now && g.startsAt - now < 24 * 3600_000);
  if (!pool.length) return null;
  const score = (g: Game) => {
    const crowd = (sides.get(g.id) ?? []).length * 10;
    const fav = favorites.has(`${g.sport}:${g.homeTeam.abbreviation}`) || favorites.has(`${g.sport}:${g.awayTeam.abbreviation}`) ? 8 : 0;
    const hour = new Date(g.startsAt).getHours();
    const prime = hour >= 19 && hour <= 21 ? 2 : 0;
    const p = isPriced(g) ? fairProbabilities(g.homeTeam.odds, g.awayTeam.odds) : null;
    const close = p ? 2 - Math.abs(p.home - p.away) * 2 : 0;
    return crowd + fav + prime + close + (SPORT_WEIGHT[g.sport] ?? 1);
  };
  return pool.slice().sort((a, b) => score(b) - score(a) || a.startsAt - b.startsAt)[0] ?? null;
}

export default function FeaturedGameCard({
  game,
  sides,
  onOpen,
}: {
  game: Game;
  sides: BoardLeagueSide[];
  onOpen: (game: Game) => void;
}) {
  const c = useColors();
  const fmt = useOddsFormat();
  const priced = isPriced(game);
  const p = priced ? fairProbabilities(game.homeTeam.odds, game.awayTeam.odds) : null;
  const onHome = sides.filter((s) => s.side === "home").length;
  const onAway = sides.filter((s) => s.side === "away").length;
  const hidden = sides.filter((s) => s.side === null).length;
  const crowd = sides.length
    ? `${sides.length} league-mate${sides.length > 1 ? "s" : ""} on this · ${game.awayTeam.abbreviation} ${onAway} – ${onHome} ${game.homeTeam.abbreviation}${hidden ? ` · ${hidden} hidden` : ""}`
    : null;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={`Game of the Night: ${game.awayTeam.name} at ${game.homeTeam.name}, ${kickoffLabel(game.startsAt)}`}
      onPress={() => {
        haptic.light();
        onOpen(game);
      }}
      style={styles.outer}
    >
      <LiquidGlass
        variant="hero"
        interactive
        borderColor={c.isDark ? c.alpha(c.primary, 0.36) : c.alpha(c.primary, 0.28)}
        borderWidth={1.25}
        contentStyle={styles.card}
      >
        {/* Subtle team-tinted optical refraction behind the smoked glass surface */}
        <LinearGradient
          pointerEvents="none"
          colors={[
            c.alpha(game.awayTeam.color, c.isDark ? 0.22 : 0.14),
            c.alpha(c.elevated, 0),
            c.alpha(game.homeTeam.color, c.isDark ? 0.22 : 0.14),
          ]}
          start={{ x: 0, y: 0.45 }}
          end={{ x: 1, y: 0.55 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.head}>
          <MaterialCommunityIcons name="star-four-points" size={14} color={c.primary} />
          <Text style={[styles.kicker, { color: c.primary }]}>GAME OF THE NIGHT</Text>
          <View
            style={[
              styles.whenPill,
              {
                backgroundColor: c.isDark ? c.alpha("#FFFFFF", 0.08) : c.alpha(c.foreground, 0.06),
                borderColor: c.isDark ? c.alpha("#FFFFFF", 0.12) : c.alpha(c.foreground, 0.08),
              },
            ]}
          >
            <Text style={[styles.when, { color: c.mutedForeground }]}>
              {game.sport} · {untilKickoff(game.startsAt)}
            </Text>
          </View>
        </View>
        <View style={styles.row}>
          <Side
            team={game.awayTeam}
            sport={game.sport}
            abbr={game.awayTeam.abbreviation}
            name={game.awayTeam.name}
            color={game.awayTeam.color}
            alt={game.awayTeam.altColor}
            odds={priced ? formatOdds(game.awayTeam.odds, fmt) : null}
            pct={p ? formatPercent(p.away) : null}
          />
          <Text style={[styles.at, { color: c.mutedForeground }]}>VS</Text>
          <Side
            team={game.homeTeam}
            sport={game.sport}
            abbr={game.homeTeam.abbreviation}
            name={game.homeTeam.name}
            color={game.homeTeam.color}
            alt={game.homeTeam.altColor}
            odds={priced ? formatOdds(game.homeTeam.odds, fmt) : null}
            pct={p ? formatPercent(p.home) : null}
          />
        </View>
        {crowd ? (
          <LiquidGlass
            variant="pill"
            tintColor={c.alpha(c.league, c.isDark ? 0.26 : 0.16)}
            borderColor={c.alpha(c.league, c.isDark ? 0.52 : 0.32)}
            contentStyle={styles.crowd}
          >
            <MaterialCommunityIcons name="account-group" size={14} color={c.league} />
            <Text style={[styles.crowdText, { color: c.foreground }]} numberOfLines={1}>
              {crowd}
            </Text>
          </LiquidGlass>
        ) : null}
        <LiquidGlass
          variant="pill"
          interactive
          tintColor={c.isDark ? c.alpha(c.primary, 0.18) : c.primary}
          borderColor={c.isDark ? c.alpha(c.primary, 0.58) : c.primary}
          borderWidth={1.25}
          contentStyle={styles.cta}
        >
          <Text style={[styles.ctaText, { color: c.isDark ? c.foreground : c.primaryForeground }]}>Make Your Pick</Text>
          <MaterialCommunityIcons name="chevron-right" size={18} color={c.isDark ? c.primary : c.primaryForeground} />
          <Shimmer every={3000} />
        </LiquidGlass>
      </LiquidGlass>
    </PressableScale>
  );
}

function Side({ team, sport, abbr, name, color, alt, odds, pct }: { team: TeamSide; sport: string; abbr: string; name: string; color: string; alt?: string | null; odds: string | null; pct: string | null }) {
  const c = useColors();
  return (
    <View style={styles.side}>
      <TeamCrest abbr={abbr} name={name} color={color} altColor={alt} size={54} sport={sport} />
      <Text style={[styles.name, { color: c.foreground }]} numberOfLines={1}>
        {name}
      </Text>
      {odds ? (
        <Text style={[styles.odds, { color: c.primary }]}>
          {odds}
          <Text style={{ color: c.mutedForeground }}> · {pct}</Text>
        </Text>
      ) : null}
      {team.record ? (
        <View style={styles.meta}>
          <Text style={[styles.record, { color: c.foreground }]}>{team.record}</Text>
          <StreakBadge form={team.form} />
        </View>
      ) : null}
      <FormChips form={team.form} size={14} />
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { marginBottom: 10 },
  card: { padding: 16, gap: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 6 },
  kicker: { flex: 1, fontSize: 11, letterSpacing: 1.4, fontFamily: "Inter_900Black" },
  whenPill: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  when: { fontSize: 11, fontFamily: "Inter_700Bold" },
  row: { flexDirection: "row", alignItems: "center" },
  side: { flex: 1, alignItems: "center", gap: 4 },
  name: { fontSize: 14, fontFamily: "Inter_800ExtraBold", textAlign: "center" },
  odds: { fontSize: 13, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"] },
  meta: { flexDirection: "row", alignItems: "center", gap: 5 },
  record: { fontSize: 12, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  at: { fontSize: 13, fontFamily: "Inter_800ExtraBold", letterSpacing: 1, paddingHorizontal: 6 },
  crowd: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7 },
  crowdText: { flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold" },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 12 },
  ctaText: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
});
