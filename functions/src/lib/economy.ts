import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue, Transaction, Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";

if (getApps().length === 0) initializeApp();

export const db = getFirestore();
export { FieldValue, Timestamp };
export type Tx = Transaction;

// ---------------------------------------------------------------------------
// Economy configuration. Single source of truth for anything that mints or
// burns credits. Nothing here is readable or writable by the client.
// ---------------------------------------------------------------------------

export const STARTING_BALANCE = 10_000;

/** Items granted free at signup so a new user is never staring at a bare avatar. */
export const STARTER_ITEMS = ["tee_basic_white", "shorts_basic_navy", "shoes_basic_white"];

export type BoxTier = "bronze" | "silver" | "gold";

export interface PrizeBoxDef {
  tier: BoxTier;
  waitHours: number;
  segments: Array<{ credits: number; weight: number }>;
}

export const PRIZE_BOXES: Record<BoxTier, PrizeBoxDef> = {
  bronze: {
    tier: "bronze",
    waitHours: 1,
    segments: [
      { credits: 500, weight: 9 },
      { credits: 750, weight: 4 },
      { credits: 1000, weight: 2 },
      { credits: 1250, weight: 1 },
      { credits: 2000, weight: 1 },
    ],
  },
  silver: {
    tier: "silver",
    waitHours: 4,
    segments: [
      { credits: 1500, weight: 9 },
      { credits: 2000, weight: 4 },
      { credits: 2500, weight: 2 },
      { credits: 3500, weight: 1 },
      { credits: 5000, weight: 1 },
    ],
  },
  gold: {
    tier: "gold",
    waitHours: 12,
    segments: [
      { credits: 4000, weight: 9 },
      { credits: 6000, weight: 4 },
      { credits: 8000, weight: 2 },
      { credits: 12000, weight: 1 },
      { credits: 20000, weight: 1 },
    ],
  },
};

/**
 * Rewarded video bonus. Credited only by the AdMob SSV callback
 * (http/adReward.ts), never by the client. Mirrored for display in
 * artifacts/mobile/constants/ads.ts.
 */
export const AD_REWARD = {
  credits: 100,
  dailyLimit: 5,
  /** Must match the customData the app sets on the RewardedAd request. */
  customData: "credits",
  /** AdMob retries failed callbacks; anything older than this is ignored. */
  maxCallbackAgeMs: 24 * 3_600_000,
  /** App-reported views closer together than this are refused (no video is shorter). */
  minGapMs: 15_000,
} as const;

/** Weighted pick. Runs on the server only — the client never sees the table. */
export function pickWeighted(segments: Array<{ credits: number; weight: number }>): number {
  const total = segments.reduce((s, x) => s + x.weight, 0);
  let roll = Math.random() * total;
  for (const seg of segments) {
    roll -= seg.weight;
    if (roll <= 0) return seg.credits;
  }
  return segments[0]?.credits ?? 0;
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export type LedgerType =
  | "signup_grant"
  | "bet_stake"
  | "bet_payout"
  | "bet_refund"
  | "prize_box"
  | "purchase"
  | "league_buy_in"
  | "league_refund"
  | "league_payout"
  | "ad_reward"
  | "challenge_escrow"
  | "challenge_payout"
  | "challenge_refund"
  | "admin_adjust"
  | "dev_grant"
  | "level_reward"
  | "referral_bonus"
  | "gift"
  | "friend_transfer"
  | "friend_loan"
  | "win_back"
  | "tutorial_gift"
  | "birthday_gift"
  | "flash_pick"
  | "streak_wager"
  | "tail_bonus";

export interface LedgerEntry {
  type: LedgerType;
  delta: number;
  balanceAfter: number;
  ref?: string;
  note?: string;
  createdAt: FirebaseFirestore.FieldValue;
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
export async function applyCredits(
  tx: Tx,
  uid: string,
  args: {
    delta: number;
    type: LedgerType;
    idempotencyKey: string;
    ref?: string;
    note?: string;
  }
): Promise<number | null> {
  const userRef = db.collection("users").doc(uid);
  const ledgerRef = userRef.collection("ledger").doc(args.idempotencyKey);

  const [userSnap, ledgerSnap] = await Promise.all([tx.get(userRef), tx.get(ledgerRef)]);

  if (ledgerSnap.exists) return null; // already applied
  if (!userSnap.exists) throw new HttpsError("not-found", "Profile not found.");

  const current = (userSnap.get("balance") as number | undefined) ?? 0;
  const next = current + args.delta;

  if (next < 0) {
    throw new HttpsError("failed-precondition", "Not enough credits.");
  }

  tx.update(userRef, { balance: next, updatedAt: FieldValue.serverTimestamp() });
  tx.set(ledgerRef, {
    type: args.type,
    delta: args.delta,
    balanceAfter: next,
    ref: args.ref ?? null,
    note: args.note ?? null,
    createdAt: FieldValue.serverTimestamp(),
  });

  return next;
}

export interface CreditMove {
  uid: string;
  delta: number;
  type: LedgerType;
  idempotencyKey: string;
  ref?: string;
  note?: string;
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
export async function applyCreditsMany(tx: Tx, moves: CreditMove[]): Promise<Record<string, number | null>> {
  const uids = [...new Set(moves.map((m) => m.uid))];
  const userRefs = uids.map((u) => db.collection("users").doc(u));
  const live = moves.filter((m) => m.delta !== 0);
  const ledgerRefs = live.map((m) => db.collection("users").doc(m.uid).collection("ledger").doc(m.idempotencyKey));

  const userSnaps = await Promise.all(userRefs.map((r) => tx.get(r)));
  const ledgerSnaps = await Promise.all(ledgerRefs.map((r) => tx.get(r)));

  const balances: Record<string, number | null> = {};
  uids.forEach((u, i) => {
    const snap = userSnaps[i]!;
    balances[u] = snap.exists ? ((snap.get("balance") as number | undefined) ?? 0) : null;
  });

  const rows: Array<{ ref: FirebaseFirestore.DocumentReference; move: CreditMove; after: number }> = [];
  const touched = new Set<string>();
  live.forEach((m, i) => {
    if (ledgerSnaps[i]!.exists) return; // already applied
    const current = balances[m.uid];
    if (current === null || current === undefined) throw new HttpsError("not-found", "Profile not found.");
    const next = current + m.delta;
    if (next < 0) throw new HttpsError("failed-precondition", "Not enough credits.");
    balances[m.uid] = next;
    touched.add(m.uid);
    rows.push({ ref: ledgerRefs[i]!, move: m, after: next });
  });

  for (const u of touched) {
    tx.update(db.collection("users").doc(u), { balance: balances[u], updatedAt: FieldValue.serverTimestamp() });
  }
  for (const { ref, move, after } of rows) {
    tx.set(ref, {
      type: move.type,
      delta: move.delta,
      balanceAfter: after,
      ref: move.ref ?? null,
      note: move.note ?? null,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  return balances;
}

/** Canonical, order-independent friendship id. Makes duplicates impossible. */
export function pairId(a: string, b: string): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

export function requireAuth(auth: { uid?: string } | undefined): string {
  const uid = auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  return uid;
}
