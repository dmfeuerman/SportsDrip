# SportDrip — Codebase Audit & Implementation Plan

Repo: `Avatar-Bet-Shop` (pnpm workspace). Real app is `artifacts/mobile` (Expo 54 / RN 0.81 / expo-router 6, Firebase Web SDK v12, AsyncStorage). `artifacts/api-server` is a bare Express `healthz` stub. `lib/db` schema is empty. `artifacts/mockup-sandbox` is unused shadcn scaffolding.

~4,500 lines of app code. Two state containers (`AppContext`, `LeagueContext`), one auth container, one sync shim.

---

## 1. Findings

Severity: **P0** = blocks launch / exploitable / core loop broken. **P1** = architectural, must fix before scaling. **P2** = quality.

### P0 — Security

| # | Finding | Location |
|---|---|---|
| S1 | **No `firestore.rules` file exists in the repo.** The project is running on default or test-mode rules. Every document is client-readable and client-writable by any authenticated user. Everything below follows from this. | — |
| S2 | **The entire economy is client-authoritative.** `placeBet`, `purchaseItem`, `claimPrizeSpin`, `addTokens` mutate React state; `FirebaseSyncProvider` mirrors the result to `users/{uid}`. No server ever validates a balance. `tokens: 1000000` is a two-line console call. | `context/AppContext.tsx`, `components/FirebaseSyncProvider.tsx` |
| S3 | **Prize payouts are chosen on the device.** `pickWinner()` runs `Math.random()` client-side and the amount is passed *into* `claimPrizeSpin(boxId, tokensWon)`. | `components/SpinWheel.tsx:53`, `AppContext.tsx:216` |
| S4 | **Bet outcomes are decided on the device.** `resolveBets` / `resolveLeagueBets` compute win/loss locally, then `settleFirestoreLeagueBet` writes `status:"won"` and `increment(potentialWin)` directly to Firestore. | `AppContext.tsx:249`, `lib/firestoreLeagues.ts:198` |
| S5 | `leagueInvites/{code}` is a world-readable, world-writable doc keyed by a 6-char code. Codes are enumerable (~2B space, but trivially brute-forced for popular leagues), and `addMemberToInvite` does an unguarded `arrayUnion`. | `lib/leagueInvites.ts` |
| S6 | `updateFirestoreMember(leagueId, uid, updates)` writes arbitrary fields at `members.{uid}.*`. Nothing stops a client passing another member's uid and zeroing their balance. | `lib/firestoreLeagues.ts:213` |
| S7 | `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` has a stray escaped quote: `"housemoney-e9991.firebasestorage.app\""`. Storage will 404 on every request. | `.replit` |
| S8 | Dead code that mints credits from `Math.random()` (`simulateBets`, `simulateLeagueBets`) is still exported on the context value. One button away from being an exploit. | `AppContext.tsx:170`, `LeagueContext.tsx:596` |

> The Firebase web API key in `.replit` is *not* a secret — that's expected for client SDKs. The security boundary is rules + server logic, and neither exists.

### P0 — Correctness

| # | Finding | Location |
|---|---|---|
| B1 | **Bets never resolve.** `resolveBets`, `resolveLeagueBets` and `fetchCompletedGames` have **zero call sites** in the app. Credits are debited on placement and never returned. The core loop is broken end to end. | verified by grep across `app/`, `components/` |
| B2 | **Auth does not persist on native.** `getAuth(app)` gives in-memory persistence under React Native; the required `initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) })` is missing. Every cold start bounces the user to `/login`. | `lib/firebase.ts:30` |
| B3 | **`LeagueProvider` is mounted without `displayName` / `avatarColor`.** `_layout.tsx` passes only `uid`, so the defaults apply and *every* member written to Firestore is named `"Player"` with colour `#00E87A`. This is the visible symptom behind "users aren't properly interconnected". | `app/_layout.tsx:43`, `LeagueContext.tsx:124` |
| B4 | **There are no user profile documents.** Nothing ever writes `displayName`, `username` or `email` to `users/{uid}`. User search, friend requests, friend profiles and friend avatars are therefore not just broken — they have no data to run on. There is **no friends system at all**; leagues + invite codes are the only social primitive in the app. | — |
| B5 | `FirebaseSyncProvider` writes `users/{uid}` with `setDoc` and **no `{merge:true}`**, every 2 seconds. It will erase any profile, friends or inventory field written by anything else. Two devices signed in = the slower one silently overwrites the faster one. | `FirebaseSyncProvider.tsx:88` |
| B6 | **Two conflicting sources of truth for leagues.** `LeagueContext` subscribes to `leagues/*` in real time *and* `FirebaseSyncProvider` mirrors that same array into `users/{uid}.league.leagues`, restoring it on next login via `restoreFromCloud`. Result: ghost leagues and stale token counts. | `LeagueContext.tsx:150` vs `FirebaseSyncProvider.tsx:95` |
| B7 | **Startup race.** `AppProvider`'s AsyncStorage `load()` and the sync provider's `getDoc` restore both call `setState` unconditionally with no ordering guarantee. AsyncStorage usually wins, clobbering cloud state. | `AppContext.tsx:87` vs `FirebaseSyncProvider.tsx:65` |
| B8 | **Prize box: `spun` is never set to `true`.** `claimPrizeSpin` *deletes* the claim, so the `spun` overlay never renders and `spunCount` / `totalWonFromPrizes` on the prizes screen are permanently `0`. Deleting the claim also erases the cooldown record — the box is instantly re-openable. And `readyAt` is `Date.now() + waitHours*3600e3` from the **device clock**, so moving the phone's time forward skips the wait, while state lives in AsyncStorage so a reinstall or second device resets it. This is the reported reset bug; all four causes need fixing, not just the timestamp. | `AppContext.tsx:216`, `AppContext.tsx:203` |
| B9 | `addTokens` has no floor and `league.tsx` calls `addTokens(-amt)` as a "deduct" helper → negative balances. | `AppContext.tsx:224`, `app/(tabs)/league.tsx:99` |
| B10 | **No transaction history and no idempotency keys anywhere.** Nothing is auditable. A double-tap on Buy, or a retried settle, double-charges or double-pays. | — |
| B11 | Ties are scored as losses: `const homeWon = game.homeScore > game.awayScore` with no equality branch. Soccer is in `SPORT_CONFIGS`, so draws are common. | `AppContext.tsx:262` |

### P1 — Architecture

| # | Finding |
|---|---|
| A1 | **Every device polls ESPN directly**, 5 sports × every 30s = ~10 req/min/user against an undocumented endpoint (`site.api.espn.com`). No shared cache, no backoff, no rate-limit handling. This does not survive a hundred users. |
| A2 | **Odds are fake.** `seededOdds()` hashes the event id into 1.4–2.9. Payouts are arbitrary numbers with no relationship to the actual matchup. |
| A3 | `useGames` silently swaps in `constants/games.ts` mock data on any failure and downgrades a badge to "SAMPLE". Users can place real-credit bets against fabricated games whose ids will never appear in a settle pass. |
| A4 | **Clothing is hardcoded.** `constants/shopItems.ts` is a 15-item literal array carrying only `color`/`secondaryColor`. Adding one hat requires a code change and an app release — directly contrary to requirement §14. There is no inventory document, no rarity, no thumbnail, no asset reference. |
| A5 | **The avatar is not 2D-poor, it is layout primitives.** `AvatarDisplay.tsx` is a stack of `<View>` rectangles tinted by item colour. There is nothing to migrate; the 3D system is a greenfield build. |
| A6 | No backend. `artifacts/api-server` exposes `/api/healthz` and nothing else; `lib/db` exports `{}`. All the "server-side" requirements in §3/§5/§24 have nowhere to live yet. |
| A7 | Bet ids are `Date.now() + Math.random()` generated client-side — not idempotency keys, and collidable across devices. |
| A8 | `replit.md` is the untouched scaffold template. No repo map, no architecture notes. |

### P2 — UX / performance

| # | Finding |
|---|---|
| U1 | `index.tsx` renders every game inside `ListHeaderComponent` of a `FlatList` with `data={[]}`. Virtualization is fully defeated; ~100 `GameCard`s mount at once. |
| U2 | No pull-to-refresh, no skeletons, no empty state, no retry affordance on the games screen. `gamesError` only changes a badge. |
| U3 | `PrizeBox` mounts a 1s `setInterval` per box (3 concurrent timers), each re-rendering the card every second. |
| U4 | Hardcoded `#00E87A` / `#1E3A2A` / `#FF6B35` literals throughout `index.tsx` and `prizes.tsx` bypass `useColors()` and break light mode. |
| U5 | Login has no password reset, no email verification, and no display-name capture — which is *why* B3/B4 exist. |
| U6 | `substr()` (deprecated) in 5 places. `Platform.OS === "web" ? 67 : insets.top` magic numbers repeated in every screen. |
| U7 | No onboarding at all: signup drops the user straight onto the games tab with 1,000 credits and no explanation. |

---

## 2. Root cause

Nine of the eleven P0 correctness bugs and all eight security findings share one cause: **the client is the server.** Balances, outcomes, rewards and relationships are all computed on-device and mirrored up. Patching them individually would produce a dozen fragile fixes. The correct repair is to move the economy behind a trusted boundary, then lock the database so the client physically cannot write it.

That is what this first implementation pass does.

---

## 3. Implementation plan

**Pass 1 — Trusted boundary (delivered in this batch).** Firestore security rules; Cloud Functions owning balance, bets, purchases, prize boxes, profiles and friendships; server-side scheduled game sync and bet settlement; client rewritten to read Firestore and call functions. Fixes S1–S8, B1, B2, B4–B11, A1, A6, A7.

**Pass 2 — Social + data-driven catalog.** Friends UI (search / request / accept / remove / profile), head-to-head challenges, `catalog/{itemId}` admin seeding, inventory + equipped rendering across every screen. Fixes A4.

**Pass 3 — 3D avatar.** Base mesh, morph-target customization, slot-based attachment, editor screen, signup flow. Fixes A5, U7.

**Pass 4 — UI/UX + performance.** Virtualization, skeletons, retry, theme cleanup, onboarding. Fixes U1–U7.

**Pass 5 — Real odds + provider migration.** Replace `seededOdds`. Fixes A2, A3.

---

## 4. Technology recommendations

### 4.1 3D avatar — **Three.js via `react-three-fiber` + `expo-gl`, with glTF/GLB assets**

| Option | Verdict |
|---|---|
| **R3F + expo-gl + glTF** | **Recommended.** Runs in the existing Expo app on iOS, Android and web with no native module ejection. glTF supports skinned meshes, morph targets and separate garment meshes rigged to the same skeleton — exactly the base-character-plus-clothing split §11 requires. Adding a shirt is: export GLB → upload to Firebase Storage → insert a `catalog/{itemId}` doc. No release. |
| Ready Player Me | Fast to a good-looking avatar, but clothing comes from *their* catalog. You cannot freely add your own apparel, which is the stated hard requirement. Rejected on §10's primary constraint. |
| Unity / Unreal as a subview | Best fidelity, worst fit. Requires ejecting from Expo Go, ~40 MB binary growth, a second toolchain and a second team skillset. |
| Sprite-stack "2.5D" | Cheapest, but you have that today and it is what you're replacing. |

Asset pipeline: one rigged base mesh (Mixamo/Rigify skeleton), morph targets for height/build/face, a small set of skin/hair materials driven by uniforms, and garments exported as separate skinned GLBs bound to the same skeleton. Draco-compress, target <300 KB per garment, lazy-load from Storage with a CDN cache.

### 4.2 Sports data — **keep ESPN for MVP, migrate to API-Sports (api-sports.io) before launch**

ESPN's `site.api.espn.com` is free, unauthenticated, well-shaped and already parsed correctly in `lib/sportsApi.ts` — but it is undocumented, unversioned, has no SLA and no odds. It is fine behind a server-side cache for now (which this pass adds: one fetch per two minutes for all users instead of ten per minute per user).

For launch, **API-Sports** is the best fit: ~$25–40/mo covers NFL/NBA/MLB/NHL/soccer with real bookmaker odds, documented rate limits (7,500 req/day on the standard tier — trivially inside budget with a 2-minute server-side poll), and a single consistent schema across leagues. The alternative, **The Odds API**, has better odds coverage but weaker box-score data; **SportsDataIO** is the enterprise option at roughly 10× the price. The scheduled function in this batch isolates the provider behind one file (`functions/src/lib/sportsProvider.ts`), so the swap is a single-module change.

---

## 5. What this batch delivers

See `CHANGES.md`.

## 6. Not yet done

- 3D avatar system (Pass 3) — technology selected and data model provisioned (`users/{uid}.avatar`, `catalog` with `assetUrl`/`slot`), no meshes yet.
- Friends **UI** — the entire backend (search, request, accept, decline, remove, profile read) ships in this batch; the screens do not.
- League economy is **not yet migrated** to the trusted boundary. Leagues still write `members.{uid}.leagueTokens` from the client. Rules in this batch leave `leagues/*` permissive-but-authenticated so the existing feature keeps working; it must move behind callables in Pass 2 before launch.
- Real odds (Pass 5).
- UI/UX redesign (Pass 4).
- No automated tests exist in the repo; nothing here is covered by tests. The Firestore rules ship with an emulator test suite stub only.
