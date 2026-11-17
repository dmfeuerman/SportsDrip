# Pass 1 — Trusted boundary

Two batches. Batch 1 built the server-side boundary; batch 2 moved the client onto it.

## Batch 1 — backend

| File | Status | Fixes |
|---|---|---|
| `firestore.rules` | **new** | S1, S5, S6 |
| `firestore.indexes.json`, `firebase.json` | new | query + deploy wiring |
| `functions/src/lib/economy.ts` | new | S2, B9, B10 — the ledger primitive |
| `functions/src/lib/sportsProvider.ts` | new | A1 — provider isolated behind one module |
| `functions/src/callable/profile.ts` | new | B3, B4 |
| `functions/src/callable/friends.ts` | new | §2 |
| `functions/src/callable/bets.ts` | new | S2, S4, B10 |
| `functions/src/callable/shop.ts` | new | §17 |
| `functions/src/callable/prizes.ts` | new | S3, B8 |
| `functions/src/callable/leagues.ts` | new | B9 — debit-only buy-in bridge |
| `functions/src/scheduled/syncGames.ts` | new | A1 |
| `functions/src/scheduled/settleBets.ts` | new | **B1**, B11 |
| `scripts/seed-catalog.mjs` | new | A4 |

## Batch 2 — client

| File | Status | Notes |
|---|---|---|
| `lib/firebase.ts` | **replaces** | RN auth persistence (B2), storage-bucket sanitising (S7), Functions handle |
| `lib/api.ts` | new | typed callables, idempotency keys, error mapping |
| `context/AppContext.tsx` | **replaces** | Firestore listeners replace AsyncStorage (S2, B5–B7) |
| `app/_layout.tsx` | **replaces** | real display name into LeagueProvider (B3), onboarding gate, sync provider removed |
| `app/onboarding.tsx` | **new** | character creation + profile claim (B4, U7) |
| `app/(tabs)/_layout.tsx` | **replaces** | Friends promoted to a tab; League moved off the bar |
| `app/(tabs)/index.tsx` | **replaces** | virtualized (U1), Firestore games, real empty/error states (U2) |
| `app/(tabs)/shop.tsx` | **replaces** | catalog-driven, preview on your own avatar (§18) |
| `app/(tabs)/mybets.tsx` | **replaces** | new bet shape, push/cancelled states, cancel action |
| `app/(tabs)/prizes.tsx` | **replaces** | server state, one shared timer (U3) |
| `app/(tabs)/avatar.tsx` | **replaces** | appearance editing (§19), all seven slots |
| `app/(tabs)/friends.tsx` | **new** | §2 and §21 in full |
| `components/AvatarDisplay.tsx` | **replaces** | reads avatar config + equipped map |
| `components/GameCard.tsx` | **replaces** | passes `side`; memoized; locks live games |
| `components/BetModal.tsx` | **replaces** | async submit, no optimistic close |
| `components/ClothingCard.tsx` | **replaces** | catalog items, rarity |
| `components/PrizeBox.tsx` | **replaces** | four explicit server states |
| `components/SpinWheel.tsx` | **replaces** | animates to the server's result (S3) |
| `constants/prizeTypes.ts` | **replaces** | display-only; the reward table moved server-side |
| `constants/avatarOptions.ts` | new | appearance options |
| `hooks/useGames.ts` | **replaces** | Firestore listener, no mock fallback (A3) |
| `hooks/useCatalog.ts`, `hooks/useFriends.ts` | new | |
| `types/game.ts`, `types/catalog.ts`, `types/leagueBet.ts` | new | |
| `context/LeagueContext.PATCH.md` | new | the four edits LeagueContext needs |

**Delete:** `components/FirebaseSyncProvider.tsx`, `constants/shopItems.ts`, `constants/games.ts`, `lib/sportsApi.ts`.

## Deploy order

```bash
# 1. Fix the malformed env var in .replit (S7) — drop the trailing quote
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET = "housemoney-e9991.firebasestorage.app"

# 2. Copy firebase.json, firestore.rules, firestore.indexes.json, functions/
#    and scripts/ to the repo root
cd functions && npm install && npx tsc --noEmit && cd ..

# 3. Rules and indexes FIRST. Deploying functions before rules leaves a window
#    where the old client can still write balances.
firebase deploy --only firestore:rules,firestore:indexes
firebase deploy --only functions

# 4. Seed the catalog, then confirm games/ is filling before shipping the client
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/seed-catalog.mjs
firebase functions:log --only syncGames

# 5. Copy artifacts/mobile/** over the existing files, apply
#    context/LeagueContext.PATCH.md, then:
pnpm --filter @workspace/mobile run typecheck
```

## Data migration

Existing users have balances in AsyncStorage and in `users/{uid}.app.tokens`; the new code reads neither. Before cutover, run a one-off that reads `users/{uid}.app`, writes `balance`, `equipped` and `inventory/*` in the new shape, and deletes the `app` and `league` blobs. They also have no `username`, so the onboarding gate will route them to `/onboarding` on next launch — which is the desired behaviour, but it means their old display name is lost unless the migration pre-fills it.

Old bets carry raw ESPN ids without the `SPORT:` prefix `games/{id}` now uses and can never be matched by a settle pass. Refund them as `cancelled` rather than attempting to map them.

## Verification

```bash
firebase emulators:exec --only firestore,functions "npm test"
```

Manual probes that must all fail after deploy:

```
setDoc(doc(db,'users',myUid), {balance: 1000000})                -> permission-denied
updateDoc(doc(db,'bets',myBetId), {status:'won'})                -> permission-denied
setDoc(doc(db,'users',myUid,'inventory','shoes_fire_reds'), {})  -> permission-denied
getDocs(collection(db,'leagueInvites'))                          -> permission-denied
updateDoc(doc(db,'leagues',lg), {'members.OTHER.leagueTokens':0})-> permission-denied
```

Manual probes that must succeed:

- Sign up → onboarding → 1,000 credits, three starter items, avatar renders in the shop preview and on a friend's card.
- Place a bet, force-quit, reopen: the bet is there and the balance is down. Kill the app entirely and let a tracked game finish: the payout still lands (`onGameFinal`).
- Double-tap Buy on the same item: one charge, one item.
- Open a prize box, move the device clock forward two days: the box is still counting down — the timer is server-side.
- Sign in on a second device: same balance, same wardrobe, same prize-box timers.
- Two accounts add each other at the same moment: one friendship, no duplicates.

## Not done

- **3D avatar** (Pass 3). Technology selected and the data model provisioned — `users/{uid}.avatar`, `catalog.assetUrl`, slot-based equipping, and `AvatarDisplay` already takes the prop shape the 3D component will take. No meshes yet; the current renderer is still 2D primitives.
- **League economy** (Pass 2). Still client-authoritative — see `context/LeagueContext.PATCH.md` for exactly what is and isn't protected in the interim.
- **Real odds** (Pass 5). `seededOdds` is a hash of the event id, so payouts are arbitrary numbers. It moved server-side unchanged, so the swap is one module.
- **Notifications** (§26). Nothing implemented. FCM triggered from `onGameFinal` and `respondFriendRequest` is the natural fit — both already exist as the right hook points.
- **Leaderboards, streaks, achievements** (§25, §31). `users/{uid}.stats` is now maintained server-side, which is the data these need, but there are no screens.
- **Tests.** The repo has none and this pass adds none beyond the rules-emulator command above. Now that the economy *is* the security boundary, `functions/src` needs unit tests before launch — the idempotency and negative-balance paths especially.

## 2026-11-13 — Results clarity, trophy celebrations, ungated levels

- **Result popup shows the bet**: new slip block (market · pick label · matchup · final score · odds) on win/loss popups; recap rows show the pick label too. `AppNotification.bet` now carries `market/selection/line/label` (the server already wrote them).
- **Trophy celebration**: `TrophyCelebrationHost` — a level-up-style takeover (god rays, confetti, the TrophyArt piece slamming in) for freshly earned achievements; queues behind results/level-ups (`OVERLAY.trophy`), marks the notification read on dismiss.
- **Challenges no longer gate levels**: XP alone levels you up (`gatedLevel` ungated, `xp.ts` follows XP directly, multi-level catch-up pays each crossed level's credits). Challenges stay as per-level bonus-XP sets, claimed ones still shown as done; pool extended with level 16/25/40 tiers so sets never run dry. Copy updated on Levels + challenge card; tests rewritten.
- **Level cash bonus** raised to 1,000 × level (was 500 ×) and surfaced on the Levels hero ("Level N pays +X credits").
- **Clothing prices**: `demoCatalog` was never ×10'd in the coin upgrade — now scaled like the seed data. Rebalance: entry commons 900/950 → 750 (first purchase on day-one 10,000 balance), gold shades 35,000 → 38,000. Re-run `node scripts/seed-catalog.mjs` to push prices to Firestore.

# Avatar pass — 2026-11-16

Five fixes/features, in order:

1. **See-through jackets fixed.** Root cause: the body distance field (`armD`/`legD`/`torsoD` in `character.mjs`) had cheap early-outs with 2–3 cm margins, smaller than thick-garment offsets (~5 cm), so `bodyD` was discontinuous exactly where the puffer's surface sits — the mesher left real holes behind each armpit. Margins widened to 8 cm. The puffer's quilting also switched patterns on a hard line at the shoulder (torn seam); it now cross-fades continuously. The shell's neck opening was wider than its collar (bare trapezius); tightened. Every garment's `hides` list was then re-measured and widened (fitcheck now passes with the puffer hiding neck/shoulders/chest/abdomen/upperArms/elbows), so skin can't poke through in animation either. `fitcheck.mjs` coverage rays extended (0.12→0.2 m, wider crevice fan) to see through deep armpit tunnels under thick jackets.
2. **Girl character.** New `frameFem` blendshape on the body, head/neck and every skinned garment (narrower shoulders/ribs/lats, higher waist, fuller chest, wider hips, slimmer neck and limbs), generated the same way as the build pair. `AvatarConfig.bodyFrame: "masc" | "fem"` (validated + sanitized in shared `avatarRules.ts`, both copies), applied in `avatarRig.ts`, selectable as "Body: Boy / Girl" in the customize screen and as the first step of the guided character designer.
3. **Less boxy silhouette.** Outerwear layer offset 30→24 mm, puffer padding trimmed, deltoids slightly smaller and closer in, lats slimmed — the letterman/varsity shoulders no longer read oversized.
4. **More open-front jackets.** New `outerwear_puffer_open` template plus catalog items for open puffers, open letterman and open satin bomber (worn open so the top underneath shows).
5. **More clothing/accessories.** New templates: `hat_headband` (banded fit, works with every hairstyle) and `acc_bracelet` (wristband). 18 new catalog items (open jackets, headbands, wristbands, new pattern colorways across tops/bottoms/outerwear/shoes).

All assets regenerated (quantized — glTF-Transform vendored in `scripts/avatar/node_modules`). `validate.mjs`, `fitcheck.mjs`, `hatfit.mjs` and the functions test suite (205) all pass; base budget raised 3.2→3.4 MB for the third morph.

To ship: re-seed the catalog (`node scripts/seed-catalog.mjs`) and re-render store thumbs (`node scripts/item-thumbs/render.cjs` — needs Playwright Chromium, blocked on this sandbox; missing/changed thumbs fall back to live renders).

## Follow-up — stronger fem shape + bra (2026-11-16)

- frameFem curves roughly doubled: narrower shoulders/trapezius/lats, deeper waist pinch, fuller bust, wider hips, fuller glutes, slimmer arms.
- New `Bra` mesh in the base GLB (sports-top band over the chest, base-layer offset, build+fem morphs). Shown by avatarRig whenever bodyFrame is fem and no worn garment hides the chest — so the girl body is never topless, mirroring how Underwear covers the hips.
- Base, tops, outerwear, bottoms, shoes and wrist items regenerated (their frameFem morphs sample the new shape); rigid head/neck items unaffected. All checks pass: validate, fitcheck (hides re-measured), hatfit (225), functions tests (205).
- itemThumbs.generated.ts: removed a duplicated line from the thumb render run.
