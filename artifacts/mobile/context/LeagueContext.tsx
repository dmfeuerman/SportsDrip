import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DURATION_DAYS,
  isLeagueClosed,
  LEAGUE_CLOSED_MESSAGE,
  LOAN_REQUESTS_CLOSED_MESSAGE,
  PEER_LOAN_REQUESTS_ENABLED,
  type GameSidesDoc,
  type League,
  type LeagueActivity,
  type LeagueAuditEntry,
  type LeagueBet,
  type LeagueDuration,
  type LeagueLoan,
  type LeagueMatchupDoc,
  type LeagueMessage,
  type LeagueMode,
  type LeagueParlay,
  type LeaguePick,
  type LeagueReport,
  type LeagueRivalry,
  type PrizeDistribution,
  type ReactionEmoji,
  type MatchupCadence,
  type Sport,
} from "@/constants/leagueTypes";
import { leagueEndFor } from "@/constants/seasons";
import { useNow } from "@/hooks/useNow";
import { weekKey } from "@/lib/markets";
import { trackEvent } from "@/lib/analytics";
import * as api from "@/lib/api";
import { useApp } from "@/context/AppContext";
import { firebaseConfigured, getDb } from "@/lib/firebase";
import { DEMO, demoActivity, demoLeagueBets, demoLeagues, demoLoans } from "@/lib/demo";
import { rankByMode, rankMembers, type Standing } from "@/lib/loanMath";
import { isObjectionable } from "@/lib/moderation";
import { BLOCKED_TEXT_ERROR } from "@/lib/chatText";
import { useBlockedUids } from "@/lib/blocks";

export interface CreateLeagueInput {
  name: string;
  startingLeagueTokens: number;
  duration: LeagueDuration;
  sports: Sport[];
  buyIn: number;
  prizeDistribution: PrizeDistribution;
  bankLoanEnabled: boolean;
  bankInterestRate: number;
  bankInterestIntervalHours: number;
  mode?: LeagueMode;
  matchupsEnabled?: boolean;
  matchupCadence?: MatchupCadence;
  stimulusEnabled?: boolean;
  bracketTemplateId?: string;
  /** Scheduled start (ms); null/undefined starts now. */
  startsAt?: number | null;
}

export type JoinSource = "code" | "link" | "signup" | "notification";

/**
 * A league this phone is still joining or creating. The league screen shows it
 * (by name, or in full for one being created) while the server call runs, and
 * shows `error` if the call was refused.
 */
export interface PendingLeague {
  id: string;
  name: string;
  kind: "join" | "create";
  error?: string;
  /** Runs the same request again (create only). */
  retry?: () => void;
}

/** What the join sheet already knows about a league from its invite code. */
export interface JoinPreview {
  leagueId: string;
  name: string;
}

/** The display fields of a league bet, for showing it before the server has written it. */
export type LeagueBetPreview = Pick<
  LeagueBet,
  "sport" | "side" | "market" | "selection" | "line" | "label" | "teamName" | "teamAbbr" | "teamColor" | "opponentAbbr" | "odds" | "startsAt"
>;
/** The display fields of a pick'em / survivor pick. */
export type PickPreview = Pick<LeaguePick, "sport" | "teamName" | "teamAbbr" | "teamColor" | "opponentAbbr" | "startsAt">;

/** Tokens the app shows moved before the league document says so. */
interface TokenHold {
  leagueId: string;
  delta: number;
  /** Server balance when the hold was made; once it changes, the server has applied the move. */
  base: number;
}
/** How long a confirmed overlay may wait for its snapshot before it's dropped anyway. */
const SETTLE_MS = 6000;
const NO_BETS: LeagueBet[] = [];
const NO_PICKS: LeaguePick[] = [];

/** Every mutation resolves to an error message, or null on success. */
type Result = Promise<string | null>;

interface LeagueContextType {
  ready: boolean;
  uid: string | null;
  /** Leagues you're in. Includes one just joined or created, before the listener has caught up. */
  leagues: League[];
  /** Leagues still open for play — excludes closed (ended or past endsAt). */
  activeLeagues: League[];
  /** Also returns a league still being created (`optimistic: true`), which `leagues` leaves out. */
  getLeague: (id: string) => League | undefined;
  /** A join or create still in flight (or refused) for this league id. */
  pendingLeague: (id: string) => PendingLeague | undefined;
  dismissPending: (id: string) => void;
  /** Bets and picks made on this phone that the server hasn't echoed back yet. */
  optimisticBets: LeagueBet[];
  optimisticPicks: LeaguePick[];
  isClosed: (id: string) => boolean;
  /** Your open + settled league bets, per league. */
  myLeagueBets: Record<string, LeagueBet[]>;
  error: string | null;
  clearError: () => void;

  createLeague: (input: CreateLeagueInput) => Promise<{ leagueId: string } | { error: string }>;
  /**
   * Instant create: the league exists in the app at once under the returned id
   * (open its screen straight away); `done` resolves to an error message or null.
   */
  startLeague: (input: CreateLeagueInput) => { leagueId: string; done: Promise<string | null> };
  /**
   * `source` is analytics only: where the code came from. With `preview` (from
   * the invite lookup) the league screen can be opened before this resolves.
   */
  joinLeague: (code: string, source?: JoinSource, preview?: JoinPreview) => Promise<{ leagueId: string } | { error: string }>;
  leaveLeague: (leagueId: string) => Result;
  endLeague: (leagueId: string) => Result;
  voteEndLeague: (leagueId: string, vote: boolean) => Result;
  updateBankSettings: (leagueId: string, enabled: boolean, rate: number, intervalHours: number) => Result;
  updateLeagueSettings: (args: api.UpdateLeagueSettingsArgs) => Result;
  inviteFriend: (leagueId: string, friendUid: string) => Result;
  placeLeagueBet: (args: api.PlaceLeagueBetArgs & { preview?: LeagueBetPreview }) => Result;
  reportResult: (leagueId: string, betId: string, reason: string) => Result;
  voidLeagueBet: (leagueId: string, betId: string, reason: string) => Result;
  reactToItem: (
    leagueId: string,
    targetType: "message" | "messages" | "activity" | "bet" | "leagueBets" | "loan" | "loans",
    targetId: string,
    emoji: ReactionEmoji
  ) => Result;
  sendMessage: (leagueId: string, text: string, replyTo?: LeagueMessage["replyTo"], gameId?: string) => Result;
  makePick: (leagueId: string, gameId: string, side: "home" | "away", preview?: PickPreview) => Result;
  createGroupParlay: (args: Parameters<typeof api.createGroupParlay>[0]) => Result;
  addParlayLeg: (args: Parameters<typeof api.addParlayLeg>[0]) => Result;
  rideParlay: (leagueId: string, parlayId: string, stake: number) => Result;
  lockParlay: (leagueId: string, parlayId: string) => Result;
  takeBankLoan: (leagueId: string, amount: number) => Result;
  repayLoan: (leagueId: string, loanId: string, amount: number) => Result;
  requestLoan: (leagueId: string, amount: number, rate: number, message?: string) => Result;
  peerLoanAction: (leagueId: string, loanId: string, action: api.PeerLoanActionName, rate?: number, amount?: number, message?: string) => Result;
  /** Bank stimulus vote: ask, vote yes/no, or withdraw. */
  stimulus: (args: api.LeagueStimulusArgs) => Result;
}

const LeagueContext = createContext<LeagueContextType | null>(null);

const NO_LEAGUES: League[] = [];

function normalizeLeagueBet(id: string, raw: Record<string, unknown>): LeagueBet {
  return {
    ...(raw as unknown as LeagueBet),
    id,
    side: (raw.side === "away" ? "away" : "home") as "home" | "away",
  };
}

export function LeagueProvider({ children, uid }: { children: React.ReactNode; uid: string | null }) {
  const [serverLeagues, setLeagues] = useState<League[]>(DEMO ? demoLeagues : NO_LEAGUES);
  const [serverLeagueBets, setMyLeagueBets] = useState<Record<string, LeagueBet[]>>(
    DEMO ? Object.fromEntries(Object.entries(demoLeagueBets).map(([k, v]) => [k, v.filter((b) => b.uid === uid)])) : {}
  );
  const [ready, setReady] = useState(DEMO);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<Set<string>>(new Set());

  // ── optimistic layer ─────────────────────────────────────────────────────
  // Joining, creating and leaving a league, league bets, picks, loans and the
  // end-season vote all show in the app the moment they're made. The server
  // call runs behind them and the Firestore listeners take over once they
  // reflect it; a refused call rolls the change back and raises a toast.
  /** Confirmed by the server's reply, not in the leagues listener yet. */
  const [seeded, setSeeded] = useState<Record<string, League>>({});
  /** Being created: built from the form, not on the server yet. Never in `leagues` (nothing may listen to it). */
  const [drafts, setDrafts] = useState<Record<string, League>>({});
  const [pending, setPending] = useState<Record<string, PendingLeague>>({});
  /** Left, listener still shows it. */
  const [left, setLeft] = useState<Record<string, true>>({});
  const [optBets, setOptBets] = useState<Record<string, LeagueBet>>({});
  const [optPicks, setOptPicks] = useState<Record<string, LeaguePick>>({});
  const [holds, setHolds] = useState<Record<string, TokenHold>>({});
  const [voteOpt, setVoteOpt] = useState<Record<string, boolean>>({});
  const dropKey = <T,>(set: React.Dispatch<React.SetStateAction<Record<string, T>>>, key: string) =>
    set((p) => {
      if (!(key in p)) return p;
      const next = { ...p };
      delete next[key];
      return next;
    });

  const leagues = useMemo(() => {
    const have = new Set(serverLeagues.map((l) => l.id));
    const extra = Object.values(seeded).filter((l) => !have.has(l.id));
    let list = extra.length ? [...extra, ...serverLeagues] : serverLeagues;
    if (Object.keys(left).length) list = list.filter((l) => !left[l.id]);
    const holdList = Object.values(holds);
    if (!uid || (!holdList.length && !Object.keys(voteOpt).length)) return list;
    return list.map((l) => {
      const me = l.members?.[uid];
      let next = l;
      if (me) {
        let delta = 0;
        for (const h of holdList) if (h.leagueId === l.id && h.base === me.leagueTokens) delta += h.delta;
        if (delta) next = { ...next, members: { ...next.members, [uid]: { ...me, leagueTokens: Math.max(0, me.leagueTokens + delta) } } };
      }
      const vote = voteOpt[l.id];
      if (vote !== undefined && (l.endVotes ?? []).includes(uid) !== vote) {
        next = { ...next, endVotes: vote ? [...(l.endVotes ?? []), uid] : (l.endVotes ?? []).filter((u) => u !== uid) };
      }
      return next;
    });
  }, [serverLeagues, seeded, left, holds, voteOpt, uid]);

  const optimisticBets = useMemo(() => {
    const list = Object.values(optBets).filter((b) => !(serverLeagueBets[b.leagueId] ?? NO_BETS).some((x) => x.id === b.id));
    return list.length ? list : NO_BETS;
  }, [optBets, serverLeagueBets]);
  const optimisticPicks = useMemo(() => {
    const list = Object.values(optPicks);
    return list.length ? list : NO_PICKS;
  }, [optPicks]);
  const myLeagueBets = useMemo(() => {
    if (!optimisticBets.length) return serverLeagueBets;
    const out = { ...serverLeagueBets };
    for (const b of optimisticBets) out[b.leagueId] = [b, ...(out[b.leagueId] ?? NO_BETS)];
    return out;
  }, [serverLeagueBets, optimisticBets]);

  // The listeners caught up: drop what they now show.
  useEffect(() => {
    const have = new Set(serverLeagues.map((l) => l.id));
    setSeeded((p) => (Object.keys(p).some((id) => have.has(id)) ? Object.fromEntries(Object.entries(p).filter(([id]) => !have.has(id))) : p));
    setPending((p) => (Object.keys(p).some((id) => have.has(id)) ? Object.fromEntries(Object.entries(p).filter(([id]) => !have.has(id))) : p));
    setLeft((p) => (Object.keys(p).some((id) => !have.has(id)) ? Object.fromEntries(Object.entries(p).filter(([id]) => have.has(id))) : p));
    setHolds((p) => {
      const keep = Object.entries(p).filter(([, h]) => {
        const l = serverLeagues.find((x) => x.id === h.leagueId);
        const tokens = uid ? l?.members?.[uid]?.leagueTokens : undefined;
        return tokens === undefined || tokens === h.base;
      });
      return keep.length === Object.keys(p).length ? p : Object.fromEntries(keep);
    });
    setVoteOpt((p) => {
      const keep = Object.entries(p).filter(([id, vote]) => {
        const l = serverLeagues.find((x) => x.id === id);
        return !!l && !!uid && (l.endVotes ?? []).includes(uid) !== vote;
      });
      return keep.length === Object.keys(p).length ? p : Object.fromEntries(keep);
    });
  }, [serverLeagues, uid]);
  useEffect(() => {
    setOptBets((p) => {
      const keep = Object.entries(p).filter(([id, b]) => !(serverLeagueBets[b.leagueId] ?? NO_BETS).some((x) => x.id === id));
      return keep.length === Object.keys(p).length ? p : Object.fromEntries(keep);
    });
  }, [serverLeagueBets]);
  // Another account signed in: nothing optimistic carries over.
  useEffect(() => {
    setSeeded({});
    setDrafts({});
    setPending({});
    setLeft({});
    setOptBets({});
    setOptPicks({});
    setHolds({});
    setVoteOpt({});
  }, [uid]);

  const leaguesRef = useRef(leagues);
  leaguesRef.current = leagues;
  const serverLeaguesRef = useRef(serverLeagues);
  serverLeaguesRef.current = serverLeagues;
  const now = useNow(30_000);
  const closedKey = leagues.filter((l) => isLeagueClosed(l, now)).map((l) => l.id).join(",");

  const enabled = firebaseConfigured && !!uid;

  useEffect(() => {
    if (DEMO) return;
    if (!enabled || !uid) {
      setLeagues(NO_LEAGUES);
      setReady(true);
      return;
    }
    const db = getDb();
    if (!db) {
      setReady(true);
      return;
    }
    return onSnapshot(
      query(collection(db, "leagues"), where("memberIds", "array-contains", uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({ ...(d.data() as League), id: d.id }));
        list.sort(
          (a, b) =>
            (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1) ||
            (b.lastActivityAt ?? b.createdAt) - (a.lastActivityAt ?? a.createdAt)
        );
        setLeagues(list);
        setReady(true);
      },
      (err) => {
        setError(api.friendlyError(err));
        setReady(true);
      }
    );
  }, [enabled, uid]);

  const leagueIdsKey = leagues.map((l) => l.id).join(",");
  useEffect(() => {
    if (DEMO) return;
    if (!enabled || !uid || !leagueIdsKey) {
      setMyLeagueBets({});
      return;
    }
    const db = getDb();
    if (!db) return;
    const ids = leagueIdsKey.split(",");
    const unsubs = ids.map((leagueId) =>
      onSnapshot(
        query(
          collection(db, "leagues", leagueId, "leagueBets"),
          where("uid", "==", uid),
          orderBy("placedAt", "desc"),
          limit(100)
        ),
        (snap) =>
          setMyLeagueBets((prev) => ({
            ...prev,
            [leagueId]: snap.docs.map((d) => normalizeLeagueBet(d.id, d.data())),
          })),
        () => {}
      )
    );
    setMyLeagueBets((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => ids.includes(id))));
    return () => unsubs.forEach((u) => u());
  }, [enabled, uid, leagueIdsKey]);

  const run = useCallback(async (key: string, fn: () => Promise<unknown>): Result => {
    if (inFlight.current.has(key)) return "Already working on that.";
    inFlight.current.add(key);
    try {
      setError(null);
      await fn();
      return null;
    } catch (err) {
      const msg = api.friendlyError(err);
      setError(msg);
      return msg;
    } finally {
      inFlight.current.delete(key);
    }
  }, []);

  const { reportSyncFailure, profile } = useApp();
  const myName = profile?.displayName ?? "You";
  const myNameRef = useRef(myName);
  myNameRef.current = myName;
  /**
   * Instant: the caller carries on as if it worked (sheets close, the app
   * moves on) while the call runs; a refusal arrives as a toast. `show` puts
   * the result on screen now and returns how to take it off again: called
   * with `false` when the server refuses, `true` once it has agreed (the
   * overlay then lingers until the listener shows the same thing).
   */
  const instant = useCallback(
    (leagueId: string, key: string, fn: () => Promise<unknown>, show?: () => (ok: boolean) => void): Result => {
      const league = leaguesRef.current.find((l) => l.id === leagueId);
      if (league && isLeagueClosed(league)) {
        setError(LEAGUE_CLOSED_MESSAGE);
        return Promise.resolve(LEAGUE_CLOSED_MESSAGE);
      }
      if (inFlight.current.has(key)) return Promise.resolve(null);
      const settle = show?.();
      void run(key, fn).then((why) => {
        settle?.(!why);
        if (why) reportSyncFailure(why);
      });
      return Promise.resolve(null);
    },
    [run, reportSyncFailure]
  );

  /** Shows league tokens moved by `delta` until the league document reflects it. */
  const holdTokens = useCallback(
    (leagueId: string, key: string, delta: number) => {
      const me = uid ? serverLeaguesRef.current.find((l) => l.id === leagueId)?.members?.[uid] : undefined;
      if (!me || !delta) return () => {};
      setHolds((p) => ({ ...p, [key]: { leagueId, delta, base: me.leagueTokens } }));
      return (ok: boolean) => {
        if (ok) setTimeout(() => dropKey(setHolds, key), SETTLE_MS);
        else dropKey(setHolds, key);
      };
    },
    [uid]
  );

  const guarded = useCallback(
    (leagueId: string, key: string, fn: () => Promise<unknown>): Result => {
      const league = leaguesRef.current.find((l) => l.id === leagueId);
      if (league && isLeagueClosed(league)) {
        setError(LEAGUE_CLOSED_MESSAGE);
        return Promise.resolve(LEAGUE_CLOSED_MESSAGE);
      }
      return run(key, fn);
    },
    [run]
  );

  /** Puts a league the server has confirmed into `leagues` without waiting for the listener. */
  const seedLeague = useCallback(async (leagueId: string, data?: League | null) => {
    if (serverLeaguesRef.current.some((l) => l.id === leagueId)) return;
    let league: League | null = data ? { ...data, id: leagueId } : null;
    if (!league) {
      const db = getDb();
      if (!db) return;
      try {
        // One read, capped: the listener delivers the same document if this is slow.
        const snap = await Promise.race([
          getDoc(doc(db, "leagues", leagueId)),
          new Promise<null>((r) => setTimeout(() => r(null), 4000)),
        ]);
        if (snap?.exists()) league = { ...(snap.data() as League), id: leagueId };
      } catch {
        // The listener still brings it in.
      }
    }
    if (league) {
      const ready = league;
      setSeeded((p) => ({ ...p, [leagueId]: ready }));
    }
  }, []);

  const startLeague = useCallback(
    (input: CreateLeagueInput): { leagueId: string; done: Promise<string | null> } => {
      const key = api.newIdempotencyKey();
      // Same id the server derives (functions/src/callable/leagues.ts createLeague).
      const leagueId = `lg_${(uid ?? "").slice(0, 8)}_${key}`;
      const now = Date.now();
      const startsAt = input.startsAt && input.startsAt > now ? input.startsAt : now;
      const fixedDays = input.duration === "Full Season" ? undefined : DURATION_DAYS[input.duration];
      const h2h = input.mode === "matchups" || Boolean(input.matchupsEnabled);
      const draft: League | null = uid
        ? {
            optimistic: true,
            id: leagueId,
            name: input.name,
            code: "",
            mode: input.mode ?? "bankroll",
            bracketTemplateId: input.mode === "bracket" ? (input.bracketTemplateId ?? null) : null,
            matchupsEnabled: h2h,
            matchupCadence: input.matchupCadence ?? "weekly",
            stimulusEnabled: Boolean(input.stimulusEnabled),
            stimulus: null,
            createdAt: now,
            startsAt,
            scheduledStart: startsAt > now,
            endsAt: leagueEndFor(input.duration, fixedDays, input.sports, startsAt),
            duration: input.duration,
            status: "active",
            creatorId: uid,
            startingLeagueTokens: input.startingLeagueTokens,
            buyIn: input.buyIn,
            pot: input.buyIn,
            prizeDistribution: input.prizeDistribution,
            allowedSports: input.sports,
            bankLoanEnabled: input.bankLoanEnabled,
            bankInterestRate: input.bankInterestRate,
            bankInterestIntervalHours: input.bankInterestIntervalHours,
            memberIds: [uid],
            members: {
              [uid]: {
                uid,
                displayName: myNameRef.current,
                avatarColor: "#E2564A",
                leagueTokens: input.startingLeagueTokens,
                startingLeagueTokens: input.startingLeagueTokens,
                joinedAt: now,
                betsWon: 0,
                betsLost: 0,
                betsPush: 0,
                pickPoints: 0,
                h2h: { w: 0, l: 0, t: 0 },
              },
            },
            endVotes: [],
            lastActivityAt: now,
            payoutStatus: "none",
          }
        : null;

      const attempt = async (): Promise<string | null> => {
        if (draft) {
          setDrafts((p) => ({ ...p, [leagueId]: draft }));
          setPending((p) => ({ ...p, [leagueId]: { id: leagueId, name: input.name, kind: "create" } }));
        }
        try {
          setError(null);
          const preset = input.prizeDistribution.preset === "custom" ? "winner-all" : input.prizeDistribution.preset;
          const res = await api.createLeague({
            idempotencyKey: key,
            name: input.name,
            startingLeagueTokens: input.startingLeagueTokens,
            duration: input.duration,
            sports: input.sports,
            buyIn: input.buyIn,
            prizePreset: preset,
            bankLoanEnabled: input.bankLoanEnabled,
            bankInterestRate: input.bankInterestRate,
            bankInterestIntervalHours: input.bankInterestIntervalHours,
            mode: input.mode ?? "bankroll",
            matchupsEnabled: h2h,
            matchupCadence: input.matchupCadence ?? "weekly",
            stimulusEnabled: Boolean(input.stimulusEnabled),
            ...(input.mode === "bracket" && input.bracketTemplateId ? { bracketTemplateId: input.bracketTemplateId } : {}),
            ...(input.startsAt ? { startNow: false, startsAt: input.startsAt } : { startNow: true }),
          });
          if (!res.duplicate) {
            trackEvent("league_created", {
              league_id: res.leagueId,
              duration: input.duration,
              buy_in: input.buyIn,
              starting_tokens: input.startingLeagueTokens,
              sports: input.sports.length,
              bank: input.bankLoanEnabled,
            });
          }
          // It's real now: the draft (with its invite code) joins `leagues` until the listener delivers the server's copy.
          if (draft) await seedLeague(res.leagueId, { ...draft, optimistic: undefined, code: res.code });
          dropKey(setDrafts, leagueId);
          dropKey(setPending, leagueId);
          return null;
        } catch (err) {
          const msg = api.friendlyError(err);
          setPending((p) => ({
            ...p,
            [leagueId]: { id: leagueId, name: input.name, kind: "create", error: msg, retry: () => void attempt() },
          }));
          return msg;
        }
      };
      return { leagueId, done: attempt() };
    },
    [uid, seedLeague]
  );

  const createLeague = useCallback(
    async (input: CreateLeagueInput) => {
      const { leagueId, done } = startLeague(input);
      const err = await done;
      if (err) {
        dropKey(setDrafts, leagueId);
        dropKey(setPending, leagueId);
        return { error: err };
      }
      return { leagueId };
    },
    [startLeague]
  );

  const joinLeague = useCallback(
    async (code: string, source: JoinSource = "code", preview?: JoinPreview) => {
      if (preview) setPending((p) => ({ ...p, [preview.leagueId]: { id: preview.leagueId, name: preview.name, kind: "join" } }));
      try {
        const res = await api.joinLeague({ code: code.trim().toUpperCase() });
        if (!res.duplicate) trackEvent("league_joined", { league_id: res.leagueId, source });
        // Until the leagues listener notices the new membership, the league
        // screen waits on this entry instead of saying "not found".
        if (!serverLeaguesRef.current.some((l) => l.id === res.leagueId)) {
          setPending((p) => ({ ...p, [res.leagueId]: { id: res.leagueId, name: p[res.leagueId]?.name ?? preview?.name ?? "", kind: "join" } }));
        }
        await seedLeague(res.leagueId, res.league);
        return { leagueId: res.leagueId };
      } catch (err) {
        const msg = api.friendlyError(err);
        if (preview) setPending((p) => ({ ...p, [preview.leagueId]: { id: preview.leagueId, name: preview.name, kind: "join", error: msg } }));
        return { error: msg };
      }
    },
    [seedLeague]
  );

  const sendMessage = useCallback(
    async (leagueId: string, rawText: string, replyTo?: LeagueMessage["replyTo"], gameId?: string): Result => {
      const text = rawText.trim();
      if (!text) return "Write a message first.";
      if (text.length > 500) return "Messages are capped at 500 characters.";
      if (isObjectionable(text)) return BLOCKED_TEXT_ERROR;
      const league = leaguesRef.current.find((l) => l.id === leagueId);
      if (!league || !uid) return "You're not signed in to this league.";
      const me = league.members?.[uid];
      if (!me) return "You're not in this league.";
      const db = getDb();
      if (!db) return null;
      const msgId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        // Not awaited: Firestore shows the local write in the chat at once; a rejection comes back as a toast.
        void setDoc(doc(db, "leagues", leagueId, "messages", msgId), {
          uid,
          name: me.displayName,
          kind: "text",
          text,
          at: Date.now(),
          createdAt: serverTimestamp(),
          ...(replyTo ? { replyTo } : {}),
          // Game-thread messages carry the game; they still show in league chat.
          ...(gameId ? { gameId } : {}),
          reactions: {},
          reactors: {},
        }).catch((err) => reportSyncFailure(api.friendlyError(err), "The message wasn't sent."));
        return null;
      } catch (err) {
        return api.friendlyError(err);
      }
    },
    [uid, reportSyncFailure]
  );

  const value = useMemo<LeagueContextType>(
    () => {
      const closed = new Set(closedKey ? closedKey.split(",") : []);
      return {
        ready,
        uid,
        leagues,
        activeLeagues: leagues.filter((l) => !closed.has(l.id)),
        getLeague: (id) => leagues.find((l) => l.id === id) ?? drafts[id],
        pendingLeague: (id) => pending[id],
        dismissPending: (id) => {
          dropKey(setPending, id);
          dropKey(setDrafts, id);
        },
        optimisticBets,
        optimisticPicks,
        isClosed: (id) => {
          const l = leaguesRef.current.find((x) => x.id === id);
          return !!l && isLeagueClosed(l);
        },
        myLeagueBets,
        error,
        clearError: () => setError(null),
        createLeague,
        startLeague,
        joinLeague,
        // Awaited (it can be refused: open bets, loans), but once the server agrees the league is gone from the list at once.
        leaveLeague: (leagueId) =>
          guarded(leagueId, `leave:${leagueId}`, async () => {
            await api.leaveLeague({ leagueId });
            dropKey(setSeeded, leagueId);
            setLeft((p) => ({ ...p, [leagueId]: true }));
          }),
        endLeague: (leagueId) => guarded(leagueId, `end:${leagueId}`, () => api.endLeague({ leagueId })),
        voteEndLeague: (leagueId, vote) =>
          instant(
            leagueId,
            `voteend:${leagueId}`,
            () => api.voteEndLeague({ leagueId, vote }),
            () => {
              setVoteOpt((p) => ({ ...p, [leagueId]: vote }));
              return (ok) => {
                if (ok) setTimeout(() => dropKey(setVoteOpt, leagueId), SETTLE_MS);
                else dropKey(setVoteOpt, leagueId);
              };
            }
          ),
        updateBankSettings: (leagueId, bankLoanEnabled, bankInterestRate, bankInterestIntervalHours) =>
          guarded(leagueId, `bank:${leagueId}`, () =>
            api.updateLeagueSettings({ leagueId, bankLoanEnabled, bankInterestRate, bankInterestIntervalHours })
          ),
        updateLeagueSettings: (args) =>
          guarded(args.leagueId, `settings:${args.leagueId}`, () => api.updateLeagueSettings(args)),
        // Awaited (not instant) so the Invite button only says "Invited" once the server has sent it.
        inviteFriend: (leagueId, friendUid) =>
          guarded(leagueId, `invite:${leagueId}:${friendUid}`, () => api.inviteToLeague({ leagueId, friendUid })),
        placeLeagueBet: ({ preview, ...args }) =>
          instant(
            args.leagueId,
            `lbet:${args.idempotencyKey}`,
            () => api.placeLeagueBet(args),
            () => {
              // Same id the server gives it (placeLeagueBet), so the listener's copy replaces this one.
              const id = `${uid}_${args.idempotencyKey}`;
              const release = holdTokens(args.leagueId, `bet:${id}`, -args.stake);
              if (preview && uid) {
                const bet: LeagueBet = {
                  ...preview,
                  id,
                  leagueId: args.leagueId,
                  uid,
                  displayName: myNameRef.current,
                  gameId: args.gameId,
                  stake: args.stake,
                  potentialPayout: Math.round(args.stake * preview.odds),
                  status: "pending",
                  placedAt: Date.now(),
                  lock: !!args.lock,
                  hidden: !!args.hidden,
                  tailOf: args.tailOf ?? null,
                  fadeOf: args.fadeOf ?? null,
                };
                setOptBets((p) => ({ ...p, [id]: bet }));
              }
              return (ok) => {
                release(ok);
                // Confirmed bets stay until the bets listener shows them.
                if (!ok) dropKey(setOptBets, id);
              };
            }
          ),
        reportResult: (leagueId, betId, reason) =>
          instant(leagueId, `dispute:${betId}`, () => api.reportResult({ leagueId, betId, reason })),
        voidLeagueBet: (leagueId, betId, reason) =>
          instant(leagueId, `void:${betId}`, () => api.voidLeagueBet({ leagueId, betId, reason })),
        reactToItem: (leagueId, targetType, targetId, emoji) =>
          instant(leagueId, `react:${targetId}:${emoji}`, () => {
            trackEvent("reaction_sent", { target_type: targetType });
            return api.reactToItem({ leagueId, targetType, targetId, emoji });
          }),
        sendMessage,
        makePick: (leagueId, gameId, side, preview) =>
          instant(
            leagueId,
            `pick:${leagueId}:${gameId}`,
            () => api.makePick({ leagueId, gameId, side }),
            () => {
              const league = leaguesRef.current.find((l) => l.id === leagueId);
              if (!preview || !uid || !league || (league.mode !== "pickem" && league.mode !== "survivor")) return () => {};
              const week = weekKey(preview.startsAt || Date.now());
              // Same id the server uses (functions/src/callable/picks.ts): one pick a week in survivor, one a game in pick'em.
              const id = league.mode === "survivor" ? `${uid}_${week}` : `${uid}_${gameId}`;
              const key = `${leagueId}:${id}`;
              const pick: LeaguePick = {
                ...preview,
                id,
                leagueId,
                uid,
                displayName: myNameRef.current,
                mode: league.mode,
                week,
                gameId,
                side,
                status: "pending",
                placedAt: Date.now(),
                settledAt: null,
              };
              setOptPicks((p) => ({ ...p, [key]: pick }));
              return (ok) => {
                if (ok) setTimeout(() => setOptPicks((p) => (p[key] === pick ? Object.fromEntries(Object.entries(p).filter(([k]) => k !== key)) : p)), SETTLE_MS);
                else setOptPicks((p) => (p[key] === pick ? Object.fromEntries(Object.entries(p).filter(([k]) => k !== key)) : p));
              };
            }
          ),
        createGroupParlay: (args) =>
          guarded(args.leagueId, `parlay:${args.idempotencyKey}`, () => api.createGroupParlay(args)),
        addParlayLeg: (args) =>
          instant(args.leagueId, `pleg:${args.parlayId}:${args.gameId}`, () => api.addParlayLeg(args)),
        rideParlay: (leagueId, parlayId, stake) =>
          instant(leagueId, `pride:${parlayId}`, () => api.rideParlay({ leagueId, parlayId, stake })),
        lockParlay: (leagueId, parlayId) =>
          instant(leagueId, `plock:${parlayId}`, () => api.lockParlay({ leagueId, parlayId })),
        stimulus: (args) => instant(args.leagueId, `stimulus:${args.leagueId}`, () => api.leagueStimulus(args)),
        takeBankLoan: (leagueId, amount) =>
          instant(
            leagueId,
            `borrow:${leagueId}`,
            () => api.takeBankLoan({ leagueId, amount, idempotencyKey: api.newIdempotencyKey() }),
            () => holdTokens(leagueId, `borrow:${leagueId}`, amount)
          ),
        repayLoan: (leagueId, loanId, amount) =>
          instant(
            leagueId,
            `repay:${loanId}`,
            () => api.repayLoan({ leagueId, loanId, amount, idempotencyKey: api.newIdempotencyKey() }),
            () => holdTokens(leagueId, `repay:${loanId}`, -amount)
          ),
        requestLoan: (leagueId, amount, rate, message) => {
          if (!PEER_LOAN_REQUESTS_ENABLED) {
            setError(LOAN_REQUESTS_CLOSED_MESSAGE);
            return Promise.resolve(LOAN_REQUESTS_CLOSED_MESSAGE);
          }
          return instant(leagueId, `request:${leagueId}`, () =>
            api.requestPeerLoan({ leagueId, amount, rate, message, idempotencyKey: api.newIdempotencyKey() })
          );
        },
        peerLoanAction: (leagueId, loanId, action, rate, amount, message) =>
          instant(leagueId, `peer:${loanId}`, () => api.peerLoanAction({ leagueId, loanId, action, rate, amount, message })),
      };
    },
    [ready, uid, leagues, drafts, pending, optimisticBets, optimisticPicks, closedKey, myLeagueBets, error, createLeague, startLeague, joinLeague, guarded, instant, holdTokens, run, sendMessage]
  );

  return <LeagueContext.Provider value={value}>{children}</LeagueContext.Provider>;
}

export function useLeague() {
  const ctx = useContext(LeagueContext);
  if (!ctx) throw new Error("useLeague must be inside LeagueProvider");
  return ctx;
}

export interface LeagueDetail {
  loans: LeagueLoan[];
  bets: LeagueBet[];
  activity: LeagueActivity[];
  messages: LeagueMessage[];
  audit: LeagueAuditEntry[];
  reports: LeagueReport[];
  matchups: LeagueMatchupDoc[];
  picks: LeaguePick[];
  parlays: LeagueParlay[];
  rivalries: LeagueRivalry[];
  standings: Standing[];
  loading: boolean;
  now: number;
}

/**
 * Everything one league screen needs, live. Standings are derived from the
 * member map plus the loan book, so they move the moment interest ticks over
 * or a loan is repaid, with no write.
 */
export function useLeagueDetail(league: League | undefined): LeagueDetail {
  const { optimisticBets, optimisticPicks } = useLeague();
  const [loans, setLoans] = useState<LeagueLoan[]>([]);
  const [serverBets, setBets] = useState<LeagueBet[]>([]);
  const [activity, setActivity] = useState<LeagueActivity[]>([]);
  const [rawMessages, setMessages] = useState<LeagueMessage[]>([]);
  const blockedUids = useBlockedUids();
  // Blocked players' chat is hidden (their bets still count in standings).
  const messages = useMemo(() => (blockedUids.size ? rawMessages.filter((m) => !m.uid || !blockedUids.has(m.uid)) : rawMessages), [rawMessages, blockedUids]);
  const [audit, setAudit] = useState<LeagueAuditEntry[]>([]);
  const [reports, setReports] = useState<LeagueReport[]>([]);
  const [matchups, setMatchups] = useState<LeagueMatchupDoc[]>([]);
  const [serverPicks, setPicks] = useState<LeaguePick[]>([]);
  const [parlays, setParlays] = useState<LeagueParlay[]>([]);
  const [rivalries, setRivalries] = useState<LeagueRivalry[]>([]);
  const [loading, setLoading] = useState(true);
  const now = useNow(30_000);
  const leagueId = league?.id;
  // A league still being created isn't on the server: listening to it would be refused, and a refused listener never retries.
  const draft = !!league?.optimistic;

  // Bets and picks made on this phone show at once; the listener's copy replaces them.
  const bets = useMemo(() => {
    const mine = optimisticBets.filter((b) => b.leagueId === leagueId && !serverBets.some((x) => x.id === b.id));
    return mine.length ? [...mine, ...serverBets] : serverBets;
  }, [optimisticBets, serverBets, leagueId]);
  const picks = useMemo(() => {
    const mine = optimisticPicks.filter((p) => p.leagueId === leagueId);
    if (!mine.length) return serverPicks;
    const ids = new Set(mine.map((p) => p.id));
    return [...mine, ...serverPicks.filter((p) => !ids.has(p.id))];
  }, [optimisticPicks, serverPicks, leagueId]);

  useEffect(() => {
    if (!leagueId) return;
    // Switching leagues: don't show the last league's data under this one's name while it loads.
    setLoans([]);
    setBets([]);
    setActivity([]);
    setMessages([]);
    setAudit([]);
    setReports([]);
    setMatchups([]);
    setPicks([]);
    setParlays([]);
    setRivalries([]);
    if (draft) {
      setLoading(false);
      return;
    }
    if (DEMO) {
      setLoans(demoLoans[leagueId] ?? []);
      setBets(demoLeagueBets[leagueId] ?? []);
      setActivity(demoActivity[leagueId] ?? []);
      setLoading(false);
      return;
    }
    const db = getDb();
    if (!db) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsubs = [
      onSnapshot(
        collection(db, "leagues", leagueId, "loans"),
        (s) => {
          setLoans(s.docs.map((d) => ({ ...(d.data() as LeagueLoan), id: d.id })));
          setLoading(false);
        },
        () => setLoading(false)
      ),
      onSnapshot(
        query(collection(db, "leagues", leagueId, "leagueBets"), orderBy("placedAt", "desc"), limit(100)),
        (s) => setBets(s.docs.map((d) => normalizeLeagueBet(d.id, d.data()))),
        () => {}
      ),
      onSnapshot(
        query(collection(db, "leagues", leagueId, "activity"), orderBy("at", "desc"), limit(50)),
        (s) => setActivity(s.docs.map((d) => ({ ...(d.data() as LeagueActivity), id: d.id }))),
        () => {}
      ),
      onSnapshot(
        query(collection(db, "leagues", leagueId, "messages"), orderBy("at", "desc"), limit(80)),
        (s) => setMessages(s.docs.map((d) => ({ ...(d.data() as LeagueMessage), id: d.id }))),
        () => {}
      ),
      onSnapshot(
        query(collection(db, "leagues", leagueId, "audit"), orderBy("at", "desc"), limit(50)),
        (s) => setAudit(s.docs.map((d) => ({ ...(d.data() as LeagueAuditEntry), id: d.id }))),
        () => {}
      ),
      onSnapshot(
        collection(db, "leagues", leagueId, "reports"),
        (s) =>
          setReports(
            s.docs
              .map((d) => ({ ...(d.data() as LeagueReport), id: d.id }))
              .sort((a, b) => (b.generatedAt ?? 0) - (a.generatedAt ?? 0))
          ),
        () => {}
      ),
      onSnapshot(
        collection(db, "leagues", leagueId, "matchups"),
        (s) =>
          setMatchups(
            s.docs
              .map((d) => ({ ...(d.data() as LeagueMatchupDoc), id: d.id }))
              .sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0))
          ),
        () => {}
      ),
      onSnapshot(
        query(collection(db, "leagues", leagueId, "picks"), orderBy("placedAt", "desc"), limit(150)),
        (s) => setPicks(s.docs.map((d) => ({ ...(d.data() as LeaguePick), id: d.id }))),
        () => {}
      ),
      onSnapshot(
        query(collection(db, "leagues", leagueId, "parlays"), orderBy("createdAt", "desc"), limit(50)),
        (s) => setParlays(s.docs.map((d) => ({ ...(d.data() as LeagueParlay), id: d.id }))),
        () => {}
      ),
      onSnapshot(
        collection(db, "leagues", leagueId, "rivalries"),
        (s) => setRivalries(s.docs.map((d) => ({ ...(d.data() as LeagueRivalry), id: d.id }))),
        () => {}
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [leagueId, draft]);

  const standings = useMemo(() => {
    if (!league) return [];
    const asOf = league.status === "ended" ? (league.endedAt ?? league.endsAt) : Math.min(now, league.endsAt);
    return rankByMode(
      rankMembers(
        Object.values(league.members ?? {}).map((m) => ({ uid: m.uid, leagueTokens: m.leagueTokens, joinedAt: m.joinedAt })),
        loans,
        asOf
      ),
      league.mode,
      (u) => league.members?.[u]?.h2h,
      (u) => league.members?.[u]
    );
  }, [league, loans, now]);

  return {
    loans,
    bets,
    activity,
    messages,
    audit,
    reports,
    matchups,
    picks,
    parlays,
    rivalries,
    standings,
    loading,
    now,
  };
}

/**
 * Sweat tracker hook for `app/game/[id].tsx`: reads one `gameSides/{gameId}`
 * document per active league the user is in, plus rivalry records in those leagues.
 */
export function useGameLeagueSweat(gameId: string | undefined): {
  byLeague: Array<{ league: League; sides: GameSidesDoc; rivalries: LeagueRivalry[] }>;
} {
  const { activeLeagues } = useLeague();
  const [sidesMap, setSidesMap] = useState<Record<string, GameSidesDoc>>({});
  const [rivMap, setRivMap] = useState<Record<string, LeagueRivalry[]>>({});
  const key = activeLeagues.map((l) => l.id).join(",");

  useEffect(() => {
    if (DEMO || !gameId || !key) {
      setSidesMap({});
      setRivMap({});
      return;
    }
    const db = getDb();
    if (!db) return;
    const ids = key.split(",");
    const unsubs: Array<() => void> = [];
    for (const leagueId of ids) {
      unsubs.push(
        onSnapshot(
          doc(db, "leagues", leagueId, "gameSides", gameId),
          (snap) => {
            if (!snap.exists()) {
              setSidesMap((prev) => {
                const next = { ...prev };
                delete next[leagueId];
                return next;
              });
              return;
            }
            setSidesMap((prev) => ({
              ...prev,
              [leagueId]: { ...(snap.data() as GameSidesDoc), id: snap.id },
            }));
          },
          () => {}
        )
      );
      unsubs.push(
        onSnapshot(
          collection(db, "leagues", leagueId, "rivalries"),
          (snap) => {
            setRivMap((prev) => ({
              ...prev,
              [leagueId]: snap.docs.map((d) => ({ ...(d.data() as LeagueRivalry), id: d.id })),
            }));
          },
          () => {}
        )
      );
    }
    return () => unsubs.forEach((u) => u());
  }, [gameId, key]);

  const byLeague = useMemo(
    () =>
      activeLeagues
        .map((league) => {
          const sides = sidesMap[league.id];
          if (!sides || !sides.entries?.length) return null;
          return {
            league,
            sides,
            rivalries: rivMap[league.id] ?? [],
          };
        })
        .filter((x): x is { league: League; sides: GameSidesDoc; rivalries: LeagueRivalry[] } => x !== null),
    [activeLeagues, sidesMap, rivMap]
  );

  return { byLeague };
}

/**
 * Games board: who in your leagues is on each game ("League is on this").
 * One listener per active league over recently-updated gameSides docs. Returns
 * names only, never sides or stakes, so hidden picks stay hidden.
 */
export interface BoardLeagueSide {
  uid: string;
  displayName: string;
  avatarColor: string;
  /** null = hidden pick; never resolved to a side client-side before kickoff. */
  side: "home" | "away" | null;
  betId: string;
  leagueId: string;
}

export function useBoardLeagueSides(myUid: string | null | undefined): Map<string, BoardLeagueSide[]> {
  const { activeLeagues } = useLeague();
  const [docs, setDocs] = useState<Record<string, GameSidesDoc[]>>({});
  const key = activeLeagues.map((l) => l.id).join(",");

  useEffect(() => {
    if (DEMO || !key) {
      setDocs({});
      return;
    }
    const db = getDb();
    if (!db) return;
    const since = Date.now() - 36 * 3600_000;
    const unsubs = key.split(",").map((leagueId) =>
      onSnapshot(
        query(collection(db, "leagues", leagueId, "gameSides"), where("updatedAt", ">=", since), limit(100)),
        (snap) => setDocs((prev) => ({ ...prev, [leagueId]: snap.docs.map((d) => ({ ...(d.data() as GameSidesDoc), id: d.id })) })),
        () => {}
      )
    );
    return () => unsubs.forEach((u) => u());
  }, [key]);

  return useMemo(() => {
    const out = new Map<string, BoardLeagueSide[]>();
    for (const [leagueId, list] of Object.entries(docs)) {
      for (const d of list) {
        const gameId = d.gameId ?? d.id;
        const arr = out.get(gameId) ?? [];
        for (const e of d.entries ?? []) {
          if (!e.uid || e.uid === myUid || arr.some((x) => x.uid === e.uid)) continue;
          arr.push({
            uid: e.uid,
            displayName: e.displayName || e.name || "Player",
            avatarColor: "",
            side: e.side ?? null,
            betId: e.betId,
            leagueId,
          });
        }
        if (arr.length) out.set(gameId, arr);
      }
    }
    return out;
  }, [docs, myUid]);
}

export interface LeagueSummary {
  league: League;
  standings: Standing[];
  me: Standing | null;
  memberCount: number;
  daysLeft: number;
  /** Ended, or past endsAt — read-only. */
  closed: boolean;
}

export function useLeagueSummaries(): { summaries: LeagueSummary[]; totalDebt: number } {
  const { leagues, uid } = useLeague();
  const now = useNow(60_000);
  const [loans, setLoans] = useState<Record<string, LeagueLoan[]>>(DEMO ? demoLoans : {});
  const key = leagues.filter((l) => l.status === "active").map((l) => l.id).join(",");

  useEffect(() => {
    if (DEMO) return;
    const db = getDb();
    if (!db || !key) {
      setLoans({});
      return;
    }
    const unsubs = key.split(",").map((leagueId) =>
      onSnapshot(
        query(collection(db, "leagues", leagueId, "loans"), where("status", "==", "active")),
        (s) => setLoans((p) => ({ ...p, [leagueId]: s.docs.map((d) => ({ ...(d.data() as LeagueLoan), id: d.id })) })),
        () => {}
      )
    );
    return () => unsubs.forEach((u) => u());
  }, [key]);

  return useMemo(() => {
    let totalDebt = 0;
    const summaries = leagues.map((league) => {
      const ended = league.status === "ended";
      const asOf = ended ? (league.endedAt ?? league.endsAt) : Math.min(now, league.endsAt);
      const members = Object.values(league.members ?? {});
      let standings: Standing[];
      if (ended && league.results?.length) {
        standings = league.results.map((r) => ({
          uid: r.memberId,
          rank: r.rank,
          tokens: r.leagueTokens,
          debt: r.debt ?? 0,
          bankDebt: 0,
          peerDebt: 0,
          receivable: r.receivable ?? 0,
          netWorth: r.netWorth ?? r.leagueTokens,
        }));
      } else {
        standings = rankByMode(
          rankMembers(
            members.map((m) => ({ uid: m.uid, leagueTokens: m.leagueTokens, joinedAt: m.joinedAt })),
            loans[league.id] ?? [],
            asOf
          ),
          league.mode,
          (u) => league.members?.[u]?.h2h,
          (u) => league.members?.[u]
        );
      }
      const me = standings.find((s) => s.uid === uid) ?? null;
      const closed = isLeagueClosed(league, now);
      if (!closed && me) totalDebt += me.debt;
      return {
        league,
        standings,
        me,
        memberCount: members.length || standings.length,
        daysLeft: Math.max(0, Math.ceil((league.endsAt - now) / 86_400_000)),
        closed,
      };
    });
    return { summaries, totalDebt };
  }, [leagues, loans, now, uid]);
}
