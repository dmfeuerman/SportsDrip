import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  appearanceErrors,
  applyEquip,
  outfitConflicts,
  sanitizeAppearance,
  SLOTS,
  type Equipped,
  type ItemLike,
  type Slot,
} from "../lib/avatarRules";
import { db, FieldValue, requireAuth } from "../lib/economy";

const SlotEnum = z.enum(SLOTS as [Slot, ...Slot[]]);

/** Appearance from a client, validated against the shared rules. Rejects rather than repairs. */
export const AvatarSchema = z.unknown().transform((v, ctx) => {
  const errs = appearanceErrors(v);
  if (errs.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid appearance: ${errs.join(", ")}` });
    return z.NEVER;
  }
  return sanitizeAppearance(v);
});

const toItem = (id: string, data: FirebaseFirestore.DocumentData | undefined): ItemLike | undefined =>
  data
    ? {
        id,
        slot: data.slot as Slot,
        model: (data.model as string | null | undefined) ?? null,
        assetUrl: (data.assetUrl as string | null | undefined) ?? null,
        shape: (data.shape as string | null | undefined) ?? null,
        excludes: (data.excludes as Slot[] | null | undefined) ?? null,
      }
    : undefined;

function describe(a: Slot, b: Slot) {
  return `Your ${a} and ${b} can't be worn together.`;
}

interface PunishmentLock {
  itemId: string;
  slot: Slot;
  expiresAt: number;
  leagueName?: string;
}

function activePunishment(user: FirebaseFirestore.DocumentSnapshot): PunishmentLock | null {
  const p = user.get("punishment") as PunishmentLock | undefined;
  if (!p || !p.itemId || !p.slot || typeof p.expiresAt !== "number") return null;
  return p.expiresAt > Date.now() ? p : null;
}

/**
 * Saves a whole look — appearance and outfit — in one transaction. This is
 * what the character creator's Save button calls, so a look is never half
 * applied: either every piece is owned, fits its slot and is compatible, or
 * nothing is written.
 */
export const saveAppearance = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = z
    .object({
      avatar: AvatarSchema,
      equipped: z.record(SlotEnum, z.string().min(1).max(80).nullable()),
    })
    .safeParse(req.data);
  if (!input.success) {
    throw new HttpsError("invalid-argument", input.error.issues[0]?.message ?? "Invalid look.");
  }
  const avatar = input.data.avatar;
  const equipped: Equipped = {};
  for (const s of SLOTS) {
    const id = input.data.equipped[s];
    if (id) equipped[s] = id;
  }

  const userRef = db.collection("users").doc(uid);
  const ids = [...new Set(Object.values(equipped))] as string[];

  await db.runTransaction(async (tx) => {
    const [user, ...rest] = await Promise.all([
      tx.get(userRef),
      ...ids.map((id) => tx.get(userRef.collection("inventory").doc(id))),
      ...ids.map((id) => tx.get(db.collection("catalog").doc(id))),
    ]);
    if (!user.exists) throw new HttpsError("failed-precondition", "Create your profile first.");

    const punishment = activePunishment(user);
    if (punishment && equipped[punishment.slot] !== punishment.itemId) {
      throw new HttpsError(
        "failed-precondition",
        `Your last-place punishment (${punishment.leagueName ?? "league"}) is locked on for 7 days.`
      );
    }

    const owned = rest.slice(0, ids.length);
    const catalog = rest.slice(ids.length);
    const items = new Map<string, ItemLike>();

    ids.forEach((id, i) => {
      if (!owned[i]!.exists) throw new HttpsError("permission-denied", "You don't own one of those items.");
      const item = toItem(id, catalog[i]!.data());
      if (!item) throw new HttpsError("failed-precondition", "One of those items is no longer in the store.");
      items.set(id, item);
    });
    for (const s of SLOTS) {
      const id = equipped[s];
      if (id && items.get(id)!.slot !== s) {
        throw new HttpsError("invalid-argument", "An item is in the wrong slot.");
      }
    }
    const clash = outfitConflicts(equipped, (id) => items.get(id))[0];
    if (clash) throw new HttpsError("failed-precondition", describe(clash[0], clash[1]));

    tx.update(userRef, { avatar, equipped, updatedAt: FieldValue.serverTimestamp() });
  });

  return { ok: true as const, avatar, equipped };
});

/**
 * Equips or clears one slot. Ownership is checked server-side, and anything
 * the new item can't be worn with is taken off in the same write — the
 * result says which slots were cleared.
 */
export async function equipOne(uid: string, slot: Slot, itemId: string | null) {
  const userRef = db.collection("users").doc(uid);
  return db.runTransaction(async (tx) => {
    const user = await tx.get(userRef);
    if (!user.exists) throw new HttpsError("failed-precondition", "Create your profile first.");
    const current = ((user.get("equipped") as Equipped | undefined) ?? {}) as Equipped;

    const punishment = activePunishment(user);
    if (punishment && punishment.slot === slot && itemId !== punishment.itemId) {
      throw new HttpsError(
        "failed-precondition",
        `Your last-place punishment (${punishment.leagueName ?? "league"}) is locked on for 7 days.`
      );
    }

    if (itemId === null) {
      const next = applyEquip(current, slot, null, () => undefined).equipped;
      tx.update(userRef, { equipped: next, updatedAt: FieldValue.serverTimestamp() });
      return { ok: true as const, removed: [] as Slot[], equipped: next };
    }

    const others = [...new Set(Object.values(current).filter((id): id is string => !!id && id !== itemId))];
    const [owned, itemSnap, ...otherSnaps] = await Promise.all([
      tx.get(userRef.collection("inventory").doc(itemId)),
      tx.get(db.collection("catalog").doc(itemId)),
      ...others.map((id) => tx.get(db.collection("catalog").doc(id))),
    ]);
    if (!owned!.exists) throw new HttpsError("permission-denied", "You don't own that item.");
    const item = toItem(itemId, itemSnap!.data());
    if (!item) throw new HttpsError("failed-precondition", "That item is no longer in the store.");
    if (item.slot !== slot) throw new HttpsError("invalid-argument", "That item doesn't go in that slot.");

    const items = new Map<string, ItemLike>([[itemId, item]]);
    others.forEach((id, i) => {
      const it = toItem(id, otherSnaps[i]!.data());
      if (it) items.set(id, it);
    });
    const { equipped, removed } = applyEquip(current, slot, itemId, (id) => items.get(id));
    if (punishment && removed.includes(punishment.slot)) {
      throw new HttpsError(
        "failed-precondition",
        `Can't equip that while your last-place punishment is active.`
      );
    }
    tx.update(userRef, { equipped, updatedAt: FieldValue.serverTimestamp() });
    return { ok: true as const, removed, equipped };
  });
}
