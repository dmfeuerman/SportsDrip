import {
  collection,
  doc,
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
import { useNow } from "@/hooks/useNow";
import { trackEvent } from "@/lib/analytics";
import * as api from "@/lib/api";
import { firebaseConfigured, getDb } from "@/lib/firebase";
import { DEMO, demoActivity, demoLeagueBets, demoLeagues, demoLoans } from "@/lib/demo";
import { rankByMode, rankMembers, type Standing } from "@/lib/loanMath";

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
}

export type JoinSource = "code" | "link" | "signup" | "notification";

/** Every mutation resolves to an error message, or null on success. */
type Result = Promise<string | null>;

interface LeagueContextType {
  ready: boolean;
  uid: string | null;
  leagues: League[];
  /** Leagues still open for play — excludes closed (ended or past endsAt). */
  activeLeagues: League[];
  getLeague: (id: string) => League | undefined;
  isClosed: (id: string) => boolean;
  /** Your open + settled league bets, per league. */
  myLeagueBets: Record<string, LeagueBet[]>;
  error: string | null;
  clearError: () => void;

  createLeague: (input: CreateLeagueInput) => Promise<{ leagueId: string } | { error: string }>;
  /** `source` is analytics only: where the code came from. */
  joinLeague: (code: string, source?: JoinSource) => Promise<{ leagueId: string } | { error: string }>;
  leaveLeague: (leagueId: string) => Result;
  endLeague: (leagueId: string) => Result;
  voteEndLeague: (leagueId: string, vote: boolean) => Result;
  updateBankSettings: (leagueId: string, enabled: boolean, rate: number, intervalHours: number) => Result;
  updateLeagueSettings: (args: api.UpdateLeagueSettingsArgs) => Result;
  inviteFriend: (leagueId: string, friendUid: string) => Result;
  placeLeagueBet: (args: api.PlaceLeagueBetArgs) => Result;
  reportResult: (leagueId: string, betId: string, reason: string) => Result;
  voidLeagueBet: (leagueId: string, betId: string, reason: string) => Result;
  reactToItem: (
    leagueId: string,
    targetType: "message" | "messages" | "activity" | "bet" | "leagueBets",
    targetId: string,
    emoji: ReactionEmoji
  ) => Result;
  sendMessage: (leagueId: string, text: string, replyTo?: LeagueMessage["replyTo"], gameId?: string) => Result;
  makePick: (leagueId: string, gameId: string, side: "home" | "away") => Result;
  createGroupParlay: (args: Parameters<typeof api.createGroupParlay>[0]) => Result;
  addParlayLeg: (args: Parameters<typeof api.addParlayLeg>[0]) => Result;
  rideParlay: (leagueId: string, parlayId: string, stake: number) => Result;
  lockParlay: (leagueId: string, parlayId: string) => Result;
  takeBankLoan: (leagueId: string, amount: number) => Result;
  repayLoan: (leagueId: string, loanId: string, amount: number) => Result;
  requestLoan: (leagueId: string, amount: number, rate: number, message?: string) => Result;
  peerLoanAction: (leagueId: string, loanId: string, action: api.PeerLoanActionName, rate?: number) => Result;
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
  const [leagues, setLeagues] = useState<League[]>(DEMO ? demoLeagues : NO_LEAGUES);
  const [myLeagueBets, setMyLeagueBets] = useState<Record<string, LeagueBet[]>>(
    DEMO ? Object.fromEntries(Object.entries(demoLeagueBets).map(([k, v]) => [k, v.filter((b) => b.uid === uid)])) : {}
  );
  const [ready, setReady] = useState(DEMO);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<Set<string>>(new Set());
  const leaguesRef = useRef(leagues);
  leaguesRef.current = leagues;
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

  const createLeague = useCallback(
    async (input: CreateLeagueInput) => {
      try {
        setError(null);
        const preset = input.prizeDistribution.preset === "custom" ? "winner-all" : input.prizeDistribution.preset;
        const res = await api.createLeague({
          idempotencyKey: api.newIdempotencyKey(),
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
          matchupsEnabled: input.mode === "matchups" || Boolean(input.matchupsEnabled),
          matchupCadence: input.matchupCadence ?? "weekly",
          stimulusEnabled: Boolean(input.stimulusEnabled),
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
        return { leagueId: res.leagueId };
      } catch (err) {
        return { error: api.friendlyError(err) };
      }
    },
    []
  );

  const joinLeague = useCallback(async (code: string, source: JoinSource = "code") => {
    try {
      const res = await api.joinLeague({ code: code.trim().toUpperCase() });
      if (!res.duplicate) trackEvent("league_joined", { league_id: res.leagueId, source });
      return { leagueId: res.leagueId };
    } catch (err) {
      return { error: api.friendlyError(err) };
    }
  }, []);

  const sendMessage = useCallback(
    async (leagueId: string, rawText: string, replyTo?: LeagueMessage["replyTo"], gameId?: string): Result => {
      const text = rawText.trim();
      if (!text) return "Write a message first.";
      if (text.length > 500) return "Messages are capped at 500 characters.";
      const league = leaguesRef.current.find((l) => l.id === leagueId);
      if (!league || !uid) return "You're not signed in to this league.";
      const me = league.members?.[uid];
      if (!me) return "You're not in this league.";
      const db = getDb();
      if (!db) return null;
      const msgId = `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        await setDoc(doc(db, "leagues", leagueId, "messages", msgId), {
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
        });
        return null;
      } catch (err) {
        return api.friendlyError(err);
      }
    },
    [uid]
  );

  const value = useMemo<LeagueContextType>(
    () => {
      const closed = new Set(closedKey ? closedKey.split(",") : []);
      return {
        ready,
        uid,
        leagues,
        activeLeagues: leagues.filter((l) => !closed.has(l.id)),
        getLeague: (id) => leagues.find((l) => l.id === id),
        isClosed: (id) => {
          const l = leaguesRef.current.find((x) => x.id === id);
          return !!l && isLeagueClosed(l);
        },
        myLeagueBets,
        error,
        clearError: () => setError(null),
        createLeague,
        joinLeague,
        leaveLeague: (leagueId) => guarded(leagueId, `leave:${leagueId}`, () => api.leaveLeague({ leagueId })),
        endLeague: (leagueId) => guarded(leagueId, `end:${leagueId}`, () => api.endLeague({ leagueId })),
        voteEndLeague: (leagueId, vote) =>
          guarded(leagueId, `voteend:${leagueId}`, () => api.voteEndLeague({ leagueId, vote })),
        updateBankSettings: (leagueId, bankLoanEnabled, bankInterestRate, bankInterestIntervalHours) =>
          guarded(leagueId, `bank:${leagueId}`, () =>
            api.updateLeagueSettings({ leagueId, bankLoanEnabled, bankInterestRate, bankInterestIntervalHours })
          ),
        updateLeagueSettings: (args) =>
          guarded(args.leagueId, `settings:${args.leagueId}`, () => api.updateLeagueSettings(args)),
        inviteFriend: (leagueId, friendUid) =>
          guarded(leagueId, `invite:${leagueId}:${friendUid}`, () => api.inviteToLeague({ leagueId, friendUid })),
        placeLeagueBet: (args) => guarded(args.leagueId, `lbet:${args.idempotencyKey}`, () => api.placeLeagueBet(args)),
        reportResult: (leagueId, betId, reason) =>
          run(`dispute:${betId}`, () => api.reportResult({ leagueId, betId, reason })),
        voidLeagueBet: (leagueId, betId, reason) =>
          guarded(leagueId, `void:${betId}`, () => api.voidLeagueBet({ leagueId, betId, reason })),
        reactToItem: (leagueId, targetType, targetId, emoji) =>
          run(`react:${targetId}:${emoji}`, () => api.reactToItem({ leagueId, targetType, targetId, emoji })),
        sendMessage,
        makePick: (leagueId, gameId, side) =>
          guarded(leagueId, `pick:${leagueId}:${gameId}`, () => api.makePick({ leagueId, gameId, side })),
        createGroupParlay: (args) =>
          guarded(args.leagueId, `parlay:${args.idempotencyKey}`, () => api.createGroupParlay(args)),
        addParlayLeg: (args) =>
          guarded(args.leagueId, `pleg:${args.parlayId}:${args.gameId}`, () => api.addParlayLeg(args)),
        rideParlay: (leagueId, parlayId, stake) =>
          guarded(leagueId, `pride:${parlayId}`, () => api.rideParlay({ leagueId, parlayId, stake })),
        lockParlay: (leagueId, parlayId) =>
          guarded(leagueId, `plock:${parlayId}`, () => api.lockParlay({ leagueId, parlayId })),
        stimulus: (args) => guarded(args.leagueId, `stimulus:${args.leagueId}`, () => api.leagueStimulus(args)),
        takeBankLoan: (leagueId, amount) =>
          guarded(leagueId, `borrow:${leagueId}`, () =>
            api.takeBankLoan({ leagueId, amount, idempotencyKey: api.newIdempotencyKey() })
          ),
        repayLoan: (leagueId, loanId, amount) =>
          guarded(leagueId, `repay:${loanId}`, () =>
            api.repayLoan({ leagueId, loanId, amount, idempotencyKey: api.newIdempotencyKey() })
          ),
        requestLoan: (leagueId, amount, rate, message) => {
          if (!PEER_LOAN_REQUESTS_ENABLED) {
            setError(LOAN_REQUESTS_CLOSED_MESSAGE);
            return Promise.resolve(LOAN_REQUESTS_CLOSED_MESSAGE);
          }
          return guarded(leagueId, `request:${leagueId}`, () =>
            api.requestPeerLoan({ leagueId, amount, rate, message, idempotencyKey: api.newIdempotencyKey() })
          );
        },
        peerLoanAction: (leagueId, loanId, action, rate) =>
          guarded(leagueId, `peer:${loanId}`, () => api.peerLoanAction({ leagueId, loanId, action, rate })),
      };
    },
    [ready, uid, leagues, closedKey, myLeagueBets, error, createLeague, joinLeague, guarded, run, sendMessage]
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
  const [loans, setLoans] = useState<LeagueLoan[]>([]);
  const [bets, setBets] = useState<LeagueBet[]>([]);
  const [activity, setActivity] = useState<LeagueActivity[]>([]);
  const [messages, setMessages] = useState<LeagueMessage[]>([]);
  const [audit, setAudit] = useState<LeagueAuditEntry[]>([]);
  const [reports, setReports] = useState<LeagueReport[]>([]);
  const [matchups, setMatchups] = useState<LeagueMatchupDoc[]>([]);
  const [picks, setPicks] = useState<LeaguePick[]>([]);
  const [parlays, setParlays] = useState<LeagueParlay[]>([]);
  const [rivalries, setRivalries] = useState<LeagueRivalry[]>([]);
  const [loading, setLoading] = useState(true);
  const now = useNow(30_000);
  const leagueId = league?.id;

  useEffect(() => {
    if (!leagueId) return;
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
  }, [leagueId]);

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
      (u) => league.members?.[u]?.h2h
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
export function useBoardLeagueSides(myUid: string | null | undefined): Map<string, Array<{ uid: string; displayName: string; avatarColor: string }>> {
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
    const out = new Map<string, Array<{ uid: string; displayName: string; avatarColor: string }>>();
    for (const list of Object.values(docs)) {
      for (const d of list) {
        const gameId = d.gameId ?? d.id;
        const arr = out.get(gameId) ?? [];
        for (const e of d.entries ?? []) {
          if (!e.uid || e.uid === myUid || arr.some((x) => x.uid === e.uid)) continue;
          arr.push({ uid: e.uid, displayName: e.displayName || e.name || "Player", avatarColor: "" });
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
          (u) => league.members?.[u]?.h2h
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
