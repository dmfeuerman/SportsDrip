import { useEffect, useMemo, useRef } from "react";
import { useApp } from "@/context/AppContext";
import { useLeague, useLeagueSummaries } from "@/context/LeagueContext";
import { useToast } from "@/context/ToastContext";
import { useGames } from "@/hooks/useGames";
import { useLatestActivity } from "@/hooks/useLatestActivity";
import { useNow } from "@/hooks/useNow";
import type { Game } from "@/types/game";

const MIN = 60_000;
const START_SOON_MS = 15 * MIN;

/**
 * Turns live data the app already listens to into banners:
 *
 *  - Live sweat: "Game starting soon" 15 minutes before a game you've bet on,
 *    "Your bet is heating up" when your side takes the lead, "Sweat alert"
 *    when it loses it.
 *  - League moves: when you climb past someone, or someone passes you.
 *  - Big bets: when a league-mate puts a big stake down.
 *
 * Nothing fires for the state the app opens in, only for changes seen while
 * it's running, so a cold start never dumps a pile of stale banners.
 * Renders nothing.
 */
export default function EngagementWatchers() {
  useLiveSweat();
  useLeagueMoves();
  useBigBets();
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
          const m = Math.max(1, Math.round(until / MIN));
          show({
            id: `soon_${bet.id}`,
            kind: "live",
            icon: "clock-fast",
            title: "Game starting soon",
            body: `${bet.teamAbbr} vs ${bet.opponentAbbr} starts in ${m} min — ${bet.stake.toLocaleString()} riding on it.`,
            href: { pathname: "/game/[id]", params: { id: g.id } },
            cta: "Watch",
            color: bet.teamColor,
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

function useBigBets() {
  const { leagues, uid } = useLeague();
  const { show } = useToast();
  const active = useMemo(() => leagues.filter((l) => l.status === "active"), [leagues]);
  const latest = useLatestActivity(active.map((l) => l.id));
  const since = useRef(Date.now());

  useEffect(() => {
    for (const lg of active) {
      const a = latest[lg.id];
      if (!a || a.type !== "bet_placed" || a.uid === uid || a.at < since.current) continue;
      // "High stakes": a fifth of the starting stack, or 1,000 tokens, whichever is bigger.
      if (a.amount < Math.max(1000, lg.startingLeagueTokens * 0.2)) continue;
      show({
        id: `big_${lg.id}_${a.id}`,
        kind: "social",
        icon: "fire-circle",
        title: `${a.name} is going big`,
        body: `${a.text} in ${lg.name}.`,
        href: { pathname: "/league/[id]", params: { id: lg.id, tab: "feed" } },
        cta: "See",
      });
    }
  }, [latest, active, uid, show]);
}

