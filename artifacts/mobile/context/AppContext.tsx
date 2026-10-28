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
import type { AvatarConfig, BoxTier, FavoriteTeam, Slot, UserStats } from "@/lib/api";
import { firebaseConfigured, getDb } from "@/lib/firebase";
import { firstAnswer } from "@/lib/devtrace";
import { SLOTS } from "@/lib/avatar3d/avatarRules";
import { DEMO, demoBets, demoCatalog, demoInventory, demoPrizeBoxes, demoProfile } from "@/lib/demo";

/**
 * Replaces the old AsyncStorage-backed AppContext.
 *
 * What changed and why:
 *  - Firestore is now the only source of truth. The old provider kept the
 *    balance in useState, mirrored it to AsyncStorage, and let
 *    FirebaseSyncProvider push it to the cloud with a non-merging setDoc every
 *    2s. That was the root of AUDIT S2, B5, B6 and B7 at once.
 *  - Every mutation is a callable. The client cannot write balance, inventory,
 *    bets or prize state — the rules deny it outright.
 *  - Reads are realtime listeners, so a settle that happens while the app is
 *    open lands on screen with no polling and no refresh.
 *  - There is no local write path left, so multi-device is consistent by
 *    construction rather than by last-writer-wins.
 */

export interface Bet {
  id: string;
  uid: string;
  gameId: string;
  sport: string;
  side: "home" | "away";
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
  /** Teams this player follows (updateFavoriteTeams). Absent on older docs. */
  favoriteTeams?: FavoriteTeam[];
  onboarded: boolean;
}

interface AppContextType {
  ready: boolean;
  profile: Profile | null;
  needsOnboarding: boolean;
  balance: number;
  bets: Bet[];
  inventory: string[];
  prizeBoxes: Record<BoxTier, PrizeBoxState>;
  error: string | null;
  clearError: () => void;

  placeBet: (args: {
    gameId: string;
    side: "home" | "away";
    stake: number;
    idempotencyKey: string;
    /** Decimal odds the user was shown, so a moved price fails loudly. */
    expectedOdds?: number;
    opponentUid?: string;
  }) => Promise<boolean>;
  cancelBet: (betId: string) => Promise<boolean>;
  purchaseItem: (itemId: string) => Promise<boolean>;
  equip: (slot: Slot, itemId: string | null) => Promise<boolean>;
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
  const [prizeBoxes, setPrizeBoxes] = useState<Record<BoxTier, PrizeBoxState>>(DEMO ? demoPrizeBoxes : DEFAULT_BOXES);
  const [profileLoaded, setProfileLoaded] = useState(DEMO);
  const [error, setError] = useState<string | null>(null);

  // Guards every mutating call so a rapid double-tap can't fire twice before
  // the first response lands. The server is idempotent regardless; this just
  // keeps the UI honest.
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
        (snap) => setBets(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Bet)),
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
        // The key is minted by the caller when the bet sheet opens, so every
        // retry of the same intent — double tap, dropped response, remount —
        // is one bet server-side rather than relying on the in-flight ref.
        `bet:${args.gameId}:${args.side}`,
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
            // Demo mode has no backend: buy against the fixture catalog locally.
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
          // The users/{uid} snapshot confirms this a moment later; applying it
          // now means the Locker doesn't flash the old look on the way back.
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

  const clearError = useCallback(() => setError(null), []);

  // Memoised: without this the provider handed every consumer a brand new
  // object on every render, so one balance tick re-rendered the games list,
  // the shop grid and the avatar stage.
  const value = useMemo<AppContextType>(
    () => ({
      ready: profileLoaded,
      profile,
      // Signed in with Firebase Auth but no users/{uid} document yet — the
      // user has an account but has not built a character.
      needsOnboarding: signedIn && profileLoaded && profile === null,
      balance: profile?.balance ?? 0,
      bets,
      inventory,
      prizeBoxes,
      error,
      clearError,
      placeBet,
      cancelBet,
      purchaseItem,
      equip,
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
      prizeBoxes,
      error,
      clearError,
      placeBet,
      cancelBet,
      purchaseItem,
      equip,
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
