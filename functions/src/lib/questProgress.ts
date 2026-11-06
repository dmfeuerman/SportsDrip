import { db } from "./economy";
import { weekKey } from "./weekly";

/**
 * Social quest progress: distinct items of someone else's a player reacted to
 * this H2H week. Stored as a set (reacted.{key}) so toggling a reaction off and
 * on can't farm the quest; `reactions` is the set's size.
 */
export function questProgressRef(uid: string, now = Date.now()) {
  return db.collection("users").doc(uid).collection("questProgress").doc(weekKey(now));
}

/** Pure: next progress doc fields, or null when this item was already counted. */
export function nextReactionProgress(
  current: { reacted?: Record<string, boolean>; reactions?: number } | undefined,
  key: string
): { reacted: Record<string, boolean>; reactions: number } | null {
  const reacted = { ...(current?.reacted ?? {}) };
  if (reacted[key]) return null;
  reacted[key] = true;
  return { reacted, reactions: Object.keys(reacted).length };
}
