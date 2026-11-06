import { createHash } from "node:crypto";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { withModelPrices } from "../lib/ratings";
import { logger } from "firebase-functions";
import { db, FieldValue } from "../lib/economy";
import { isClutch, type GameLike } from "../lib/gameState";
import { writeNotification } from "../lib/notify";
import { simpleNotification } from "../lib/notifyModel";
import { fetchGames, type NormalizedGame, type Sport } from "../lib/sportsProvider";
import { sendSweatAlerts } from "./sweat";

/**
 * Sends a one-time clutch alert to everyone with league stakes on a live game
 * that enters its final 5 minutes (or 9th inning) within one score.
 * Exported for unit tests.
 */
export async function sendClutchAlerts(
  games?: Array<GameLike & { id: string; homeTeam?: { abbreviation: string }; awayTeam?: { abbreviation: string } }>,
  now = Date.now()
): Promise<number> {
  const candidates =
    games ??
    (await db.collection("games").where("status", "==", "live").limit(200).get()).docs.map((d) => ({
      id: d.id,
      ...(d.data() as GameLike & { homeTeam?: { abbreviation: string }; awayTeam?: { abbreviation: string } }),
    }));

  const clutchGames = candidates.filter((g) => isClutch(g));
  if (clutchGames.length === 0) return 0;

  let alertsSent = 0;
  for (const g of clutchGames) {
    const sidesGroup = await db
      .collectionGroup("gameSides")
      .where("gameId", "==", g.id)
      .limit(200)
      .get();

    for (const sideDoc of sidesGroup.docs) {
      if (sideDoc.get("clutchAlerted") === true) continue;
      const entries = (sideDoc.get("entries") as Array<{ uid: string; name?: string; displayName?: string }> | undefined) ?? [];
      if (entries.length === 0) continue;

      const leagueId = sideDoc.get("leagueId") as string;
      const did = await db.runTransaction(async (tx) => {
        const [freshSide, league] = await Promise.all([
          tx.get(sideDoc.ref),
          tx.get(db.collection("leagues").doc(leagueId)),
        ]);
        if (!freshSide.exists || freshSide.get("clutchAlerted") === true) return 0;
        if (!league.exists || league.get("status") !== "active") return 0;

        tx.update(sideDoc.ref, { clutchAlerted: true, clutchAlertedAt: now });

        const homeAbbr = g.homeTeam?.abbreviation ?? "HOME";
        const awayAbbr = g.awayTeam?.abbreviation ?? "AWAY";
        const hs = g.homeScore ?? 0;
        const as = g.awayScore ?? 0;
        const scoreLine =
          hs === as
            ? `${awayAbbr} ${as}, ${homeAbbr} ${hs} tied`
            : hs > as
              ? `${homeAbbr} up ${hs - as}`
              : `${awayAbbr} up ${as - hs}`;
        const clockPart = g.clock ? `, ${g.clock} left` : "";

        const byUid = new Map<string, string>();
        for (const e of entries) {
          byUid.set(e.uid, e.displayName ?? e.name ?? "Player");
        }
        const uids = [...byUid.keys()];
        const leagueName = (league.get("name") as string) ?? "League";

        for (const uid of uids) {
          const others = uids.filter((u) => u !== uid).map((u) => byUid.get(u)!);
          const who =
            others.length === 0
              ? "You are sweating."
              : others.length === 1
                ? `You and ${others[0]} are sweating.`
                : `You, ${others.slice(0, -1).join(", ")} and ${others[others.length - 1]} are sweating.`;

          writeNotification(
            tx,
            uid,
            simpleNotification({
              id: `clutch_${leagueId}_${g.id}`,
              type: "clutch_alert",
              title: `${scoreLine}${clockPart}`,
              body: `${who}`,
              wallet: "league",
              leagueId,
              leagueName,
              now,
              popup: true,
              data: { gameId: g.id, leagueId },
            })
          );
        }
        return uids.length;
      });
      alertsSent += did;
    }
  }
  return alertsSent;
}


/**
 * Write-avoidance for the scoreboard. Every sync used to rewrite every game,
 * every minute: hundreds of writes a minute, and every one of them re-read by
 * every client listening to the board. Now each game's content (minus its
 * timestamps) is fingerprinted into meta/gameHashes and only games whose
 * content changed are written. Games close to kickoff are always written,
 * because pricing.ts rejects bets on a near-kickoff game whose updatedAt is
 * more than two minutes old.
 */
const HASHES = () => db.collection("meta").doc("gameHashes");
const ALWAYS_WRITE_BEFORE_KICKOFF_MS = 35 * 60_000;

function gameHash(g: NormalizedGame): string {
  const { updatedAt: _u, model, ...rest } = g as NormalizedGame & { model?: { pricedAt?: number } | null };
  const stable = { ...rest, model: model ? { ...model, pricedAt: 0 } : model };
  return createHash("sha1").update(JSON.stringify(stable)).digest("base64").slice(0, 12);
}

/** Writes the games whose content changed; returns how many were written. `prune` drops fingerprints of games no longer in the feed. */
export async function writeChangedGames(games: NormalizedGame[], prune: boolean, now = Date.now()): Promise<number> {
  const snap = await HASHES().get();
  const known = ((snap.get("h") as Record<string, string> | undefined) ?? {});
  const changed: NormalizedGame[] = [];
  const nextHashes: Record<string, string> = {};
  for (const g of games) {
    const h = gameHash(g);
    const nearKickoff = g.status === "upcoming" && g.startsAt - now < ALWAYS_WRITE_BEFORE_KICKOFF_MS;
    if (known[g.id] !== h || nearKickoff) {
      changed.push(g);
      nextHashes[g.id] = h;
    }
  }
  for (let i = 0; i < changed.length; i += 400) {
    const batch = db.batch();
    for (const g of changed.slice(i, i + 400)) batch.set(db.collection("games").doc(g.id), { ...g, expired: false }, { merge: true });
    await batch.commit();
  }
  const update: Record<string, unknown> = {};
  for (const [id, h] of Object.entries(nextHashes)) if (known[id] !== h) update[`h.${id}`] = h;
  if (prune) {
    const seen = new Set(games.map((g) => g.id));
    for (const id of Object.keys(known)) if (!seen.has(id)) update[`h.${id}`] = FieldValue.delete();
  }
  if (Object.keys(update).length) {
    if (snap.exists) await HASHES().update(update);
    else await HASHES().set({ h: nextHashes });
  }
  return changed.length;
}

/**
 * Pulls the scoreboard for every configured sport and writes it to games/{id}.
 * Tightened to a 1-minute schedule so games within 30 minutes of kickoff carry
 * fresh prices.
 */
export const syncGames = onSchedule(
  { schedule: "*/1 * * * *", region: "us-central1", timeoutSeconds: 120, retryCount: 1 },
  async () => {
    const fetched = await fetchGames();
    const failures = fetched.failures;
    // Unpriced upcoming games get the shared model line (same for every user).
    const games = await withModelPrices(fetched.games);

    if (failures.length) logger.warn("sportsProvider partial failure", { failures });
    if (games.length === 0) {
      logger.error("sportsProvider returned nothing — leaving previous cache in place");
      return;
    }

    const written = await writeChangedGames(games, true);

    const expired = await expireMissing(new Set(games.map((g: NormalizedGame) => g.id)));
    const clutch = await sendClutchAlerts(games, Date.now());
    const sweat = await sendSweatAlerts(games as never, Date.now()).catch((err) => {
      logger.warn("sweat alerts failed", { error: String(err) });
      return 0;
    });

    await db.collection("meta").doc("sportsSync").set(
      {
        lastRunAt: FieldValue.serverTimestamp(),
        gameCount: games.length,
        written,
        expired,
        clutch,
        sweat,
        failures,
      },
      { merge: true }
    );

    logger.info("syncGames complete", { count: games.length, written, clutch });
  }
);

async function expireMissing(seen: Set<string>): Promise<number> {
  const cutoff = Date.now() - 6 * 3_600_000;
  const stale = await db
    .collection("games")
    .where("status", "in", ["upcoming", "live"])
    .where("expired", "==", false)
    .where("startsAt", "<", cutoff)
    .limit(400)
    .get();
  const batch = db.batch();
  let n = 0;
  for (const d of stale.docs) {
    if (seen.has(d.id) || d.get("expired") === true) continue;
    batch.set(d.ref, { expired: true, expiredAt: Date.now() }, { merge: true });
    n++;
  }
  if (n) await batch.commit();
  if (n) logger.info("expired stale games", { count: n });
  return n;
}

/** Sweeps games that finished more than 48h ago. */
export const pruneGames = onSchedule(
  { schedule: "0 5 * * *", region: "us-central1", timeoutSeconds: 300 },
  async () => {
    const cutoff = Date.now() - 48 * 3_600_000;
    const stale = await db
      .collection("games")
      .where("status", "==", "final")
      .where("startsAt", "<", cutoff)
      .limit(400)
      .get();

    if (stale.empty) return;

    const batch = db.batch();
    let deleted = 0;

    for (const d of stale.docs) {
      const pending = await db
        .collection("bets")
        .where("gameId", "==", d.id)
        .where("status", "==", "pending")
        .limit(1)
        .get();

      if (!pending.empty) {
        logger.warn("skipping prune, bets still pending", { gameId: d.id });
        continue;
      }

      batch.delete(d.ref);
      batch.delete(db.collection("gameInsights").doc(d.id));
      deleted++;
    }

    if (deleted === 0) return;
    await batch.commit();

    logger.info("pruneGames", { deleted });
  }
);

/** Live games someone has money on: a sweat doc, a pending global bet, or a pending league bet. */
export async function liveGamesWithStakes(): Promise<Array<{ id: string; sport: Sport }>> {
  const live = await db.collection("games").where("status", "==", "live").limit(200).get();
  const checks = await Promise.all(
    live.docs.map(async (g) => {
      const [sweat, bet, leagueBet] = await Promise.all([
        db.collection("sweat").doc(g.id).get(),
        db.collection("bets").where("gameId", "==", g.id).where("status", "==", "pending").limit(1).get(),
        db.collectionGroup("leagueBets").where("gameId", "==", g.id).where("status", "==", "pending").limit(1).get(),
      ]);
      return sweat.exists || !bet.empty || !leagueBet.empty ? { id: g.id, sport: g.get("sport") as Sport } : null;
    })
  );
  return checks.filter((x): x is { id: string; sport: Sport } => !!x);
}

/** One live pass: re-fetch only the sports with staked live games and write just those games. */
export async function refreshLiveGames(): Promise<number> {
  const staked = await liveGamesWithStakes();
  if (!staked.length) return 0;
  const ids = new Set(staked.map((g) => g.id));
  const { games: raw } = await fetchGames(new Set(staked.map((g) => g.sport)));
  const games = await withModelPrices(raw);
  const fresh = games.filter((g) => ids.has(g.id));
  if (!fresh.length) return 0;
  await writeChangedGames(fresh, false);
  const now = Date.now();
  await sendClutchAlerts(fresh, now).catch(() => 0);
  await sendSweatAlerts(fresh as never, now).catch(() => 0);
  return fresh.length;
}

/**
 * Sub-minute freshness for live games with open stakes: a 1-minute job that
 * refreshes twice, ~30 s apart (offset from syncGames' own pass). Cost scales
 * with staked live games, not users; a quiet slate does one cheap query.
 */
export const syncLiveGames = onSchedule(
  { schedule: "*/1 * * * *", region: "us-central1", timeoutSeconds: 90, retryCount: 0 },
  async () => {
    await new Promise((r) => setTimeout(r, 15_000));
    const a = await refreshLiveGames().catch((err) => (logger.warn("live refresh failed", { error: String(err) }), 0));
    await new Promise((r) => setTimeout(r, 30_000));
    const b = await refreshLiveGames().catch((err) => (logger.warn("live refresh failed", { error: String(err) }), 0));
    if (a || b) logger.info("syncLiveGames", { first: a, second: b });
  }
);
