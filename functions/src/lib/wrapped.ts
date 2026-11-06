import { db, Timestamp } from "./economy";
import { levelFromXp } from "./progression";

/**
 * Drip Wrapped: a personal recap for a league season (periodId = leagueId) or
 * a year (periodId = "year-YYYY"). Pure builder + a loader; written to
 * users/{uid}/wrapped/{periodId} under a deterministic id, so regeneration
 * overwrites. Private to the owner; worstBeat is never offered for sharing.
 */

export interface WrappedBet {
  status: string;
  odds: number;
  stake: number;
  payout?: number;
  teamAbbr?: string | null;
  label?: string | null;
  opponentAbbr?: string | null;
}
export interface WrappedRivalry {
  aUid: string;
  bUid: string;
  aName: string;
  bName: string;
  aWins?: number;
  bWins?: number;
  pushes?: number;
}
export interface Wrapped {
  periodId: string;
  title: string;
  record: { w: number; l: number; p: number };
  bestCall: { label: string; odds: number } | null;
  worstBeat: { label: string; stake: number } | null;
  rival: { uid: string; name: string; games: number; w: number; l: number } | null;
  topTeam: { abbr: string; picks: number } | null;
  streakBest: number;
  level: number;
  achievements: number;
  generatedAt: number;
}

export function buildWrapped(args: {
  uid: string;
  periodId: string;
  title: string;
  bets: WrappedBet[];
  rivalries: WrappedRivalry[];
  streakBest: number;
  xp: number;
  achievements: number;
  now: number;
}): Wrapped {
  const record = { w: 0, l: 0, p: 0 };
  let bestCall: Wrapped["bestCall"] = null;
  let worstBeat: Wrapped["worstBeat"] = null;
  const teams = new Map<string, number>();
  for (const b of args.bets) {
    const label = b.label || b.teamAbbr || "Pick";
    if (b.teamAbbr) teams.set(b.teamAbbr, (teams.get(b.teamAbbr) ?? 0) + 1);
    if (b.status === "won") {
      record.w++;
      if (!bestCall || b.odds > bestCall.odds) bestCall = { label, odds: b.odds };
    } else if (b.status === "lost") {
      record.l++;
      if (!worstBeat || b.stake > worstBeat.stake) worstBeat = { label, stake: b.stake };
    } else if (b.status === "push") record.p++;
  }
  let rival: Wrapped["rival"] = null;
  for (const r of args.rivalries) {
    const me = r.aUid === args.uid ? "a" : r.bUid === args.uid ? "b" : null;
    if (!me) continue;
    const w = (me === "a" ? r.aWins : r.bWins) ?? 0;
    const l = (me === "a" ? r.bWins : r.aWins) ?? 0;
    const games = w + l + (r.pushes ?? 0);
    if (!rival || games > rival.games) {
      rival = { uid: me === "a" ? r.bUid : r.aUid, name: me === "a" ? r.bName : r.aName, games, w, l };
    }
  }
  const top = [...teams.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  return {
    periodId: args.periodId,
    title: args.title,
    record,
    bestCall,
    worstBeat,
    rival: rival && rival.games > 0 ? rival : null,
    topTeam: top ? { abbr: top[0], picks: top[1] } : null,
    streakBest: args.streakBest,
    level: levelFromXp(args.xp),
    achievements: args.achievements,
    generatedAt: args.now,
  };
}

const settled = (d: FirebaseFirestore.QueryDocumentSnapshot): WrappedBet => ({
  status: d.get("status") as string,
  odds: (d.get("odds") as number) ?? 0,
  stake: (d.get("stake") as number) ?? 0,
  payout: d.get("payout") as number | undefined,
  teamAbbr: (d.get("teamAbbr") as string | null) ?? null,
  label: (d.get("label") as string | null) ?? null,
});

/** One league season. */
export async function generateLeagueWrapped(leagueId: string, now = Date.now()): Promise<number> {
  const leagueRef = db.collection("leagues").doc(leagueId);
  const league = await leagueRef.get();
  if (!league.exists) return 0;
  const memberIds = (league.get("memberIds") as string[] | undefined) ?? [];
  const [bets, rivalries] = await Promise.all([
    leagueRef.collection("leagueBets").limit(5000).get(),
    leagueRef.collection("rivalries").limit(1000).get(),
  ]);
  const rivs = rivalries.docs.map((d) => d.data() as WrappedRivalry);
  let n = 0;
  for (const uid of memberIds) {
    const user = await db.collection("users").doc(uid).get();
    if (!user.exists) continue;
    const w = buildWrapped({
      uid,
      periodId: leagueId,
      title: (league.get("name") as string) ?? "League",
      bets: bets.docs.filter((d) => d.get("uid") === uid).map(settled),
      rivalries: rivs,
      streakBest: (user.get("streak.longest") as number) ?? 0,
      xp: (user.get("xp") as number) ?? 0,
      achievements: (user.get("achievementCount") as number) ?? 0,
      now,
    });
    await user.ref.collection("wrapped").doc(leagueId).set(w);
    n++;
  }
  return n;
}

/** The yearly edition for one player: global bets + every league's bets that year. */
export async function generateYearWrapped(uid: string, year: number, now = Date.now()): Promise<boolean> {
  const user = await db.collection("users").doc(uid).get();
  if (!user.exists) return false;
  const from = Date.UTC(year, 0, 1);
  const to = Date.UTC(year + 1, 0, 1);
  const [global, league, leagues] = await Promise.all([
    db
      .collection("bets")
      .where("uid", "==", uid)
      .where("placedAt", ">=", Timestamp.fromMillis(from))
      .where("placedAt", "<", Timestamp.fromMillis(to))
      .limit(5000)
      .get(),
    db.collectionGroup("leagueBets").where("uid", "==", uid).where("placedAt", ">=", from).where("placedAt", "<", to).limit(5000).get(),
    db.collection("leagues").where("memberIds", "array-contains", uid).limit(50).get(),
  ]);
  const rivs: WrappedRivalry[] = [];
  for (const l of leagues.docs) {
    const r = await l.ref.collection("rivalries").limit(500).get();
    rivs.push(...r.docs.map((d) => d.data() as WrappedRivalry));
  }
  const w = buildWrapped({
    uid,
    periodId: `year-${year}`,
    title: `${year} on SportDrip`,
    bets: [...global.docs, ...league.docs].map(settled),
    rivalries: rivs,
    streakBest: (user.get("streak.longest") as number) ?? 0,
    xp: (user.get("xp") as number) ?? 0,
    achievements: (user.get("achievementCount") as number) ?? 0,
    now,
  });
  await user.ref.collection("wrapped").doc(`year-${year}`).set(w);
  return true;
}
