import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
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
  type League,
  type LeagueActivity,
  type LeagueBet,
  type LeagueDuration,
  type LeagueLoan,
  type PrizeDistribution,
  type Sport,
} from "@/constants/leagueTypes";
import { useNow } from "@/hooks/useNow";
import * as api from "@/lib/api";
import { firebaseConfigured, getDb } from "@/lib/firebase";
import { DEMO, demoActivity, demoLeagueBets, demoLeagues, demoLoans } from "@/lib/demo";
import { rankMembers, type Standing } from "@/lib/loanMath";

/**
 * Leagues, read-only on the client.
 *
 * The previous provider kept a full local copy of every league (AsyncStorage,
 * or a Firestore doc it wrote itself), applied bank interest on app load —
 * compounding, and only in local mode — and let "approve loan" mint tokens.
 * None of that survives. This provider:
 *
 *  - subscribes to the leagues you're a member of and to your own league bets
 *  - exposes callables for every change; the server decides and the listeners
 *    deliver the result
 *  - computes standings and loan balances from the shared, pure `loanMath`,
 *    the same file the server uses, so the number on screen is the number the
 *    season will end on
 */

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
}

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
  joinLeague: (code: string) => Promise<{ leagueId: string } | { error: string }>;
  leaveLeague: (leagueId: string) => Result;
  endLeague: (leagueId: string) => Result;
  updateBankSettings: (leagueId: string, enabled: boolean, rate: number, intervalHours: number) => Result;
  inviteFriend: (leagueId: string, friendUid: string) => Result;
  placeLeagueBet: (args: {
    leagueId: string;
    gameId: string;
    side: "home" | "away";
    stake: number;
    idempotencyKey: string;
    expectedOdds?: number;
  }) => Result;
  takeBankLoan: (leagueId: string, amount: number) => Result;
  repayLoan: (leagueId: string, loanId: string, amount: number) => Result;
  requestLoan: (leagueId: string, amount: number, rate: number, message?: string) => Result;
  peerLoanAction: (leagueId: string, loanId: string, action: api.PeerLoanActionName, rate?: number) => Result;
}

const LeagueContext = createContext<LeagueContextType | null>(null);

const NO_LEAGUES: League[] = [];

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
  // String key so the context value only changes when a league actually closes.
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

  // Your own bets in each league. One listener per league; a user is in a
  // handful at most.
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
            [leagueId]: snap.docs.map((d) => ({ ...(d.data() as LeagueBet), id: d.id })),
          })),
        () => {}
      )
    );
    // Drop leagues you're no longer in.
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

  /** Read-only guard: no mutation reaches the server for a closed league. */
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
        });
        return { leagueId: res.leagueId };
      } catch (err) {
        return { error: api.friendlyError(err) };
      }
    },
    []
  );

  const joinLeague = useCallback(async (code: string) => {
    try {
      const res = await api.joinLeague({ code: code.trim().toUpperCase() });
      return { leagueId: res.leagueId };
    } catch (err) {
      return { error: api.friendlyError(err) };
    }
  }, []);

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
        updateBankSettings: (leagueId, bankLoanEnabled, bankInterestRate, bankInterestIntervalHours) =>
          guarded(leagueId, `bank:${leagueId}`, () =>
            api.updateLeagueSettings({ leagueId, bankLoanEnabled, bankInterestRate, bankInterestIntervalHours })
          ),
        inviteFriend: (leagueId, friendUid) =>
          guarded(leagueId, `invite:${leagueId}:${friendUid}`, () => api.inviteToLeague({ leagueId, friendUid })),
        placeLeagueBet: (args) => guarded(args.leagueId, `lbet:${args.idempotencyKey}`, () => api.placeLeagueBet(args)),
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
    [ready, uid, leagues, closedKey, myLeagueBets, error, createLeague, joinLeague, guarded]
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
      onSnapshot(collection(db, "leagues", leagueId, "loans"), (s) => {
        setLoans(s.docs.map((d) => ({ ...(d.data() as LeagueLoan), id: d.id })));
        setLoading(false);
      }, () => setLoading(false)),
      onSnapshot(
        query(collection(db, "leagues", leagueId, "leagueBets"), orderBy("placedAt", "desc"), limit(100)),
        (s) => setBets(s.docs.map((d) => ({ ...(d.data() as LeagueBet), id: d.id }))),
        () => {}
      ),
      onSnapshot(
        query(collection(db, "leagues", leagueId, "activity"), orderBy("at", "desc"), limit(40)),
        (s) => setActivity(s.docs.map((d) => ({ ...(d.data() as LeagueActivity), id: d.id }))),
        () => {}
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [leagueId]);

  const standings = useMemo(() => {
    if (!league) return [];
    const asOf = league.status === "ended" ? (league.endedAt ?? league.endsAt) : Math.min(now, league.endsAt);
    return rankMembers(
      Object.values(league.members ?? {}).map((m) => ({ uid: m.uid, leagueTokens: m.leagueTokens, joinedAt: m.joinedAt })),
      loans,
      asOf
    );
  }, [league, loans, now]);

  return { loans, bets, activity, standings, loading, now };
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

/**
 * Rank, net worth and debt for every league you're in, live — for Home and the
 * Leagues overview. One listener per league on its active loans (bank and
 * peer), because standings rank on net worth and net worth needs the loan book.
 */
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
        standings = rankMembers(
          members.map((m) => ({ uid: m.uid, leagueTokens: m.leagueTokens, joinedAt: m.joinedAt })),
          loans[league.id] ?? [],
          asOf
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
