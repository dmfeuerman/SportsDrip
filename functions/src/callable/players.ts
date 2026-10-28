import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { db, FieldValue, pairId, requireAuth, Timestamp } from "../lib/economy";

/**
 * Player profiles: what a tapped league card or friend row opens.
 *
 * users/{uid} is already readable by any signed-in client, but bets are not —
 * the rules only let a client *list* its own. Rather than loosen that, the
 * server decides what the viewer may see:
 *
 *   self / friend  -> public profile + balance + global bet history
 *   league-mate    -> public profile + that league's bets (already visible to
 *                     members) + their league line
 *   anyone else    -> public profile only
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
  if (!parsed.success) throw new HttpsError("invalid-argument", `Pick up to ${MAX_FAVORITE_TEAMS} teams.`);

  const seen = new Set<string>();
  const teams = parsed.data.filter((t) => {
    const k = `${t.sport}:${t.abbr}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  await db.collection("users").doc(uid).update({ favoriteTeams: teams, updatedAt: FieldValue.serverTimestamp() });
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
    side: b.side as "home" | "away",
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

  const [user, friendship, league] = await Promise.all([
    db.collection("users").doc(uid).get(),
    uid === me ? Promise.resolve(null) : db.collection("friendships").doc(pairId(me, uid)).get(),
    leagueId ? db.collection("leagues").doc(leagueId).get() : Promise.resolve(null),
  ]);
  if (!user.exists) throw new HttpsError("not-found", "That player doesn't exist.");

  const self = uid === me;
  const friend = !!friendship?.exists;
  const memberIds = (league?.get("memberIds") as string[] | undefined) ?? [];
  const leagueMate = !!league?.exists && memberIds.includes(me) && memberIds.includes(uid);
  const relation = self ? "self" : friend ? "friend" : leagueMate ? "league" : "none";

  const [betsSnap, leagueBetsSnap] = await Promise.all([
    self || friend
      ? db.collection("bets").where("uid", "==", uid).orderBy("placedAt", "desc").limit(50).get()
      : Promise.resolve(null),
    leagueMate
      ? db.collection("leagues").doc(leagueId!).collection("leagueBets").where("uid", "==", uid).orderBy("placedAt", "desc").limit(30).get()
      : Promise.resolve(null),
  ]);

  const m = leagueMate ? (league!.get(`members.${uid}`) as Record<string, unknown> | undefined) : undefined;

  return {
    relation,
    profile: {
      uid,
      username: user.get("username") as string,
      displayName: user.get("displayName") as string,
      avatar: user.get("avatar") ?? null,
      equipped: user.get("equipped") ?? {},
      favoriteTeams: user.get("favoriteTeams") ?? [],
      stats: user.get("stats") ?? null,
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
          joinedAt: (m?.joinedAt as number | undefined) ?? null,
          bets: leagueBetsSnap ? leagueBetsSnap.docs.map(betOf) : [],
        }
      : null,
  };
});
