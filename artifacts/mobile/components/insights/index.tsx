import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { ActionChip } from "@/components/ui";
import { useColors, type Colors } from "@/hooks/useColors";
import { fairProbabilities, formatPercent } from "@/lib/odds";
import type { Game, Side, TeamSide } from "@/types/game";
import type { GameInsights, H2HGame, Injury, PlayerLeader, RecentGame } from "@/types/insights";

/**
 * Building blocks for game insights: the live scoring view (linescore,
 * situation, win probability, scoring timeline) and the pre-bet matchup
 * (form, head-to-head, key players, team stats, injuries).
 *
 * Every block renders nothing when its data is empty, so a sport the provider
 * covers thinly gets a shorter page instead of a page of dashes.
 */

export const teamOf = (g: Game, s: Side): TeamSide => (s === "home" ? g.homeTeam : g.awayTeam);
const SIDES: Side[] = ["away", "home"];

function shortDate(ms: number | null): string {
  if (!ms) return "";
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString([], sameYear ? { month: "short", day: "numeric" } : { month: "short", year: "numeric" });
}

// ── primitives ─────────────────────────────────────────────────────────────

export function Block({
  title,
  caption,
  right,
  children,
}: {
  title: string;
  caption?: string | null;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const c = useColors();
  return (
    <Animated.View entering={FadeIn.duration(220)} layout={LinearTransition.duration(200)} style={styles.block}>
      <View style={styles.blockHead}>
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={[styles.blockTitle, { color: c.foreground }]}>
            {title}
          </Text>
          {caption ? <Text style={[styles.caption, { color: c.subtleForeground }]}>{caption}</Text> : null}
        </View>
        {right}
      </View>
      <View style={[styles.blockBody, { backgroundColor: c.card, borderColor: c.border }]}>{children}</View>
    </Animated.View>
  );
}

export function TeamMark({ team, size = 20 }: { team: TeamSide; size?: number }) {
  const c = useColors();
  if (team.logoUrl) {
    return <Image source={{ uri: team.logoUrl }} style={{ width: size, height: size }} contentFit="contain" transition={100} />;
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: c.alpha(team.color, 0.25),
        borderWidth: 1,
        borderColor: team.color,
      }}
    />
  );
}

export function FormStrip({ results, size = 18 }: { results: Array<"W" | "L" | "D" | null>; size?: number }) {
  const c = useColors();
  if (!results.length) return null;
  return (
    <View style={styles.formStrip} accessibilityLabel={`Last ${results.length}: ${results.map((r) => r ?? "?").join(" ")}`}>
      {results.map((r, i) => {
        const tone = r === "W" ? c.positive : r === "L" ? c.negative : c.push;
        return (
          <View key={i} style={[styles.formChip, { width: size, height: size, backgroundColor: c.alpha(tone, 0.16), borderColor: c.alpha(tone, 0.6) }]}>
            <Text style={[styles.formText, { color: tone, fontSize: size * 0.55 }]}>{r ?? "–"}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** Two-way split bar, away on the left as on the card. */
export function SplitBar({ game, away, home, label }: { game: Game; away: number; home: number; label: string }) {
  const c = useColors();
  const total = away + home || 1;
  const a = Math.max(0.04, Math.min(0.96, away / total));
  return (
    <View style={{ gap: 6 }} accessible accessibilityLabel={`${label}: ${game.awayTeam.abbreviation} ${formatPercent(away / total)}, ${game.homeTeam.abbreviation} ${formatPercent(home / total)}`}>
      <View style={styles.splitHead}>
        <Text style={[styles.splitPct, { color: c.foreground }]}>
          {game.awayTeam.abbreviation} {formatPercent(away / total)}
        </Text>
        <Text style={[styles.caption, { color: c.subtleForeground }]}>{label}</Text>
        <Text style={[styles.splitPct, { color: c.foreground }]}>
          {formatPercent(home / total)} {game.homeTeam.abbreviation}
        </Text>
      </View>
      <View style={[styles.splitTrack, { backgroundColor: c.secondary }]}>
        <Animated.View layout={LinearTransition.duration(400)} style={{ flex: a, backgroundColor: c.alpha(game.awayTeam.color, 0.9) }} />
        <View style={{ width: 2, backgroundColor: c.card }} />
        <Animated.View layout={LinearTransition.duration(400)} style={{ flex: 1 - a, backgroundColor: c.alpha(game.homeTeam.color, 0.9) }} />
      </View>
    </View>
  );
}

export function LiveDot({ size = 8 }: { size?: number }) {
  const c = useColors();
  const o = useSharedValue(1);
  useEffect(() => {
    o.value = withRepeat(withTiming(0.25, { duration: 800 }), -1, true);
  }, [o]);
  const style = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: c.live }, style]} />;
}

export function InsightsSkeleton({ rows = 3 }: { rows?: number }) {
  const c = useColors();
  return (
    <View style={{ gap: 10 }}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={[styles.skel, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={[styles.skelBar, { backgroundColor: c.secondary, width: "40%" }]} />
          <View style={[styles.skelBar, { backgroundColor: c.secondary, width: "85%" }]} />
        </View>
      ))}
      <ActivityIndicator color={c.mutedForeground} />
    </View>
  );
}

export function Note({ text, icon = "information-outline", action, onAction }: { text: string; icon?: React.ComponentProps<typeof MaterialCommunityIcons>["name"]; action?: string; onAction?: () => void }) {
  const c = useColors();
  return (
    <View style={[styles.note, { backgroundColor: c.secondary, borderColor: c.border }]}>
      <MaterialCommunityIcons name={icon} size={15} color={c.mutedForeground} />
      <Text style={[styles.noteText, { color: c.mutedForeground }]}>{text}</Text>
      {action && onAction ? (
        <ActionChip label={action} onPress={onAction} />
      ) : null}
    </View>
  );
}

// ── live ───────────────────────────────────────────────────────────────────

export function Linescore({ game, insights }: { game: Game; insights: GameInsights | null }) {
  const c = useColors();
  const ls = insights?.linescore ?? (game.linescore ? { ...game.linescore, periods: game.linescore.home.map((_, i) => String(i + 1)) } : null);
  if (!ls || !ls.periods.length) return null;
  const live = game.status === "live";
  const cur = ls.periods.length - 1;
  const total = (side: Side) => (side === "home" ? game.homeScore : game.awayScore) ?? ls[side].reduce<number>((s, v) => s + (v ?? 0), 0);

  return (
    <Block title="By period" caption={live ? "Updates as the game goes" : null}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 8 }}>
        <View>
          <View style={styles.lsRow}>
            <View style={styles.lsTeam} />
            {ls.periods.map((p, i) => (
              <Text key={i} style={[styles.lsHead, { color: live && i === cur ? c.live : c.subtleForeground }]}>
                {p}
              </Text>
            ))}
            <Text style={[styles.lsHead, styles.lsTotal, { color: c.subtleForeground }]}>T</Text>
          </View>
          {SIDES.map((side) => {
            const t = teamOf(game, side);
            const leading = (total(side) ?? 0) > (total(side === "home" ? "away" : "home") ?? 0);
            return (
              <View key={side} style={[styles.lsRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }]}>
                <View style={styles.lsTeam}>
                  <TeamMark team={t} size={16} />
                  <Text style={[styles.lsAbbr, { color: c.foreground }]}>{t.abbreviation}</Text>
                </View>
                {ls[side].map((v, i) => (
                  <Text key={i} style={[styles.lsCell, { color: v === null ? c.subtleForeground : c.cardForeground }]}>
                    {v ?? "–"}
                  </Text>
                ))}
                <Text style={[styles.lsCell, styles.lsTotal, { color: leading ? c.foreground : c.mutedForeground, fontFamily: "Inter_800ExtraBold" }]}>
                  {total(side)}
                </Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </Block>
  );
}

export function SituationCard({ game }: { game: Game }) {
  const c = useColors();
  if (game.status !== "live") return null;
  const s = game.live;
  const football = (game.sport === "NFL" || game.sport === "NCAAF") && s?.downDistance;
  const baseball = game.sport === "MLB" && s && (s.outs !== null || s.balls !== null);
  const text = game.lastPlay ?? game.situation;
  if (!football && !baseball && !text) return null;

  return (
    <Animated.View entering={FadeIn} style={[styles.situation, { backgroundColor: c.alpha(c.live, 0.08), borderColor: c.alpha(c.live, 0.35) }]}>
      {football && s ? (
        <View style={styles.sitRow}>
          <MaterialCommunityIcons name="football" size={16} color={c.live} />
          <Text style={[styles.sitStrong, { color: c.foreground }]}>
            {s.possession ? `${teamOf(game, s.possession).abbreviation} ball · ` : ""}
            {s.downDistance}
          </Text>
          {s.redZone ? (
            <View style={[styles.tag, { backgroundColor: c.alpha(c.negative, 0.16) }]}>
              <Text style={[styles.tagText, { color: c.negative }]}>RED ZONE</Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {baseball && s ? (
        <View style={styles.sitRow}>
          <Diamond first={s.onFirst} second={s.onSecond} third={s.onThird} c={c} />
          <Text style={[styles.sitStrong, { color: c.foreground }]}>
            {s.balls ?? 0}-{s.strikes ?? 0} · {s.outs ?? 0} out{s.outs === 1 ? "" : "s"}
          </Text>
        </View>
      ) : null}
      {text ? (
        <Text style={[styles.sitText, { color: c.cardForeground }]} numberOfLines={3}>
          {text}
        </Text>
      ) : null}
    </Animated.View>
  );
}

function Diamond({ first, second, third, c }: { first: boolean; second: boolean; third: boolean; c: Colors }) {
  const base = (on: boolean, pos: object) => (
    <View style={[styles.base, pos, { backgroundColor: on ? c.warning : "transparent", borderColor: on ? c.warning : c.mutedForeground }]} />
  );
  return (
    <View style={styles.diamond} accessibilityLabel={`Runners: ${[first && "first", second && "second", third && "third"].filter(Boolean).join(", ") || "none"}`}>
      {base(second, { top: 0, left: 9 })}
      {base(third, { top: 9, left: 0 })}
      {base(first, { top: 9, left: 18 })}
    </View>
  );
}

export function WinProbability({ game, insights }: { game: Game; insights: GameInsights | null }) {
  const wp = insights?.winProbability;
  if (!wp || game.status !== "live") return null;
  return (
    <Block title="Win probability" caption="ESPN's live model, updated each play">
      <View style={{ paddingVertical: 10 }}>
        <SplitBar game={game} away={Math.max(0, 1 - wp.home - wp.tie)} home={wp.home} label="right now" />
      </View>
    </Block>
  );
}

export function ScoringTimeline({ game, insights }: { game: Game; insights: GameInsights | null }) {
  const c = useColors();
  const [all, setAll] = useState(false);
  const events = insights?.scoring ?? [];
  if (!events.length) return null;
  const shown = all ? events : events.slice(0, 6);
  const title = game.sport === "Soccer" ? "Key moments" : "Scoring";

  return (
    <Block
      title={title}
      caption={game.status === "live" ? "Newest first" : null}
      right={
        events.length > 6 ? (
          <ActionChip label={all ? "Show less" : `All ${events.length}`} chevron={!all} onPress={() => setAll((v) => !v)} />
        ) : null
      }
    >
      {shown.map((e, i) => {
        const t = e.side ? teamOf(game, e.side) : null;
        return (
          <Animated.View
            key={e.id}
            entering={FadeInDown.duration(260)}
            layout={LinearTransition.duration(200)}
            style={[styles.event, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }]}
          >
            <View style={[styles.eventBar, { backgroundColor: t ? t.color : c.border }]} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.eventMeta, { color: c.subtleForeground }]}>
                {[e.periodLabel, e.clock, t?.abbreviation, e.kind].filter(Boolean).join(" · ")}
              </Text>
              <Text style={[styles.eventText, { color: c.cardForeground }]} numberOfLines={3}>
                {e.text}
              </Text>
            </View>
            {e.homeScore !== null && e.awayScore !== null ? (
              <Text style={[styles.eventScore, { color: c.foreground }]}>
                <Text style={{ color: e.side === "away" ? c.foreground : c.mutedForeground }}>{e.awayScore}</Text>
                <Text style={{ color: c.subtleForeground }}>–</Text>
                <Text style={{ color: e.side === "home" ? c.foreground : c.mutedForeground }}>{e.homeScore}</Text>
              </Text>
            ) : null}
          </Animated.View>
        );
      })}
    </Block>
  );
}

// ── matchup ────────────────────────────────────────────────────────────────

export function Favoured({ game, insights }: { game: Game; insights: GameInsights | null }) {
  const c = useColors();
  if (game.status !== "upcoming") return null;
  const market = fairProbabilities(game.homeTeam.odds, game.awayTeam.odds);
  const model = insights?.predictor;
  return (
    <Block title="Who's favoured" caption={model ? "The odds you're offered, and an independent model" : "From the odds you're offered, margin removed"}>
      <View style={{ gap: 14, paddingVertical: 10 }}>
        <SplitBar game={game} away={market.away} home={market.home} label="Market" />
        {model ? <SplitBar game={game} away={model.away} home={model.home} label="ESPN model" /> : null}
        {model && Math.abs(model.home - market.home) >= 0.08 ? (
          <Text style={[styles.caption, { color: c.mutedForeground }]}>
            The model rates {model.home > market.home ? game.homeTeam.abbreviation : game.awayTeam.abbreviation} higher than the market by{" "}
            {formatPercent(Math.abs(model.home - market.home))}. Disagreement isn't a guarantee either way.
          </Text>
        ) : null}
      </View>
    </Block>
  );
}

function recentOf(game: Game, insights: GameInsights | null, side: Side): RecentGame[] {
  const list = insights?.recent[side] ?? [];
  if (list.length) return list;
  return (teamOf(game, side).form ?? []).map((r) => ({ date: null, opponent: "", opponentName: null, venue: null, result: r, score: null }));
}

export function formLine(results: Array<"W" | "L" | "D" | null>): string {
  const w = results.filter((r) => r === "W").length;
  const l = results.filter((r) => r === "L").length;
  const d = results.filter((r) => r === "D").length;
  return `${w}-${l}${d ? `-${d}` : ""}`;
}

export function RecentFormBlock({ game, insights }: { game: Game; insights: GameInsights | null }) {
  const c = useColors();
  const [open, setOpen] = useState<Side | null>(null);
  const data = { away: recentOf(game, insights, "away"), home: recentOf(game, insights, "home") };
  if (!data.away.length && !data.home.length) return null;

  return (
    <Block title="Recent form" caption="Last five, newest first. Tap a team for results.">
      {SIDES.map((side, idx) => {
        const t = teamOf(game, side);
        const list = data[side];
        const expanded = open === side && list.some((g) => g.opponent);
        return (
          <View key={side} style={idx > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border } : null}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              onPress={() => setOpen((o) => (o === side ? null : side))}
              style={styles.formRow}
            >
              <TeamMark team={t} />
              <Text style={[styles.rowStrong, { color: c.foreground, width: 52 }]}>{t.abbreviation}</Text>
              <FormStrip results={list.map((g) => g.result)} />
              <Text style={[styles.rowDim, { color: c.mutedForeground, marginLeft: "auto" }]}>{list.length ? formLine(list.map((g) => g.result)) : "—"}</Text>
              {list.some((g) => g.opponent) ? (
                <MaterialCommunityIcons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={c.subtleForeground} />
              ) : null}
            </Pressable>
            {expanded ? (
              <Animated.View entering={FadeIn.duration(180)} style={{ paddingBottom: 8, gap: 4 }}>
                {list.map((g, i) => (
                  <View key={i} style={styles.resultRow}>
                    <FormStrip results={[g.result]} size={16} />
                    <Text style={[styles.rowDim, { color: c.cardForeground, flex: 1 }]} numberOfLines={1}>
                      {g.venue === "away" ? "@" : "vs"} {g.opponentName ?? g.opponent}
                    </Text>
                    <Text style={[styles.rowNum, { color: c.foreground }]}>{g.score ?? ""}</Text>
                    <Text style={[styles.rowDim, { color: c.subtleForeground, width: 52, textAlign: "right" }]}>{shortDate(g.date)}</Text>
                  </View>
                ))}
              </Animated.View>
            ) : null}
          </View>
        );
      })}
    </Block>
  );
}

export function h2hTally(game: Game, games: H2HGame[]) {
  const home = games.filter((g) => g.winnerAbbr === game.homeTeam.abbreviation).length;
  const away = games.filter((g) => g.winnerAbbr === game.awayTeam.abbreviation).length;
  return { home, away, draws: games.length - home - away };
}

export function HeadToHeadBlock({ game, insights }: { game: Game; insights: GameInsights | null }) {
  const c = useColors();
  const h2h = insights?.headToHead;
  if (!h2h || (!h2h.games.length && !h2h.summary)) return null;
  const tally = h2hTally(game, h2h.games);
  return (
    <Block title="Head to head" caption={h2h.summary ?? (h2h.games.length ? `Last ${h2h.games.length} meetings` : null)}>
      {h2h.games.length ? (
        <View style={[styles.tally, { borderBottomColor: c.border }]}>
          <Tally team={game.awayTeam} wins={tally.away} c={c} />
          {tally.draws ? <Text style={[styles.rowDim, { color: c.mutedForeground }]}>{tally.draws} drawn</Text> : <Text style={[styles.rowDim, { color: c.subtleForeground }]}>wins</Text>}
          <Tally team={game.homeTeam} wins={tally.home} c={c} right />
        </View>
      ) : null}
      {h2h.games.map((g, i) => (
        <View key={i} style={styles.resultRow}>
          <Text style={[styles.rowDim, { color: c.subtleForeground, width: 56 }]}>{shortDate(g.date)}</Text>
          <Text style={[styles.rowDim, { color: g.winnerAbbr === g.awayAbbr ? c.foreground : c.mutedForeground, flex: 1, textAlign: "right" }]}>{g.awayAbbr}</Text>
          <Text style={[styles.rowNum, { color: c.foreground, minWidth: 64, textAlign: "center" }]}>
            {g.awayScore ?? "–"} – {g.homeScore ?? "–"}
          </Text>
          <Text style={[styles.rowDim, { color: g.winnerAbbr === g.homeAbbr ? c.foreground : c.mutedForeground, flex: 1 }]}>{g.homeAbbr}</Text>
        </View>
      ))}
    </Block>
  );
}

function Tally({ team, wins, c, right }: { team: TeamSide; wins: number; c: Colors; right?: boolean }) {
  return (
    <View style={[styles.tallySide, right && { flexDirection: "row-reverse" }]}>
      <TeamMark team={team} size={22} />
      <Text style={[styles.tallyNum, { color: c.foreground }]}>{wins}</Text>
    </View>
  );
}

export function KeyPlayersBlock({ game, insights }: { game: Game; insights: GameInsights | null }) {
  const c = useColors();
  const l = insights?.leaders;
  if (!l || (!l.home.length && !l.away.length)) return null;
  return (
    <Block title="Key players" caption={l.scope === "season" ? "Season leaders" : "Leading this game"}>
      {SIDES.map((side, idx) =>
        l[side].length ? (
          <View key={side} style={[{ paddingVertical: 8, gap: 8 }, idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border }]}>
            <View style={styles.sideHead}>
              <TeamMark team={teamOf(game, side)} size={16} />
              <Text style={[styles.sideHeadText, { color: c.mutedForeground }]}>{teamOf(game, side).name}</Text>
            </View>
            {l[side].map((p, i) => (
              <Leader key={i} p={p} color={teamOf(game, side).color} c={c} />
            ))}
          </View>
        ) : null
      )}
    </Block>
  );
}

function Leader({ p, color, c }: { p: PlayerLeader; color: string; c: Colors }) {
  const initials = p.athlete
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .replace(/[^A-Za-z]/g, "")
    .slice(0, 2)
    .toUpperCase();
  return (
    <View style={styles.leader}>
      {p.headshot ? (
        <Image source={{ uri: p.headshot }} style={[styles.headshot, { backgroundColor: c.secondary }]} contentFit="cover" transition={120} />
      ) : (
        <View style={[styles.headshot, { backgroundColor: c.alpha(color, 0.2), alignItems: "center", justifyContent: "center" }]}>
          <Text style={[styles.initials, { color: c.foreground }]}>{initials}</Text>
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowStrong, { color: c.foreground }]} numberOfLines={1}>
          {p.athlete}
          {p.position ? <Text style={{ color: c.subtleForeground }}> {p.position}</Text> : null}
        </Text>
        <Text style={[styles.caption, { color: c.subtleForeground }]} numberOfLines={1}>
          {p.category}
        </Text>
      </View>
      <Text style={[styles.rowNum, { color: c.foreground, maxWidth: "45%", textAlign: "right" }]} numberOfLines={2}>
        {p.value}
      </Text>
    </View>
  );
}

const NUMERIC = /^-?[\d,]*\.?\d+%?$/;
const asNum = (s: string) => (NUMERIC.test(s.trim()) ? Number(s.replace(/[,%]/g, "")) : null);

export function TeamStatsBlock({ game, insights, limit = 10 }: { game: Game; insights: GameInsights | null; limit?: number }) {
  const c = useColors();
  const base: Array<{ label: string; away: string; home: string }> = [];
  if (game.awayTeam.record || game.homeTeam.record) base.push({ label: "Record", away: game.awayTeam.record ?? "—", home: game.homeTeam.record ?? "—" });
  if (game.awayTeam.splitRecord || game.homeTeam.splitRecord)
    base.push({ label: "Home / road", away: game.awayTeam.splitRecord ?? "—", home: game.homeTeam.splitRecord ?? "—" });
  if (game.awayTeam.pointsFor != null && game.homeTeam.pointsFor != null)
    base.push({ label: "Scored / game", away: game.awayTeam.pointsFor.toFixed(1), home: game.homeTeam.pointsFor.toFixed(1) });
  if (game.awayTeam.pointsAgainst != null && game.homeTeam.pointsAgainst != null)
    base.push({ label: "Allowed / game", away: game.awayTeam.pointsAgainst.toFixed(1), home: game.homeTeam.pointsAgainst.toFixed(1) });
  const seen = new Set(base.map((r) => r.label.toLowerCase()));
  const rows = [...base, ...(insights?.teamStats ?? []).filter((r) => !seen.has(r.label.toLowerCase()))].slice(0, limit);
  if (!rows.length) return null;

  return (
    <Block title="Team stats" caption={game.status === "upcoming" ? "Season to date" : "Season record, then this game's numbers"}>
      <View style={[styles.statHead, { borderBottomColor: c.border }]}>
        <Text style={[styles.rowStrong, { color: c.foreground }]}>{game.awayTeam.abbreviation}</Text>
        <Text style={[styles.rowStrong, { color: c.foreground }]}>{game.homeTeam.abbreviation}</Text>
      </View>
      {rows.map((r) => {
        const a = asNum(r.away);
        const h = asNum(r.home);
        const bar = a !== null && h !== null && a + h > 0 && a >= 0 && h >= 0;
        return (
          <View key={r.label} style={styles.statRow}>
            <View style={styles.statLine}>
              <Text style={[styles.rowNum, { color: c.foreground, width: 72 }]} numberOfLines={1}>{r.away}</Text>
              <Text style={[styles.rowDim, { color: c.subtleForeground, flex: 1, textAlign: "center" }]} numberOfLines={1}>{r.label}</Text>
              <Text style={[styles.rowNum, { color: c.foreground, width: 72, textAlign: "right" }]} numberOfLines={1}>{r.home}</Text>
            </View>
            {bar ? (
              <View style={styles.statBars}>
                <View style={[styles.statTrack, { backgroundColor: c.secondary, alignItems: "flex-end" }]}>
                  <View style={{ width: `${(a! / (a! + h!)) * 100}%`, height: "100%", borderRadius: 2, backgroundColor: c.alpha(game.awayTeam.color, 0.85) }} />
                </View>
                <View style={[styles.statTrack, { backgroundColor: c.secondary }]}>
                  <View style={{ width: `${(h! / (a! + h!)) * 100}%`, height: "100%", borderRadius: 2, backgroundColor: c.alpha(game.homeTeam.color, 0.85) }} />
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
    </Block>
  );
}

export function injuryTone(c: Colors, status: string): string {
  const s = status.toLowerCase();
  if (s === "out" || s.includes("injured reserve") || s === "ir") return c.negative;
  if (s === "doubtful") return c.debt;
  if (s === "questionable" || s.includes("day")) return c.warning;
  return c.mutedForeground;
}

export function InjuriesBlock({ game, insights }: { game: Game; insights: GameInsights | null }) {
  const c = useColors();
  const inj = insights?.injuries;
  if (!inj || (!inj.home.length && !inj.away.length)) return null;
  return (
    <Block title="Injury report">
      {SIDES.map((side, idx) =>
        inj[side].length ? (
          <View key={side} style={[{ paddingVertical: 8, gap: 6 }, idx > 0 && inj.away.length ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border } : null]}>
            <View style={styles.sideHead}>
              <TeamMark team={teamOf(game, side)} size={16} />
              <Text style={[styles.sideHeadText, { color: c.mutedForeground }]}>{teamOf(game, side).abbreviation}</Text>
            </View>
            {inj[side].map((i: Injury, k) => {
              const tone = injuryTone(c, i.status);
              return (
                <View key={k} style={styles.injury}>
                  <Text style={[styles.rowStrong, { color: c.foreground, flex: 1 }]} numberOfLines={1}>
                    {i.athlete}
                    {i.position ? <Text style={{ color: c.subtleForeground }}> {i.position}</Text> : null}
                    {i.detail ? <Text style={[styles.rowDim, { color: c.mutedForeground }]}>  {i.detail}</Text> : null}
                  </Text>
                  <View style={[styles.tag, { backgroundColor: c.alpha(tone, 0.14) }]}>
                    <Text style={[styles.tagText, { color: tone }]}>{i.status.toUpperCase()}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null
      )}
    </Block>
  );
}

/**
 * The whole pre-bet picture, in the order it's useful: who the market and a
 * model favour, form, history, who matters, numbers, who's missing.
 */
export function MatchupInsights({
  game,
  insights,
  loading,
  error,
  onRetry,
}: {
  game: Game;
  insights: GameInsights | null;
  loading: boolean;
  error: string | null;
  onRetry?: () => void;
}) {
  const empty =
    !!insights &&
    !insights.recent.home.length &&
    !insights.recent.away.length &&
    !insights.headToHead.games.length &&
    !insights.leaders.home.length &&
    !insights.leaders.away.length &&
    !insights.teamStats.length &&
    !insights.injuries.home.length &&
    !insights.injuries.away.length;

  return (
    <View style={{ gap: 18 }}>
      <Favoured game={game} insights={insights} />
      <RecentFormBlock game={game} insights={insights} />
      {insights ? (
        <>
          <HeadToHeadBlock game={game} insights={insights} />
          <KeyPlayersBlock game={game} insights={insights} />
        </>
      ) : null}
      <TeamStatsBlock game={game} insights={insights} />
      {insights ? <InjuriesBlock game={game} insights={insights} /> : null}
      {!insights && loading ? <InsightsSkeleton /> : null}
      {!insights && error ? <Note icon="wifi-off" text={`Couldn't load the deeper stats. ${error}`} action={onRetry ? "Retry" : undefined} onAction={onRetry} /> : null}
      {empty ? <Note text="No player or head-to-head stats are published for this game yet." /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 8 },
  blockHead: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  blockTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  blockBody: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 4 },
  caption: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  link: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  formStrip: { flexDirection: "row", gap: 3 },
  formChip: { borderRadius: 5, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  formText: { fontFamily: "Inter_800ExtraBold" },

  splitHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  splitPct: { fontSize: 13, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  splitTrack: { flexDirection: "row", height: 10, borderRadius: 5, overflow: "hidden" },

  skel: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  skelBar: { height: 10, borderRadius: 5 },
  note: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, padding: 12 },
  noteText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 17 },

  lsRow: { flexDirection: "row", alignItems: "center", minHeight: 34 },
  lsTeam: { width: 66, flexDirection: "row", alignItems: "center", gap: 6 },
  lsAbbr: { fontSize: 13, fontFamily: "Inter_700Bold" },
  lsHead: { width: 32, textAlign: "center", fontSize: 11, fontFamily: "Inter_600SemiBold" },
  lsCell: { width: 32, textAlign: "center", fontSize: 14, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  lsTotal: { width: 40 },

  situation: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 8 },
  sitRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  sitStrong: { fontSize: 14, fontFamily: "Inter_700Bold", flexShrink: 1 },
  sitText: { fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 18 },
  tag: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  tagText: { fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.4 },
  diamond: { width: 28, height: 20 },
  base: { position: "absolute", width: 9, height: 9, borderWidth: 1.5, transform: [{ rotate: "45deg" }] },

  event: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10 },
  eventBar: { width: 3, alignSelf: "stretch", borderRadius: 2 },
  eventMeta: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 0.2 },
  eventText: { fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 18 },
  eventScore: { fontSize: 15, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"] },

  formRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10 },
  resultRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 5 },
  rowStrong: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  rowDim: { fontSize: 12, fontFamily: "Inter_500Medium" },
  rowNum: { fontSize: 13, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },

  tally: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, marginBottom: 4 },
  tallySide: { flexDirection: "row", alignItems: "center", gap: 8 },
  tallyNum: { fontSize: 20, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"] },

  sideHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  sideHeadText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.3 },
  leader: { flexDirection: "row", alignItems: "center", gap: 10 },
  headshot: { width: 34, height: 34, borderRadius: 17, overflow: "hidden" },
  initials: { fontSize: 11, fontFamily: "Inter_700Bold" },

  statHead: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  statRow: { paddingVertical: 7, gap: 5 },
  statLine: { flexDirection: "row", alignItems: "center" },
  statBars: { flexDirection: "row", gap: 4, height: 4 },
  statTrack: { flex: 1, height: 4, borderRadius: 2, overflow: "hidden" },

  injury: { flexDirection: "row", alignItems: "center", gap: 8 },
});
