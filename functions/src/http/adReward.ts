import { logger } from "firebase-functions";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { AD_REWARD, applyCredits, db, FieldValue, requireAuth } from "../lib/economy";
import { SsvError, verifySsv, type SsvParams } from "../lib/admobSsv";

export type GrantResult =
  | "granted"
  | "duplicate"
  | "capped"
  | "too_soon"
  | "no_user"
  | "stale"
  | "unknown_reward";

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

const NONCE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * customData is "credits" or "credits:<nonce>". The nonce is minted by the app
 * per video and is shared by the SSV callback and the app's own claim, so
 * whichever lands first credits and the other is a no-op.
 */
export function parseCustomData(raw: string): { ok: boolean; nonce: string | null } {
  if (raw === AD_REWARD.customData) return { ok: true, nonce: null };
  const prefix = `${AD_REWARD.customData}:`;
  if (!raw.startsWith(prefix)) return { ok: false, nonce: null };
  const nonce = raw.slice(prefix.length);
  return NONCE.test(nonce) ? { ok: true, nonce } : { ok: false, nonce: null };
}

/**
 * Credits one rewarded view inside a transaction. Replay-safe: the ledger row
 * is keyed by `key`. The per-day count lives at users/{uid}/private/ads
 * (owner-readable), which is also how the app learns the reward landed.
 */
async function grant(
  uid: string,
  key: string,
  opts: { now: number; ref?: string; minGapMs?: number }
): Promise<GrantResult> {
  const userRef = db.collection("users").doc(uid);
  const adsRef = userRef.collection("private").doc("ads");
  const ledgerRef = userRef.collection("ledger").doc(key);
  const day = utcDay(opts.now);

  return db.runTransaction(async (tx): Promise<GrantResult> => {
    const [user, ads, prior] = await Promise.all([tx.get(userRef), tx.get(adsRef), tx.get(ledgerRef)]);
    if (!user.exists) return "no_user";
    if (prior.exists) return "duplicate";

    const sameDay = ads.exists && ads.get("day") === day;
    const count = sameDay ? ((ads.get("count") as number | undefined) ?? 0) : 0;
    if (count >= AD_REWARD.dailyLimit) return "capped";
    const lastAt = (ads.get("lastAt") as number | undefined) ?? 0;
    if (opts.minGapMs && opts.now - lastAt < opts.minGapMs) return "too_soon";

    const balance = await applyCredits(tx, uid, {
      delta: AD_REWARD.credits,
      type: "ad_reward",
      idempotencyKey: key,
      ref: opts.ref,
      note: "bonus video",
    });
    if (balance === null) return "duplicate";

    tx.set(adsRef, { day, count: count + 1, lastAt: opts.now, lastKey: key, updatedAt: FieldValue.serverTimestamp() });
    return "granted";
  });
}

/** SSV path: a request signed by Google. */
export async function grantAdReward(p: SsvParams, now = Date.now()): Promise<GrantResult> {
  const txId = p.transactionId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 128);
  if (!p.userId || !txId) return "no_user";
  const custom = parseCustomData(p.customData);
  if (!custom.ok) return "unknown_reward";
  if (!p.timestamp || now - p.timestamp > AD_REWARD.maxCallbackAgeMs) return "stale";
  return grant(p.userId, custom.nonce ? `ad_${custom.nonce}` : `ad_${txId}`, { now, ref: p.adUnit || undefined });
}

/**
 * App path: called when the SDK reports EARNED_REWARD. SSV only fires for
 * ad units with a callback URL set in the AdMob console — never for Google's
 * test units — so without this, dev builds and unconfigured units never pay.
 * Bounded by the same daily cap plus a minimum gap between views. Set
 * ADMOB_CLIENT_CLAIMS=0 to make SSV the only path.
 */
export const claimAdReward = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  if (process.env.ADMOB_CLIENT_CLAIMS === "0") return { result: "pending" as const };
  const nonce = String((req.data as { nonce?: unknown } | null)?.nonce ?? "");
  if (!NONCE.test(nonce)) throw new HttpsError("invalid-argument", "Bad reward id.");
  const result = await grant(uid, `ad_${nonce}`, { now: Date.now(), ref: "client", minGapMs: AD_REWARD.minGapMs });
  return { result };
});

/**
 * AdMob SSV callback. Set this function's URL as the rewarded ad unit's
 * "Server-side verification" callback in the AdMob console.
 *
 * Status codes matter: AdMob retries anything that isn't a 200, so a verified
 * request always gets 200 (even when capped or duplicated), and only a
 * transient failure (key fetch, Firestore) returns 5xx.
 */
export const admobReward = onRequest({ region: "us-central1", invoker: "public", maxInstances: 10 }, async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).send("method not allowed");
    return;
  }

  const url = req.originalUrl || req.url || "";
  const q = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  if (!q) {
    // The AdMob console's "Verify URL" reachability check.
    res.status(200).send("ok");
    return;
  }

  let params: SsvParams;
  try {
    params = await verifySsv(q);
  } catch (err) {
    if (err instanceof SsvError) {
      logger.warn("admobReward: rejected", { reason: err.message });
      res.status(403).send("invalid");
      return;
    }
    logger.error("admobReward: verification unavailable", { err: String(err) });
    res.status(503).send("retry");
    return;
  }

  const allowed = (process.env.ADMOB_REWARDED_AD_UNITS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allowed.length && !allowed.includes(params.adUnit)) {
    logger.warn("admobReward: unexpected ad unit", { adUnit: params.adUnit });
    res.status(200).send("ignored");
    return;
  }

  try {
    const result = await grantAdReward(params);
    logger.info("admobReward", { uid: params.userId, result, transactionId: params.transactionId });
    res.status(200).send(result);
  } catch (err) {
    logger.error("admobReward: grant failed", { uid: params.userId, err: String(err) });
    res.status(500).send("error");
  }
});
