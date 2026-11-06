"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitBracket = void 0;
exports.settleBracketsForGame = settleBracketsForGame;
const https_1 = require("firebase-functions/v2/https");
const firebase_functions_1 = require("firebase-functions");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const bracket_1 = require("../lib/bracket");
const templateOf = (d) => ({ ...d.data(), id: d.id });
/** Saves a member's bracket. Picks lock at the template's locksAt (first tip-off). */
exports.submitBracket = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = zod_1.z
        .object({
        leagueId: zod_1.z.string().min(1).max(64),
        picks: zod_1.z.record(zod_1.z.string().min(1).max(32), zod_1.z.string().min(1).max(12)).refine((p) => Object.keys(p).length <= 128, "Too many picks."),
    })
        .parse(req.data);
    const leagueRef = economy_1.db.collection("leagues").doc(input.leagueId);
    return economy_1.db.runTransaction(async (tx) => {
        const league = await tx.get(leagueRef);
        if (!league.exists)
            throw new https_1.HttpsError("not-found", "League not found.");
        if (league.get("mode") !== "bracket")
            throw new https_1.HttpsError("failed-precondition", "Not a bracket league.");
        if (!(league.get("memberIds") ?? []).includes(uid))
            throw new https_1.HttpsError("permission-denied", "You're not in this league.");
        const tid = league.get("bracketTemplateId");
        if (!tid)
            throw new https_1.HttpsError("failed-precondition", "No bracket set for this league yet.");
        const tpl = await tx.get(economy_1.db.collection("bracketTemplates").doc(tid));
        if (!tpl.exists)
            throw new https_1.HttpsError("not-found", "Bracket not found.");
        const t = templateOf(tpl);
        if (Date.now() >= t.locksAt)
            throw new https_1.HttpsError("failed-precondition", "Brackets are locked.");
        const picks = (0, bracket_1.sanitizePicks)(t, input.picks);
        tx.set(leagueRef.collection("brackets").doc(uid), { uid, templateId: tid, picks, points: 0, correct: 0, updatedAt: Date.now() });
        return { ok: true, picks: Object.keys(picks).length };
    });
});
/**
 * On a final game: record the slot winner on every template that maps the game,
 * then rescore each bracket league on that template (members.{uid}.pickPoints).
 */
async function settleBracketsForGame(gameId) {
    const game = await economy_1.db.collection("games").doc(gameId).get();
    if (!game.exists)
        return 0;
    const winner = (0, bracket_1.slotWinner)(game.data());
    if (!winner)
        return 0;
    const templates = await economy_1.db.collection("bracketTemplates").where("gameIds", "array-contains", gameId).limit(20).get();
    let rescored = 0;
    for (const tplDoc of templates.docs) {
        const t = templateOf(tplDoc);
        const slots = t.slots.filter((s) => s.gameId === gameId).map((s) => s.id);
        if (!slots.length)
            continue;
        await tplDoc.ref.update(Object.fromEntries(slots.map((s) => [`results.${s}`, winner])));
        const fresh = templateOf(await tplDoc.ref.get());
        const leagues = await economy_1.db.collection("leagues").where("bracketTemplateId", "==", t.id).where("status", "==", "active").limit(500).get();
        for (const l of leagues.docs) {
            try {
                const brackets = await l.ref.collection("brackets").get();
                const batch = economy_1.db.batch();
                const update = {};
                for (const b of brackets.docs) {
                    const s = (0, bracket_1.scoreBracket)(fresh, b.get("picks") ?? {});
                    batch.update(b.ref, { points: s.points, correct: s.correct });
                    update[`members.${b.id}.pickPoints`] = s.points;
                }
                if (Object.keys(update).length)
                    batch.update(l.ref, update);
                await batch.commit();
                rescored += brackets.size;
            }
            catch (err) {
                firebase_functions_1.logger.warn("bracket rescore failed", { leagueId: l.id, error: String(err) });
            }
        }
    }
    return rescored;
}
//# sourceMappingURL=brackets.js.map