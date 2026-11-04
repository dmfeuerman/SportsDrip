"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AD_REWARD = exports.PRIZE_BOXES = exports.STARTER_ITEMS = exports.STARTING_BALANCE = exports.Timestamp = exports.FieldValue = exports.db = void 0;
exports.pickWeighted = pickWeighted;
exports.applyCredits = applyCredits;
exports.applyCreditsMany = applyCreditsMany;
exports.pairId = pairId;
exports.requireAuth = requireAuth;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
Object.defineProperty(exports, "FieldValue", { enumerable: true, get: function () { return firestore_1.FieldValue; } });
Object.defineProperty(exports, "Timestamp", { enumerable: true, get: function () { return firestore_1.Timestamp; } });
const https_1 = require("firebase-functions/v2/https");
if ((0, app_1.getApps)().length === 0)
    (0, app_1.initializeApp)();
exports.db = (0, firestore_1.getFirestore)();
// ---------------------------------------------------------------------------
// Economy configuration. Single source of truth for anything that mints or
// burns credits. Nothing here is readable or writable by the client.
// ---------------------------------------------------------------------------
exports.STARTING_BALANCE = 1000;
/** Items granted free at signup so a new user is never staring at a bare avatar. */
exports.STARTER_ITEMS = ["tee_basic_white", "shorts_basic_navy", "shoes_basic_white"];
exports.PRIZE_BOXES = {
    bronze: {
        tier: "bronze",
        waitHours: 1,
        segments: [
            { credits: 50, weight: 9 },
            { credits: 75, weight: 4 },
            { credits: 100, weight: 2 },
            { credits: 125, weight: 1 },
            { credits: 200, weight: 1 },
        ],
    },
    silver: {
        tier: "silver",
        waitHours: 4,
        segments: [
            { credits: 150, weight: 9 },
            { credits: 200, weight: 4 },
            { credits: 250, weight: 2 },
            { credits: 350, weight: 1 },
            { credits: 500, weight: 1 },
        ],
    },
    gold: {
        tier: "gold",
        waitHours: 12,
        segments: [
            { credits: 400, weight: 9 },
            { credits: 600, weight: 4 },
            { credits: 800, weight: 2 },
            { credits: 1200, weight: 1 },
            { credits: 2000, weight: 1 },
        ],
    },
};
/**
 * Rewarded video bonus. Credited only by the AdMob SSV callback
 * (http/adReward.ts), never by the client. Mirrored for display in
 * artifacts/mobile/constants/ads.ts.
 */
exports.AD_REWARD = {
    credits: 100,
    dailyLimit: 5,
    /** Must match the customData the app sets on the RewardedAd request. */
    customData: "credits",
    /** AdMob retries failed callbacks; anything older than this is ignored. */
    maxCallbackAgeMs: 24 * 3_600_000,
    /** App-reported views closer together than this are refused (no video is shorter). */
    minGapMs: 15_000,
};
/** Weighted pick. Runs on the server only — the client never sees the table. */
function pickWeighted(segments) {
    const total = segments.reduce((s, x) => s + x.weight, 0);
    let roll = Math.random() * total;
    for (const seg of segments) {
        roll -= seg.weight;
        if (roll <= 0)
            return seg.credits;
    }
    return segments[0]?.credits ?? 0;
}
/**
 * The only way credits ever move. Applies `delta` to users/{uid}.balance and
 * appends a ledger row, inside the caller's transaction.
 *
 * - Refuses to take a balance negative (B9).
 * - `idempotencyKey` makes the whole operation replay-safe: the ledger entry id
 *   is derived from it, so a retried client call is a no-op instead of a double
 *   charge or a double payout (B10).
 *
 * Returns the new balance, or null if this key was already applied.
 */
async function applyCredits(tx, uid, args) {
    const userRef = exports.db.collection("users").doc(uid);
    const ledgerRef = userRef.collection("ledger").doc(args.idempotencyKey);
    const [userSnap, ledgerSnap] = await Promise.all([tx.get(userRef), tx.get(ledgerRef)]);
    if (ledgerSnap.exists)
        return null; // already applied
    if (!userSnap.exists)
        throw new https_1.HttpsError("not-found", "Profile not found.");
    const current = userSnap.get("balance") ?? 0;
    const next = current + args.delta;
    if (next < 0) {
        throw new https_1.HttpsError("failed-precondition", "Not enough credits.");
    }
    tx.update(userRef, { balance: next, updatedAt: firestore_1.FieldValue.serverTimestamp() });
    tx.set(ledgerRef, {
        type: args.type,
        delta: args.delta,
        balanceAfter: next,
        ref: args.ref ?? null,
        note: args.note ?? null,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
    return next;
}
/**
 * `applyCredits` for several moves (and several users) in one transaction.
 *
 * Firestore makes every read come before the first write, so two plain
 * applyCredits calls can't share a transaction: the second one's read would
 * land after the first one's write. This reads every user and ledger row up
 * front, then writes each user's balance once.
 *
 * - Same guarantees as applyCredits: no balance goes negative, and a move whose
 *   idempotency key is already in the ledger is skipped.
 * - A zero delta writes nothing but still reports the balance, so a loser's
 *   notification can show where they stand.
 * - The caller must not have written anything in this transaction yet.
 *
 * Returns each user's balance after the moves (null if the profile is gone and
 * nothing was owed to it).
 */
async function applyCreditsMany(tx, moves) {
    const uids = [...new Set(moves.map((m) => m.uid))];
    const userRefs = uids.map((u) => exports.db.collection("users").doc(u));
    const live = moves.filter((m) => m.delta !== 0);
    const ledgerRefs = live.map((m) => exports.db.collection("users").doc(m.uid).collection("ledger").doc(m.idempotencyKey));
    const userSnaps = await Promise.all(userRefs.map((r) => tx.get(r)));
    const ledgerSnaps = await Promise.all(ledgerRefs.map((r) => tx.get(r)));
    const balances = {};
    uids.forEach((u, i) => {
        const snap = userSnaps[i];
        balances[u] = snap.exists ? (snap.get("balance") ?? 0) : null;
    });
    const rows = [];
    const touched = new Set();
    live.forEach((m, i) => {
        if (ledgerSnaps[i].exists)
            return; // already applied
        const current = balances[m.uid];
        if (current === null || current === undefined)
            throw new https_1.HttpsError("not-found", "Profile not found.");
        const next = current + m.delta;
        if (next < 0)
            throw new https_1.HttpsError("failed-precondition", "Not enough credits.");
        balances[m.uid] = next;
        touched.add(m.uid);
        rows.push({ ref: ledgerRefs[i], move: m, after: next });
    });
    for (const u of touched) {
        tx.update(exports.db.collection("users").doc(u), { balance: balances[u], updatedAt: firestore_1.FieldValue.serverTimestamp() });
    }
    for (const { ref, move, after } of rows) {
        tx.set(ref, {
            type: move.type,
            delta: move.delta,
            balanceAfter: after,
            ref: move.ref ?? null,
            note: move.note ?? null,
            createdAt: firestore_1.FieldValue.serverTimestamp(),
        });
    }
    return balances;
}
/** Canonical, order-independent friendship id. Makes duplicates impossible. */
function pairId(a, b) {
    return a < b ? `${a}_${b}` : `${b}_${a}`;
}
function requireAuth(auth) {
    const uid = auth?.uid;
    if (!uid)
        throw new https_1.HttpsError("unauthenticated", "Sign in first.");
    return uid;
}
//# sourceMappingURL=economy.js.map