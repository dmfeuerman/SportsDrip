import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "@/lib/api";
import type { PlayerProfile, ProfileBet } from "@/lib/api";
import { DEMO, demoBets, demoLeagueBets, demoLeagues, demoProfile, demoPublicProfiles, demoUid } from "@/lib/demo";

/**
 * One player's profile, stats and bets, from the getPlayerProfile callable.
 * Short session cache keyed by uid+league so flicking between cards in the
 * standings doesn't refetch; `reload` bypasses it.
 */
const cache = new Map<string, { at: number; data: PlayerProfile }>();
const TTL = 60_000;

/** Drop cached entries for a player, e.g. after they edit their own profile. */
export function invalidatePlayerProfile(uid: string) {
  for (const k of cache.keys()) if (k.startsWith(`${uid}|`)) cache.delete(k);
}

export function usePlayerProfile(uid: string | null, leagueId?: string | null) {
  const key = uid ? `${uid}|${leagueId ?? ""}` : "";
  const [data, setData] = useState<PlayerProfile | null>(() => (key ? cache.get(key)?.data ?? null : null));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(
    async (force = false) => {
      if (!uid) return;
      const hit = cache.get(key);
      if (!force && hit && Date.now() - hit.at < TTL) {
        setData(hit.data);
        return;
      }
      const mine = ++seq.current;
      setLoading(true);
      setError(null);
      try {
        const res = DEMO ? demoPlayerProfile(uid, leagueId ?? undefined) : await api.getPlayerProfile(leagueId ? { uid, leagueId } : { uid });
        cache.set(key, { at: Date.now(), data: res });
        if (mine === seq.current) setData(res);
      } catch (e) {
        if (mine === seq.current) setError(api.friendlyError(e));
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [uid, leagueId, key]
  );

  useEffect(() => {
    setData(key ? cache.get(key)?.data ?? null : null);
    void load();
  }, [key, load]);

  return { data, loading, error, reload: () => load(true) };
}

// ── demo ───────────────────────────────────────────────────────────────────

function demoPlayerProfile(uid: string, leagueId?: string): PlayerProfile {
  const p = uid === demoUid ? { ...demoPublicProfiles[uid]!, balance: demoProfile.balance } : demoPublicProfiles[uid];
  const league = leagueId ? demoLeagues.find((l) => l.id === leagueId) : undefined;
  const m = league?.members[uid];
  const lbet = (b: (typeof demoLeagueBets)[string][number]): ProfileBet => ({
    ...b,
    sport: b.sport,
    placedAt: b.placedAt,
    settledAt: null,
    finalHomeScore: b.finalHomeScore ?? null,
    finalAwayScore: b.finalAwayScore ?? null,
  });
  const bets: ProfileBet[] =
    uid === demoUid
      ? demoBets.map((b) => ({
          ...b,
          placedAt: b.placedAt ? b.placedAt.seconds * 1000 : null,
          settledAt: b.settledAt ? b.settledAt.seconds * 1000 : null,
          finalHomeScore: b.finalHomeScore ?? null,
          finalAwayScore: b.finalAwayScore ?? null,
        }))
      : Object.values(demoLeagueBets).flat().filter((b) => b.uid === uid).map(lbet);
  return {
    relation: uid === demoUid ? "self" : "friend",
    profile: {
      uid,
      username: p?.username ?? uid,
      displayName: p?.displayName ?? "Player",
      avatar: p?.avatar ?? null,
      equipped: p?.equipped ?? {},
      favoriteTeams: p?.favoriteTeams ?? [],
      stats: p?.stats ?? null,
      memberSince: Date.now() - 90 * 86_400_000,
      balance: p?.balance ?? null,
    },
    bets,
    league:
      league && m
        ? {
            leagueId: league.id,
            leagueName: league.name,
            leagueTokens: m.leagueTokens,
            betsWon: m.betsWon,
            betsLost: m.betsLost,
            betsPush: m.betsPush ?? 0,
            joinedAt: m.joinedAt,
            bets: (demoLeagueBets[league.id] ?? []).filter((b) => b.uid === uid).map(lbet),
          }
        : null,
  };
}
