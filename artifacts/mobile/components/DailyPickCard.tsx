import { MaterialCommunityIcons } from "@expo/vector-icons";
import { trackEvent } from "@/lib/analytics";
import { collection, doc, getDocs, onSnapshot, query, where } from "firebase/firestore";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import StreakMilestoneCard from "@/components/StreakMilestoneCard";
import { ActionChip, Button, Card, ChoiceDialog, Pill } from "@/components/ui";
import { useLeague } from "@/context/LeagueContext";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import { useNow } from "@/hooks/useNow";
import * as api from "@/lib/api";
import { DEMO } from "@/lib/demo";
import { getDb } from "@/lib/firebase";
import { haptic } from "@/lib/motion";
import { formatOdds, untilKickoff } from "@/lib/odds";
import { hasSpreadLine, hasTotalLine, quoteMarket, type Market, type Selection } from "@/lib/markets";
import { router } from "expo-router";
import KeyboardSheet from "@/components/KeyboardSheet";
import { useGames } from "@/hooks/useGames";
import { useOddsFormat } from "@/lib/settings";
import { SPORT_ICONS } from "@/constants/leagueTypes";
import type { Game } from "@/types/game";
import { weekDays, weekGrid, weekRecord, type DailyResult } from "@/lib/streakGrid";

interface Team {
  abbreviation: string;
  name?: string;
  color?: string;
}
interface Featured {
  day: string;
  gameId: string;
  sport: string | null;
  startsAt: number;
  homeTeam: Team | null;
  awayTeam: Team | null;
}
interface MyPick {
  side: "home" | "away";
  teamAbbr: string | null;
  result: "won" | "lost" | "push" | null;
}

/** Today's date in America/New_York, matching the server's nyDay. */
function nyDay(ms = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/** Games the free bet can go on: upcoming, a few minutes out, soonest first. */
function bettable(games: Game[], now: number): Game[] {
  return games
    .filter((g) => g.status === "upcoming" && g.startsAt > now + 2 * 60_000 && !g.disrupted)
    .sort((a, b) => a.startsAt - b.startsAt);
}

type Choice = { market: Market; selection: Selection };
const sideOf = (ch: Choice): "home" | "away" => (ch.market === "total" ? (ch.selection === "over" ? "home" : "away") : (ch.selection as "home" | "away"));
const winningsAt = (odds: number) => Math.max(1, Math.round(100 * odds) - 100);
const same = (a: Choice | null, b: Choice | null) => !!a && !!b && a.market === b.market && a.selection === b.selection;

/**
 * Daily Free Bet: every day you open the app there's a free 100-credit bet
 * waiting. Today's featured game is the suggestion, but it can go on any
 * upcoming game and any market. Nothing is staked; a win pays the winnings in
 * real credits. Once locked in, the teams stay on the card: picking the
 * other one offers a switch until kickoff. Tapping the card (not a team)
 * opens the details, with moneyline / spread / total to choose from.
 * It also keeps the daily streak alive and pays XP (the old Daily Pick).
 */
export default function DailyPickCard() {
  const c = useColors();
  const now = useNow(30_000);
  const fmt = useOddsFormat();
  const { profile, bets, placeFreeBet, switchFreeBet } = useApp();
  const { show } = useToast();
  const { games } = useGames(["upcoming", "live"]);
  const uid = profile?.uid ?? null;
  const day = nyDay(now);
  const [featured, setFeatured] = useState<Featured | null>(null);
  const [token, setToken] = useState<{ betId: string } | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [details, setDetails] = useState(false);
  const [milestone, setMilestone] = useState<number | null>(null);
  const [weekText, setWeekText] = useState<string | null>(null);
  const [mine, setMine] = useState<MyPick | null>(null);
  const { activeLeagues, sendMessage } = useLeague();

  useEffect(() => {
    if (DEMO || !uid) return;
    const db = getDb();
    if (!db) return;
    const a = onSnapshot(doc(db, "dailyPick", day), (s) => setFeatured(s.exists() ? (s.data() as Featured) : null), () => {});
    const b = onSnapshot(doc(db, "users", uid, "dailyPicks", day), (s) => setMine(s.exists() ? (s.data() as MyPick) : null), () => {});
    const t = onSnapshot(doc(db, "users", uid, "freeBets", day), (s) => setToken(s.exists() ? (s.data() as { betId: string }) : null), () => {});
    return () => {
      a();
      b();
      t();
    };
  }, [uid, day]);

  // Today's free bet, once placed (the app's copy shows at once; the server's replaces it).
  const placed = useMemo(
    () => bets.find((b) => b.freeBet && b.freeDay === day && b.status !== "cancelled") ?? (token ? bets.find((b) => b.id === token.betId && b.status !== "cancelled") : undefined),
    [bets, day, token]
  );
  const used = !!placed || !!token;
  const placedChoice: Choice | null = placed ? { market: placed.market ?? "ml", selection: placed.selection ?? placed.side } : null;

  const options = useMemo(() => bettable(games, now), [games, now]);
  const byId = (id: string | null | undefined) => (id ? games.find((g) => g.id === id) : undefined);
  // The game on the card: the one you tapped, else today's bet's game, else the featured game while it's open, else the next one up.
  const game = useMemo(
    () => (gameId ? byId(gameId) : undefined) ?? (placed ? byId(placed.gameId) : undefined) ?? options.find((g) => g.id === featured?.gameId) ?? options[0] ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [games, gameId, placed?.gameId, options, featured?.gameId]
  );
  const open = !!game && game.status === "upcoming" && game.startsAt > now + 60_000;
  const onPlacedGame = !!placed && game?.id === placed.gameId;
  // What's highlighted: your new choice, else the bet you have, else the top-right option (home moneyline).
  const current: Choice | null = choice ?? (onPlacedGame ? placedChoice : open ? { market: "ml", selection: "home" } : null);
  const changed = !!placed && !(onPlacedGame && same(current, placedChoice));
  const canSwitch = !!placed && placed.status === "pending" && !!placed.startsAt && placed.startsAt > now && open;

  const streak = profile?.streak;
  const alive = !!streak?.count;

  const lockIn = async () => {
    if (!game || !current || !open) return;
    const q = quoteMarket(game, current.market, current.selection);
    if (!q.odds) {
      show({ kind: "warning", title: "No price on that yet", body: "Pick another option or game for your free bet." });
      return;
    }
    const sd = sideOf(current);
    const t = sd === "home" ? game.homeTeam : game.awayTeam;
    const o = sd === "home" ? game.awayTeam : game.homeTeam;
    const args = {
      gameId: game.id,
      side: sd,
      market: current.market,
      selection: current.selection,
      day,
      preview: {
        gameId: game.id,
        sport: game.sport,
        side: sd,
        market: current.market,
        selection: current.selection,
        line: q.line ?? null,
        label: q.label || t.abbreviation,
        startsAt: game.startsAt,
        voidReason: null,
        teamName: q.teamName || t.name,
        teamAbbr: q.teamAbbr || t.abbreviation,
        teamColor: q.teamColor || t.color,
        opponentAbbr: q.opponentAbbr || o.abbreviation,
        odds: q.odds,
        potentialPayout: winningsAt(q.odds),
        opponentUid: null,
      },
    };
    const ok = placed ? await switchFreeBet(placed.id, args) : await placeFreeBet(args);
    if (!ok) return;
    haptic.success();
    trackEvent("daily_pick_made", { side: sd });
    setChoice(null);
    setGameId(null);
    setDetails(false);
  };

  const shareWeek = async () => {
    const db = getDb();
    if (!db || !uid) return;
    haptic.tick();
    const days = weekDays(now);
    try {
      const snap = await getDocs(query(collection(db, "users", uid, "dailyPicks"), where("day", ">=", days[0]!), where("day", "<=", days[6]!)));
      const results: Record<string, DailyResult> = {};
      snap.forEach((d) => {
        results[d.id] = (d.get("result") as DailyResult) ?? null;
      });
      const rec = weekRecord(results, now);
      const text = `Daily Pick this week ${rec.w}-${rec.l}\n${weekGrid(results, now)}`;
      if (activeLeagues.length === 1) {
        void sendMessage(activeLeagues[0]!.id, text);
        show({ kind: "league", title: "Posted to the League", body: weekGrid(results, now) });
      } else setWeekText(text);
    } catch (e) {
      show({ kind: "warning", title: "Couldn't load your week", body: api.friendlyError(e) });
    }
  };

  const repair = streak?.repairPending && streak.repairPending.day === day && streak.repairPending.done < streak.repairPending.needed ? streak.repairPending : null;

  const status = placed
    ? placed.status === "won"
      ? { label: `Won +${placed.potentialPayout.toLocaleString()}`, tone: "positive" as const }
      : placed.status === "lost"
        ? { label: "Missed", tone: "negative" as const }
        : placed.status === "push"
          ? { label: "Push", tone: "neutral" as const }
          : { label: placed.startsAt && placed.startsAt <= now ? "Riding" : "Locked In", tone: "accent" as const }
    : { label: "Ready", tone: "accent" as const };

  // Popup: swipe (or the arrows) moves between today's games without closing it.
  const pageable = options.slice(0, 12);
  const gameIndex = game ? pageable.findIndex((g) => g.id === game.id) : -1;
  const step = (dir: 1 | -1) => {
    if (!pageable.length) return;
    const next = pageable[(Math.max(0, gameIndex) + dir + pageable.length) % pageable.length]!;
    haptic.tick();
    setGameId(next.id);
    setChoice(null);
  };
  const touch = useRef<{ x: number; y: number } | null>(null);
  const swipe = {
    onTouchStart: (e: GestureResponderEvent) => {
      touch.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
    },
    onTouchEnd: (e: GestureResponderEvent) => {
      const t = touch.current;
      touch.current = null;
      if (!t) return;
      const dx = e.nativeEvent.pageX - t.x;
      const dy = e.nativeEvent.pageY - t.y;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
    },
  };

  const pick = (ch: Choice) => {
    haptic.tick();
    setChoice(ch);
  };
  const quote = game && current ? quoteMarket(game, current.market, current.selection) : null;
  const sportIcon = (game ? SPORT_ICONS[game.sport] : placed ? SPORT_ICONS[placed.sport as keyof typeof SPORT_ICONS] : null) ?? "gift-outline";
  const actionLabel = !placed
    ? current && game
      ? `Lock In Bet · ${quote?.label ?? ""}`
      : "Lock In Bet"
    : `Switch to ${quote?.label ?? "this pick"}`;
  const showAction = open && (!placed ? true : changed && canSwitch);

  /** Two team buttons (moneyline) — always on the card, even once locked in. */
  const teamButtons = game ? (
    <View style={styles.row}>
      {(["away", "home"] as const).map((sd) => {
        const t = sd === "home" ? game.homeTeam : game.awayTeam;
        const q = quoteMarket(game, "ml", sd);
        const ch: Choice = { market: "ml", selection: sd };
        const on = same(current, ch);
        const isBet = onPlacedGame && same(placedChoice, ch);
        const tint = t.color || c.primary;
        return (
          <Pressable
            key={sd}
            accessibilityRole="button"
            accessibilityState={{ selected: on, disabled: !open }}
            accessibilityLabel={`${t.name ?? t.abbreviation}${q.odds ? `, wins ${winningsAt(q.odds)}` : ""}${isBet ? ", your free bet" : ""}`}
            disabled={!open}
            onPress={() => pick(ch)}
            style={({ pressed }) => [
              styles.team,
              { borderColor: on ? tint : c.border, backgroundColor: on ? c.alpha(tint, 0.18) : c.secondary, opacity: !open && !isBet ? 0.5 : pressed ? 0.85 : 1 },
            ]}
          >
            <View style={styles.teamTop}>
              <Text style={[styles.abbr, { color: c.foreground }]}>{t.abbreviation}</Text>
              {isBet ? <MaterialCommunityIcons name="lock" size={14} color={tint} /> : null}
            </View>
            <Text style={[styles.sub, { color: c.mutedForeground }]} numberOfLines={1}>
              {q.odds ? `${formatOdds(q.odds, fmt)} · +${winningsAt(q.odds)}` : sd === "home" ? "Home" : "Away"}
            </Text>
          </Pressable>
        );
      })}
    </View>
  ) : null;

  // Nothing to bet on at all (no games on the board) and nothing placed: keep the card small.
  if (!used && !game) {
    return (
      <Card style={{ gap: 6 }} accessibilityLabel="Daily free bet">
        <View style={styles.head}>
          <MaterialCommunityIcons name="gift-outline" size={20} color={c.primary} />
          <Text style={[styles.title, { color: c.foreground }]}>Daily Free Bet</Text>
          <Pill label="100 free" tone="accent" />
        </View>
        <Text style={[styles.sub, { color: c.mutedForeground }]}>Your free 100-credit bet is ready. No games are open right now — check back when the next slate is up.</Text>
      </Card>
    );
  }

  return (
    <Card style={{ gap: 10 }} accessibilityLabel="Daily free bet">
      {/* Anywhere on the card that isn't a button opens the details. */}
      <Pressable accessibilityRole="button" accessibilityLabel="Free bet details" onPress={() => setDetails(true)} style={{ gap: 10 }}>
        <View style={styles.head}>
          <MaterialCommunityIcons name={sportIcon as never} size={20} color={c.primary} />
          <Text style={[styles.title, { color: c.foreground }]}>Daily Free Bet</Text>
          <Text style={[styles.sub, { color: c.mutedForeground, flex: 1 }]} numberOfLines={1}>
            {game ? `${game.sport} · ${open ? untilKickoff(game.startsAt, now) : game.status === "live" ? "live" : "locked"}` : "100 credits, on us"}
          </Text>
          <Pill label={status.label} tone={status.tone} />
        </View>
        {placed ? (
          <Text style={[styles.sub, { color: c.foreground }]} numberOfLines={1}>
            <MaterialCommunityIcons name="lock" size={12} color={c.primary} /> {placed.label} vs {placed.opponentAbbr} · {formatOdds(placed.odds, fmt)} ·{" "}
            {placed.status === "won" ? `paid +${placed.potentialPayout.toLocaleString()}` : placed.status === "pending" ? `win +${placed.potentialPayout.toLocaleString()}` : "it was free"}
          </Text>
        ) : (
          <Text style={[styles.sub, { color: c.mutedForeground }]} numberOfLines={1}>
            {featured?.gameId === game?.id ? "Today's featured game · " : ""}Free 100 credits · tap the card for spread & totals
          </Text>
        )}
      </Pressable>

      {teamButtons}
      {placed && !onPlacedGame && game ? (
        <Text style={[styles.sub, { color: c.mutedForeground }]}>Your free bet is on another game. Lock in here to move it.</Text>
      ) : null}

      {showAction ? <Button label={actionLabel} icon={placed ? "swap-horizontal" : "lock"} disabled={!current} onPress={lockIn} /> : null}

      {open && options.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {options.slice(0, 12).map((g) => {
            const on = g.id === game?.id;
            return (
              <Pressable
                key={g.id}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`Use it on ${g.awayTeam.abbreviation} at ${g.homeTeam.abbreviation}`}
                onPress={() => {
                  haptic.tick();
                  setGameId(g.id);
                  setChoice(null);
                }}
                style={[styles.chip, { borderColor: on ? c.primary : c.border, backgroundColor: on ? c.alpha(c.primary, 0.14) : c.secondary }]}
              >
                <MaterialCommunityIcons name={(SPORT_ICONS[g.sport] ?? "trophy") as never} size={12} color={c.mutedForeground} />
                <Text style={[styles.chipText, { color: c.foreground }]}>
                  {g.awayTeam.abbreviation} @ {g.homeTeam.abbreviation}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <View style={styles.streakRow}>
        <Text style={[styles.sub, { color: c.mutedForeground, flex: 1 }]}>
          {alive
            ? `🔥 ${streak!.count}-day streak${streak!.freezes ? " · 🧊 freeze banked" : ""}${used ? "" : " — bet to keep it"}`
            : streak?.longest
              ? `Best streak ${streak.longest} days. Start a new one today.`
              : "Use your free bet daily to build a streak. Every 7 days banks a freeze."}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Bet types" hitSlop={8} onPress={() => setDetails(true)}>
          <Text style={[styles.betTypes, { color: c.primary }]}>Bet Types</Text>
        </Pressable>
      </View>
      {repair ? (
        <Text style={[styles.sub, { color: c.mutedForeground }]}>
          {`One more pick today restores your ${repair.from}-day streak.`}
        </Text>
      ) : null}
      {mine?.result && activeLeagues.length > 0 ? (
        <ActionChip label="Share My Week" icon="grid" chevron={false} tone="league" accessibilityLabel="Share this week's Daily Pick grid to league chat" onPress={shareWeek} />
      ) : null}

      {/* Details: the bet (or the pick so far) and every market to put it on. */}
      <KeyboardSheet visible={details} onClose={() => setDetails(false)} maxHeight="80%">
        <View style={styles.sheet} {...swipe}>
          {open && options.length > 1 ? (
            <View style={styles.pager}>
              <Pressable accessibilityRole="button" accessibilityLabel="Previous game" hitSlop={8} onPress={() => step(-1)}>
                <MaterialCommunityIcons name="chevron-left" size={22} color={c.mutedForeground} />
              </Pressable>
              <Text style={[styles.sub, { color: c.mutedForeground, flex: 1, textAlign: "center" }]}>
                Game {Math.max(1, gameIndex + 1)} of {Math.min(options.length, 12)} · swipe for more
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Next game" hitSlop={8} onPress={() => step(1)}>
                <MaterialCommunityIcons name="chevron-right" size={22} color={c.mutedForeground} />
              </Pressable>
            </View>
          ) : null}
          <View style={styles.head}>
            <MaterialCommunityIcons name={sportIcon as never} size={20} color={c.primary} />
            <Text style={[styles.title, { color: c.foreground, flex: 1 }]}>
              {game ? `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}` : "Daily Free Bet"}
            </Text>
            <Pill label={status.label} tone={status.tone} />
          </View>
          {placed ? (
            <View style={[styles.placed, { borderColor: placed.teamColor || c.primary, backgroundColor: c.alpha(placed.teamColor || c.primary, 0.12) }]}>
              <MaterialCommunityIcons name="lock" size={18} color={placed.teamColor || c.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.placedTitle, { color: c.foreground }]} numberOfLines={1}>
                  {placed.label} vs {placed.opponentAbbr}
                </Text>
                <Text style={[styles.sub, { color: c.mutedForeground }]}>
                  Free 100 · {formatOdds(placed.odds, fmt)} · win +{placed.potentialPayout.toLocaleString()} credits
                  {placed.startsAt && placed.startsAt > now ? ` · ${untilKickoff(placed.startsAt, now)}` : ""}
                </Text>
              </View>
            </View>
          ) : null}
          {game && open ? (
            <>
              {(
                [
                  ["MONEYLINE · WHO WINS", "ml", ["away", "home"]],
                  ...(hasSpreadLine(game) && typeof game.line?.spreadHome === "number" ? [["SPREAD · WIN OR LOSE BY", "spread", ["away", "home"]]] : []),
                  ...(hasTotalLine(game) && typeof game.line?.overUnder === "number" ? [["TOTAL POINTS · OVER / UNDER", "total", ["over", "under"]]] : []),
                ] as [string, Market, Selection[]][]
              ).map(([title, market, sels]) => (
                <View key={market} style={{ gap: 6 }}>
                  <Text style={[styles.group, { color: c.subtleForeground }]}>{title}</Text>
                  <View style={styles.row}>
                    {sels.map((sel) => {
                      const ch: Choice = { market, selection: sel };
                      const q = quoteMarket(game, market, sel);
                      const on = same(current, ch);
                      const isBet = onPlacedGame && same(placedChoice, ch);
                      return (
                        <Pressable
                          key={sel}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          onPress={() => pick(ch)}
                          style={[styles.option, { borderColor: on ? c.primary : c.border, backgroundColor: on ? c.alpha(c.primary, 0.16) : c.secondary }]}
                        >
                          <Text style={[styles.optionLabel, { color: c.foreground }]} numberOfLines={1}>
                            {q.label} {isBet ? "🔒" : ""}
                          </Text>
                          <Text style={[styles.sub, { color: c.mutedForeground }]}>{q.odds ? `${formatOdds(q.odds, fmt)} · +${winningsAt(q.odds)}` : "no price"}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
              {!placed || (changed && canSwitch) ? (
                <Button label={actionLabel} icon={placed ? "swap-horizontal" : "lock"} disabled={!current} onPress={lockIn} />
              ) : (
                <Text style={[styles.sub, { color: c.mutedForeground }]}>Pick something else above to switch your free bet before kickoff.</Text>
              )}
            </>
          ) : (
            <Text style={[styles.sub, { color: c.mutedForeground }]}>{placed ? "This game has started — your free bet is locked." : "No open game to bet on right now."}</Text>
          )}
          <Button
            label="See All Bets"
            icon="ticket-outline"
            variant="secondary"
            onPress={() => {
              setDetails(false);
              router.push("/bets");
            }}
          />
        </View>
      </KeyboardSheet>

      <StreakMilestoneCard days={milestone} name={profile?.displayName} onClose={() => setMilestone(null)} />
      <ChoiceDialog
        visible={!!weekText}
        title="Share Your Week"
        body="Post your Daily Pick grid to a league chat."
        actions={activeLeagues.map((l) => ({
          label: l.name,
          onPress: () => {
            if (weekText) void sendMessage(l.id, weekText);
            setWeekText(null);
          },
        }))}
        onCancel={() => setWeekText(null)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  sub: { fontSize: 12, fontFamily: "Inter_500Medium" },
  row: { flexDirection: "row", gap: 10 },
  team: { flex: 1, borderWidth: 1.5, borderRadius: 14, paddingVertical: 12, alignItems: "center", gap: 2 },
  abbr: { fontSize: 20, fontFamily: "Inter_900Black", letterSpacing: -0.5 },
  placed: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1.5, borderRadius: 14, padding: 12 },
  placedTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  chips: { gap: 8, paddingRight: 4 },
  betTypes: { fontSize: 12, fontFamily: "Inter_700Bold" },
  pager: { flexDirection: "row", alignItems: "center", gap: 6 },
  streakRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  teamTop: { flexDirection: "row", alignItems: "center", gap: 4 },
  sheet: { gap: 12, padding: 16 },
  group: { fontSize: 10, letterSpacing: 1, fontFamily: "Inter_700Bold" },
  option: { flex: 1, borderWidth: 1.5, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 8, alignItems: "center", gap: 2 },
  optionLabel: { fontSize: 14, fontFamily: "Inter_800ExtraBold" },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { fontSize: 12, fontFamily: "Inter_700Bold" },
});
