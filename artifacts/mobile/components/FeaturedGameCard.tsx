import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import PressableScale from "@/components/fx/PressableScale";
import Shimmer from "@/components/fx/Shimmer";
import TeamCrest from "@/components/TeamCrest";
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
      style={[styles.card, { borderColor: c.primary }]}
    >
      <LinearGradient
        colors={[c.alpha(game.awayTeam.color, 0.4), c.elevated, c.alpha(game.homeTeam.color, 0.4)]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.head}>
        <MaterialCommunityIcons name="star-four-points" size={14} color={c.primary} />
        <Text style={[styles.kicker, { color: c.primary }]}>GAME OF THE NIGHT</Text>
        <Text style={[styles.when, { color: c.mutedForeground }]}>{game.sport} · {untilKickoff(game.startsAt)}</Text>
      </View>
      <View style={styles.row}>
        <Side sport={game.sport} abbr={game.awayTeam.abbreviation} name={game.awayTeam.name} color={game.awayTeam.color} alt={game.awayTeam.altColor} odds={priced ? formatOdds(game.awayTeam.odds, fmt) : null} pct={p ? formatPercent(p.away) : null} />
        <Text style={[styles.at, { color: c.mutedForeground }]}>@</Text>
        <Side sport={game.sport} abbr={game.homeTeam.abbreviation} name={game.homeTeam.name} color={game.homeTeam.color} alt={game.homeTeam.altColor} odds={priced ? formatOdds(game.homeTeam.odds, fmt) : null} pct={p ? formatPercent(p.home) : null} />
      </View>
      {crowd ? (
        <View style={[styles.crowd, { backgroundColor: c.alpha(c.league, 0.16) }]}>
          <MaterialCommunityIcons name="account-group" size={14} color={c.league} />
          <Text style={[styles.crowdText, { color: c.foreground }]} numberOfLines={1}>
            {crowd}
          </Text>
        </View>
      ) : null}
      <View style={[styles.cta, { backgroundColor: c.primary }]}>
        <Text style={[styles.ctaText, { color: c.primaryForeground }]}>Make Your Pick</Text>
        <MaterialCommunityIcons name="chevron-right" size={18} color={c.primaryForeground} />
        <Shimmer every={3000} />
      </View>
    </PressableScale>
  );
}

function Side({ sport, abbr, name, color, alt, odds, pct }: { sport: string; abbr: string; name: string; color: string; alt?: string | null; odds: string | null; pct: string | null }) {
  const c = useColors();
  return (
    <View style={styles.side}>
      <TeamCrest abbr={abbr} color={color} altColor={alt} size={44} sport={sport} />
      <Text style={[styles.name, { color: c.foreground }]} numberOfLines={1}>
        {name}
      </Text>
      {odds ? (
        <Text style={[styles.odds, { color: c.mutedForeground }]}>
          {odds} · {pct}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, borderWidth: 1.5, padding: 14, gap: 12, overflow: "hidden", marginBottom: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 6 },
  kicker: { flex: 1, fontSize: 11, letterSpacing: 1.4, fontFamily: "Inter_900Black" },
  when: { fontSize: 12, fontFamily: "Inter_700Bold" },
  row: { flexDirection: "row", alignItems: "center" },
  side: { flex: 1, alignItems: "center", gap: 4 },
  name: { fontSize: 14, fontFamily: "Inter_800ExtraBold", textAlign: "center" },
  odds: { fontSize: 12, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  at: { fontSize: 16, fontFamily: "Inter_700Bold", paddingHorizontal: 6 },
  crowd: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  crowdText: { flex: 1, fontSize: 12, fontFamily: "Inter_600SemiBold" },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 11, borderRadius: 999, overflow: "hidden" },
  ctaText: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
});
