import { useEffect, useMemo, useRef } from "react";
import { useApp } from "@/context/AppContext";
import { useLeague, useLeagueSummaries } from "@/context/LeagueContext";
import { useToast } from "@/context/ToastContext";
import { useGames } from "@/hooks/useGames";
import { useLatestActivity } from "@/hooks/useLatestActivity";
import { useNow } from "@/hooks/useNow";
import * as api from "@/lib/api";
import { onActivityPushToken, setWidgetSnapshot } from "@/modules/live-activity";
import type { Game } from "@/types/game";
import { SPORT_ICONS } from "@/constants/leagueTypes";
import { showSoonPill } from "@/lib/soonPill";
import { openKickoffSheet } from "@/lib/kickoffSheet";
import { useKickoffSoon } from "@/hooks/useKickoffSoon";

const MIN = 60_000;
const START_SOON_MS = 15 * MIN;
const KICKOFF_REBANNER_MS = 30 * MIN;

/**
 * Turns live data the app already listens to into banners:
 *
 *  - Live sweat: a quiet "starting soon" pill 15 minutes before a game you've bet on,
 *    "Your bet is heating up" when your side takes the lead, "Sweat alert"
 *    when it loses it.
 *  - League moves: when you climb past someone, or someone passes you.
 *  - Trophies: a popup for every new trophy or achievement on your shelf.
 *  - Live Activity push tokens → server; home-screen widget snapshot → App Group.
 *
 * Nothing fires for the state the app opens in, only for changes seen while
 * it's running, so a cold start never dumps a pile of stale banners.
 * Renders nothing.
 */
export default function EngagementWatchers() {
  useLiveSweat();
  useBetBeforeKickoff();
  useLeagueMoves();
  useTrophyAlerts();
  // useBigBets removed: a "going big" banner is keyed on someone else's stake size (guardrail 3).
  useLiveActivityTokens();
  useWidgetSnapshot();
  return null;
}

function useLiveSweat() {
  const { bets } = useApp();
  const { games } = useGames(["upcoming", "live"]);
  const { show } = useToast();
  const now = useNow(30_000);
  const lastLead = useRef(new Map<string, "lead" | "trail" | "tie">());

  const open = useMemo(() => bets.filter((b) => b.status === "pending"), [bets]);
  const byId = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);

  useEffect(() => {
    for (const bet of open) {
      const g = byId.get(bet.gameId);
      if (!g) continue;
      if (g.status === "upcoming") {
        const until = g.startsAt - now;
        if (until > 0 && until <= START_SOON_MS) {
          // Quiet pill, once per game: no toast, no haptic.
          showSoonPill({
            id: g.id,
            icon: g.sportIcon || SPORT_ICONS[g.sport] || "clock-outline",
            league: g.sport,
            away: g.awayTeam.abbreviation,
            home: g.homeTeam.abbreviation,
            minutes: Math.max(1, Math.round(until / MIN)),
          });
        }
        continue;
      }
      if (g.status !== "live" || g.homeScore === null || g.awayScore === null) continue;
      const mine = bet.side === "home" ? g.homeScore : g.awayScore;
      const theirs = bet.side === "home" ? g.awayScore : g.homeScore;
      const state = mine > theirs ? "lead" : mine < theirs ? "trail" : "tie";
      const before = lastLead.current.get(bet.id);
      lastLead.current.set(bet.id, state);
      if (!before || before === state) continue;
      const score = `${bet.teamAbbr} ${mine}–${theirs} ${bet.opponentAbbr}${clockOf(g)}`;
      if (state === "lead") {
        show({
          id: `heat_${bet.id}_${mine}_${theirs}`,
          kind: "live",
          icon: "fire",
          title: "Your bet is heating up!",
          body: `${score}. ${bet.potentialPayout.toLocaleString()} on the line.`,
          href: { pathname: "/game/[id]", params: { id: g.id } },
          cta: "Sweat it",
        });
      } else if (before === "lead") {
        show({
          id: `sweat_${bet.id}_${mine}_${theirs}`,
          kind: "warning",
          icon: "heart-pulse",
          title: state === "tie" ? "All square" : "Sweat alert",
          body: `${score}. Still time.`,
          href: { pathname: "/game/[id]", params: { id: g.id } },
          cta: "Watch",
        });
      }
    }
  }, [open, byId, now, show]);
}

/**
 * One banner for every unbet game starting within the hour. New games joining
 * the window don't re-banner for 30 min; tapping opens the full list.
 */
function useBetBeforeKickoff() {
  const { games } = useKickoffSoon();
  const { show } = useToast();
  const seen = useRef(new Set<string>());
  const lastShown = useRef(0);

  useEffect(() => {
    const fresh = games.filter((g) => !seen.current.has(g.id));
    if (!fresh.length) return;
    if (Date.now() - lastShown.current < KICKOFF_REBANNER_MS) {
      fresh.forEach((g) => seen.current.add(g.id));
      return;
    }
    const first = games[0]!;
    const mins = Math.max(1, Math.round((first.startsAt - Date.now()) / MIN));
    const single = games.length === 1;
    const shown = show({
      id: `kickoff_${Date.now()}`,
      kind: "live",
      icon: "clock-alert-outline",
      title: single ? `${first.awayTeam.abbreviation} @ ${first.homeTeam.abbreviation} starts in ${mins} min` : `${games.length} games start within the hour`,
      body: single ? "Get your bet in before it locks." : `First one in ${mins} min. Tap to see them all.`,
      onPress: openKickoffSheet,
      cta: single ? "Bet now" : "See games",
      durationMs: 8000,
    });
    // Dropped by the 5-min gap: leave them unseen so the banner retries next tick.
    if (!shown) return;
    lastShown.current = Date.now();
    fresh.forEach((g) => seen.current.add(g.id));
  }, [games, show]);
}

/** A popup whenever a new trophy lands on the shelf (league finishes, achievements, punishments). */
function useTrophyAlerts() {
  const { trophies, ready } = useApp();
  const { show } = useToast();
  const known = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!ready) return;
    // The first list is what the player already had: no popups for those.
    if (!known.current) {
      known.current = new Set(trophies.map((t) => t.id));
      return;
    }
    for (const t of trophies) {
      if (known.current.has(t.id)) continue;
      known.current.add(t.id);
      const achievement = t.kind === "achievement";
      const punishment = t.kind === "last_place";
      show({
        id: `trophy_${t.id}`,
        kind: punishment ? "warning" : "league",
        icon: achievement ? "trophy-award" : punishment ? "emoticon-sad-outline" : "trophy",
        title: achievement ? "Achievement unlocked!" : punishment ? "Last-place trophy" : "New trophy!",
        body: t.leagueName ? `${t.title} · ${t.leagueName}` : t.title,
        href: "/trophies" as never,
        cta: "See it",
        durationMs: 7000,
      });
    }
  }, [trophies, ready, show]);
}

function clockOf(g: Game) {
  return g.clock ? ` · ${g.clock}` : g.situation ? ` · ${g.situation}` : "";
}

function useLeagueMoves() {
  const { summaries } = useLeagueSummaries();
  const { uid } = useLeague();
  const { show } = useToast();
  const prev = useRef(new Map<string, { rank: number; order: string[] }>());

  useEffect(() => {
    for (const s of summaries) {
      if (s.closed || !s.me || s.standings.length < 2) continue;
      const order = s.standings.map((x) => x.uid);
      const was = prev.current.get(s.league.id);
      prev.current.set(s.league.id, { rank: s.me.rank, order });
      if (!was || was.rank === s.me.rank) continue;
      const name = (id: string | undefined) => (id ? s.league.members?.[id]?.displayName ?? "Someone" : "Someone");
      const href = { pathname: "/league/[id]" as const, params: { id: s.league.id } };
      if (s.me.rank < was.rank) {
        // Whoever now sits right below you is who you just passed.
        const passed = order[s.me.rank];
        show({
          id: `up_${s.league.id}_${s.me.rank}_${Date.now() >> 16}`,
          kind: "league",
          icon: s.me.rank === 1 ? "crown" : "trending-up",
          title: s.me.rank === 1 ? `You're #1 in ${s.league.name}!` : `Up to #${s.me.rank} in ${s.league.name}`,
          body: `You just passed ${name(passed)}.`,
          href,
          cta: "Table",
        });
      } else {
        const passer = order[s.me.rank - 2];
        show({
          id: `down_${s.league.id}_${s.me.rank}_${Date.now() >> 16}`,
          kind: "warning",
          icon: "trending-down",
          title: `${name(passer)} passed you`,
          body: `You're #${s.me.rank} in ${s.league.name} now.`,
          href,
          cta: "Table",
        });
      }
    }
    // uid only scopes the names; the summaries already carry `me`.
  }, [summaries, show, uid]);
}



/** Each Live Activity's ActivityKit push token goes to the server for APNs updates. */
function useLiveActivityTokens() {
  const { bets } = useApp();
  const { myLeagueBets } = useLeague();
  const sides = useRef(new Map<string, "home" | "away">());
  useEffect(() => {
    for (const b of bets) if (b.side) sides.current.set(b.gameId, b.side);
    for (const list of Object.values(myLeagueBets)) for (const b of list) if (b.side) sides.current.set(b.gameId, b.side);
  }, [bets, myLeagueBets]);
  useEffect(() => {
    const sub = onActivityPushToken(({ gameId, token }) => {
      api.registerLiveActivity({ gameId, token, side: sides.current.get(gameId) ?? "home" }).catch(() => {});
    });
    return () => sub.remove();
  }, []);
}

/** Writes this week's H2H, streak and Daily Pick status for the home-screen widget. */
function useWidgetSnapshot() {
  const { profile } = useApp();
  const { summaries } = useLeagueSummaries();
  const streak = profile?.streak?.count ?? 0;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const picked = profile?.streak?.lastDay === today;
  const h2h = summaries.find((s) => s.league.mode === "matchups" && !s.closed);
  const me = h2h?.me;
  const key = `${streak}|${picked}|${h2h?.league.id ?? ""}|${me?.netWorth ?? 0}`;
  const last = useRef("");
  useEffect(() => {
    if (key === last.current) return;
    last.current = key;
    setWidgetSnapshot({
      h2hMe: me?.netWorth ?? 0,
      h2hThem: 0,
      opponent: h2h?.league.name ?? "—",
      streak,
      dailyPick: picked ? "picked" : "open",
      updatedAt: Date.now(),
    });
  }, [key, me?.netWorth, h2h?.league.name, streak, picked]);
}
