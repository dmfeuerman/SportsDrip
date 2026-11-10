// import { onSchedule } from "firebase-functions/v2/scheduler";
import { onSchedule } from "../lib/onlineSchedule";
import { sendWidgetRefresh } from "../lib/widgetRefresh";
import { logger } from "firebase-functions";
import { db, FieldValue } from "../lib/economy";
import { balanceSheet, type LeagueLoanLike } from "../lib/loanMath";
import { writeNotification } from "../lib/notify";
import { simpleNotification } from "../lib/notifyModel";
import { CADENCE_DAYS, leagueStarted, leagueStartsAt } from "../lib/leagueConfig";
import {
  buildLeagueReport,
  isPeriodStart,
  matchupPeriodKey,
  playoffPairs,
  roundRobinPairs,
  weekKey,
  type LeagueReportDoc,
  type MatchupCadence,
  type MatchupPair,
  type MatchupSeed,
  type ReportBetInput,
} from "../lib/weekly";

interface MemberLite {
  uid: string;
  displayName: string;
  leagueTokens: number;
  h2h?: { w?: number; l?: number; t?: number };
  eliminated?: boolean;
}

function loanListFrom(docs: FirebaseFirestore.QueryDocumentSnapshot[]): LeagueLoanLike[] {
  return docs.map((d) => ({
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
}

/**
 * Generates and stores the Tuesday League Report (`leagues/{id}/reports/{week}`)
 * for one league, pushing a notification to every member.
 */
export async function generateTuesdayReport(
  leagueId: string,
  now = Date.now(),
  explicitWeek?: string
): Promise<LeagueReportDoc | null> {
  const ref = db.collection("leagues").doc(leagueId);
  const week = explicitWeek ?? weekKey(now - 2 * 86_400_000); // Previous Monday-anchored week

  return db.runTransaction(async (tx) => {
    const [league, existing, betsSnap, loansSnap] = await Promise.all([
      tx.get(ref),
      tx.get(ref.collection("reports").doc(week)),
      tx.get(ref.collection("leagueBets")),
      tx.get(ref.collection("loans")),
    ]);
    if (!league.exists) return null;
    if (existing.exists) return existing.data() as LeagueReportDoc;

    const leagueName = (league.get("name") as string) ?? "League";
    const membersMap = (league.get("members") as Record<string, MemberLite> | undefined) ?? {};
    const loans = loanListFrom(loansSnap.docs);

    const members = Object.values(membersMap).map((m) => ({
      uid: m.uid,
      displayName: m.displayName,
      netWorth: balanceSheet(m.uid, m.leagueTokens, loans, now).netWorth,
    }));

    const bets: ReportBetInput[] = betsSnap.docs.map((d) => ({
      id: d.id,
      uid: d.get("uid") as string,
      displayName: (d.get("displayName") as string) ?? "Player",
      label: (d.get("label") as string | undefined) ?? (d.get("teamAbbr") as string),
      teamAbbr: d.get("teamAbbr") as string,
      stake: d.get("stake") as number,
      odds: d.get("odds") as number,
      potentialPayout: d.get("potentialPayout") as number,
      status: d.get("status") as string,
      tailOf: (d.get("tailOf") as string | null | undefined) ?? null,
      followOfName: (d.get("followOfName") as string | null | undefined) ?? null,
      placedAt: (d.get("placedAt") as number | undefined) ?? now,
    }));

    const report = buildLeagueReport({
      leagueId,
      leagueName,
      week,
      bets,
      members,
      now,
    });

    tx.set(ref.collection("reports").doc(week), report);
    tx.set(ref.collection("activity").doc(`report_${week}`), {
      type: "weekly_report",
      uid: league.get("creatorId") as string,
      name: leagueName,
      amount: 0,
      reactions: {},
      reactors: {},
      text: `Tuesday League Report for ${week} is out (${report.cards.length} highlights)`,
      at: now,
    });

    const topHeadline = report.cards[0]?.headline ?? `${report.totalBets} bets graded this week.`;
    for (const m of members) {
      writeNotification(
        tx,
        m.uid,
        simpleNotification({
          id: `report_${leagueId}_${week}`,
          type: "league_report",
          title: `Tuesday League Report · ${leagueName}`,
          body: topHeadline,
          wallet: "league",
          leagueId,
          leagueName,
          now,
          popup: true,
          data: { leagueId, week },
        })
      );
    }

    return report;
  });
}

/**
 * Closes the currently open weekly head-to-head matchup week (`openMatchupWeek`)
 * on a league, updating each member's `h2h` (`{ w, l, t }`) record and awarding
 * a championship trophy if the closed matchup was a playoff final.
 */
export async function closeMatchups(leagueId: string, now = Date.now()): Promise<MatchupPair[]> {
  const ref = db.collection("leagues").doc(leagueId);

  return db.runTransaction(async (tx) => {
    const league = await tx.get(ref);
    if (!league.exists) return [];
    const openWeek = league.get("openMatchupWeek") as string | null | undefined;
    if (!openWeek) return [];

    const matchupRef = ref.collection("matchups").doc(openWeek);
    const [matchupSnap, loansSnap] = await Promise.all([
      tx.get(matchupRef),
      tx.get(ref.collection("loans")),
    ]);
    if (!matchupSnap.exists || matchupSnap.get("status") === "closed") {
      tx.update(ref, { openMatchupWeek: null });
      return (matchupSnap.get("pairs") as MatchupPair[] | undefined) ?? [];
    }

    const membersMap = (league.get("members") as Record<string, MemberLite> | undefined) ?? {};
    const loans = loanListFrom(loansSnap.docs);
    const netWorthOf = (uid: string) => {
      const m = membersMap[uid];
      return m ? balanceSheet(uid, m.leagueTokens, loans, now).netWorth : 0;
    };

    const pairs = (matchupSnap.get("pairs") as MatchupPair[] | undefined) ?? [];
    const leagueUpdate: Record<string, unknown> = {
      openMatchupWeek: null,
      lastActivityAt: now,
    };

    const gradedPairs: MatchupPair[] = pairs.map((p) => {
      const aEnd = netWorthOf(p.aUid);
      const bEnd = netWorthOf(p.bUid);
      const aDelta = aEnd - p.aStartNetWorth;
      const bDelta = bEnd - p.bStartNetWorth;
      const winnerUid: string | "tie" = aDelta > bDelta ? p.aUid : bDelta > aDelta ? p.bUid : "tie";

      if (membersMap[p.aUid] && membersMap[p.bUid]) {
        if (winnerUid === p.aUid) {
          leagueUpdate[`members.${p.aUid}.h2h.w`] = FieldValue.increment(1);
          leagueUpdate[`members.${p.bUid}.h2h.l`] = FieldValue.increment(1);
        } else if (winnerUid === p.bUid) {
          leagueUpdate[`members.${p.bUid}.h2h.w`] = FieldValue.increment(1);
          leagueUpdate[`members.${p.aUid}.h2h.l`] = FieldValue.increment(1);
        } else {
          leagueUpdate[`members.${p.aUid}.h2h.t`] = FieldValue.increment(1);
          leagueUpdate[`members.${p.bUid}.h2h.t`] = FieldValue.increment(1);
        }
      }

      if (p.bracket === "playoff" && winnerUid !== "tie") {
        const champName = winnerUid === p.aUid ? p.aName : p.bName;
        const leagueName = (league.get("name") as string) ?? "League";
        tx.set(
          db.collection("users").doc(winnerUid).collection("trophies").doc(`h2h_${leagueId}_${openWeek}`),
          {
            id: `h2h_${leagueId}_${openWeek}`,
            kind: "h2h_champion",
            title: `${leagueName} H2H Playoff Winner`,
            leagueId,
            leagueName,
            week: openWeek,
            awardedAt: now,
          },
          { merge: true }
        );
        tx.set(ref.collection("activity").doc(`h2h_champ_${openWeek}`), {
          type: "matchup_won",
          uid: winnerUid,
          name: champName,
          amount: 0,
          reactions: {},
          reactors: {},
          text: `${champName} won the head-to-head playoff bracket!`,
          at: now,
        });
      }

      return {
        ...p,
        aEndNetWorth: aEnd,
        bEndNetWorth: bEnd,
        aDelta,
        bDelta,
        winnerUid,
      };
    });

    tx.update(matchupRef, {
      status: "closed",
      pairs: gradedPairs,
      closedAt: now,
    });
    tx.update(ref, leagueUpdate);
    return gradedPairs;
  });
}

/**
 * Opens a new week of head-to-head matchups (`leagues/{id}/matchups/{week}`).
 * Uses round-robin pairings during the regular season and top-seed playoff
 * pairings in the final week of the season.
 */
export async function openWeekMatchups(
  leagueId: string,
  now = Date.now(),
  explicitWeek?: string
): Promise<MatchupPair[]> {
  const ref = db.collection("leagues").doc(leagueId);
  const week = explicitWeek ?? weekKey(now);

  return db.runTransaction(async (tx) => {
    const [league, existing, matchupsSnap, loansSnap] = await Promise.all([
      tx.get(ref),
      tx.get(ref.collection("matchups").doc(week)),
      tx.get(ref.collection("matchups")),
      tx.get(ref.collection("loans")),
    ]);
    if (!league.exists || league.get("status") !== "active") return [];
    if (existing.exists) return (existing.get("pairs") as MatchupPair[] | undefined) ?? [];

    const membersMap = (league.get("members") as Record<string, MemberLite> | undefined) ?? {};
    const loans = loanListFrom(loansSnap.docs);
    const seeds: MatchupSeed[] = Object.values(membersMap).map((m) => ({
      uid: m.uid,
      displayName: m.displayName,
      netWorth: balanceSheet(m.uid, m.leagueTokens, loans, now).netWorth,
      w: m.h2h?.w ?? 0,
      l: m.h2h?.l ?? 0,
      t: m.h2h?.t ?? 0,
    }));
    if (seeds.length < 2) return [];

    const weekIndex = matchupsSnap.size;
    const cadence = (league.get("matchupCadence") as MatchupCadence | undefined) ?? "weekly";
    const periodDays = CADENCE_DAYS[cadence];
    const endsAt = (league.get("endsAt") as number | undefined) ?? 0;
    const createdAt = leagueStartsAt(league) || now;
    const totalPeriods = endsAt > createdAt
      ? Math.max(2, Math.floor((endsAt - createdAt) / (periodDays * 86_400_000)))
      : ((league.get("durationWeeks") as number | undefined) ?? 4);
    // The last period that fits before the season ends is the playoff round.
    const isFinalWeek =
      weekIndex >= totalPeriods - 1 ||
      (endsAt > 0 && endsAt - now <= (periodDays + 1) * 86_400_000 && weekIndex >= 1);

    const pairs = isFinalWeek
      ? playoffPairs(seeds)
      : roundRobinPairs(seeds, weekIndex);

    tx.set(ref.collection("matchups").doc(week), {
      week,
      weekNumber: weekIndex + 1,
      isPlayoff: isFinalWeek,
      status: "open",
      pairs,
      openedAt: now,
      closedAt: null,
    });
    tx.update(ref, {
      openMatchupWeek: week,
      matchupsEnabled: true,
      lastActivityAt: now,
    });

    return pairs;
  });
}

/**
 * Eliminates survivor players who missed making a pick in a completed week
 * that had at least one pick placed in the league.
 */
export async function sweepMissedSurvivorWeek(leagueId: string, completedWeek: string, now = Date.now()): Promise<number> {
  const ref = db.collection("leagues").doc(leagueId);
  return db.runTransaction(async (tx) => {
    const [league, picksSnap] = await Promise.all([
      tx.get(ref),
      tx.get(ref.collection("picks").where("week", "==", completedWeek)),
    ]);
    if (!league.exists || league.get("status") !== "active") return 0;
    if (league.get("mode") !== "survivor") return 0;
    if (picksSnap.empty) return 0;

    const pickedUids = new Set(picksSnap.docs.map((d) => d.get("uid") as string));
    const membersMap = (league.get("members") as Record<string, MemberLite> | undefined) ?? {};
    const update: Record<string, unknown> = {};
    let knockedOut = 0;

    for (const [uid, m] of Object.entries(membersMap)) {
      if (m.eliminated || pickedUids.has(uid)) continue;
      update[`members.${uid}.eliminated`] = true;
      update[`members.${uid}.eliminatedAt`] = now;
      update[`members.${uid}.eliminatedWeek`] = completedWeek;
      knockedOut++;
    }
    if (knockedOut > 0) {
      update.lastActivityAt = now;
      tx.update(ref, update);
    }
    return knockedOut;
  });
}

export const tuesdayLeagueReport = onSchedule(
  { schedule: "0 9 * * 2", timeZone: "America/New_York", region: "us-central1", timeoutSeconds: 540 },
  async () => {
    const now = Date.now();
    const active = await db.collection("leagues").where("status", "==", "active").limit(200).get();
    let count = 0;
    for (const d of active.docs) {
      try {
        if (!leagueStarted(d, now)) continue;
        const rep = await generateTuesdayReport(d.id, now);
        if (rep) count++;
      } catch (err) {
        logger.error("tuesdayLeagueReport failed", { leagueId: d.id, err });
      }
    }
    if (count > 0) logger.info("tuesdayLeagueReport complete", { count });
  }
);

/**
 * Turns head-to-head periods over every morning: closes the open period once
 * it's over, and opens the next on its first day (Mondays for weekly leagues,
 * Mondays and Thursdays for twice-weekly, every day for daily).
 */
export const leagueMatchupJobs = onSchedule(
  { schedule: "0 9 * * *", timeZone: "America/New_York", region: "us-central1", timeoutSeconds: 540 },
  async () => {
    const now = Date.now();
    const active = await db.collection("leagues").where("status", "==", "active").limit(500).get();
    for (const d of active.docs) {
      try {
        // Matchups begin once the league has started.
        if (!leagueStarted(d, now)) continue;
        const cadence = (d.get("matchupCadence") as MatchupCadence | undefined) ?? "weekly";
        const key = matchupPeriodKey(cadence, now);
        const open = d.get("openMatchupWeek") as string | null | undefined;
        const rolled = !!open && open !== key;
        if (rolled) await closeMatchups(d.id, now);
        if (d.get("matchupsEnabled") && open !== key && isPeriodStart(cadence, now)) {
          await openWeekMatchups(d.id, now, key);
        }
        // H2H changed: wake members' apps to refresh the home-screen widget.
        if (rolled) await sendWidgetRefresh((d.get("memberIds") as string[]) ?? []).catch(() => 0);
      } catch (err) {
        logger.error("leagueMatchupJobs failed", { leagueId: d.id, err });
      }
    }
  }
);

export const mondayLeagueJobs = onSchedule(
  { schedule: "0 9 * * 1", timeZone: "America/New_York", region: "us-central1", timeoutSeconds: 540 },
  async () => {
    const now = Date.now();
    const prevWeek = weekKey(now - 2 * 86_400_000);
    const active = await db.collection("leagues").where("status", "==", "active").limit(200).get();
    for (const d of active.docs) {
      try {
        if (!leagueStarted(d, now)) continue;
        // Head-to-head periods turn over in leagueMatchupJobs.
        if (d.get("mode") === "survivor") {
          await sweepMissedSurvivorWeek(d.id, prevWeek, now);
        }
      } catch (err) {
        logger.error("mondayLeagueJobs failed", { leagueId: d.id, err });
      }
    }
  }
);
