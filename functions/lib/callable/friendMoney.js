"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.repayFriendLoan = exports.respondFriendLoan = exports.offerFriendLoan = exports.requestFriendLoan = exports.sendCredits = exports.loanOwed = exports.FRIEND_SEND_LEVEL = exports.FRIEND_LOAN_RATES = exports.FRIEND_DAILY_SEND_CAP = exports.FRIEND_SEND_MAX = exports.FRIEND_SEND_MIN = void 0;
exports.writeFriendDm = writeDm;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const notify_1 = require("../lib/notify");
const notifyModel_1 = require("../lib/notifyModel");
const progression_1 = require("../lib/progression");
const streak_1 = require("../lib/streak");
const gifts_1 = require("./gifts");
/**
 * Credits between friends, outside leagues: straight transfers and friend loans.
 *
 * Moving credits between accounts invites alt-account farming, so both sides
 * must be friends, the sender's account must be a week old (same gate as
 * gifts), each send is capped, and a player can send at most
 * FRIEND_DAILY_SEND_CAP a day across transfers and loan fundings.
 *
 *   friendLoans/{id}  lenderUid, borrowerUid, amount, interestPct (flat, one-time),
 *                     owed, repaid, status: requested | offered | active | repaid | declined | cancelled
 *
 * Every action also drops a card into the pair's DM thread.
 */
exports.FRIEND_SEND_MIN = 10;
exports.FRIEND_SEND_MAX = 5_000;
exports.FRIEND_DAILY_SEND_CAP = 10_000;
exports.FRIEND_LOAN_RATES = [0, 5, 10, 20];
/** Sending credits (transfers, offering or funding a loan) unlocks at this level. */
exports.FRIEND_SEND_LEVEL = 5;
const fmt = (n) => n.toLocaleString("en-US");
const loanOwed = (amount, pct) => amount + Math.round((amount * pct) / 100);
exports.loanOwed = loanOwed;
function dmRef(a, b, id) {
    return economy_1.db.collection("directMessages").doc(`dm_${(0, economy_1.pairId)(a, b)}`).collection("messages").doc(id);
}
/** A card in the DM thread. Server-written, so the rules' text-only create doesn't apply. */
function writeDm(tx, args) {
    const ref = dmRef(args.from, args.to, args.id);
    tx.set(ref, {
        id: args.id,
        threadId: ref.parent.parent.id,
        senderUid: args.from,
        senderName: args.fromName,
        recipientUid: args.to,
        recipientName: args.toName,
        kind: args.kind,
        text: args.text,
        at: args.now,
        replyTo: null,
        createdAt: economy_1.FieldValue.serverTimestamp(),
        ...args.extra,
    });
}
/** Both players exist and are friends. Returns their snapshots. */
async function friendPair(tx, me, other) {
    if (me === other)
        throw new https_1.HttpsError("invalid-argument", "Pick a friend, not yourself.");
    const [meSnap, otherSnap, friendship] = await Promise.all([
        tx.get(economy_1.db.collection("users").doc(me)),
        tx.get(economy_1.db.collection("users").doc(other)),
        tx.get(economy_1.db.collection("friendships").doc((0, economy_1.pairId)(me, other))),
    ]);
    if (!meSnap.exists || !otherSnap.exists)
        throw new https_1.HttpsError("not-found", "That player doesn't exist.");
    if (!friendship.exists)
        throw new https_1.HttpsError("permission-denied", "You can only do this with friends.");
    return { meSnap, otherSnap };
}
function assertSenderLevel(sender) {
    if ((0, progression_1.levelFromXp)(sender.get("xp")) < exports.FRIEND_SEND_LEVEL) {
        throw new https_1.HttpsError("failed-precondition", `Sending credits unlocks at level ${exports.FRIEND_SEND_LEVEL}.`);
    }
}
function assertSenderAge(sender, now) {
    assertSenderLevel(sender);
    const createdAt = sender.get("createdAt");
    if (!(0, gifts_1.accountAgeOk)(createdAt ? createdAt.toMillis() : null, now)) {
        throw new https_1.HttpsError("failed-precondition", "Sending credits unlocks 7 days after you join.");
    }
}
/** Reads today's sent total; returns a writer that books `amount` against it. Call before any write. */
async function dailyAllowance(tx, uid, amount, now) {
    const ref = economy_1.db.collection("users").doc(uid).collection("friendSends").doc((0, streak_1.nyDay)(now));
    const snap = await tx.get(ref);
    const sent = snap.get("sent") ?? 0;
    if (sent + amount > exports.FRIEND_DAILY_SEND_CAP) {
        const left = Math.max(0, exports.FRIEND_DAILY_SEND_CAP - sent);
        throw new https_1.HttpsError("resource-exhausted", `Daily send limit is ${fmt(exports.FRIEND_DAILY_SEND_CAP)}. You can send ${fmt(left)} more today.`);
    }
    return () => tx.set(ref, { sent: sent + amount, updatedAt: economy_1.FieldValue.serverTimestamp() }, { merge: true });
}
/** True when this idempotency key was already booked (a retried call). Read before any write. */
async function alreadyDone(tx, uid, key) {
    return (await tx.get(economy_1.db.collection("users").doc(uid).collection("ledger").doc(key))).exists;
}
const name = (s) => s.get("displayName") || "A friend";
const Amount = zod_1.z.number().int().min(exports.FRIEND_SEND_MIN).max(exports.FRIEND_SEND_MAX);
const Key = zod_1.z.string().min(8).max(64);
const Note = zod_1.z.string().trim().max(140).optional();
/* ── transfers ─────────────────────────────────────────────────────────── */
exports.sendCredits = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const from = (0, economy_1.requireAuth)(req.auth);
    const { toUid, amount, note, idempotencyKey } = zod_1.z.object({ toUid: zod_1.z.string().min(1), amount: Amount, note: Note, idempotencyKey: Key }).parse(req.data);
    return economy_1.db.runTransaction(async (tx) => {
        const now = Date.now();
        const { meSnap, otherSnap } = await friendPair(tx, from, toUid);
        assertSenderAge(meSnap, now);
        if (await alreadyDone(tx, from, `xfer_out_${idempotencyKey}`))
            return { ok: true, duplicate: true, balance: null };
        const book = await dailyAllowance(tx, from, amount, now);
        const fromName = name(meSnap);
        const bal = await (0, economy_1.applyCreditsMany)(tx, [
            { uid: from, delta: -amount, type: "friend_transfer", idempotencyKey: `xfer_out_${idempotencyKey}`, ref: toUid, note: `Sent to ${name(otherSnap)}` },
            { uid: toUid, delta: amount, type: "friend_transfer", idempotencyKey: `xfer_in_${idempotencyKey}`, ref: from, note: `From ${fromName}` },
        ]);
        const debit = bal[from] ?? null;
        book();
        writeDm(tx, { id: `money_${idempotencyKey}`, from, fromName, to: toUid, toName: name(otherSnap), kind: "money", text: note ? `Sent ${fmt(amount)} credits: ${note}` : `Sent ${fmt(amount)} credits`, now, extra: { amount } });
        (0, notify_1.writeNotification)(tx, toUid, (0, notifyModel_1.simpleNotification)({ id: `xfer_${idempotencyKey}`, type: "credits_received", title: `${fromName} sent you ${fmt(amount)} credits`, body: note || "They're in your wallet.", now, delta: amount, data: { fromUid: from, fromName } }));
        return { ok: true, duplicate: false, balance: debit };
    });
});
/* ── loans ─────────────────────────────────────────────────────────────── */
const Rate = zod_1.z.number().int().refine((n) => exports.FRIEND_LOAN_RATES.includes(n), "Pick a listed rate.");
/** Ask a friend to lend you credits (`toUid` is the lender). */
exports.requestFriendLoan = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const me = (0, economy_1.requireAuth)(req.auth);
    const { toUid, amount, interestPct, note } = zod_1.z.object({ toUid: zod_1.z.string().min(1), amount: Amount, interestPct: Rate, note: Note }).parse(req.data);
    return createLoan(me, toUid, { lender: toUid, borrower: me, amount, interestPct, note: note ?? null, status: "requested" });
});
/** Offer to lend a friend credits (`toUid` is the borrower). Nothing moves until they accept. */
exports.offerFriendLoan = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const me = (0, economy_1.requireAuth)(req.auth);
    const { toUid, amount, interestPct, note } = zod_1.z.object({ toUid: zod_1.z.string().min(1), amount: Amount, interestPct: Rate, note: Note }).parse(req.data);
    return createLoan(me, toUid, { lender: me, borrower: toUid, amount, interestPct, note: note ?? null, status: "offered" });
});
async function createLoan(me, other, l) {
    const ref = economy_1.db.collection("friendLoans").doc();
    return economy_1.db.runTransaction(async (tx) => {
        const now = Date.now();
        const { meSnap, otherSnap } = await friendPair(tx, me, other);
        if (l.lender === me)
            assertSenderLevel(meSnap);
        const open = await tx.get(economy_1.db.collection("friendLoans").where("pair", "==", (0, economy_1.pairId)(me, other)).where("status", "in", ["requested", "offered", "active"]).limit(5));
        if (open.size >= 3)
            throw new https_1.HttpsError("failed-precondition", "You already have 3 open loans with this friend.");
        const owed = (0, exports.loanOwed)(l.amount, l.interestPct);
        const myName = name(meSnap);
        tx.set(ref, {
            id: ref.id,
            pair: (0, economy_1.pairId)(me, other),
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
            createdAt: now,
            updatedAt: now,
        });
        const what = l.status === "requested" ? `Asked to borrow ${fmt(l.amount)}` : `Offered to lend ${fmt(l.amount)}`;
        writeDm(tx, { id: `loan_${ref.id}`, from: me, fromName: myName, to: other, toName: name(otherSnap), kind: "loan", text: `${what} at ${l.interestPct}% (pay back ${fmt(owed)})${l.note ? `: ${l.note}` : ""}`, now, extra: { loanId: ref.id, amount: l.amount } });
        (0, notify_1.writeNotification)(tx, other, (0, notifyModel_1.simpleNotification)({
            id: `floan_${ref.id}`,
            type: l.status === "requested" ? "loan_request" : "loan_countered",
            title: l.status === "requested" ? `${myName} wants to borrow ${fmt(l.amount)}` : `${myName} offered you a ${fmt(l.amount)} loan`,
            body: `${l.interestPct}% flat. Pay back ${fmt(owed)}.`,
            now,
            data: { fromUid: me, fromName: myName, loanId: ref.id },
        }));
        return { ok: true, loanId: ref.id };
    });
}
/**
 * Answer a loan. The other party accepts or declines; the creator can cancel
 * (accept: false) while it's still pending. Accepting funds it: lender → borrower.
 */
exports.respondFriendLoan = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const me = (0, economy_1.requireAuth)(req.auth);
    const { loanId, accept } = zod_1.z.object({ loanId: zod_1.z.string().min(1), accept: zod_1.z.boolean() }).parse(req.data);
    const ref = economy_1.db.collection("friendLoans").doc(loanId);
    return economy_1.db.runTransaction(async (tx) => {
        const now = Date.now();
        const loan = await tx.get(ref);
        if (!loan.exists)
            throw new https_1.HttpsError("not-found", "That loan is gone.");
        const status = loan.get("status");
        const lender = loan.get("lenderUid");
        const borrower = loan.get("borrowerUid");
        const creator = loan.get("createdBy");
        if (me !== lender && me !== borrower)
            throw new https_1.HttpsError("permission-denied", "Not your loan.");
        if (status !== "requested" && status !== "offered")
            throw new https_1.HttpsError("failed-precondition", "This loan was already answered.");
        const other = me === lender ? borrower : lender;
        const { meSnap, otherSnap } = await friendPair(tx, me, other);
        const amount = loan.get("amount");
        const owed = loan.get("owed");
        const myName = name(meSnap);
        if (me === creator) {
            if (accept)
                throw new https_1.HttpsError("failed-precondition", "Waiting on your friend to answer.");
            tx.update(ref, { status: "cancelled", updatedAt: now });
            return { ok: true, status: "cancelled" };
        }
        if (!accept) {
            tx.update(ref, { status: "declined", updatedAt: now });
            writeDm(tx, { id: `loan_${loanId}_declined`, from: me, fromName: myName, to: other, toName: name(otherSnap), kind: "loan", text: `Declined the ${fmt(amount)} loan`, now, extra: { loanId, amount } });
            return { ok: true, status: "declined" };
        }
        // Funding is a send from the lender: same age gate and daily cap as transfers.
        const lenderSnap = me === lender ? meSnap : otherSnap;
        assertSenderAge(lenderSnap, now);
        const book = await dailyAllowance(tx, lender, amount, now);
        const bal = await (0, economy_1.applyCreditsMany)(tx, [
            { uid: lender, delta: -amount, type: "friend_loan", idempotencyKey: `floan_out_${loanId}`, ref: loanId, note: `Loan to ${name(me === lender ? otherSnap : meSnap)}` },
            { uid: borrower, delta: amount, type: "friend_loan", idempotencyKey: `floan_in_${loanId}`, ref: loanId, note: `Loan from ${name(lenderSnap)}` },
        ]);
        const borrowerBal = bal[borrower] ?? null;
        book();
        tx.update(ref, { status: "active", fundedAt: now, updatedAt: now });
        writeDm(tx, { id: `loan_${loanId}_funded`, from: me, fromName: myName, to: other, toName: name(otherSnap), kind: "loan", text: `Loan accepted: ${fmt(amount)} sent, ${fmt(owed)} to pay back`, now, extra: { loanId, amount } });
        (0, notify_1.writeNotification)(tx, other, (0, notifyModel_1.simpleNotification)({
            id: `floan_${loanId}_funded`,
            type: "loan_funded",
            title: `${myName} accepted your loan`,
            body: me === lender ? `${fmt(amount)} credits are in your wallet. Pay back ${fmt(owed)}.` : `${fmt(amount)} sent. They owe you ${fmt(owed)}.`,
            now,
            delta: other === borrower ? amount : -amount,
            balanceAfter: other === borrower ? borrowerBal : null,
            data: { fromUid: me, fromName: myName, loanId },
        }));
        return { ok: true, status: "active" };
    });
});
/** Borrower pays back some or all of what's left. Repayments don't count toward the send cap. */
exports.repayFriendLoan = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const me = (0, economy_1.requireAuth)(req.auth);
    const { loanId, amount, idempotencyKey } = zod_1.z.object({ loanId: zod_1.z.string().min(1), amount: zod_1.z.number().int().min(1), idempotencyKey: Key }).parse(req.data);
    const ref = economy_1.db.collection("friendLoans").doc(loanId);
    return economy_1.db.runTransaction(async (tx) => {
        const now = Date.now();
        const loan = await tx.get(ref);
        if (!loan.exists)
            throw new https_1.HttpsError("not-found", "That loan is gone.");
        if (loan.get("borrowerUid") !== me)
            throw new https_1.HttpsError("permission-denied", "Only the borrower repays.");
        if (loan.get("status") !== "active")
            throw new https_1.HttpsError("failed-precondition", "This loan isn't open.");
        const lender = loan.get("lenderUid");
        const { meSnap, otherSnap } = await friendPair(tx, me, lender).catch(async () => {
            // Unfriending doesn't cancel a debt: repay still works.
            const [a, b] = await Promise.all([tx.get(economy_1.db.collection("users").doc(me)), tx.get(economy_1.db.collection("users").doc(lender))]);
            return { meSnap: a, otherSnap: b };
        });
        const owed = loan.get("owed");
        const repaid = loan.get("repaid") ?? 0;
        const pay = Math.min(amount, owed - repaid);
        if (pay <= 0)
            throw new https_1.HttpsError("failed-precondition", "Nothing left to repay.");
        if (await alreadyDone(tx, me, `floan_pay_${idempotencyKey}`))
            return { ok: true, duplicate: true, balance: null };
        const bals = await (0, economy_1.applyCreditsMany)(tx, [
            { uid: me, delta: -pay, type: "friend_loan", idempotencyKey: `floan_pay_${idempotencyKey}`, ref: loanId, note: `Repay ${name(otherSnap)}` },
            { uid: lender, delta: pay, type: "friend_loan", idempotencyKey: `floan_got_${idempotencyKey}`, ref: loanId, note: `Repaid by ${name(meSnap)}` },
        ]);
        const bal = bals[me] ?? null;
        const done = repaid + pay >= owed;
        tx.update(ref, { repaid: repaid + pay, status: done ? "repaid" : "active", updatedAt: now, ...(done ? { repaidAt: now } : {}) });
        const myName = name(meSnap);
        writeDm(tx, { id: `loan_${loanId}_pay_${idempotencyKey}`.slice(0, 64), from: me, fromName: myName, to: lender, toName: name(otherSnap), kind: "loan", text: done ? `Paid back ${fmt(pay)}. Loan cleared ✅` : `Paid back ${fmt(pay)} (${fmt(owed - repaid - pay)} left)`, now, extra: { loanId, amount: pay } });
        (0, notify_1.writeNotification)(tx, lender, (0, notifyModel_1.simpleNotification)({ id: `floan_${loanId}_pay_${idempotencyKey}`, type: "loan_repaid", title: `${myName} paid you back ${fmt(pay)}`, body: done ? "Loan cleared." : `${fmt(owed - repaid - pay)} still owed.`, now, delta: pay, data: { fromUid: me, fromName: myName, loanId } }));
        return { ok: true, duplicate: false, balance: bal, status: done ? "repaid" : "active" };
    });
});
//# sourceMappingURL=friendMoney.js.map