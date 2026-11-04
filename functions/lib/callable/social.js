"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reactToItem = exports.REACTION_EMOJIS = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
/**
 * Six fixed reaction emojis for league chat messages, feed activity rows,
 * and league bets. No free-text emoji picker.
 */
exports.REACTION_EMOJIS = ["🔥", "💀", "😂", "🧊", "🫡", "🤡"];
const ReactInput = zod_1.z
    .object({
    leagueId: zod_1.z.string().min(1),
    targetId: zod_1.z.string().min(1).nullish(),
    itemId: zod_1.z.string().min(1).nullish(),
    targetType: zod_1.z.enum(["message", "messages", "activity", "bet", "leagueBets"]).nullish(),
    kind: zod_1.z.enum(["message", "messages", "activity", "bet", "leagueBets"]).nullish(),
    collection: zod_1.z.enum(["message", "messages", "activity", "bet", "leagueBets"]).nullish(),
    emoji: zod_1.z.enum(exports.REACTION_EMOJIS),
})
    .refine((v) => !!(v.targetId || v.itemId), { message: "Target item id required." });
function resolveCollection(raw) {
    if (raw === "activity")
        return "activity";
    if (raw === "bet" || raw === "leagueBets")
        return "leagueBets";
    return "messages";
}
/**
 * Toggles or switches the caller's emoji reaction on a league message, feed
 * row, or bet. One active emoji per member per item; tapping the same emoji
 * removes it, tapping another switches it.
 */
exports.reactToItem = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = ReactInput.parse(req.data);
    const itemId = (input.targetId ?? input.itemId);
    const col = resolveCollection(input.targetType ?? input.kind ?? input.collection);
    const leagueRef = economy_1.db.collection("leagues").doc(input.leagueId);
    const itemRef = leagueRef.collection(col).doc(itemId);
    return economy_1.db.runTransaction(async (tx) => {
        const [league, item] = await Promise.all([tx.get(leagueRef), tx.get(itemRef)]);
        if (!league.exists)
            throw new https_1.HttpsError("not-found", "League not found.");
        const memberIds = league.get("memberIds") ?? [];
        if (!memberIds.includes(uid)) {
            throw new https_1.HttpsError("permission-denied", "You're not in this league.");
        }
        if (!item.exists)
            throw new https_1.HttpsError("not-found", "Item not found.");
        const reactions = { ...(item.get("reactions") ?? {}) };
        const reactors = { ...(item.get("reactors") ?? {}) };
        const prev = reactors[uid];
        if (prev === input.emoji) {
            delete reactors[uid];
            const nextCount = Math.max(0, (reactions[input.emoji] ?? 1) - 1);
            if (nextCount === 0)
                delete reactions[input.emoji];
            else
                reactions[input.emoji] = nextCount;
        }
        else {
            if (prev) {
                const prevCount = Math.max(0, (reactions[prev] ?? 1) - 1);
                if (prevCount === 0)
                    delete reactions[prev];
                else
                    reactions[prev] = prevCount;
            }
            reactors[uid] = input.emoji;
            reactions[input.emoji] = (reactions[input.emoji] ?? 0) + 1;
        }
        tx.update(itemRef, { reactions, reactors });
        return { ok: true, reactions, reactors };
    });
});
//# sourceMappingURL=social.js.map