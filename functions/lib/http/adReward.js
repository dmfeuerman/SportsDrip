"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.admobReward = exports.claimAdReward = void 0;
exports.utcDay = utcDay;
exports.parseCustomData = parseCustomData;
exports.grantAdReward = grantAdReward;
const firebase_functions_1 = require("firebase-functions");
const https_1 = require("firebase-functions/v2/https");
const economy_1 = require("../lib/economy");
const admobSsv_1 = require("../lib/admobSsv");
function utcDay(ms) {
    return new Date(ms).toISOString().slice(0, 10);
}
const NONCE = /^[A-Za-z0-9_-]{8,64}$/;
/**
 * customData is "credits" or "credits:<nonce>". The nonce is minted by the app
 * per video and is shared by the SSV callback and the app's own claim, so
 * whichever lands first credits and the other is a no-op.
 */
function parseCustomData(raw) {
    if (raw === economy_1.AD_REWARD.customData)
        return { ok: true, nonce: null };
    const prefix = `${economy_1.AD_REWARD.customData}:`;
    if (!raw.startsWith(prefix))
        return { ok: false, nonce: null };
    const nonce = raw.slice(prefix.length);
    return NONCE.test(nonce) ? { ok: true, nonce } : { ok: false, nonce: null };
}
/**
 * Credits one rewarded view inside a transaction. Replay-safe: the ledger row
 * is keyed by `key`. The per-day count lives at users/{uid}/private/ads
 * (owner-readable), which is also how the app learns the reward landed.
 */
async function grant(uid, key, opts) {
    const userRef = economy_1.db.collection("users").doc(uid);
    const adsRef = userRef.collection("private").doc("ads");
    const ledgerRef = userRef.collection("ledger").doc(key);
    const day = utcDay(opts.now);
    return economy_1.db.runTransaction(async (tx) => {
        const [user, ads, prior] = await Promise.all([tx.get(userRef), tx.get(adsRef), tx.get(ledgerRef)]);
        if (!user.exists)
            return "no_user";
        if (prior.exists)
            return "duplicate";
        const sameDay = ads.exists && ads.get("day") === day;
        const count = sameDay ? (ads.get("count") ?? 0) : 0;
        if (count >= economy_1.AD_REWARD.dailyLimit)
            return "capped";
        const lastAt = ads.get("lastAt") ?? 0;
        if (opts.minGapMs && opts.now - lastAt < opts.minGapMs)
            return "too_soon";
        const balance = await (0, economy_1.applyCredits)(tx, uid, {
            delta: economy_1.AD_REWARD.credits,
            type: "ad_reward",
            idempotencyKey: key,
            ref: opts.ref,
            note: "bonus video",
        });
        if (balance === null)
            return "duplicate";
        tx.set(adsRef, { day, count: count + 1, lastAt: opts.now, lastKey: key, updatedAt: economy_1.FieldValue.serverTimestamp() });
        return "granted";
    });
}
/** SSV path: a request signed by Google. */
async function grantAdReward(p, now = Date.now()) {
    const txId = p.transactionId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 128);
    if (!p.userId || !txId)
        return "no_user";
    const custom = parseCustomData(p.customData);
    if (!custom.ok)
        return "unknown_reward";
    if (!p.timestamp || now - p.timestamp > economy_1.AD_REWARD.maxCallbackAgeMs)
        return "stale";
    return grant(p.userId, custom.nonce ? `ad_${custom.nonce}` : `ad_${txId}`, { now, ref: p.adUnit || undefined });
}
/**
 * App path: called when the SDK reports EARNED_REWARD. SSV only fires for
 * ad units with a callback URL set in the AdMob console — never for Google's
 * test units — so without this, dev builds and unconfigured units never pay.
 * Bounded by the same daily cap plus a minimum gap between views. Set
 * ADMOB_CLIENT_CLAIMS=0 to make SSV the only path.
 */
exports.claimAdReward = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    if (process.env.ADMOB_CLIENT_CLAIMS === "0")
        return { result: "pending" };
    const nonce = String(req.data?.nonce ?? "");
    if (!NONCE.test(nonce))
        throw new https_1.HttpsError("invalid-argument", "Bad reward id.");
    const result = await grant(uid, `ad_${nonce}`, { now: Date.now(), ref: "client", minGapMs: economy_1.AD_REWARD.minGapMs });
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
exports.admobReward = (0, https_1.onRequest)({ region: "us-central1", invoker: "public", maxInstances: 10 }, async (req, res) => {
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
    let params;
    try {
        params = await (0, admobSsv_1.verifySsv)(q);
    }
    catch (err) {
        if (err instanceof admobSsv_1.SsvError) {
            firebase_functions_1.logger.warn("admobReward: rejected", { reason: err.message });
            res.status(403).send("invalid");
            return;
        }
        firebase_functions_1.logger.error("admobReward: verification unavailable", { err: String(err) });
        res.status(503).send("retry");
        return;
    }
    const allowed = (process.env.ADMOB_REWARDED_AD_UNITS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    if (allowed.length && !allowed.includes(params.adUnit)) {
        firebase_functions_1.logger.warn("admobReward: unexpected ad unit", { adUnit: params.adUnit });
        res.status(200).send("ignored");
        return;
    }
    try {
        const result = await grantAdReward(params);
        firebase_functions_1.logger.info("admobReward", { uid: params.userId, result, transactionId: params.transactionId });
        res.status(200).send(result);
    }
    catch (err) {
        firebase_functions_1.logger.error("admobReward: grant failed", { uid: params.userId, err: String(err) });
        res.status(500).send("error");
    }
});
//# sourceMappingURL=adReward.js.map