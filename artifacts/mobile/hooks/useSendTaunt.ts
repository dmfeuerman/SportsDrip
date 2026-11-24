import { useCallback } from "react";
import { MOVES_BY_ID } from "@/constants/moves";
import type { LeagueMessage } from "@/constants/leagueTypes";
import { useApp } from "@/context/AppContext";
import { canonicalPairId, useChat } from "@/context/ChatContext";
import { useLeague } from "@/context/LeagueContext";
import { useToast } from "@/context/ToastContext";
import { useMoves } from "@/hooks/useMoves";
import * as api from "@/lib/api";
import { haptic as buzz } from "@/lib/motion";

export type TauntTarget =
  | { scope: "dm"; receiverUid: string; receiverName: string }
  | { scope: "league"; leagueId: string; matchupId: string; receiverUid: string; receiverName: string };

/** Same id functions/src/callable/taunts.ts gives a named taunt, so the server's row replaces this one. */
function tauntRowId(uid: string, clientId: string): string {
  return `taunt_${uid}_${clientId}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
}

/**
 * Sends a taunt the way a chat message sends: the row (with the move and your
 * current look) is in the chat the moment you tap, and the server call runs
 * behind it, after any outfit change or move purchase still on its way up, so
 * the server writes the same character you see. Taken back with a toast if
 * the server refuses (e.g. they've muted taunts).
 */
export function useSendTaunt() {
  const { profile, ownedMoves, runQueued } = useApp();
  const { showPendingDm } = useChat();
  const { showMessage } = useLeague();
  const { show } = useToast();
  const { byId } = useMoves();

  return useCallback(
    (target: TauntTarget, moveId: string): string | null => {
      const uid = profile?.uid;
      if (!uid) return "Sign in to taunt.";
      if (!ownedMoves.has(moveId)) return "You don't own that move yet.";
      const now = Date.now();
      const clientId = api.newIdempotencyKey();
      const id = tauntRowId(uid, clientId);
      const myName = profile.displayName ?? "Player";
      const moveName = byId.get(moveId)?.name ?? MOVES_BY_ID.get(moveId)?.name ?? moveId.replace(/_/g, " ");
      const text = `${myName} hit the ${moveName} 💃`;
      const look = { avatar: profile.avatar ?? null, equipped: profile.equipped ?? {} };

      const settle =
        target.scope === "dm"
          ? showPendingDm({
              id,
              threadId: canonicalPairId(uid, target.receiverUid),
              senderUid: uid,
              senderName: myName,
              recipientUid: target.receiverUid,
              recipientName: target.receiverName,
              kind: "taunt",
              text,
              moveId,
              ...look,
              at: now,
              replyTo: null,
            })
          : showMessage(target.leagueId, {
              id,
              uid,
              name: myName,
              kind: "taunt",
              text,
              moveId,
              matchupId: target.matchupId,
              ...look,
              at: now,
              reactions: {},
              reactors: {},
            } as LeagueMessage);
      buzz.success();

      const input: api.TauntInput =
        target.scope === "dm"
          ? { scope: "dm", receiverUid: target.receiverUid, matchupId: "friend", moveId, clientId }
          : { scope: "league", leagueId: target.leagueId, matchupId: target.matchupId, receiverUid: target.receiverUid, moveId, clientId };
      runQueued(() => api.sendTaunt(input)).then(
        () => settle(true),
        (e) => {
          settle(false);
          buzz.error();
          show({ kind: "warning", title: `Couldn't taunt ${target.receiverName}`, body: api.friendlyError(e) });
        }
      );
      return null;
    },
    [profile, ownedMoves, runQueued, showPendingDm, showMessage, show, byId]
  );
}
