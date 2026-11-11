import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { applyCreditsMany, db, FieldValue, pairId, requireAuth } from "../lib/economy";
import { writeNotification } from "../lib/notify";
import { simpleNotification } from "../lib/notifyModel";
import { levelFromXp } from "../lib/progression";
import { nyDay } from "../lib/streak";
import { accountAgeOk } from "./gifts";

/**
 * Credits between friends, outside leagues: straight transfers and friend loans.
 *
 * Moving credits between accounts invites alt-account farming, so both sides
 * must be friends, the sender's account must be a week old (same gate as
 * gifts), each send is capped, and a player can send at most
 * FRIEND_DAILY_SEND_CAP a day across transfers and loan fundings.
 *
 *   friendLoans/{id}  lenderUid, borrowerUid, amount, interestPct (flat, one-time),
 *                     owed, repaid, status: requested | offered | countered | active | repaid | declined | cancelled
 *
 * Every action also drops a card into the pair's DM thread.
 */
export const FRIEND_SEND_MIN = 10;
export const FRIEND_SEND_MAX = 5_000;
export const FRIEND_DAILY_SEND_CAP = 100_000;
export const FRIEND_LOAN_RATES = [0, 5, 10, 20] as const;
/** Sending credits (transfers, offering or funding a loan) unlocks at this level. */
export const FRIEND_SEND_LEVEL = 5;

type Tx = FirebaseFirestore.Transaction;
type Snap = FirebaseFirestore.DocumentSnapshot;

const fmt = (n: number) => n.toLocaleString("en-US");
export const loanOwed = (amount: number, pct: number) => amount + Math.round((amount * pct) / 100);

function dmRef(a: string, b: string, id: string) {
  return db.collection("directMessages").doc(`dm_${pairId(a, b)}`).collection("messages").doc(id);
}

/** A card in the DM thread. Server-written, so the rules' text-only create doesn't apply. */
function writeDm(
  tx: Tx,
  args: { id: string; from: string; fromName: string; to: string; toName: string; kind: "gift" | "money" | "loan"; text: string; now: number; extra: Record<string, unknown> }
) {
  const ref = dmRef(args.from, args.to, args.id);
  tx.set(ref, {
    id: args.id,
    threadId: ref.parent.parent!.id,
    senderUid: args.from,
    senderName: args.fromName,
    recipientUid: args.to,
    recipientName: args.toName,
    kind: args.kind,
    text: args.text,
    at: args.now,
    replyTo: null,
    createdAt: FieldValue.serverTimestamp(),
    ...args.extra,
  });
}
export { writeDm as writeFriendDm };

/** Both players exist and are friends. Returns their snapshots. */
async function friendPair(tx: Tx, me: string, other: string): Promise<{ meSnap: Snap; otherSnap: Snap }> {
  if (me === other) throw new HttpsError("invalid-argument", "Pick a friend, not yourself.");
  const [meSnap, otherSnap, friendship] = await Promise.all([
    tx.get(db.collection("users").doc(me)),
    tx.get(db.collection("users").doc(other)),
    tx.get(db.collection("friendships").doc(pairId(me, other))),
  ]);
  if (!meSnap.exists || !otherSnap.exists) throw new HttpsError("not-found", "That player doesn't exist.");
  if (!friendship.exists) throw new HttpsError("permission-denied", "You can only do this with friends.");
  return { meSnap, otherSnap };
}

function assertSenderLevel(sender: Snap) {
  if (levelFromXp(sender.get("xp")) < FRIEND_SEND_LEVEL) {
    throw new HttpsError("failed-precondition", `Sending credits unlocks at level ${FRIEND_SEND_LEVEL}.`);
  }
}

function assertSenderAge(sender: Snap, now: number) {
  assertSenderLevel(sender);
  const createdAt = sender.get("createdAt") as FirebaseFirestore.Timestamp | undefined;
  if (!accountAgeOk(createdAt ? createdAt.toMillis() : null, now)) {
    throw new HttpsError("failed-precondition", "Sending credits unlocks 7 days after you join.");
  }
}

/** Reads today's sent total; returns a writer that books `amount` against it. Call before any write. */
async function dailyAllowance(tx: Tx, uid: string, amount: number, now: number) {
  const ref = db.collection("users").doc(uid).collection("friendSends").doc(nyDay(now));
  const snap = await tx.get(ref);
  const sent = (snap.get("sent") as number | undefined) ?? 0;
  if (sent + amount > FRIEND_DAILY_SEND_CAP) {
    const left = Math.max(0, FRIEND_DAILY_SEND_CAP - sent);
    throw new HttpsError("resource-exhausted", `Daily send limit is ${fmt(FRIEND_DAILY_SEND_CAP)}. You can send ${fmt(left)} more today.`);
  }
  return () => tx.set(ref, { sent: sent + amount, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

/** True when this idempotency key was already booked (a retried call). Read before any write. */
async function alreadyDone(tx: Tx, uid: string, key: string) {
  return (await tx.get(db.collection("users").doc(uid).collection("ledger").doc(key))).exists;
}

const name = (s: Snap) => (s.get("displayName") as string | undefined) || "A friend";
const Amount = z.number().int().min(FRIEND_SEND_MIN).max(FRIEND_SEND_MAX);
const Key = z.string().min(8).max(64);
const Note = z.string().trim().max(140).optional();

/* ── transfers ─────────────────────────────────────────────────────────── */

export const sendCredits = onCall({ region: "us-central1" }, async (req) => {
  const from = requireAuth(req.auth);
  const { toUid, amount, note, idempotencyKey } = z.object({ toUid: z.string().min(1), amount: Amount, note: Note, idempotencyKey: Key }).parse(req.data);
  return db.runTransaction(async (tx) => {
    const now = Date.now();
    const { meSnap, otherSnap } = await friendPair(tx, from, toUid);
    assertSenderAge(meSnap, now);
    if (await alreadyDone(tx, from, `xfer_out_${idempotencyKey}`)) return { ok: true, duplicate: true, balance: null };
    const book = await dailyAllowance(tx, from, amount, now);
    const fromName = name(meSnap);
    const bal = await applyCreditsMany(tx, [
      { uid: from, delta: -amount, type: "friend_transfer", idempotencyKey: `xfer_out_${idempotencyKey}`, ref: toUid, note: `Sent to ${name(otherSnap)}` },
      { uid: toUid, delta: amount, type: "friend_transfer", idempotencyKey: `xfer_in_${idempotencyKey}`, ref: from, note: `From ${fromName}` },
    ]);
    const debit = bal[from] ?? null;
    book();
    writeDm(tx, { id: `money_${idempotencyKey}`, from, fromName, to: toUid, toName: name(otherSnap), kind: "money", text: note ? `Sent ${fmt(amount)} credits: ${note}` : `Sent ${fmt(amount)} credits`, now, extra: { amount } });
    writeNotification(tx, toUid, simpleNotification({ id: `xfer_${idempotencyKey}`, type: "credits_received", title: `${fromName} sent you ${fmt(amount)} credits`, body: note || "They're in your wallet.", now, delta: amount, data: { fromUid: from, fromName } }));
    return { ok: true, duplicate: false, balance: debit };
  });
});

/* ── loans ─────────────────────────────────────────────────────────────── */

const Rate = z.number().min(0).max(50);

/** Ask a friend to lend you credits (`toUid` is the lender). */
export const requestFriendLoan = onCall({ region: "us-central1" }, async (req) => {
  const me = requireAuth(req.auth);
  const { toUid, amount, interestPct, note } = z.object({ toUid: z.string().min(1), amount: Amount, interestPct: Rate, note: Note }).parse(req.data);
  return createLoan(me, toUid, { lender: toUid, borrower: me, amount, interestPct: Math.round(interestPct * 10) / 10, note: note ?? null, status: "requested" });
});

/** Offer to lend a friend credits (`toUid` is the borrower). Nothing moves until they accept. */
export const offerFriendLoan = onCall({ region: "us-central1" }, async (req) => {
  const me = requireAuth(req.auth);
  const { toUid, amount, interestPct, note } = z.object({ toUid: z.string().min(1), amount: Amount, interestPct: Rate, note: Note }).parse(req.data);
  return createLoan(me, toUid, { lender: me, borrower: toUid, amount, interestPct: Math.round(interestPct * 10) / 10, note: note ?? null, status: "offered" });
});

async function createLoan(me: string, other: string, l: { lender: string; borrower: string; amount: number; interestPct: number; note: string | null; status: "requested" | "offered" }) {
  const ref = db.collection("friendLoans").doc();
  return db.runTransaction(async (tx) => {
    const now = Date.now();
    const { meSnap, otherSnap } = await friendPair(tx, me, other);
    if (l.lender === me) assertSenderLevel(meSnap);
    const open = await tx.get(
      db.collection("friendLoans").where("pair", "==", pairId(me, other)).where("status", "in", ["requested", "offered", "countered", "active"]).limit(5)
    );
    if (open.size >= 3) throw new HttpsError("failed-precondition", "You already have 3 open loans with this friend.");
    const owed = loanOwed(l.amount, l.interestPct);
    const myName = name(meSnap);
    tx.set(ref, {
      id: ref.id,
      pair: pairId(me, other),
      parties: [l.lender, l.borrower],
      lenderUid: l.lender,
      borrowerUid: l.borrower,
      lenderName: l.lender === me ? myName : name(otherSnap),
      borrowerName: l.borrower === me ? myName : name(otherSnap),
      amount: l.amount,
      interestPct: l.interestPct,
      owed,
      repaid: 0,
      note: l.note,
      status: l.status,
      createdBy: me,
      lastTurnBy: me,
      lastTurnName: myName,
      createdAt: now,
      updatedAt: now,
    });
    const what = l.status === "requested" ? `Asked to borrow ${fmt(l.amount)}` : `Offered to lend ${fmt(l.amount)}`;
    writeDm(tx, { id: `loan_${ref.id}`, from: me, fromName: myName, to: other, toName: name(otherSnap), kind: "loan", text: `${what} at ${l.interestPct}% (pay back ${fmt(owed)})${l.note ? `: ${l.note}` : ""}`, now, extra: { loanId: ref.id, amount: l.amount } });
    writeNotification(
      tx,
      other,
      simpleNotification({
        id: `floan_${ref.id}`,
        type: l.status === "requested" ? "loan_request" : "loan_countered",
        title: l.status === "requested" ? `${myName} wants to borrow ${fmt(l.amount)}` : `${myName} offered you a ${fmt(l.amount)} loan`,
        body: `${l.interestPct}% flat. Pay back ${fmt(owed)}.`,
        now,
        data: { fromUid: me, fromName: myName, loanId: ref.id },
      })
    );
    return { ok: true, loanId: ref.id };
  });
}

/**
 * Answer, counter, or edit a friend loan inside chat:
 *  - `accept: true` (or `action: "accept"`): the party who didn't propose the latest turn accepts & funds it.
 *  - `accept: false` (or `action: "decline"` / `"cancel"`): declines or cancels the pending loan.
 *  - `action: "counter"` / `"edit"`: updates the rate, amount, and/or note and hands the turn to the other party
 *    (or edits your own pending proposal).
 */
export const respondFriendLoan = onCall({ region: "us-central1" }, async (req) => {
  const me = requireAuth(req.auth);
  const parsed = z
    .object({
      loanId: z.string().min(1),
      accept: z.boolean().optional(),
      action: z.enum(["accept", "decline", "cancel", "counter", "edit"]).optional(),
      amount: Amount.optional(),
      interestPct: Rate.optional(),
      note: Note,
    })
    .parse(req.data);

  const loanId = parsed.loanId;
  const ref = db.collection("friendLoans").doc(loanId);
  return db.runTransaction(async (tx) => {
    const now = Date.now();
    const loan = await tx.get(ref);
    if (!loan.exists) throw new HttpsError("not-found", "That loan is gone.");
    const status = loan.get("status") as string;
    const lender = loan.get("lenderUid") as string;
    const borrower = loan.get("borrowerUid") as string;
    const creator = loan.get("createdBy") as string;
    const lastTurnBy = (loan.get("lastTurnBy") as string | undefined) ?? creator;
    if (me !== lender && me !== borrower) throw new HttpsError("permission-denied", "Not your loan.");
    if (status !== "requested" && status !== "offered" && status !== "countered") {
      throw new HttpsError("failed-precondition", "This loan was already answered.");
    }
    const other = me === lender ? borrower : lender;
    const { meSnap, otherSnap } = await friendPair(tx, me, other);
    const curAmount = loan.get("amount") as number;
    const curRate = loan.get("interestPct") as number;
    const myName = name(meSnap);
    const otherName = name(otherSnap);

    const act = parsed.action ?? (parsed.accept === true ? "accept" : "decline");

    if (act === "counter" || act === "edit") {
      const nextAmount = parsed.amount ?? curAmount;
      const nextRate = parsed.interestPct !== undefined ? Math.round(parsed.interestPct * 10) / 10 : curRate;
      const nextOwed = loanOwed(nextAmount, nextRate);
      const nextNote = parsed.note !== undefined ? parsed.note || null : (loan.get("note") as string | null) ?? null;
      if (me === lender) assertSenderLevel(meSnap);
      const isCounter = me !== lastTurnBy;
      const nextStatus = isCounter ? "countered" : status;
      tx.update(ref, {
        amount: nextAmount,
        interestPct: nextRate,
        owed: nextOwed,
        note: nextNote,
        status: nextStatus,
        lastTurnBy: me,
        lastTurnName: myName,
        updatedAt: now,
      });
      const verb = isCounter ? "Countered loan terms" : "Updated loan terms";
      writeDm(tx, {
        id: `loan_${loanId}_turn_${now.toString(36)}`,
        from: me,
        fromName: myName,
        to: other,
        toName: otherName,
        kind: "loan",
        text: `${verb}: ${fmt(nextAmount)} credits at ${nextRate}% flat (pay back ${fmt(nextOwed)})${nextNote ? ` — "${nextNote}"` : ""}`,
        now,
        extra: { loanId, amount: nextAmount },
      });
      writeNotification(
        tx,
        other,
        simpleNotification({
          id: `floan_${loanId}_turn_${now.toString(36)}`,
          type: "loan_countered",
          title: isCounter ? `${myName} countered your loan` : `${myName} updated the loan terms`,
          body: `${fmt(nextAmount)} credits at ${nextRate}% flat (pay back ${fmt(nextOwed)}).`,
          now,
          data: { fromUid: me, fromName: myName, loanId },
        })
      );
      return { ok: true, status: nextStatus };
    }

    if (act === "cancel" || (act === "decline" && me === lastTurnBy && me === creator && status !== "countered")) {
      tx.update(ref, { status: "cancelled", updatedAt: now });
      return { ok: true, status: "cancelled" };
    }
    if (act === "decline") {
      tx.update(ref, { status: "declined", updatedAt: now });
      writeDm(tx, { id: `loan_${loanId}_declined`, from: me, fromName: myName, to: other, toName: otherName, kind: "loan", text: `Declined the ${fmt(curAmount)} loan`, now, extra: { loanId, amount: curAmount } });
      return { ok: true, status: "declined" };
    }

    // Accepting: must be the party responding to the latest turn
    if (me === lastTurnBy) {
      throw new HttpsError("failed-precondition", "Waiting on your friend to answer your latest offer.");
    }

    const amount = curAmount;
    const owed = loan.get("owed") as number;

    // Funding is a send from the lender: same age gate and daily cap as transfers.
    const lenderSnap = me === lender ? meSnap : otherSnap;
    assertSenderAge(lenderSnap, now);
    const book = await dailyAllowance(tx, lender, amount, now);
    const bal = await applyCreditsMany(tx, [
      { uid: lender, delta: -amount, type: "friend_loan", idempotencyKey: `floan_out_${loanId}`, ref: loanId, note: `Loan to ${name(me === lender ? otherSnap : meSnap)}` },
      { uid: borrower, delta: amount, type: "friend_loan", idempotencyKey: `floan_in_${loanId}`, ref: loanId, note: `Loan from ${name(lenderSnap)}` },
    ]);
    const borrowerBal = bal[borrower] ?? null;
    book();
    tx.update(ref, { status: "active", fundedAt: now, updatedAt: now });
    writeDm(tx, { id: `loan_${loanId}_funded`, from: me, fromName: myName, to: other, toName: otherName, kind: "loan", text: `Loan accepted: ${fmt(amount)} sent, ${fmt(owed)} to pay back`, now, extra: { loanId, amount } });
    writeNotification(
      tx,
      other,
      simpleNotification({
        id: `floan_${loanId}_funded`,
        type: "loan_funded",
        title: `${myName} accepted your loan`,
        body: me === lender ? `${fmt(amount)} credits are in your wallet. Pay back ${fmt(owed)}.` : `${fmt(amount)} sent. They owe you ${fmt(owed)}.`,
        now,
        delta: other === borrower ? amount : -amount,
        balanceAfter: other === borrower ? borrowerBal : null,
        data: { fromUid: me, fromName: myName, loanId },
      })
    );
    return { ok: true, status: "active" };
  });
});

/** Borrower pays back some or all of what's left. Repayments don't count toward the send cap. */
export const repayFriendLoan = onCall({ region: "us-central1" }, async (req) => {
  const me = requireAuth(req.auth);
  const { loanId, amount, idempotencyKey } = z.object({ loanId: z.string().min(1), amount: z.number().int().min(1), idempotencyKey: Key }).parse(req.data);
  const ref = db.collection("friendLoans").doc(loanId);
  return db.runTransaction(async (tx) => {
    const now = Date.now();
    const loan = await tx.get(ref);
    if (!loan.exists) throw new HttpsError("not-found", "That loan is gone.");
    if (loan.get("borrowerUid") !== me) throw new HttpsError("permission-denied", "Only the borrower repays.");
    if (loan.get("status") !== "active") throw new HttpsError("failed-precondition", "This loan isn't open.");
    const lender = loan.get("lenderUid") as string;
    const { meSnap, otherSnap } = await friendPair(tx, me, lender).catch(async () => {
      // Unfriending doesn't cancel a debt: repay still works.
      const [a, b] = await Promise.all([tx.get(db.collection("users").doc(me)), tx.get(db.collection("users").doc(lender))]);
      return { meSnap: a, otherSnap: b };
    });
    const owed = loan.get("owed") as number;
    const repaid = (loan.get("repaid") as number) ?? 0;
    const pay = Math.min(amount, owed - repaid);
    if (pay <= 0) throw new HttpsError("failed-precondition", "Nothing left to repay.");
    if (await alreadyDone(tx, me, `floan_pay_${idempotencyKey}`)) return { ok: true, duplicate: true, balance: null };
    const bals = await applyCreditsMany(tx, [
      { uid: me, delta: -pay, type: "friend_loan", idempotencyKey: `floan_pay_${idempotencyKey}`, ref: loanId, note: `Repay ${name(otherSnap)}` },
      { uid: lender, delta: pay, type: "friend_loan", idempotencyKey: `floan_got_${idempotencyKey}`, ref: loanId, note: `Repaid by ${name(meSnap)}` },
    ]);
    const bal = bals[me] ?? null;
    const done = repaid + pay >= owed;
    tx.update(ref, { repaid: repaid + pay, status: done ? "repaid" : "active", updatedAt: now, ...(done ? { repaidAt: now } : {}) });
    const myName = name(meSnap);
    writeDm(tx, { id: `loan_${loanId}_pay_${idempotencyKey}`.slice(0, 64), from: me, fromName: myName, to: lender, toName: name(otherSnap), kind: "loan", text: done ? `Paid back ${fmt(pay)}. Loan cleared ✅` : `Paid back ${fmt(pay)} (${fmt(owed - repaid - pay)} left)`, now, extra: { loanId, amount: pay } });
    writeNotification(tx, lender, simpleNotification({ id: `floan_${loanId}_pay_${idempotencyKey}`, type: "loan_repaid", title: `${myName} paid you back ${fmt(pay)}`, body: done ? "Loan cleared." : `${fmt(owed - repaid - pay)} still owed.`, now, delta: pay, data: { fromUid: me, fromName: myName, loanId } }));
    return { ok: true, duplicate: false, balance: bal, status: done ? "repaid" : "active" };
  });
});
