import { HttpsError } from "firebase-functions/v2/https";
import { generateLeagueWrapped } from "./wrapped";
import { logger } from "firebase-functions";
import { applyCredits, db, FieldValue } from "./economy";
import { prizeSplit, rankMembers, type LeagueLoanLike } from "./loanMath";
import { writeNotification } from "./notify";
import { simpleNotification } from "./notifyModel";
import { applySeasonAwards } from "./awards";

export interface LeagueResultDoc {
  rank: number;
  memberId: string;
  memberName: string;
  memberColor: string;
  leagueTokens: number;
  debt: number;
  receivable: number;
  netWorth: number;
  prizeTokens: number;
  paid: boolean;
}

interface MemberLite {
  uid: string;
  displayName: string;
  avatarColor: string;
  leagueTokens: number;
  joinedAt: number;
  pickPoints?: number;
  eliminated?: boolean;
  eliminatedAt?: number | null;
  h2h?: { w?: number; l?: number; t?: number };
}

/**
 * Ends a league exactly once.
 *
 *  - open league bets and open group parlays are voided and their stakes
 *    returned, so nobody is ranked with tokens stuck in a bet that can no
 *    longer pay
 *  - standings rank on net worth (or pickPoints in pick'em, survival in
 *    survivor) as of the season end, using the same flat-interest math as the
 *    client, and tied places split their combined prize equally
 *  - the pot split is recorded with `paid: false`; payoutLeague moves the
 *    real credits, one idempotent transaction per winner
 *  - awards champion trophies and last-place punishments
 *
 * Safe to call repeatedly: an ended league returns its stored results.
 */
export async function finalizeLeague(leagueId: string, now: number): Promise<LeagueResultDoc[]> {
  const ref = db.collection("leagues").doc(leagueId);

  let leagueName = "League";
  let freshEnd = false;

  const results = await db.runTransaction(async (tx) => {
    const league = await tx.get(ref);
    if (!league.exists) throw new HttpsError("not-found", "League not found.");
    leagueName = (league.get("name") as string) ?? "League";
    if (league.get("status") === "ended") return (league.get("results") as LeagueResultDoc[]) ?? [];

    const [bets, loans, parlays] = await Promise.all([
      tx.get(ref.collection("leagueBets").where("status", "==", "pending")),
      tx.get(ref.collection("loans")),
      tx.get(ref.collection("parlays").where("status", "in", ["open", "locked"])),
    ]);

    const members = Object.values((league.get("members") as Record<string, MemberLite>) ?? {});
    const tokens = new Map(members.map((m) => [m.uid, m.leagueTokens]));
    for (const b of bets.docs) {
      const uid = b.get("uid") as string;
      if (tokens.has(uid)) tokens.set(uid, tokens.get(uid)! + (b.get("stake") as number));
      tx.update(b.ref, { status: "cancelled", voidReason: "league_ended", settledAt: FieldValue.serverTimestamp() });
    }
    for (const p of parlays.docs) {
      const riders = (p.get("riders") as Record<string, { stake: number }> | undefined) ?? {};
      for (const [uid, r] of Object.entries(riders)) {
        if (tokens.has(uid)) tokens.set(uid, tokens.get(uid)! + (r.stake ?? 0));
      }
      tx.update(p.ref, { status: "void", voidReason: "league_ended", settledAt: now });
    }

    const asOf = Math.min(now, (league.get("endsAt") as number) ?? now);
    const loanList: LeagueLoanLike[] = loans.docs.map((d) => ({
      principal: d.get("principal"),
      principalOutstanding: d.get("principalOutstanding"),
      interestAccrued: d.get("interestAccrued") ?? 0,
      interestPaid: d.get("interestPaid") ?? 0,
      accruedThrough: d.get("accruedThrough"),
      ratePct: d.get("ratePct"),
      intervalHours: d.get("intervalHours"),
      kind: d.get("kind"),
      status: d.get("status"),
      borrowerId: d.get("borrowerId"),
      lenderId: d.get("lenderId") ?? null,
    }));

    const mode = (league.get("mode") as string | undefined) ?? "bankroll";
    const baseStandings = rankMembers(
      members.map((m) => ({ uid: m.uid, leagueTokens: tokens.get(m.uid) ?? m.leagueTokens, joinedAt: m.joinedAt })),
      loanList,
      asOf
    );

    const byId = new Map(members.map((m) => [m.uid, m]));
    const standings =
      mode === "pickem" || mode === "bracket"
        ? [...baseStandings]
            .map((s) => ({ ...s, netWorth: byId.get(s.uid)?.pickPoints ?? 0 }))
            .sort((a, b) => b.netWorth - a.netWorth || (a.uid < b.uid ? -1 : 1))
        : mode === "survivor"
          ? [...baseStandings]
              .map((s) => {
                const m = byId.get(s.uid);
                const score = m?.eliminated ? (m.eliminatedAt ?? 0) : Number.MAX_SAFE_INTEGER;
                return { ...s, netWorth: score };
              })
              .sort((a, b) => b.netWorth - a.netWorth || (a.uid < b.uid ? -1 : 1))
          : mode === "matchups"
            ? // Head-to-head record (2 per win, 1 per tie), net worth breaks ties.
              [...baseStandings]
                .map((s) => {
                  const h = byId.get(s.uid)?.h2h;
                  return { ...s, tieKey: ((h?.w ?? 0) * 2 + (h?.t ?? 0)) * 1e12 + s.netWorth };
                })
                .sort((a, b) => b.tieKey - a.tieKey || (a.uid < b.uid ? -1 : 1))
            : baseStandings;
    const rankKey = (s: (typeof standings)[number]) => ("tieKey" in s ? (s as { tieKey: number }).tieKey : s.netWorth);

    const pot = (league.get("pot") as number) ?? 0;
    const netWorths = standings.map(rankKey);
    const prizes = prizeSplit(pot, league.get("prizeDistribution"), standings.length, netWorths);

    let currentRank = 1;
    const out: LeagueResultDoc[] = standings.map((s, i) => {
      if (i > 0 && rankKey(standings[i - 1]!) !== rankKey(s)) {
        currentRank = i + 1;
      }
      return {
        rank: currentRank,
        memberId: s.uid,
        memberName: byId.get(s.uid)?.displayName ?? "Player",
        memberColor: byId.get(s.uid)?.avatarColor ?? "#8FA098",
        leagueTokens: s.tokens,
        debt: s.debt,
        receivable: s.receivable,
        netWorth: s.netWorth,
        prizeTokens: prizes[i] ?? 0,
        paid: false,
      };
    });

    const update: Record<string, unknown> = {
      status: "ended",
      endedAt: now,
      results: out,
      payoutStatus: out.some((r) => r.prizeTokens > 0) ? "pending" : "none",
      lastActivityAt: now,
    };
    for (const [uid, t] of tokens) update[`members.${uid}.leagueTokens`] = t;
    tx.update(ref, update);

    tx.set(ref.collection("activity").doc("ended"), {
      type: "ended",
      uid: out[0]?.memberId ?? "",
      name: out[0]?.memberName ?? "",
      amount: out[0]?.prizeTokens ?? 0,
      text: out[0] ? `Season over — ${out[0].memberName} wins ${leagueName}` : "Season over",
      at: now,
    });

    for (const r of out) {
      if (r.prizeTokens > 0) continue; // winners hear about it from the payout
      writeNotification(
        tx,
        r.memberId,
        simpleNotification({
          id: `ended_${leagueId}`,
          type: "league_ended",
          title: `${leagueName} is over`,
          body: `You finished #${r.rank} of ${out.length} with a net worth of ${r.netWorth.toLocaleString("en-US")}.`,
          leagueId,
          leagueName,
          now,
          popup: true,
        })
      );
    }
    freshEnd = true;
    return out;
  });

  if (freshEnd && results.length > 0) {
    await applySeasonAwards(leagueId, leagueName, results, now);
    // Drip Wrapped for the season; a failure never blocks the league end.
    await generateLeagueWrapped(leagueId, now).catch((err) => logger.warn("wrapped failed", { leagueId, error: String(err) }));
  }
  return results;
}

/**
 * Pays the pot. One transaction per winner, keyed on the league and the
 * member, so a crash halfway through resumes without double-paying.
 */
export async function payoutLeague(leagueId: string): Promise<number> {
  const ref = db.collection("leagues").doc(leagueId);
  const snap = await ref.get();
  const results = (snap.get("results") as LeagueResultDoc[] | undefined) ?? [];
  let paid = 0;

  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    if (r.prizeTokens <= 0 || r.paid) continue;
    try {
      await db.runTransaction(async (tx) => {
        const league = await tx.get(ref);
        const current = (league.get("results") as LeagueResultDoc[]) ?? [];
        const row = current[i];
        if (!row || row.paid || row.memberId !== r.memberId) return;

        const balance = await applyCredits(tx, r.memberId, {
          delta: r.prizeTokens,
          type: "league_payout",
          idempotencyKey: `league_payout_${leagueId}_${r.memberId}`,
          ref: leagueId,
          note: `#${r.rank} in ${league.get("name")}`,
        });
        const next = current.map((x, j) => (j === i ? { ...x, paid: true } : x));
        tx.update(ref, {
          results: next,
          payoutStatus: next.every((x) => x.prizeTokens <= 0 || x.paid) ? "paid" : "pending",
        });
        writeNotification(
          tx,
          r.memberId,
          simpleNotification({
            id: `payout_${leagueId}`,
            type: "league_payout",
            title: r.rank === 1 ? `You won ${league.get("name")}!` : `#${r.rank} in ${league.get("name")}`,
            body: `+${r.prizeTokens.toLocaleString("en-US")} credits from the pot.`,
            delta: r.prizeTokens,
            balanceAfter: balance,
            wallet: "credits",
            leagueId,
            leagueName: league.get("name") as string,
            now: Date.now(),
            popup: true,
          })
        );
        paid++;
      });
    } catch (err) {
      logger.error("league payout failed", { leagueId, memberId: r.memberId, err });
    }
  }
  return paid;
}

/**
 * A league whose start time arrives with fewer than MIN_LEAGUE_PLAYERS (nobody
 * accepted the invite) is cancelled: the remaining members get their buy-ins
 * back and it closes. Leagues that ever had a bet placed are left alone.
 * Returns true when it cancelled the league.
 */
export async function cancelUnstartedLeague(leagueId: string, now: number, minPlayers: number): Promise<boolean> {
  const ref = db.collection("leagues").doc(leagueId);
  const anyBet = await ref.collection("leagueBets").limit(1).get();
  if (!anyBet.empty) return false;
  return db.runTransaction(async (tx) => {
    const league = await tx.get(ref);
    if (!league.exists || league.get("status") !== "active" || league.get("scheduledStart") !== true) return false;
    const startsAt = ((league.get("startsAt") as number | undefined) ?? (league.get("createdAt") as number | undefined) ?? 0);
    const memberIds = (league.get("memberIds") as string[] | undefined) ?? [];
    if (startsAt > now || memberIds.length >= minPlayers) return false;
    const buyIn = (league.get("buyIn") as number | undefined) ?? 0;
    const leagueName = (league.get("name") as string | undefined) ?? "Your league";
    for (const uid of memberIds) {
      if (buyIn > 0) {
        await applyCredits(tx, uid, {
          delta: buyIn,
          type: "league_refund",
          idempotencyKey: `league_cancel_refund_${leagueId}_${uid}`,
          ref: leagueId,
          note: `${leagueName} cancelled`,
        });
      }
      writeNotification(
        tx,
        uid,
        simpleNotification({
          id: `cancelled_${leagueId}`,
          type: "league_ended",
          title: `${leagueName} was cancelled`,
          body: `Nobody accepted the invite before it started${buyIn > 0 ? `, so your ${buyIn.toLocaleString("en-US")}-credit buy-in is back` : ""}.`,
          leagueId,
          leagueName,
          now,
          popup: true,
        })
      );
    }
    tx.update(ref, {
      status: "ended",
      cancelled: true,
      cancelReason: "no_players",
      endedAt: now,
      pot: 0,
      payoutStatus: "none",
      results: [],
      lastActivityAt: now,
    });
    tx.set(ref.collection("activity").doc(`cancelled_${now}`), {
      type: "cancelled",
      uid: "",
      name: "",
      text: "Cancelled: nobody joined before the start date",
      amount: 0,
      reactions: {},
      reactors: {},
      at: now,
    });
    return true;
  });
}
