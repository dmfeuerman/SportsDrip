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
  uid: string;
  username: string;
  displayName: string;
  email: string | null;
  balance: number;
  avatar: AvatarConfig;
  equipped: Partial<Record<Slot, string>>;
  stats: UserStats;
  streak?: StreakInfo | null;
  punishment?: PunishmentInfo | null;
  /** Teams this player follows (updateFavoriteTeams). Absent on older docs. */
  favoriteTeams?: FavoriteTeam[];
  /** Opt-in "your team plays soon" push (updateFavoriteTeams). */
  teamReminders?: boolean;
  /** Opt-in live lead-change pushes (setAlertPrefs). */
  sweatAlerts?: boolean;
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
}

interface AppContextType {
  ready: boolean;
  profile: Profile | null;
  needsOnboarding: boolean;
  balance: number;
  bets: Bet[];
  inventory: string[];
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
  }) => Promise<boolean>;
  cancelBet: (betId: string) => Promise<boolean>;
  purchaseItem: (itemId: string) => Promise<boolean>;
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
  const [profile, setProfile] = useState<Profile | null>(DEMO ? demoProfile : null);
  const [bets, setBets] = useState<Bet[]>(DEMO ? demoBets : []);
  const [inventory, setInventory] = useState<string[]>(DEMO ? demoInventory : []);
  const [trophies, setTrophies] = useState<TrophyItem[]>([]);
  const [boughtMoves, setBoughtMoves] = useState<string[]>([]);
  const [boughtBackgrounds, setBoughtBackgrounds] = useState<string[]>(DEMO ? ["night_stadium"] : []);
  const [prizeBoxes, setPrizeBoxes] = useState<Record<BoxTier, PrizeBoxState>>(DEMO ? demoPrizeBoxes : DEFAULT_BOXES);
  const [profileLoaded, setProfileLoaded] = useState(DEMO);
  const [error, setError] = useState<string | null>(null);

  const inFlight = useRef<Set<string>>(new Set());
  const profileRef = useRef(profile);
  profileRef.current = profile;

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

    unsubs.push(
      onSnapshot(
        query(
          collection(db, "bets"),
          where("uid", "==", uid),
          orderBy("placedAt", "desc"),
          limit(200)
        ),
        (snap) =>
          setBets(
            snap.docs.map((d) => {
              const raw = d.data();
              return {
                id: d.id,
                ...raw,
                side: (raw.side === "away" ? "away" : "home") as "home" | "away",
              } as Bet;
            })
          ),
        (err) => setError(api.friendlyError(err))
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, "users", uid, "inventory"),
        (snap) => setInventory(snap.docs.map((d) => d.id)),
        () => {}
      )
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
      onSnapshot(
        collection(db, "users", uid, "moves"),
        (snap) => setBoughtMoves(snap.docs.map((d) => d.id)),
        () => {}
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, "users", uid, "backgrounds"),
        (snap) => setBoughtBackgrounds(snap.docs.map((d) => d.id)),
        () => {}
      )
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
    (args) =>
      guard(
        `bet:${args.gameId}:${args.market ?? "ml"}:${args.selection ?? args.side ?? "home"}`,
        async () => {
          await api.placeBet(args);
          return true;
        },
        false
      ),
    [guard]
  );

  const cancelBet = useCallback(
    (betId: string) =>
      guard(
        `cancel:${betId}`,
        async () => {
          await api.cancelBet({ betId });
          return true;
        },
        false
      ),
    [guard]
  );

  const purchaseItem = useCallback(
    (itemId: string) =>
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
          await api.purchaseItem({ itemId, idempotencyKey: api.newIdempotencyKey() });
          return true;
        },
        false
      ),
    [guard]
  );

  const equip = useCallback(
    (slot: Slot, itemId: string | null) =>
      guard(
        `equip:${slot}`,
        async () => {
          await api.equipItem({ slot, itemId });
          return true;
        },
        false
      ),
    [guard]
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
          await api.purchaseMove({ moveId, idempotencyKey: api.newIdempotencyKey() });
          return true;
        },
        false
      ),
    [guard]
  );

  const setLoadout = useCallback(
    (moves: string[]) =>
      guard(
        "loadout",
        async () => {
          const before = profileRef.current?.moves;
          setProfile((p) => (p ? { ...p, moves } : p));
          if (DEMO) return true;
          try {
            await api.setMoveLoadout({ moves });
          } catch (err) {
            setProfile((p) => (p ? { ...p, moves: before } : p));
            throw err;
          }
          return true;
        },
        false
      ),
    [guard]
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
          await api.purchaseBackground({ backgroundId, idempotencyKey: api.newIdempotencyKey() });
          return true;
        },
        false
      ),
    [guard]
  );

  const setBackground = useCallback(
    (backgroundId: string) =>
      guard(
        "background",
        async () => {
          const before = profileRef.current?.background;
          setProfile((p) => (p ? { ...p, background: backgroundId } : p));
          if (DEMO) return true;
          try {
            await api.setBackground({ backgroundId });
          } catch (err) {
            setProfile((p) => (p ? { ...p, background: before } : p));
            throw err;
          }
          return true;
        },
        false
      ),
    [guard]
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
          await api.updateAvatar({ avatar });
          return true;
        },
        false
      ),
    [guard]
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
          const res = await api.saveAppearance({ avatar, equipped: full });
          setProfile((p) => (p ? { ...p, avatar: res.avatar, equipped: res.equipped } : p));
          return true;
        },
        false
      ),
    [guard]
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
      trophies,
      ownedMoves,
      loadout,
      progress,
      ownedBackgrounds,
      background,
      prizeBoxes,
      error,
      clearError,
      placeBet,
      cancelBet,
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
      trophies,
      ownedMoves,
      loadout,
      progress,
      ownedBackgrounds,
      background,
      prizeBoxes,
      error,
      clearError,
      placeBet,
      cancelBet,
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
