# Patches

**These are all applied already in this tree.** Kept as a record of what
moved and why — useful for review, and for reapplying against a branch that
has diverged. Nothing here is outstanding.

Small in-place edits. Everything else in this drop is a whole file that
replaces its counterpart. Paths are relative to the repo root.

---

## 1. `artifacts/mobile/app/(tabs)/friends.tsx` — the crash

Three edits. The first is the actual fix; the second and third remove work the
hook now does.

```diff
@@
 import type { PublicUser } from "@/lib/api";
+
+/** Stable empty result set. A fresh `[]` is a new identity every render. */
+const EMPTY_RESULTS: PublicUser[] = [];
@@
   const {
     friends,
     incoming,
+    senders,
     outgoing,
+    friendUids,
+    outgoingUids,
     loading,
     error,
     clearError,
     search,
     sendRequest,
     respond,
     remove,
   } = useFriends(profile?.uid ?? null);
@@
   useEffect(() => {
     const q = query.trim().toLowerCase();
     if (q.length < 2) {
-      setResults([]);
+      // Writing a fresh [] here is what turned an unstable dep into an
+      // infinite loop. Keep the existing array when it is already empty.
+      setResults((prev) => (prev.length === 0 ? prev : EMPTY_RESULTS));
       return;
     }
@@
-  const friendUids = new Set(friends.map((f) => f.uid));
-  const outgoingUids = new Set(outgoing.map((r) => r.to));
-
   const act = useCallback(async (key: string, fn: () => Promise<unknown>) => {
```

And the request row, which currently asks people to accept a stranger:

```diff
@@
                   {incoming.map((r) => (
+                    // `senders` resolves from.uid -> profile; the row falls
+                    // back to the generic label only for deleted accounts.
                     <View
                       key={r.id}
                       style={[styles.reqRow, { backgroundColor: colors.card, borderColor: colors.border }]}
                     >
-                      <MaterialCommunityIcons name="account-plus" size={20} color={colors.primary} />
-                      <Text style={[styles.reqText, { color: colors.foreground }]} numberOfLines={1}>
-                        Someone wants to be friends
-                      </Text>
+                      <View style={[styles.thumb, { backgroundColor: colors.secondary, width: 34, height: 40 }]}>
+                        {senders[r.from] ? (
+                          <AvatarDisplay
+                            avatar={senders[r.from]!.avatar}
+                            equipped={senders[r.from]!.equipped}
+                            catalog={byId}
+                            size="xs"
+                          />
+                        ) : (
+                          <MaterialCommunityIcons name="account-plus" size={18} color={colors.primary} />
+                        )}
+                      </View>
+                      <Text style={[styles.reqText, { color: colors.foreground }]} numberOfLines={1}>
+                        {senders[r.from]
+                          ? `${senders[r.from]!.displayName} (@${senders[r.from]!.username})`
+                          : "A player wants to be friends"}
+                      </Text>
```

---

## 2. `artifacts/mobile/context/AppContext.tsx` — memoize the context value

The provider hands a brand-new object to every consumer on every render, so a
single balance tick re-renders the games list, the shop grid and the avatar
stage even when none of their inputs changed.

```diff
@@
-  const value: AppContextType = {
-    ready: profileLoaded,
-    profile,
-    needsOnboarding: signedIn && profileLoaded && profile === null,
-    balance: profile?.balance ?? 0,
-    bets,
-    inventory,
-    prizeBoxes,
-    error,
-    clearError: () => setError(null),
-    placeBet,
-    cancelBet,
-    purchaseItem,
-    equip,
-    openBox,
-    claimBox,
-    resetBox,
-    saveAvatar,
-    totalWon,
-    totalStaked,
-  };
+  const clearError = useCallback(() => setError(null), []);
+
+  const value = useMemo<AppContextType>(
+    () => ({
+      ready: profileLoaded,
+      profile,
+      // Signed in with Firebase Auth but no users/{uid} document yet — the
+      // user has an account but has not built a character.
+      needsOnboarding: signedIn && profileLoaded && profile === null,
+      balance: profile?.balance ?? 0,
+      bets,
+      inventory,
+      prizeBoxes,
+      error,
+      clearError,
+      placeBet,
+      cancelBet,
+      purchaseItem,
+      equip,
+      openBox,
+      claimBox,
+      resetBox,
+      saveAvatar,
+      totalWon,
+      totalStaked,
+    }),
+    [
+      profileLoaded, profile, signedIn, bets, inventory, prizeBoxes, error,
+      clearError, placeBet, cancelBet, purchaseItem, equip, openBox, claimBox,
+      resetBox, saveAvatar, totalWon, totalStaked,
+    ]
+  );
```

---

## 3. `artifacts/mobile/app/(tabs)/index.tsx` — wire the detail sheet and positions

```diff
@@
 import BetModal from "@/components/BetModal";
-import GameCard from "@/components/GameCard";
+import GameCard, { type MyPosition } from "@/components/GameCard";
+import GameDetailSheet from "@/components/GameDetailSheet";
@@
   const [pending, setPending] = useState<{ game: Game; side: Side } | null>(null);
+  const [detail, setDetail] = useState<Game | null>(null);
@@
   const openBets = bets.filter((b) => b.status === "pending").length;
+
+  // One lookup for "do I already have money on this game?". Built from the
+  // bets the context is already subscribed to — no extra reads.
+  const positions = useMemo(() => {
+    const map = new Map<string, MyPosition>();
+    for (const b of bets) {
+      if (b.status !== "pending" || map.has(b.gameId)) continue;
+      map.set(b.gameId, { side: b.side, stake: b.stake, potentialPayout: b.potentialPayout });
+    }
+    return map;
+  }, [bets]);
@@
-              <GameCard game={item.game} onBet={openBetSheet} />
+              <GameCard
+                game={item.game}
+                onBet={openBetSheet}
+                onOpenDetail={setDetail}
+                position={positions.get(item.game.id) ?? null}
+              />
@@
       )}
+
+      <GameDetailSheet
+        game={detail}
+        onClose={() => setDetail(null)}
+        onBet={(game, side) => {
+          setDetail(null);
+          openBetSheet(game, side);
+        }}
+        bets={detail ? bets.filter((b) => b.gameId === detail.id) : []}
+      />
 
       {pending && team && (
```

`GameDetailSheet` renders nothing when `game` is null, so it can sit
unconditionally in the tree.

---

## 4. `artifacts/mobile/app/(tabs)/mybets.tsx` — use the new ticket

Delete the module-level `BetCard`, `Cell` and `STATUS_META` from this file
(they move into `components/BetTicket.tsx`), then:

```diff
@@
-import TokenBalance from "@/components/TokenBalance";
+import BetTicket from "@/components/BetTicket";
+import TokenBalance from "@/components/TokenBalance";
 import { useApp, type Bet } from "@/context/AppContext";
 import { useColors } from "@/hooks/useColors";
+import { useGames } from "@/hooks/useGames";
@@
   const { bets, balance, totalWon, totalStaked, cancelBet } = useApp();
+  // Settled tickets want the final game too, so this listener asks for all
+  // three statuses rather than reusing the board's upcoming+live default.
+  const { games } = useGames(["upcoming", "live", "final"]);
+  const gameById = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
@@
         renderItem={({ item }) => (
-          <BetCard
+          <BetTicket
             bet={item}
-            colors={colors}
+            game={gameById.get(item.gameId) ?? null}
             busy={busy === item.id}
             onCancel={async () => {
               setBusy(item.id);
               await cancelBet(item.id);
               setBusy(null);
             }}
           />
         )}
```

---

## 5. `firestore.rules` — two open collections

```diff
     match /users/{uid} {
-      allow get, list: if signedIn();
+      // `list` let any signed-in client page the entire user base, email and
+      // balance included. Discovery goes through the searchUsers callable,
+      // which returns public fields only.
+      allow get: if signedIn();
+      allow list: if false;
@@
     match /bets/{betId} {
       allow get: if signedIn() &&
                  (resource.data.uid == request.auth.uid ||
                   isFriend(resource.data.uid));
-      allow list: if signedIn();     // constrain with a where('uid','==',...) query
+      // A comment asking for a where clause is not enforcement. Evaluating
+      // ownership per document forces the query to carry the filter: an
+      // unscoped list now fails instead of returning every bet in the app.
+      allow list: if signedIn() && resource.data.uid == request.auth.uid;
```

The friends' bets read path stays on `get`. If a friends-feed query is added
later it needs its own rule, not a reopened `list`.

---

## 6. `functions/src/callable/prizes.ts` — the box that never becomes ready

`openPrizeBox` returns `state: "ready"` once the timer has elapsed but never
writes it, so the document says `waiting` forever and any server-side read of
box state is wrong.

```diff
       if (state === "waiting" || state === "ready") {
-        // Already running and the timer has elapsed — nothing to do.
-        return { ok: true, state: "ready" as const, readyAt };
+        // Timer elapsed. Persist the transition instead of only reporting it,
+        // so the document and the response agree.
+        if (state === "waiting") {
+          tx.update(ref, { state: "ready", updatedAt: FieldValue.serverTimestamp() });
+        }
+        return { ok: true, state: "ready" as const, readyAt };
       }
```

And `resetPrizeBox` should clear the spent cycle rather than merging one field
over stale data:

```diff
   await ref.set(
-    { state: "idle", updatedAt: FieldValue.serverTimestamp() },
+    {
+      state: "idle",
+      openedAt: null,
+      readyAt: null,
+      rewardCredits: null,
+      claimedAt: null,
+      updatedAt: FieldValue.serverTimestamp(),
+    },
     { merge: true }
   );
```

---

## 7. `functions/src/callable/bets.ts` — odds drift guard

Now that odds track a real moneyline they move between syncs. The client shows
the price it last read; the server prices off its own document. Without a
guard, a user taps 2.40x and is silently given 2.05x.

```diff
   idempotencyKey: z.string().min(8).max(64),
+  /** Decimal odds the user was shown. Optional so old clients keep working. */
+  expectedOdds: z.number().positive().max(100).optional(),
   opponentUid: z.string().min(1).optional(),
 });
@@
     const opponent = gameSnap.get(input.side === "home" ? "awayTeam" : "homeTeam") as {
       abbreviation: string;
     };
+
+    // Drift in the user's favour is fine and gets applied silently. Drift
+    // against them fails loudly rather than quietly shrinking the payout.
+    if (input.expectedOdds && team.odds < input.expectedOdds * 0.95) {
+      throw new HttpsError(
+        "aborted",
+        `The price moved to ${team.odds.toFixed(2)}x before this went through. Tap again to take it.`
+      );
+    }
```

Client side, `artifacts/mobile/lib/api.ts`:

```diff
 export const placeBet = callable<
   {
     gameId: string;
     side: "home" | "away";
     stake: number;
     idempotencyKey: string;
+    expectedOdds?: number;
     opponentUid?: string;
   },
```

`AppContext.placeBet` passes it straight through, and `friendlyError` needs one
more case so `aborted` reads as a price change rather than "Something went
wrong":

```diff
   if (code.includes("already-exists")) return e?.message ?? "You've already done that.";
+  if (code.includes("aborted")) return e?.message ?? "The price changed. Try again.";
```

---

## 8. `artifacts/mobile/package.json` — 3D dependencies

```diff
     "expo-font": "~14.0.10",
+    "expo-gl": "~16.0.7",
     "expo-glass-effect": "~0.1.4",
@@
     "react-native-worklets": "0.5.1",
+    "three": "^0.180.0",
+    "@types/three": "^0.180.0",
+    "@react-three/fiber": "^9.1.0",
+    "@react-three/drei": "^10.0.0",
```

Install with `npx expo install expo-gl` so the SDK-matched version is picked,
then `pnpm add three @react-three/fiber @react-three/drei` and
`pnpm add -D @types/three` in `artifacts/mobile`.

`@react-three/drei` is only used by `GltfGarment.tsx` (for `useGLTF`), which is
behind a `React.lazy`. If no catalogue item ever ships an `assetUrl`, drei is
never loaded at runtime — but it still has to resolve at build time, so it is a
real dependency, not optional.

No Metro config change is needed: `unstable_enablePackageExports` is already
`true` in `metro.config.js`, which is what lets `@react-three/fiber/native`
resolve.

---

## 9. Ordering fix for the pruning job

`pruneGames` runs at 05:00 and deletes finals older than 48h. `refundStaleBets`
runs at 06:30 and refunds bets whose game document is missing. A bet that
failed to settle for two days is therefore refunded rather than paid.

In `functions/src/scheduled/syncGames.ts`, make pruning refuse to delete a game
that still has pending bets:

```diff
     const stale = await db
       .collection("games")
       .where("status", "==", "final")
       .where("startsAt", "<", cutoff)
       .limit(400)
       .get();
 
     if (stale.empty) return;
 
     const batch = db.batch();
-    stale.docs.forEach((d) => batch.delete(d.ref));
+    let deleted = 0;
+    for (const d of stale.docs) {
+      // A final game with unsettled bets is evidence settlement is broken.
+      // Deleting it converts a win into a refund and hides the bug.
+      const pending = await db
+        .collection("bets")
+        .where("gameId", "==", d.id)
+        .where("status", "==", "pending")
+        .limit(1)
+        .get();
+      if (!pending.empty) {
+        logger.warn("skipping prune, bets still pending", { gameId: d.id });
+        continue;
+      }
+      batch.delete(d.ref);
+      deleted++;
+    }
+    if (deleted === 0) return;
     await batch.commit();
```

---

## 10. Idempotency keys are minted too late

`AppContext.placeBet` calls `api.newIdempotencyKey()` inside the request, so
every tap gets a different key and the server sees two distinct bets. Only the
`inFlight` ref stops the double — and it doesn't survive a screen remount or a
retry after a dropped response.

Mint the key when the bet sheet opens and reuse it for every attempt on that
sheet:

```diff
-  const [pending, setPending] = useState<{ game: Game; side: Side } | null>(null);
+  const [pending, setPending] = useState<{ game: Game; side: Side; key: string } | null>(null);
@@
   const openBetSheet = useCallback((game: Game, side: Side) => {
-    setPending({ game, side });
+    setPending({ game, side, key: newIdempotencyKey() });
   }, []);
```

…then thread `key` and `expectedOdds` through `placeBet` and drop the
`newIdempotencyKey()` call inside `AppContext`.
