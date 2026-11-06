"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reactToItem = exports.REACTION_EMOJIS = void 0;
const https_1 = require("firebase-functions/v2/https");
const questProgress_1 = require("../lib/questProgress");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const notify_1 = require("../lib/notify");
const notifyModel_1 = require("../lib/notifyModel");
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
    const progressRef = (0, questProgress_1.questProgressRef)(uid);
    return economy_1.db.runTransaction(async (tx) => {
        const [league, item, progress] = await Promise.all([tx.get(leagueRef), tx.get(itemRef), tx.get(progressRef)]);
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
        // Social quest: a reaction added (not removed) on someone else's item.
        const itemOwner = item.get("uid");
        if (itemOwner && itemOwner !== uid && prev !== input.emoji) {
            const next = (0, questProgress_1.nextReactionProgress)(progress.exists ? progress.data() : undefined, `${input.leagueId}_${col}_${itemId}`);
            if (next)
                tx.set(progressRef, next, { merge: true });
        }
        // Deliver it: the owner hears about a new reaction. One notification per
        // item per hour; its id is fixed for the hour, so the first reaction
        // creates it (and pushes) and later ones only refresh the count in-app.
        const owner = item.get("uid");
        if (owner && owner !== uid && prev !== input.emoji) {
            const others = Object.keys(reactors).filter((r) => r !== owner);
            const name = league.get(`members.${uid}.displayName`) ?? "A league-mate";
            const hour = Math.floor(Date.now() / 3_600_000);
            const what = col === "messages" ? "your message" : col === "leagueBets" ? "your pick" : "your post";
            (0, notify_1.writeNotification)(tx, owner, (0, notifyModel_1.simpleNotification)({
                id: `react_${col}_${itemId}_${hour}`.slice(0, 120),
                type: "reaction",
                title: others.length > 1 ? `${name} + ${others.length - 1} other${others.length > 2 ? "s" : ""} ${input.emoji} ${what}` : `${name} ${input.emoji} ${what}`,
                body: league.get("name") ?? "League",
                leagueId: input.leagueId,
                leagueName: league.get("name") ?? null,
                wallet: "league",
                now: Date.now(),
                data: { leagueId: input.leagueId, targetType: col, targetId: itemId },
            }));
        }
        return { ok: true, reactions, reactors };
    });
});
//# sourceMappingURL=social.js.map