"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveAppearance = exports.AvatarSchema = void 0;
exports.equipOne = equipOne;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const avatarRules_1 = require("../lib/avatarRules");
const economy_1 = require("../lib/economy");
const SlotEnum = zod_1.z.enum(avatarRules_1.SLOTS);
/** Appearance from a client, validated against the shared rules. Rejects rather than repairs. */
exports.AvatarSchema = zod_1.z.unknown().transform((v, ctx) => {
    const errs = (0, avatarRules_1.appearanceErrors)(v);
    if (errs.length) {
        ctx.addIssue({ code: zod_1.z.ZodIssueCode.custom, message: `Invalid appearance: ${errs.join(", ")}` });
        return zod_1.z.NEVER;
    }
    return (0, avatarRules_1.sanitizeAppearance)(v);
});
const toItem = (id, data) => data
    ? {
        id,
        slot: data.slot,
        model: data.model ?? null,
        assetUrl: data.assetUrl ?? null,
        shape: data.shape ?? null,
        excludes: data.excludes ?? null,
    }
    : undefined;
function describe(a, b) {
    return `Your ${a} and ${b} can't be worn together.`;
}
function activePunishment(user) {
    const p = user.get("punishment");
    if (!p || !p.itemId || !p.slot || typeof p.expiresAt !== "number")
        return null;
    return p.expiresAt > Date.now() ? p : null;
}
/**
 * Saves a whole look — appearance and outfit — in one transaction. This is
 * what the character creator's Save button calls, so a look is never half
 * applied: either every piece is owned, fits its slot and is compatible, or
 * nothing is written.
 */
exports.saveAppearance = (0, https_1.onCall)({ region: "us-central1" }, async (req) => {
    const uid = (0, economy_1.requireAuth)(req.auth);
    const input = zod_1.z
        .object({
        avatar: exports.AvatarSchema,
        equipped: zod_1.z.record(SlotEnum, zod_1.z.string().min(1).max(80).nullable()),
    })
        .safeParse(req.data);
    if (!input.success) {
        throw new https_1.HttpsError("invalid-argument", input.error.issues[0]?.message ?? "Invalid look.");
    }
    const avatar = input.data.avatar;
    const equipped = {};
    for (const s of avatarRules_1.SLOTS) {
        const id = input.data.equipped[s];
        if (id)
            equipped[s] = id;
    }
    const userRef = economy_1.db.collection("users").doc(uid);
    const ids = [...new Set(Object.values(equipped))];
    await economy_1.db.runTransaction(async (tx) => {
        const [user, ...rest] = await Promise.all([
            tx.get(userRef),
            ...ids.map((id) => tx.get(userRef.collection("inventory").doc(id))),
            ...ids.map((id) => tx.get(economy_1.db.collection("catalog").doc(id))),
        ]);
        if (!user.exists)
            throw new https_1.HttpsError("failed-precondition", "Create your profile first.");
        const punishment = activePunishment(user);
        if (punishment && equipped[punishment.slot] !== punishment.itemId) {
            throw new https_1.HttpsError("failed-precondition", `Your last-place punishment (${punishment.leagueName ?? "league"}) is locked on for 7 days.`);
        }
        const owned = rest.slice(0, ids.length);
        const catalog = rest.slice(ids.length);
        const items = new Map();
        ids.forEach((id, i) => {
            if (!owned[i].exists)
                throw new https_1.HttpsError("permission-denied", "You don't own one of those items.");
            const item = toItem(id, catalog[i].data());
            if (!item)
                throw new https_1.HttpsError("failed-precondition", "One of those items is no longer in the store.");
            items.set(id, item);
        });
        for (const s of avatarRules_1.SLOTS) {
            const id = equipped[s];
            if (id && items.get(id).slot !== s) {
                throw new https_1.HttpsError("invalid-argument", "An item is in the wrong slot.");
            }
        }
        const clash = (0, avatarRules_1.outfitConflicts)(equipped, (id) => items.get(id))[0];
        if (clash)
            throw new https_1.HttpsError("failed-precondition", describe(clash[0], clash[1]));
        tx.update(userRef, { avatar, equipped, updatedAt: economy_1.FieldValue.serverTimestamp() });
    });
    return { ok: true, avatar, equipped };
});
/**
 * Equips or clears one slot. Ownership is checked server-side, and anything
 * the new item can't be worn with is taken off in the same write — the
 * result says which slots were cleared.
 */
async function equipOne(uid, slot, itemId) {
    const userRef = economy_1.db.collection("users").doc(uid);
    return economy_1.db.runTransaction(async (tx) => {
        const user = await tx.get(userRef);
        if (!user.exists)
            throw new https_1.HttpsError("failed-precondition", "Create your profile first.");
        const current = (user.get("equipped") ?? {});
        const punishment = activePunishment(user);
        if (punishment && punishment.slot === slot && itemId !== punishment.itemId) {
            throw new https_1.HttpsError("failed-precondition", `Your last-place punishment (${punishment.leagueName ?? "league"}) is locked on for 7 days.`);
        }
        if (itemId === null) {
            const next = (0, avatarRules_1.applyEquip)(current, slot, null, () => undefined).equipped;
            tx.update(userRef, { equipped: next, updatedAt: economy_1.FieldValue.serverTimestamp() });
            return { ok: true, removed: [], equipped: next };
        }
        const others = [...new Set(Object.values(current).filter((id) => !!id && id !== itemId))];
        const [owned, itemSnap, ...otherSnaps] = await Promise.all([
            tx.get(userRef.collection("inventory").doc(itemId)),
            tx.get(economy_1.db.collection("catalog").doc(itemId)),
            ...others.map((id) => tx.get(economy_1.db.collection("catalog").doc(id))),
        ]);
        if (!owned.exists)
            throw new https_1.HttpsError("permission-denied", "You don't own that item.");
        const item = toItem(itemId, itemSnap.data());
        if (!item)
            throw new https_1.HttpsError("failed-precondition", "That item is no longer in the store.");
        if (item.slot !== slot)
            throw new https_1.HttpsError("invalid-argument", "That item doesn't go in that slot.");
        const items = new Map([[itemId, item]]);
        others.forEach((id, i) => {
            const it = toItem(id, otherSnaps[i].data());
            if (it)
                items.set(id, it);
        });
        const { equipped, removed } = (0, avatarRules_1.applyEquip)(current, slot, itemId, (id) => items.get(id));
        if (punishment && removed.includes(punishment.slot)) {
            throw new https_1.HttpsError("failed-precondition", `Can't equip that while your last-place punishment is active.`);
        }
        tx.update(userRef, { equipped, updatedAt: economy_1.FieldValue.serverTimestamp() });
        return { ok: true, removed, equipped };
    });
}
//# sourceMappingURL=avatar.js.map