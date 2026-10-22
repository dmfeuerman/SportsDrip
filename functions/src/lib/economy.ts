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

export const STARTING_BALANCE = 1000;

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
  | "league_payout"
  | "admin_adjust";

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

/** Canonical, order-independent friendship id. Makes duplicates impossible. */
export function pairId(a: string, b: string): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

export function requireAuth(auth: { uid?: string } | undefined): string {
  const uid = auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");
  return uid;
}
