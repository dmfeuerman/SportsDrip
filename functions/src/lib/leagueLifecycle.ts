import { HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { applyCredits, db, FieldValue } from "./economy";
import { prizeSplit, rankMembers, type LeagueLoanLike } from "./loanMath";
import { writeNotification } from "./notify";
import { simpleNotification } from "./notifyModel";

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
}

/**
 * Ends a league exactly once.
 *
 *  - open league bets are voided and their stakes returned, so nobody is
 *    ranked with tokens stuck in a bet that can no longer pay
 *  - standings rank on net worth (tokens + money owed to you − money you owe)
 *    as of the season end, using the same flat-interest math as the client
 *  - the pot split is recorded with `paid: false`; payoutLeague moves the
 *    real credits, one idempotent transaction per winner
 *
 * Safe to call repeatedly: an ended league returns its stored results.
 */
export async function finalizeLeague(leagueId: string, now: number): Promise<LeagueResultDoc[]> {
  const ref = db.collection("leagues").doc(leagueId);

  return db.runTransaction(async (tx) => {
    const league = await tx.get(ref);
    if (!league.exists) throw new HttpsError("not-found", "League not found.");
    if (league.get("status") === "ended") return (league.get("results") as LeagueResultDoc[]) ?? [];

    const [bets, loans] = await Promise.all([
      tx.get(ref.collection("leagueBets").where("status", "==", "pending")),
      tx.get(ref.collection("loans")),
    ]);

    const members = Object.values((league.get("members") as Record<string, MemberLite>) ?? {});
    const tokens = new Map(members.map((m) => [m.uid, m.leagueTokens]));
    for (const b of bets.docs) {
      const uid = b.get("uid") as string;
      if (tokens.has(uid)) tokens.set(uid, tokens.get(uid)! + (b.get("stake") as number));
      tx.update(b.ref, { status: "cancelled", voidReason: "league_ended", settledAt: FieldValue.serverTimestamp() });
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

    const standings = rankMembers(
      members.map((m) => ({ uid: m.uid, leagueTokens: tokens.get(m.uid) ?? m.leagueTokens, joinedAt: m.joinedAt })),
      loanList,
      asOf
    );
    const pot = (league.get("pot") as number) ?? 0;
    const prizes = prizeSplit(pot, league.get("prizeDistribution"), standings.length);
    const byId = new Map(members.map((m) => [m.uid, m]));

    const results: LeagueResultDoc[] = standings.map((s, i) => ({
      rank: s.rank,
      memberId: s.uid,
      memberName: byId.get(s.uid)?.displayName ?? "Player",
      memberColor: byId.get(s.uid)?.avatarColor ?? "#8FA098",
      leagueTokens: s.tokens,
      debt: s.debt,
      receivable: s.receivable,
      netWorth: s.netWorth,
      prizeTokens: prizes[i] ?? 0,
      paid: false,
    }));

    const update: Record<string, unknown> = {
      status: "ended",
      endedAt: now,
      results,
      payoutStatus: results.some((r) => r.prizeTokens > 0) ? "pending" : "none",
      lastActivityAt: now,
    };
    for (const [uid, t] of tokens) update[`members.${uid}.leagueTokens`] = t;
    tx.update(ref, update);

    const name = league.get("name") as string;
    tx.set(ref.collection("activity").doc("ended"), {
      type: "ended",
      uid: results[0]?.memberId ?? "",
      name: results[0]?.memberName ?? "",
      amount: results[0]?.prizeTokens ?? 0,
      text: results[0] ? `Season over — ${results[0].memberName} wins ${name}` : "Season over",
      at: now,
    });

    for (const r of results) {
      if (r.prizeTokens > 0) continue; // winners hear about it from the payout
      writeNotification(
        tx,
        r.memberId,
        simpleNotification({
          id: `ended_${leagueId}`,
          type: "league_ended",
          title: `${name} is over`,
          body: `You finished #${r.rank} of ${results.length} with a net worth of ${r.netWorth.toLocaleString("en-US")}.`,
          leagueId,
          leagueName: name,
          now,
          popup: true,
        })
      );
    }
    return results;
  });
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
