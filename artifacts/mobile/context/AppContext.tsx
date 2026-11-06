import {
  collection,
  doc,
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
import * as api from "@/lib/api";
import { subscribeCached, toMillis } from "@/lib/cachedQuery";
import type { AvatarConfig, BoxTier, FavoriteTeam, PunishmentInfo, Slot, StreakInfo, UserStats } from "@/lib/api";
import type { TrophyItem } from "@/constants/leagueTypes";
import type { Market, Selection } from "@/lib/markets";
import { firebaseConfigured, getDb } from "@/lib/firebase";
import { firstAnswer } from "@/lib/devtrace";
import { SLOTS } from "@/lib/avatar3d/avatarRules";
import { DEMO, demoBets, demoCatalog, demoInventory, demoPrizeBoxes, demoProfile } from "@/lib/demo";
import { FREE_MOVES, loadoutOf, MAX_LOADOUT, MOVES_BY_ID } from "@/constants/moves";
import { backgroundOf, BACKGROUNDS_BY_ID, FREE_BACKGROUNDS } from "@/constants/backgrounds";
import { progressOf, type LevelProgress } from "@/constants/progression";

export interface Bet {
  id: string;
  uid: string;
  gameId: string;
  sport: string;
  side: "home" | "away";
  market?: Market;
  selection?: Selection;
  line?: number | null;
  label?: string;
  startsAt?: number | null;
  voidReason?: string | null;
  teamName: string;
  teamAbbr: string;
  teamColor: string;
  opponentAbbr: string;
  stake: number;
  odds: number;
  potentialPayout: number;
  status: "pending" | "won" | "lost" | "push" | "cancelled";
  opponentUid: string | null;
  placedAt: { seconds: number } | null;
  settledAt: { seconds: number } | null;
  finalHomeScore?: number;
  finalAwayScore?: number;
  /** The daily free bet: stake 0, potentialPayout is the winnings, the free stake never returns. */
  freeBet?: boolean;
  freeStake?: number;
  /** NY day the free bet belongs to. */
  freeDay?: string;
}

export interface PrizeBoxState {
  tier: BoxTier;
  state: "idle" | "waiting" | "ready" | "claimed";
  openedAt: number | null;
  readyAt: number | null;
  rewardCredits: number | null;
  baseCredits?: number | null;
  streakBonus?: number | null;
  streakDays?: number | null;
}

export interface Profile {
  /** Trophy pinned to the top of the public profile. */
  featuredTrophy?: string | null;
  uid: string;
  username: string;
  displayName: string;
  email: string | null;
  balance: number;
  avatar: AvatarConfig;
  equipped: Partial<Record<Slot, string>>;
  stats: UserStats;
  streak?: StreakInfo | null;
  /** Pending returning-player Prize Box (functions/src/scheduled/winBack.ts). */
  winBack?: { pending: boolean; stage: number; lastDay: string } | null;
  punishment?: PunishmentInfo | null;
  /** Teams this player follows (updateFavoriteTeams). Absent on older docs. */
  favoriteTeams?: FavoriteTeam[];
  /** Opt-in "your team plays soon" push (updateFavoriteTeams). */
  teamReminders?: boolean;
  /** Opt-in live lead-change pushes (setAlertPrefs). */
  sweatAlerts?: boolean;
  /** Engagement pushes held 23:00–08:00 local unless false. */
  quietHours?: boolean;
  tz?: string;
  muteTaunts?: boolean;
  achievementCount?: number;
  seasonXp?: Record<string, number>;
  ladder?: { tier: string; cohortId: string | null; week: string; lastResult?: "promoted" | "relegated" | "stayed"; lastRank?: number } | null;
  /** Player-set play limits (setPlayLimits). */
  limits?: { dailyPicks?: number | null; breakUntil?: number | null };
  /** Picks placed today, for the daily limit and the reality check. */
  picksToday?: { day: string; count: number };
  /** Dance-move loadout, in button order (setMoveLoadout). Absent until first set. */
  moves?: string[];
  /** Lifetime XP (server-written; constants/progression.ts turns it into a level). */
  xp?: number;
  level?: number;
  /** Background behind the character (constants/backgrounds.ts). Absent = Locker Room. */
  background?: string;
  /** Their invite code, and how many players have joined with it. */
  referralCode?: string;
  referralCount?: number;
  referredBy?: string;
  onboarded: boolean;
  /** Terms of Service version accepted (constants/legal.ts TERMS_VERSION). */
  termsVersion?: number;
  /** When the first-bet tutorial's prize box was paid (once per account). */
  tutorialGiftAt?: number;
}

interface AppContextType {
  ready: boolean;
  profile: Profile | null;
  needsOnboarding: boolean;
  balance: number;
  bets: Bet[];
  inventory: string[];
  /** False until the inventory has been read at least once this session (cache or server). */
  inventoryLoaded: boolean;
  trophies: TrophyItem[];
  /** Moves this player can dance: the free ones plus everything bought. */
  ownedMoves: Set<string>;
  /** Up to four moves on the dance button, in order (the default if never set). */
  loadout: string[];
  /** Level, XP into it and XP it takes, from profile.xp. */
  progress: LevelProgress;
  /** Backgrounds this player can use: the free ones plus bought and earned ones. */
  ownedBackgrounds: Set<string>;
  /** The background in use (always a known id). */
  background: string;
  prizeBoxes: Record<BoxTier, PrizeBoxState>;
  error: string | null;
  clearError: () => void;
  /** Latest background write that failed after the app had already shown it (the change is rolled back). */
  syncFailure: { id: number; message: string; note: string } | null;
  /** For other contexts' instant actions: tell the player a background write failed. */
  reportSyncFailure: (message: string, note?: string) => void;
  /** Shows profile fields now and saves them with `call` behind the scenes (rolled back if it fails). */
  writeProfile: (fields: Partial<Omit<Profile, "uid" | "balance">>, call: () => Promise<unknown>) => void;

  placeBet: (args: {
    gameId: string;
    side?: "home" | "away";
    market?: Market;
    selection?: Selection;
    stake: number;
    idempotencyKey: string;
    expectedOdds?: number;
    expectedLine?: number;
    opponentUid?: string;
    /** Shown in My Bets straight away, until the server's copy arrives. */
    preview?: BetPreview;
  }) => Promise<boolean>;
  cancelBet: (betId: string) => Promise<boolean>;
  /** Today's free 100-credit bet: shown at once, saved behind it. False if today's is already used. */
  placeFreeBet: (args: FreeBetArgs) => Promise<boolean>;
  /** Moves today's free bet to a new pick (cancels the old one before kickoff, places the new). */
  switchFreeBet: (oldBetId: string, args: FreeBetArgs) => Promise<boolean>;
  /** Instant: owned and charged in the app now, confirmed by the server after (rolled back if it refuses). */
  purchaseItem: (itemId: string, price: number) => Promise<boolean>;
  equip: (slot: Slot, itemId: string | null) => Promise<boolean>;
  purchaseMove: (moveId: string) => Promise<boolean>;
  setLoadout: (moves: string[]) => Promise<boolean>;
  purchaseBackground: (backgroundId: string) => Promise<boolean>;
  setBackground: (backgroundId: string) => Promise<boolean>;
  openBox: (tier: BoxTier) => Promise<boolean>;
  claimBox: (tier: BoxTier) => Promise<number | null>;
  resetBox: (tier: BoxTier) => Promise<void>;
  saveAvatar: (avatar: AvatarConfig) => Promise<boolean>;
  /** Appearance + outfit in one server transaction (the character creator's Save). */
  saveLook: (avatar: AvatarConfig, equipped: Partial<Record<Slot, string>>) => Promise<boolean>;

  totalWon: number;
  totalStaked: number;
}

const AppContext = createContext<AppContextType | null>(null);

/** Profile fields the app may show ahead of the server. */
type ProfileOverlay = Partial<Omit<Profile, "uid" | "balance">>;
/** What the app shows ahead of the server, until the snapshots catch up. */
interface Opt {
  /** Bought, not yet in the inventory snapshot: id → price. */
  items: Record<string, number>;
  moves: Record<string, number>;
  bgs: Record<string, number>;
  /** Placed, not yet in the bets snapshot. */
  bets: Record<string, Bet>;
  /** Cancelled, snapshot still says pending. */
  cancelled: Record<string, true>;
  profile: ProfileOverlay;
}
const EMPTY_OPT: Opt = { items: {}, moves: {}, bgs: {}, bets: {}, cancelled: {}, profile: {} };
/** How long a confirmed overlay may wait for its snapshot before it's dropped anyway. */
const SETTLE_MS = 5000;

/** The display fields of a bet, for showing it before the server has written it. */
export type BetPreview = Omit<Bet, "id" | "uid" | "stake" | "status" | "placedAt" | "settledAt">;
export interface FreeBetArgs {
  gameId: string;
  side: "home" | "away";
  market: Market;
  selection: Selection;
  day: string;
  preview: BetPreview;
}

const EMPTY_BOX = (tier: BoxTier): PrizeBoxState => ({
  tier,
  state: "idle",
  openedAt: null,
  readyAt: null,
  rewardCredits: null,
});

const DEFAULT_BOXES: Record<BoxTier, PrizeBoxState> = {
  bronze: EMPTY_BOX("bronze"),
  silver: EMPTY_BOX("silver"),
  gold: EMPTY_BOX("gold"),
};

export function AppProvider({ children, uid }: { children: React.ReactNode; uid: string }) {
  const [serverProfile, setProfile] = useState<Profile | null>(DEMO ? demoProfile : null);
  const [serverBets, setBets] = useState<Bet[]>(DEMO ? demoBets : []);
  const [serverInventory, setInventory] = useState<string[]>(DEMO ? demoInventory : []);
  const [inventoryLoaded, setInventoryLoaded] = useState(DEMO);
  const [trophies, setTrophies] = useState<TrophyItem[]>([]);
  const [serverMoves, setBoughtMoves] = useState<string[]>([]);
  const [serverBackgrounds, setBoughtBackgrounds] = useState<string[]>(DEMO ? ["night_stadium"] : []);
  const [prizeBoxes, setPrizeBoxes] = useState<Record<BoxTier, PrizeBoxState>>(DEMO ? demoPrizeBoxes : DEFAULT_BOXES);
  const [profileLoaded, setProfileLoaded] = useState(DEMO);
  const [error, setError] = useState<string | null>(null);

  const inFlight = useRef<Set<string>>(new Set());

  // ── optimistic layer ─────────────────────────────────────────────────────
  // Every purchase, equip, look change and bet shows in the app the moment
  // it's made; the server call runs behind it, in order, and Firestore's
  // snapshots take over once they reflect it. A failed call rolls the change
  // back and raises `syncFailure` (shown as a toast).
  const [opt, setOpt] = useState<Opt>(EMPTY_OPT);
  const [syncFailure, setSyncFailure] = useState<{ id: number; message: string; note: string } | null>(null);
  const reportSyncFailure = useCallback((message: string, note = "Nothing was changed.") => {
    setError(message);
    setSyncFailure({ id: Date.now() + Math.random(), message, note });
  }, []);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  /** Runs server writes one at a time, in the order they were made (a look save waits for the purchases it needs). */
  const enqueue = useCallback(<T,>(fn: () => Promise<T>): Promise<T> => {
    const run = writes.current.then(fn, fn);
    writes.current = run.catch(() => {});
    return run;
  }, []);
  const failed = useCallback((err: unknown) => reportSyncFailure(api.friendlyError(err), "It's been undone and any credits are back."), [reportSyncFailure]);
  const patchOpt = useCallback((f: (o: Opt) => Opt) => setOpt(f), []);
  /** Overlays profile fields now; returns a function that drops them again (on failure, or once the server agrees). */
  const overlay = useCallback((fields: ProfileOverlay) => {
    setOpt((o) => ({ ...o, profile: { ...o.profile, ...fields } }));
    return () =>
      setOpt((o) => {
        const next = { ...o.profile };
        for (const k of Object.keys(fields) as (keyof ProfileOverlay)[]) if (next[k] === fields[k]) delete next[k];
        return { ...o, profile: next };
      });
  }, []);
  /** After a successful write, the overlay lingers until the snapshot shows it (or a few seconds, whichever first). */
  const settle = useCallback((drop: () => void) => setTimeout(drop, SETTLE_MS), []);

  const writeProfile = useCallback(
    (fields: ProfileOverlay, call: () => Promise<unknown>) => {
      const drop = overlay(fields);
      enqueue(call).then(
        () => settle(drop),
        (err) => {
          drop();
          failed(err);
        }
      );
    },
    [overlay, enqueue, settle, failed]
  );

  const inventory = useMemo(() => {
    const extra = Object.keys(opt.items).filter((id) => !serverInventory.includes(id));
    return extra.length ? [...serverInventory, ...extra] : serverInventory;
  }, [serverInventory, opt.items]);
  const boughtMoves = useMemo(() => [...new Set([...serverMoves, ...Object.keys(opt.moves)])], [serverMoves, opt.moves]);
  const boughtBackgrounds = useMemo(() => [...new Set([...serverBackgrounds, ...Object.keys(opt.bgs)])], [serverBackgrounds, opt.bgs]);
  const bets = useMemo(() => {
    const have = new Set(serverBets.map((b) => b.id));
    const mine = Object.values(opt.bets).filter((b) => !have.has(b.id));
    const merged = mine.length ? [...mine, ...serverBets] : serverBets;
    const cancelled = Object.keys(opt.cancelled);
    return cancelled.length ? merged.map((b) => (opt.cancelled[b.id] && b.status === "pending" ? { ...b, status: "cancelled" as const } : b)) : merged;
  }, [serverBets, opt.bets, opt.cancelled]);
  const profile = useMemo<Profile | null>(() => {
    if (!serverProfile) return serverProfile;
    let spent = 0;
    for (const [id, price] of Object.entries(opt.items)) if (!serverInventory.includes(id)) spent += price;
    for (const [id, price] of Object.entries(opt.moves)) if (!serverMoves.includes(id)) spent += price;
    for (const [id, price] of Object.entries(opt.bgs)) if (!serverBackgrounds.includes(id)) spent += price;
    const placed = new Set(serverBets.map((b) => b.id));
    for (const b of Object.values(opt.bets)) if (!placed.has(b.id)) spent += b.stake;
    for (const b of serverBets) if (opt.cancelled[b.id] && b.status === "pending") spent -= b.stake;
    const keys = Object.keys(opt.profile);
    if (!spent && !keys.length) return serverProfile;
    return { ...serverProfile, ...opt.profile, balance: serverProfile.balance - spent };
  }, [serverProfile, opt, serverInventory, serverMoves, serverBackgrounds, serverBets]);

  // Snapshots caught up: drop what they now show.
  useEffect(() => {
    setOpt((o) => {
      let changed = false;
      const drop = <T,>(rec: Record<string, T>, done: (id: string) => boolean) => {
        const next: Record<string, T> = {};
        for (const [k, v] of Object.entries(rec)) {
          if (done(k)) changed = true;
          else next[k] = v;
        }
        return next;
      };
      const placed = new Set(serverBets.map((b) => b.id));
      const items = drop(o.items, (id) => serverInventory.includes(id));
      const moves = drop(o.moves, (id) => serverMoves.includes(id));
      const bgs = drop(o.bgs, (id) => serverBackgrounds.includes(id));
      const betsOpt = drop(o.bets, (id) => placed.has(id));
      const cancelled = drop(o.cancelled, (id) => serverBets.some((b) => b.id === id && b.status !== "pending"));
      const prof = { ...o.profile };
      if (serverProfile) {
        for (const k of Object.keys(prof) as (keyof ProfileOverlay)[]) {
          if (JSON.stringify(serverProfile[k] ?? null) === JSON.stringify(prof[k] ?? null)) {
            delete prof[k];
            changed = true;
          }
        }
      }
      return changed ? { items, moves, bgs, bets: betsOpt, cancelled, profile: prof } : o;
    });
  }, [serverProfile, serverInventory, serverMoves, serverBackgrounds, serverBets]);

  const profileRef = useRef(profile);
  profileRef.current = profile;
  const inventoryRef = useRef(inventory);
  inventoryRef.current = inventory;
  const serverBetsRef = useRef(serverBets);
  serverBetsRef.current = serverBets;
  const optBetsRef = useRef(opt.bets);
  optBetsRef.current = opt.bets;
  const optCancelledRef = useRef(opt.cancelled);
  optCancelledRef.current = opt.cancelled;

  const signedIn = firebaseConfigured && uid !== "local";

  // ── realtime subscriptions ───────────────────────────────────────────────
  useEffect(() => {
    if (!signedIn) {
      setProfileLoaded(true);
      return;
    }
    const db = getDb();
    if (!db) {
      setProfileLoaded(true);
      return;
    }

    const unsubs: Array<() => void> = [];
    const answer = firstAnswer("profile", () => {});
    unsubs.push(answer.cancel);

    unsubs.push(
      onSnapshot(
        doc(db, "users", uid),
        (snap) => {
          answer.hit();
          setProfile(snap.exists() ? ({ uid, ...snap.data() } as Profile) : null);
          setProfileLoaded(true);
        },
        (err) => {
          answer.hit();
          setError(api.friendlyError(err));
          setProfileLoaded(true);
        }
      )
    );

    // Bets: open ones live; the rest from the phone's cache plus only what
    // settled since (lib/cachedQuery.ts). Results are still decided and paid
    // server-side — the cache is only what this phone remembers having seen.
    const toBet = (d: { id: string } & Record<string, unknown>) => ({ ...d, side: (d.side === "away" ? "away" : "home") as "home" | "away" }) as unknown as Bet;
    let pendingNow: Bet[] = [];
    let pendingLoaded = false;
    let history: Bet[] = [];
    const publishBets = () => {
      const byId = new Map<string, Bet>();
      for (const b of history) byId.set(b.id, b);
      // The live open copy beats a cached "pending" one; a settled copy beats both.
      for (const b of pendingNow) {
        const had = byId.get(b.id);
        if (!had || had.status === "pending") byId.set(b.id, b);
      }
      const open = new Set(pendingNow.map((b) => b.id));
      setBets(
        [...byId.values()]
          // Cached as open but no longer open: its settled copy is on the way; don't show it as open meanwhile.
          .filter((b) => b.status !== "pending" || !pendingLoaded || open.has(b.id))
          .sort((a, b) => (toMillis(b.placedAt) ?? 0) - (toMillis(a.placedAt) ?? 0))
          .slice(0, 200)
      );
    };
    unsubs.push(
      onSnapshot(
        query(collection(db, "bets"), where("uid", "==", uid), where("status", "==", "pending")),
        (snap) => {
          pendingNow = snap.docs.map((d) => toBet({ ...d.data(), id: d.id }));
          pendingLoaded = true;
          publishBets();
        },
        (err) => setError(api.friendlyError(err))
      )
    );
    unsubs.push(
      subscribeCached<{ id: string } & Record<string, unknown>>(
        {
          key: `sd.cache.bets.${uid}`,
          version: 1,
          cursorType: "timestamp",
          full: () => query(collection(db, "bets"), where("uid", "==", uid), orderBy("placedAt", "desc"), limit(200)),
          delta: (after) => query(collection(db, "bets"), where("uid", "==", uid), where("settledAt", ">", after)),
          cursorOf: (b) => toMillis(b.settledAt),
          keep: (list) => list.sort((a, b) => (toMillis(b.placedAt) ?? 0) - (toMillis(a.placedAt) ?? 0)).slice(0, 200),
        },
        (items) => {
          history = items.map(toBet);
          publishBets();
        },
        (err) => setError(api.friendlyError(err))
      ).stop
    );

    unsubs.push(
      subscribeCached<{ id: string } & Record<string, unknown>>(
        {
          key: `sd.cache.inventory.${uid}`,
          version: 1,
          cursorType: "timestamp",
          full: () => collection(db, "users", uid, "inventory"),
          delta: (after) => query(collection(db, "users", uid, "inventory"), where("acquiredAt", ">", after)),
          cursorOf: (d) => toMillis(d.acquiredAt),
        },
        (items) => {
          setInventory(items.map((d) => d.id));
          setInventoryLoaded(true);
        },
        () => {}
      ).stop
    );

    unsubs.push(
      onSnapshot(
        collection(db, "users", uid, "trophies"),
        (snap) =>
          setTrophies(
            snap.docs
              .map((d) => ({ ...(d.data() as TrophyItem), id: d.id }))
              .sort((a, b) => (b.awardedAt ?? 0) - (a.awardedAt ?? 0))
          ),
        () => {}
      )
    );

    unsubs.push(
      subscribeCached<{ id: string } & Record<string, unknown>>(
        {
          key: `sd.cache.moves.${uid}`,
          version: 1,
          cursorType: "timestamp",
          full: () => collection(db, "users", uid, "moves"),
          delta: (after) => query(collection(db, "users", uid, "moves"), where("acquiredAt", ">", after)),
          cursorOf: (d) => toMillis(d.acquiredAt),
        },
        (items) => setBoughtMoves(items.map((d) => d.id)),
        () => {}
      ).stop
    );

    unsubs.push(
      subscribeCached<{ id: string } & Record<string, unknown>>(
        {
          key: `sd.cache.backgrounds.${uid}`,
          version: 1,
          cursorType: "timestamp",
          full: () => collection(db, "users", uid, "backgrounds"),
          delta: (after) => query(collection(db, "users", uid, "backgrounds"), where("acquiredAt", ">", after)),
          cursorOf: (d) => toMillis(d.acquiredAt),
        },
        (items) => setBoughtBackgrounds(items.map((d) => d.id)),
        () => {}
      ).stop
    );

    unsubs.push(
      onSnapshot(
        collection(db, "users", uid, "prizeBoxes"),
        (snap) => {
          const next = { ...DEFAULT_BOXES };
          snap.docs.forEach((d) => {
            const tier = d.id as BoxTier;
            if (tier in next) next[tier] = { tier, ...d.data() } as PrizeBoxState;
          });
          setPrizeBoxes(next);
        },
        () => {}
      )
    );

    return () => unsubs.forEach((u) => u());
  }, [signedIn, uid]);

  // Quiet hours are evaluated server-side in the user's timezone; keep it current.
  const profileTz = profile?.tz;
  const hasProfile = !!profile;
  useEffect(() => {
    if (!signedIn || !hasProfile) return;
    let tz: string | undefined;
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {}
    if (tz && tz !== profileTz) api.setAlertPrefs({ tz }).catch(() => {});
  }, [signedIn, hasProfile, profileTz]);

  // ── mutations ────────────────────────────────────────────────────────────
  const guard = useCallback(
    async <T,>(key: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
      if (inFlight.current.has(key)) return fallback;
      inFlight.current.add(key);
      try {
        setError(null);
        return await fn();
      } catch (err) {
        setError(api.friendlyError(err));
        return fallback;
      } finally {
        inFlight.current.delete(key);
      }
    },
    []
  );

  const placeBet = useCallback<AppContextType["placeBet"]>(
    async (args) => {
      const have = profileRef.current?.balance ?? 0;
      if (args.stake > have) {
        setError("Not enough credits.");
        return false;
      }
      const id = `${uid}_${args.idempotencyKey}`;
      if (args.preview) patchOpt((o) => ({ ...o, bets: { ...o.bets, [id]: { ...args.preview!, id, uid, stake: args.stake, status: "pending", placedAt: { seconds: Math.floor(Date.now() / 1000) }, settledAt: null } } }));
      const { preview: _preview, ...call } = args;
      enqueue(() => api.placeBet(call)).catch((err) => {
        patchOpt((o) => {
          const next = { ...o.bets };
          delete next[id];
          return { ...o, bets: next };
        });
        failed(err);
      });
      return true;
    },
    [uid, enqueue, failed, patchOpt]
  );

  const placeFreeBet = useCallback<AppContextType["placeFreeBet"]>(
    async ({ gameId, side, market, selection, day, preview }) => {
      const used = [...serverBetsRef.current, ...Object.values(optBetsRef.current)].some(
        (b) => b.freeBet && b.freeDay === day && b.status !== "cancelled" && !optCancelledRef.current[b.id]
      );
      if (used) {
        setError("You've already used today's free bet.");
        return false;
      }
      const key = api.newIdempotencyKey();
      const id = `${uid}_${key}`;
      patchOpt((o) => ({
        ...o,
        bets: { ...o.bets, [id]: { ...preview, id, uid, stake: 0, freeBet: true, freeStake: 100, freeDay: day, status: "pending", placedAt: { seconds: Math.floor(Date.now() / 1000) }, settledAt: null } },
      }));
      enqueue(() => api.placeFreeBet({ gameId, side, market, selection, idempotencyKey: key })).catch((err) => {
        patchOpt((o) => {
          const next = { ...o.bets };
          delete next[id];
          return { ...o, bets: next };
        });
        failed(err);
      });
      return true;
    },
    [uid, enqueue, failed, patchOpt]
  );

  const switchFreeBet = useCallback<AppContextType["switchFreeBet"]>(
    async (oldBetId, args) => {
      if (!(await cancelBetRef.current(oldBetId))) return false;
      // Both writes share the ordered queue: the cancel (which hands the day's free bet back) lands first.
      optCancelledRef.current = { ...optCancelledRef.current, [oldBetId]: true };
      return placeFreeBet(args);
    },
    [placeFreeBet]
  );
  const cancelBetRef = useRef<(id: string) => Promise<boolean>>(async () => false);

  const cancelBet = useCallback(
    async (betId: string) => {
      const bet = serverBetsRef.current.find((b) => b.id === betId);
      if (bet?.startsAt && bet.startsAt <= Date.now()) {
        setError("This game has started — the bet is locked.");
        return false;
      }
      patchOpt((o) => ({ ...o, cancelled: { ...o.cancelled, [betId]: true } }));
      enqueue(() => api.cancelBet({ betId })).catch((err) => {
        patchOpt((o) => {
          const next = { ...o.cancelled };
          delete next[betId];
          return { ...o, cancelled: next };
        });
        failed(err);
      });
      return true;
    },
    [enqueue, failed, patchOpt]
  );
  cancelBetRef.current = cancelBet;

  const purchaseItem = useCallback(
    (itemId: string, price: number) =>
      guard(
        `buy:${itemId}`,
        async () => {
          if (DEMO) {
            const item = demoCatalog.find((i) => i.id === itemId);
            const have = profileRef.current?.balance ?? 0;
            if (!item) throw new Error("That item isn't in the store.");
            if (have < item.price) throw new Error("Not enough credits.");
            setInventory((inv) => (inv.includes(itemId) ? inv : [...inv, itemId]));
            setProfile((p) => (p ? { ...p, balance: p.balance - item.price } : p));
            return true;
          }
          // Instant: owned and paid for in the app now; the server call follows.
          if (inventoryRef.current.includes(itemId)) return true;
          if ((profileRef.current?.balance ?? 0) < price) throw new Error("Not enough credits.");
          patchOpt((o) => ({ ...o, items: { ...o.items, [itemId]: price } }));
          const key = api.newIdempotencyKey();
          enqueue(() => api.purchaseItem({ itemId, idempotencyKey: key })).catch((err) => {
            patchOpt((o) => {
              const next = { ...o.items };
              delete next[itemId];
              return { ...o, items: next };
            });
            failed(err);
          });
          return true;
        },
        false
      ),
    [guard, enqueue, failed, patchOpt]
  );

  const equip = useCallback(
    (slot: Slot, itemId: string | null) =>
      guard(
        `equip:${slot}`,
        async () => {
          const equipped = { ...(profileRef.current?.equipped ?? {}) };
          if (itemId) equipped[slot] = itemId;
          else delete equipped[slot];
          const drop = overlay({ equipped });
          enqueue(() => api.equipItem({ slot, itemId })).then(
            () => settle(drop),
            (err) => {
              drop();
              failed(err);
            }
          );
          return true;
        },
        false
      ),
    [guard, enqueue, overlay, settle, failed]
  );

  const purchaseMove = useCallback(
    (moveId: string) =>
      guard(
        `move:${moveId}`,
        async () => {
          if (DEMO) {
            const m = MOVES_BY_ID.get(moveId);
            const have = profileRef.current?.balance ?? 0;
            if (!m || !m.price) throw new Error("That move isn't in the store.");
            if (have < m.price) throw new Error("Not enough credits.");
            setBoughtMoves((b) => (b.includes(moveId) ? b : [...b, moveId]));
            setProfile((p) => {
              if (!p) return p;
              const cur = loadoutOf(p.moves);
              return { ...p, balance: p.balance - m.price, moves: cur.length < MAX_LOADOUT ? [...cur, moveId] : cur };
            });
            return true;
          }
          const m = MOVES_BY_ID.get(moveId);
          if (!m || !m.price) throw new Error("That move isn't in the store.");
          if ((profileRef.current?.balance ?? 0) < m.price) throw new Error("Not enough credits.");
          const cur = loadoutOf(profileRef.current?.moves);
          patchOpt((o) => ({ ...o, moves: { ...o.moves, [moveId]: m.price } }));
          const drop = cur.length < MAX_LOADOUT && !cur.includes(moveId) ? overlay({ moves: [...cur, moveId] }) : () => {};
          const key = api.newIdempotencyKey();
          enqueue(() => api.purchaseMove({ moveId, idempotencyKey: key })).then(
            () => settle(drop),
            (err) => {
              drop();
              patchOpt((o) => {
                const next = { ...o.moves };
                delete next[moveId];
                return { ...o, moves: next };
              });
              failed(err);
            }
          );
          return true;
        },
        false
      ),
    [guard, enqueue, overlay, settle, failed, patchOpt]
  );

  const setLoadout = useCallback(
    (moves: string[]) =>
      guard(
        "loadout",
        async () => {
          if (DEMO) {
            setProfile((p) => (p ? { ...p, moves } : p));
            return true;
          }
          const drop = overlay({ moves });
          enqueue(() => api.setMoveLoadout({ moves })).then(
            () => settle(drop),
            (err) => {
              drop();
              failed(err);
            }
          );
          return true;
        },
        false
      ),
    [guard, enqueue, overlay, settle, failed]
  );

  const purchaseBackground = useCallback(
    (backgroundId: string) =>
      guard(
        `bg:${backgroundId}`,
        async () => {
          if (DEMO) {
            const b = BACKGROUNDS_BY_ID.get(backgroundId);
            const have = profileRef.current?.balance ?? 0;
            if (!b || !b.price) throw new Error("That background isn't in the store.");
            if (have < b.price) throw new Error("Not enough credits.");
            setBoughtBackgrounds((x) => (x.includes(backgroundId) ? x : [...x, backgroundId]));
            setProfile((p) => (p ? { ...p, balance: p.balance - b.price, background: backgroundId } : p));
            return true;
          }
          const b = BACKGROUNDS_BY_ID.get(backgroundId);
          if (!b || !b.price) throw new Error("That background isn't in the store.");
          if ((profileRef.current?.balance ?? 0) < b.price) throw new Error("Not enough credits.");
          patchOpt((o) => ({ ...o, bgs: { ...o.bgs, [backgroundId]: b.price } }));
          const drop = overlay({ background: backgroundId });
          const key = api.newIdempotencyKey();
          enqueue(() => api.purchaseBackground({ backgroundId, idempotencyKey: key })).then(
            () => settle(drop),
            (err) => {
              drop();
              patchOpt((o) => {
                const next = { ...o.bgs };
                delete next[backgroundId];
                return { ...o, bgs: next };
              });
              failed(err);
            }
          );
          return true;
        },
        false
      ),
    [guard, enqueue, overlay, settle, failed, patchOpt]
  );

  const setBackground = useCallback(
    (backgroundId: string) =>
      guard(
        "background",
        async () => {
          if (DEMO) {
            setProfile((p) => (p ? { ...p, background: backgroundId } : p));
            return true;
          }
          const drop = overlay({ background: backgroundId });
          enqueue(() => api.setBackground({ backgroundId })).then(
            () => settle(drop),
            (err) => {
              drop();
              failed(err);
            }
          );
          return true;
        },
        false
      ),
    [guard, enqueue, overlay, settle, failed]
  );

  // Brings older accounts onto the level curve, grants any level rewards
  // already earned, and makes sure there's an invite code. Once per session.
  const synced = useRef(false);
  useEffect(() => {
    if (DEMO || !signedIn || !profile?.uid || synced.current) return;
    synced.current = true;
    api.syncProgression({}).catch(() => {
      synced.current = false;
    });
  }, [signedIn, profile?.uid]);

  const openBox = useCallback(
    (tier: BoxTier) =>
      guard(
        `open:${tier}`,
        async () => {
          await api.openPrizeBox({ tier });
          return true;
        },
        false
      ),
    [guard]
  );

  const claimBox = useCallback(
    (tier: BoxTier) =>
      guard<number | null>(
        `claim:${tier}`,
        async () => {
          const res = await api.claimPrizeBox({ tier });
          return res.rewardCredits;
        },
        null
      ),
    [guard]
  );

  const resetBox = useCallback(
    async (tier: BoxTier) => {
      await guard(
        `reset:${tier}`,
        async () => {
          await api.resetPrizeBox({ tier });
          return true;
        },
        false
      );
    },
    [guard]
  );

  const saveAvatar = useCallback(
    (avatar: AvatarConfig) =>
      guard(
        "avatar",
        async () => {
          const drop = overlay({ avatar });
          enqueue(() => api.updateAvatar({ avatar })).then(
            () => settle(drop),
            (err) => {
              drop();
              failed(err);
            }
          );
          return true;
        },
        false
      ),
    [guard, enqueue, overlay, settle, failed]
  );

  const saveLook = useCallback(
    (avatar: AvatarConfig, equipped: Partial<Record<Slot, string>>) =>
      guard(
        "look",
        async () => {
          if (DEMO) {
            setProfile((p) => (p ? { ...p, avatar, equipped } : p));
            return true;
          }
          const full: Partial<Record<Slot, string | null>> = {};
          for (const s of SLOTS) full[s] = equipped[s] ?? null;
          // Worn now; saved after any purchases queued ahead of it (the server checks ownership).
          const drop = overlay({ avatar, equipped });
          enqueue(() => api.saveAppearance({ avatar, equipped: full })).then(
            (res) => {
              setProfile((p) => (p ? { ...p, avatar: res.avatar, equipped: res.equipped } : p));
              settle(drop);
            },
            (err) => {
              drop();
              failed(err);
            }
          );
          return true;
        },
        false
      ),
    [guard, enqueue, overlay, settle, failed]
  );

  // ── derived ──────────────────────────────────────────────────────────────
  const totalWon = useMemo(
    () =>
      bets
        .filter((b) => b.status === "won")
        .reduce((s, b) => s + (b.potentialPayout - b.stake), 0),
    [bets]
  );

  const totalStaked = useMemo(
    () => bets.filter((b) => b.status !== "cancelled").reduce((s, b) => s + b.stake, 0),
    [bets]
  );

  const ownedMoves = useMemo(() => new Set<string>([...FREE_MOVES, ...boughtMoves]), [boughtMoves]);
  const loadout = useMemo(() => loadoutOf(profile?.moves), [profile?.moves]);
  const progress = useMemo(() => progressOf(profile?.xp ?? 0), [profile?.xp]);
  const ownedBackgrounds = useMemo(() => new Set<string>([...FREE_BACKGROUNDS, ...boughtBackgrounds]), [boughtBackgrounds]);
  const background = useMemo(() => backgroundOf(profile?.background), [profile?.background]);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo<AppContextType>(
    () => ({
      ready: profileLoaded,
      profile,
      needsOnboarding: signedIn && profileLoaded && profile === null,
      balance: profile?.balance ?? 0,
      bets,
      inventory,
      inventoryLoaded,
      trophies,
      ownedMoves,
      loadout,
      progress,
      ownedBackgrounds,
      background,
      prizeBoxes,
      error,
      clearError,
      syncFailure,
      reportSyncFailure,
      writeProfile,
      placeBet,
      cancelBet,
      placeFreeBet,
      switchFreeBet,
      purchaseItem,
      equip,
      purchaseMove,
      setLoadout,
      purchaseBackground,
      setBackground,
      openBox,
      claimBox,
      resetBox,
      saveAvatar,
      saveLook,
      totalWon,
      totalStaked,
    }),
    [
      profileLoaded,
      profile,
      signedIn,
      bets,
      inventory,
      inventoryLoaded,
      trophies,
      ownedMoves,
      loadout,
      progress,
      ownedBackgrounds,
      background,
      prizeBoxes,
      error,
      clearError,
      syncFailure,
      reportSyncFailure,
      writeProfile,
      placeBet,
      cancelBet,
      placeFreeBet,
      switchFreeBet,
      purchaseItem,
      equip,
      purchaseMove,
      setLoadout,
      purchaseBackground,
      setBackground,
      openBox,
      claimBox,
      resetBox,
      saveAvatar,
      saveLook,
      totalWon,
      totalStaked,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
