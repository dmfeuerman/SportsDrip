import { collection, limit, onSnapshot, orderBy, query, where, type Query } from "firebase/firestore";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/context/AppContext";
import * as api from "@/lib/api";
import type { Challenge, ChallengeMode, ChallengeTeam, PublicUser } from "@/lib/api";
import { DEMO, demoFriends } from "@/lib/demo";
import { firebaseConfigured, getDb } from "@/lib/firebase";

/**
 * Head-to-head challenges between friends.
 *
 * One listener on challenges where the user is a participant, shared by every
 * screen that shows them (board, slip, game center, friends, home, the
 * Challenges screen). All writes are callables: the server moves the escrow
 * and the rules deny the client everything else.
 *
 * Friends for the slip's picker are fetched on demand (listFriends) and
 * cached here, so opening a slip doesn't mount the Friends tab's listeners.
 */

export type Side = "home" | "away";

/** A challenge from the signed-in player's side of the table. */
export interface ChallengeView {
  ch: Challenge;
  isCreator: boolean;
  friendUid: string;
  friendName: string;
  mySide: Side;
  myTeam: ChallengeTeam;
  theirTeam: ChallengeTeam;
  myStake: number;
  theirStake: number;
  /** What the pot is to my stake: the price I'm effectively getting. */
  myOdds: number;
  /** Settled from my side. */
  result: "won" | "lost" | "push" | null;
}

export function viewOf(ch: Challenge, uid: string): ChallengeView {
  const isCreator = ch.creatorUid === uid;
  const mySide: Side = isCreator ? ch.creatorSide : ch.creatorSide === "home" ? "away" : "home";
  const myStake = isCreator ? ch.creatorStake : ch.opponentStake;
  const result =
    ch.status !== "settled" || !ch.outcome
      ? null
      : ch.outcome === "push"
        ? "push"
        : (ch.outcome === "creator") === isCreator
          ? "won"
          : "lost";
  return {
    ch,
    isCreator,
    friendUid: isCreator ? ch.opponentUid : ch.creatorUid,
    friendName: (isCreator ? ch.opponentName : ch.creatorName) || "Friend",
    mySide,
    myTeam: mySide === "home" ? ch.home : ch.away,
    theirTeam: mySide === "home" ? ch.away : ch.home,
    myStake,
    theirStake: isCreator ? ch.opponentStake : ch.creatorStake,
    myOdds: myStake > 0 ? Math.round((ch.pot / myStake) * 100) / 100 : 0,
    result,
  };
}

/** My credits are in the pot: I sent it (pending) or it's on (accepted). */
export function holdsMyStake(ch: Challenge, uid: string): boolean {
  return ch.status === "accepted" || (ch.status === "pending" && ch.creatorUid === uid);
}

export interface CreateChallengeArgs {
  gameId: string;
  opponentUid: string;
  side: Side;
  mode: ChallengeMode;
  stake: number;
  odds?: number;
  message?: string;
  idempotencyKey: string;
  /** What the composer already knows, so the challenge shows under Sent straight away. */
  preview?: Pick<Challenge, "sport" | "startsAt" | "home" | "away" | "opponentName" | "opponentStake" | "pot" | "odds">;
}

interface ChallengeContextType {
  uid: string | null;
  /** False until the challenges have been read once: don't say "none" before then. */
  loaded: boolean;
  challenges: Challenge[];
  /** Waiting on me to accept or decline. */
  incoming: Challenge[];
  /** I sent it; waiting on my friend. */
  outgoing: Challenge[];
  /** Accepted: both stakes in the pot, game not yet settled. */
  live: Challenge[];
  /** Settled, declined, withdrawn, expired, void. */
  history: Challenge[];
  /** Credits of mine sitting in pots right now. */
  escrowed: number;
  /** Open challenges (pending or accepted) by game id. */
  byGame: Map<string, Challenge[]>;
  /** Record against each friend, from settled challenges. */
  headToHead: (friendUid: string) => { won: number; lost: number; push: number };

  friends: PublicUser[];
  friendsLoading: boolean;
  loadFriends: () => Promise<void>;

  /** Each returns an error message to show, or null on success. */
  create: (args: CreateChallengeArgs) => Promise<string | null>;
  respond: (challengeId: string, accept: boolean) => Promise<{ error: string | null; status?: string }>;
  cancel: (challengeId: string) => Promise<string | null>;
}

const Ctx = createContext<ChallengeContextType | null>(null);
const NONE: Challenge[] = [];
const OPEN = new Set(["pending", "accepted"]);

export function ChallengeProvider({ uid, children }: { uid: string | null; children: React.ReactNode }) {
  const { reportSyncFailure, profile } = useApp();
  const myName = profile?.displayName ?? "You";
  const [serverChallenges, setChallenges] = useState<Challenge[]>(NONE);
  const [loaded, setLoaded] = useState(false);
  // Shown ahead of the server: challenges just sent, and ones just accepted, declined or withdrawn.
  // The listener's copy takes over once it agrees; a refusal undoes the change.
  const [sent, setSent] = useState<Record<string, Challenge>>({});
  const [statusOpt, setStatusOpt] = useState<Record<string, Challenge["status"]>>({});
  const without = <T,>(rec: Record<string, T>, id: string) => {
    if (!(id in rec)) return rec;
    const next = { ...rec };
    delete next[id];
    return next;
  };
  const challenges = useMemo(() => {
    const have = new Set(serverChallenges.map((c) => c.id));
    const mine = Object.values(sent).filter((c) => !have.has(c.id));
    const merged = mine.length ? [...mine, ...serverChallenges] : serverChallenges;
    if (!Object.keys(statusOpt).length) return merged;
    return merged.map((c) => (statusOpt[c.id] && c.status === "pending" ? { ...c, status: statusOpt[c.id]! } : c));
  }, [serverChallenges, sent, statusOpt]);
  useEffect(() => {
    const byId = new Map(serverChallenges.map((c) => [c.id, c]));
    setSent((p) => (Object.keys(p).some((id) => byId.has(id)) ? Object.fromEntries(Object.entries(p).filter(([id]) => !byId.has(id))) : p));
    setStatusOpt((p) => {
      const keep = Object.entries(p).filter(([id]) => byId.get(id)?.status === "pending");
      return keep.length === Object.keys(p).length ? p : Object.fromEntries(keep);
    });
  }, [serverChallenges]);
  useEffect(() => {
    setSent({});
    setStatusOpt({});
  }, [uid]);
  const [friends, setFriends] = useState<PublicUser[]>(DEMO ? demoFriends : []);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const friendsAt = useRef(0);
  const inFlight = useRef(new Set<string>());

  const enabled = firebaseConfigured && !!uid && uid !== "local" && !DEMO;

  useEffect(() => {
    if (!enabled || !uid) {
      setChallenges(NONE);
      setLoaded(true);
      return;
    }
    setLoaded(false);
    const db = getDb();
    if (!db) return;
    const base = collection(db, "challenges");
    const ordered = query(base, where("participants", "array-contains", uid), orderBy("createdAtMs", "desc"), limit(100));
    // Same data without the composite index, for a project whose indexes
    // haven't been deployed yet: sorted here instead of by the server.
    const unordered = query(base, where("participants", "array-contains", uid), limit(200));

    let unsub: () => void = () => {};
    const listen = (q: Query, fallback: boolean) => {
      unsub = onSnapshot(
        q,
        (snap) => {
          const list = snap.docs.map((d) => ({ ...(d.data() as Challenge), id: d.id }));
          if (fallback) list.sort((a, b) => b.createdAtMs - a.createdAtMs);
          setChallenges(list.length ? list : NONE);
          setLoaded(true);
        },
        (err) => {
          if (!fallback && err.code === "failed-precondition") return listen(unordered, true);
          setLoaded(true);
          if (__DEV__) console.warn(`[challenges] listener: ${err.code} — ${err.message}`);
        }
      );
    };
    listen(ordered, false);
    return () => unsub();
  }, [enabled, uid]);

  const loadFriends = useCallback(async () => {
    if (!enabled || Date.now() - friendsAt.current < 60_000) return;
    setFriendsLoading(true);
    try {
      const res = await api.listFriends({});
      friendsAt.current = Date.now();
      setFriends((prev) => (JSON.stringify(prev) === JSON.stringify(res.friends) ? prev : res.friends));
    } catch {
      // The picker shows its own empty / retry state.
    } finally {
      setFriendsLoading(false);
    }
  }, [enabled]);

  const once = useCallback(async <T,>(key: string, fn: () => Promise<T>, busy: T): Promise<T> => {
    if (inFlight.current.has(key)) return busy;
    inFlight.current.add(key);
    try {
      return await fn();
    } finally {
      inFlight.current.delete(key);
    }
  }, []);

  const create = useCallback(
    (args: CreateChallengeArgs) =>
      once<string | null>(
        `create:${args.idempotencyKey}`,
        async () => {
          if (!enabled) return "Challenges need a signed-in account.";
          try {
            const trimmed = args.message?.trim();
            const payload: CreateChallengeArgs = {
              gameId: args.gameId,
              opponentUid: args.opponentUid,
              side: args.side,
              mode: args.mode,
              stake: args.stake,
              idempotencyKey: args.idempotencyKey,
              ...(args.mode === "odds" && typeof args.odds === "number" ? { odds: args.odds } : {}),
              ...(trimmed ? { message: trimmed } : {}),
            };
            // Instant: the composer closes and the challenge is listed now; a refusal takes it back off and comes back as a toast.
            const id = `${uid}_${args.idempotencyKey}`; // the id createChallenge gives it
            if (args.preview && uid) {
              const now = Date.now();
              const draft: Challenge = {
                ...args.preview,
                id,
                gameId: args.gameId,
                mode: args.mode,
                creatorUid: uid,
                opponentUid: args.opponentUid,
                participants: [uid, args.opponentUid],
                creatorName: myName,
                creatorSide: args.side,
                creatorStake: args.stake,
                message: trimmed || null,
                status: "pending",
                outcome: null,
                winnerUid: null,
                finalHomeScore: null,
                finalAwayScore: null,
                createdAtMs: now,
                respondedAtMs: null,
                closedAtMs: null,
                settledAtMs: null,
              };
              setSent((p) => ({ ...p, [id]: draft }));
            }
            api.createChallenge(payload).catch((err) => {
              setSent((p) => without(p, id));
              reportSyncFailure(api.friendlyError(err), "The challenge wasn't sent.");
            });
            return null;
          } catch (err) {
            return api.friendlyError(err);
          }
        },
        "Already sending…"
      ),
    [enabled, once, reportSyncFailure, uid, myName]
  );

  const respond = useCallback(
    (challengeId: string, accept: boolean) =>
      once<{ error: string | null; status?: string }>(
        `respond:${challengeId}`,
        async () => {
          // Instant: it leaves the inbox now. Put back if the server refuses or the game has already started.
          setStatusOpt((p) => ({ ...p, [challengeId]: accept ? "accepted" : "declined" }));
          try {
            const res = await api.respondChallenge({ challengeId, accept });
            if (res.status === "expired") setStatusOpt((p) => ({ ...p, [challengeId]: "expired" }));
            return { error: null, status: res.status };
          } catch (err) {
            setStatusOpt((p) => without(p, challengeId));
            return { error: api.friendlyError(err) };
          }
        },
        { error: null }
      ),
    [once]
  );

  const cancel = useCallback(
    (challengeId: string) =>
      once<string | null>(
        `cancel:${challengeId}`,
        async () => {
          setStatusOpt((p) => ({ ...p, [challengeId]: "cancelled" }));
          api.cancelChallenge({ challengeId }).catch((err) => {
            setStatusOpt((p) => without(p, challengeId));
            reportSyncFailure(api.friendlyError(err), "The challenge is still open.");
          });
          return null;
        },
        null
      ),
    [once, reportSyncFailure]
  );

  const derived = useMemo(() => {
    const incoming: Challenge[] = [];
    const outgoing: Challenge[] = [];
    const live: Challenge[] = [];
    const history: Challenge[] = [];
    const byGame = new Map<string, Challenge[]>();
    let escrowed = 0;
    if (!uid) return { incoming, outgoing, live, history, byGame, escrowed };
    for (const ch of challenges) {
      if (ch.status === "pending") (ch.opponentUid === uid ? incoming : outgoing).push(ch);
      else if (ch.status === "accepted") live.push(ch);
      else history.push(ch);
      if (OPEN.has(ch.status)) {
        const list = byGame.get(ch.gameId) ?? [];
        list.push(ch);
        byGame.set(ch.gameId, list);
      }
      if (holdsMyStake(ch, uid)) escrowed += ch.creatorUid === uid ? ch.creatorStake : ch.opponentStake;
    }
    // Soonest kickoff first for anything still to play.
    const byKickoff = (a: Challenge, b: Challenge) => a.startsAt - b.startsAt;
    incoming.sort(byKickoff);
    outgoing.sort(byKickoff);
    live.sort(byKickoff);
    return { incoming, outgoing, live, history, byGame, escrowed };
  }, [challenges, uid]);

  const headToHead = useCallback(
    (friendUid: string) => {
      const rec = { won: 0, lost: 0, push: 0 };
      if (!uid) return rec;
      for (const ch of challenges) {
        if (ch.status !== "settled" || !ch.participants.includes(friendUid)) continue;
        const r = viewOf(ch, uid).result;
        if (r) rec[r]++;
      }
      return rec;
    },
    [challenges, uid]
  );

  const value = useMemo<ChallengeContextType>(
    () => ({
      uid,
      loaded,
      challenges,
      ...derived,
      headToHead,
      friends,
      friendsLoading,
      loadFriends,
      create,
      respond,
      cancel,
    }),
    [uid, loaded, challenges, derived, headToHead, friends, friendsLoading, loadFriends, create, respond, cancel]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useChallenges() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useChallenges must be used inside ChallengeProvider");
  return ctx;
}
