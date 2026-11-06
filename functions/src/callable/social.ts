import { onCall, HttpsError } from "firebase-functions/v2/https";
import { nextReactionProgress, questProgressRef } from "../lib/questProgress";
import { z } from "zod";
import { db, requireAuth } from "../lib/economy";
import { writeNotification } from "../lib/notify";
import { simpleNotification } from "../lib/notifyModel";

/**
 * Six fixed reaction emojis for league chat messages, feed activity rows,
 * and league bets. No free-text emoji picker.
 */
export const REACTION_EMOJIS = ["🔥", "💀", "😂", "🧊", "🫡", "🤡"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

const ReactInput = z
  .object({
    leagueId: z.string().min(1),
    targetId: z.string().min(1).nullish(),
    itemId: z.string().min(1).nullish(),
    targetType: z.enum(["message", "messages", "activity", "bet", "leagueBets"]).nullish(),
    kind: z.enum(["message", "messages", "activity", "bet", "leagueBets"]).nullish(),
    collection: z.enum(["message", "messages", "activity", "bet", "leagueBets"]).nullish(),
    emoji: z.enum(REACTION_EMOJIS),
  })
  .refine((v) => !!(v.targetId || v.itemId), { message: "Target item id required." });

function resolveCollection(raw: string | null | undefined): "messages" | "activity" | "leagueBets" {
  if (raw === "activity") return "activity";
  if (raw === "bet" || raw === "leagueBets") return "leagueBets";
  return "messages";
}

/**
 * Toggles or switches the caller's emoji reaction on a league message, feed
 * row, or bet. One active emoji per member per item; tapping the same emoji
 * removes it, tapping another switches it.
 */
export const reactToItem = onCall({ region: "us-central1" }, async (req) => {
  const uid = requireAuth(req.auth);
  const input = ReactInput.parse(req.data);
  const itemId = (input.targetId ?? input.itemId)!;
  const col = resolveCollection(input.targetType ?? input.kind ?? input.collection);

  const leagueRef = db.collection("leagues").doc(input.leagueId);
  const itemRef = leagueRef.collection(col).doc(itemId);

  const progressRef = questProgressRef(uid);
  return db.runTransaction(async (tx) => {
    const [league, item, progress] = await Promise.all([tx.get(leagueRef), tx.get(itemRef), tx.get(progressRef)]);
    if (!league.exists) throw new HttpsError("not-found", "League not found.");
    const memberIds = (league.get("memberIds") as string[] | undefined) ?? [];
    if (!memberIds.includes(uid)) {
      throw new HttpsError("permission-denied", "You're not in this league.");
    }
    if (!item.exists) throw new HttpsError("not-found", "Item not found.");

    const reactions = { ...((item.get("reactions") as Record<string, number> | undefined) ?? {}) };
    const reactors = { ...((item.get("reactors") as Record<string, string> | undefined) ?? {}) };
    const prev = reactors[uid];

    if (prev === input.emoji) {
      delete reactors[uid];
      const nextCount = Math.max(0, (reactions[input.emoji] ?? 1) - 1);
      if (nextCount === 0) delete reactions[input.emoji];
      else reactions[input.emoji] = nextCount;
    } else {
      if (prev) {
        const prevCount = Math.max(0, (reactions[prev] ?? 1) - 1);
        if (prevCount === 0) delete reactions[prev];
        else reactions[prev] = prevCount;
      }
      reactors[uid] = input.emoji;
      reactions[input.emoji] = (reactions[input.emoji] ?? 0) + 1;
    }

    tx.update(itemRef, { reactions, reactors });

    // Social quest: a reaction added (not removed) on someone else's item.
    const itemOwner = item.get("uid") as string | undefined;
    if (itemOwner && itemOwner !== uid && prev !== input.emoji) {
      const next = nextReactionProgress(progress.exists ? (progress.data() as { reacted?: Record<string, boolean> }) : undefined, `${input.leagueId}_${col}_${itemId}`);
      if (next) tx.set(progressRef, next, { merge: true });
    }

    // Deliver it: the owner hears about a new reaction. One notification per
    // item per hour; its id is fixed for the hour, so the first reaction
    // creates it (and pushes) and later ones only refresh the count in-app.
    const owner = item.get("uid") as string | undefined;
    if (owner && owner !== uid && prev !== input.emoji) {
      const others = Object.keys(reactors).filter((r) => r !== owner);
      const name = (league.get(`members.${uid}.displayName`) as string | undefined) ?? "A league-mate";
      const hour = Math.floor(Date.now() / 3_600_000);
      const what = col === "messages" ? "your message" : col === "leagueBets" ? "your pick" : "your post";
      writeNotification(
        tx,
        owner,
        simpleNotification({
          id: `react_${col}_${itemId}_${hour}`.slice(0, 120),
          type: "reaction",
          title: others.length > 1 ? `${name} + ${others.length - 1} other${others.length > 2 ? "s" : ""} ${input.emoji} ${what}` : `${name} ${input.emoji} ${what}`,
          body: (league.get("name") as string | undefined) ?? "League",
          leagueId: input.leagueId,
          leagueName: (league.get("name") as string | undefined) ?? null,
          wallet: "league",
          now: Date.now(),
          data: { leagueId: input.leagueId, targetType: col, targetId: itemId },
        })
      );
    }
    return { ok: true, reactions, reactors };
  });
});
