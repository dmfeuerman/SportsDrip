import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db, FieldValue, pairId, requireAuth, Timestamp } from "../lib/economy";
import { isFreeMove, loadoutOf } from "../lib/moves";
import { levelFromXp } from "../lib/progression";

/**
 * Player profiles: what a tapped league card or friend row opens.
 *
 * users/{uid} is already readable by any signed-in client, but bets are not —
 * the rules only let a client *list* its own. Rather than loosen that, the
 * server decides what the viewer may see:
 *
 *   self / friend  -> public profile + balance + global bet history + trophies
 *   league-mate    -> public profile + that league's bets (already visible to
 *                     members) + their league line + head-to-head rivalry record
 *   anyone else    -> public profile + trophies
 */

const SPORTS = ["NFL", "NBA", "MLB", "NHL", "NCAAF", "NCAAB", "Soccer"] as const;
export const MAX_FAVORITE_TEAMS = 5;

const FavoriteTeam = z.object({
  sport: z.enum(SPORTS),
  abbr: z.string().trim().toUpperCase().regex(/^[A-Z0-9&]{2,5}$/),
  name: z.string().trim().min(2).max(40),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

export const updateFavoriteTeams = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const parsed = z.array(FavoriteTeam).max(MAX_FAVORITE_TEAMS).safeParse(req.data?.teams);
  const reminders = typeof req.data?.reminders === "boolean" ? (req.data.reminders as boolean) : undefined;
  if (!parsed.success) throw new HttpsError("invalid-argument", `Pick up to ${MAX_FAVORITE_TEAMS} teams.`);

  const seen = new Set<string>();
  const teams = parsed.data.filter((t) => {
    const k = `${t.sport}:${t.abbr}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // favoriteTeamKeys ("NFL:KC") is the queryable mirror the team-reminder job uses.
  await db.collection("users").doc(uid).update({
    favoriteTeams: teams,
    favoriteTeamKeys: teams.map((t) => `${t.sport}:${t.abbr}`),
    ...(reminders !== undefined ? { teamReminders: reminders } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true, teams };
});

function ms(v: unknown): number | null {
  if (v instanceof Timestamp) return v.toMillis();
  if (typeof v === "number") return v;
  return null;
}

function betOf(d: FirebaseFirestore.QueryDocumentSnapshot) {
  const b = d.data();
  return {
    id: d.id,
    gameId: b.gameId as string,
    sport: (b.sport as string) ?? null,
    side: (b.side as "home" | "away" | null | undefined) ?? null,
    market: (b.market as "ml" | "spread" | "total" | undefined) ?? "ml",
    selection: (b.selection as "home" | "away" | "over" | "under" | undefined) ?? (b.side as "home" | "away") ?? "home",
    line: (b.line as number | null | undefined) ?? null,
    label: (b.label as string | undefined) ?? (b.teamAbbr as string),
    lock: Boolean(b.lock),
    teamName: b.teamName as string,
    teamAbbr: b.teamAbbr as string,
    teamColor: (b.teamColor as string) ?? "#5F6B80",
    opponentAbbr: b.opponentAbbr as string,
    stake: b.stake as number,
    odds: b.odds as number,
    potentialPayout: b.potentialPayout as number,
    status: b.status as string,
    placedAt: ms(b.placedAt),
    settledAt: ms(b.settledAt),
    finalHomeScore: (b.finalHomeScore as number | undefined) ?? null,
    finalAwayScore: (b.finalAwayScore as number | undefined) ?? null,
  };
}

export const getPlayerProfile = onCall({ region: "us-central1" }, async (req) => {
  const me = requireAuth(req.auth);
  const { uid, leagueId } = z
    .object({ uid: z.string().min(1).max(128), leagueId: z.string().min(1).max(128).optional() })
    .parse(req.data);

  const [user, friendship, league, trophiesSnap, ownedMovesSnap] = await Promise.all([
    db.collection("users").doc(uid).get(),
    uid === me ? Promise.resolve(null) : db.collection("friendships").doc(pairId(me, uid)).get(),
    leagueId ? db.collection("leagues").doc(leagueId).get() : Promise.resolve(null),
    db.collection("users").doc(uid).collection("trophies").limit(50).get(),
    db.collection("users").doc(uid).collection("moves").select().get(),
  ]);
  if (!user.exists) throw new HttpsError("not-found", "That player doesn't exist.");

  const self = uid === me;
  const friend = !!friendship?.exists;
  const memberIds = (league?.get("memberIds") as string[] | undefined) ?? [];
  const leagueMate = !!league?.exists && memberIds.includes(me) && memberIds.includes(uid);
  const relation = self ? "self" : friend ? "friend" : leagueMate ? "league" : "none";

  const [betsSnap, leagueBetsSnap, rivalrySnap] = await Promise.all([
    self || friend
      ? db.collection("bets").where("uid", "==", uid).orderBy("placedAt", "desc").limit(50).get()
      : Promise.resolve(null),
    leagueMate
      ? db
          .collection("leagues")
          .doc(leagueId!)
          .collection("leagueBets")
          .where("uid", "==", uid)
          .orderBy("placedAt", "desc")
          .limit(30)
          .get()
      : Promise.resolve(null),
    leagueMate && !self
      ? db.collection("leagues").doc(leagueId!).collection("rivalries").doc(pairId(me, uid)).get()
      : Promise.resolve(null),
  ]);

  const m = leagueMate ? (league!.get(`members.${uid}`) as Record<string, unknown> | undefined) : undefined;
  const now = Date.now();
  const visibleLeagueBets = leagueBetsSnap
    ? leagueBetsSnap.docs
        .filter((d) => {
          if (self) return true;
          if (d.get("hidden") !== true) return true;
          const startsAt = (d.get("startsAt") as number | undefined) ?? 0;
          return (startsAt > 0 && startsAt <= now) || d.get("status") !== "pending";
        })
        .map(betOf)
    : [];

  let rivalry: { myWins: number; theirWins: number; pushes: number } | null = null;
  if (rivalrySnap?.exists) {
    const aUid = rivalrySnap.get("aUid") as string;
    const aWins = (rivalrySnap.get("aWins") as number | undefined) ?? 0;
    const bWins = (rivalrySnap.get("bWins") as number | undefined) ?? 0;
    const pushes = (rivalrySnap.get("pushes") as number | undefined) ?? 0;
    rivalry = {
      myWins: me === aUid ? aWins : bWins,
      theirWins: me === aUid ? bWins : aWins,
      pushes,
    };
  }

  return {
    relation,
    profile: {
      uid,
      username: user.get("username") as string,
      displayName: user.get("displayName") as string,
      avatar: user.get("avatar") ?? null,
      equipped: user.get("equipped") ?? {},
      // Only moves they own (or the free ones) — never trust the stored loadout alone.
      moves: loadoutOf(
        loadoutOf(user.get("moves")).filter((id) => isFreeMove(id) || ownedMovesSnap.docs.some((d) => d.id === id))
      ),
      favoriteTeams: user.get("favoriteTeams") ?? [],
      level: levelFromXp(user.get("xp")),
      background: (user.get("background") as string | undefined) ?? null,
      stats: user.get("stats") ?? null,
      streak: user.get("streak") ?? null,
      punishment: user.get("punishment") ?? null,
      trophies: trophiesSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      memberSince: ms(user.get("createdAt")),
      balance: self || friend ? ((user.get("balance") as number | undefined) ?? null) : null,
    },
    bets: betsSnap ? betsSnap.docs.map(betOf) : null,
    league: leagueMate
      ? {
          leagueId: leagueId!,
          leagueName: league!.get("name") as string,
          leagueTokens: (m?.leagueTokens as number | undefined) ?? 0,
          betsWon: (m?.betsWon as number | undefined) ?? 0,
          betsLost: (m?.betsLost as number | undefined) ?? 0,
          betsPush: (m?.betsPush as number | undefined) ?? 0,
          locksWon: (m?.locksWon as number | undefined) ?? 0,
          locksLost: (m?.locksLost as number | undefined) ?? 0,
          joinedAt: (m?.joinedAt as number | undefined) ?? null,
          bets: visibleLeagueBets,
          rivalry,
        }
      : null,
  };
});

/** Player-set play limits: a daily pick cap and/or a break of 1, 7 or 30 days. */
export const setPlayLimits = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = z
    .object({
      dailyPicks: z.number().int().min(1).max(100).nullable().optional(),
      breakDays: z.union([z.literal(1), z.literal(7), z.literal(30)]).optional(),
    })
    .parse(req.data ?? {});
  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (input.dailyPicks !== undefined) update["limits.dailyPicks"] = input.dailyPicks;
  if (input.breakDays) update["limits.breakUntil"] = Date.now() + input.breakDays * 86_400_000;
  await db.collection("users").doc(uid).update(update);
  return { ok: true };
});

/** Opt in/out of live "sweat" lead-change pushes. */
export const setAlertPrefs = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const { sweat } = z.object({ sweat: z.boolean() }).parse(req.data);
  await db.collection("users").doc(uid).update({ sweatAlerts: sweat, updatedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});
