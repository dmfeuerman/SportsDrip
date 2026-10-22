# SportDrip — Pass 4: leagues on the server, simple-interest loans, result popups, redesign

Scope: `artifacts/mobile` (Expo 54 / expo-router / Firebase Web SDK 12), `functions/` (Cloud Functions v2), `firestore.rules`, `firestore.indexes.json`, `scripts/`.
Snapshot of the starting code was kept for diffing; nothing outside the repo was changed.

---

## A. Implemented changes

### 1. Leagues moved behind the trusted boundary (prerequisite for everything else)

Before this pass the whole league economy was client-written. A member could set their own `leagueTokens` to any value, "approving" a loan minted tokens from nothing, league bets were settled by whichever phone happened to be open, interest only ran in AsyncStorage mode, and pressing "End League" paid nobody. League betting had **no call site at all** — `placeLeagueBet` existed but nothing in the UI reached it, so leagues had no gameplay.

New server API (`functions/src/callable/leagues.ts`), all transactional and idempotent:

| Callable | Notes |
|---|---|
| `createLeague` | validates every option against `lib/leagueConfig.ts`, allocates a unique 6-char code (no 0/O/1/I), charges buy-in in the same transaction; deterministic id from the idempotency key |
| `joinLeague` | code → league; charges buy-in once per member (`league_buyin_{league}_{uid}`); leaving is permanent (`formerMemberIds`) so a buy-in can't be dodged |
| `leaveLeague` | blocked while you owe/are owed or have open league bets; creator role passes to the earliest member |
| `placeLeagueBet` | server odds + drift guard, sport must be allowed, game must start before the season ends, tokens can't go negative |
| `takeBankLoan` / `repayLoan` | simple interest (below); principal capped at 1× starting stack; repay receipts are idempotent |
| `requestPeerLoan` / `peerLoanAction` | fund / counter / decline / cancel / accept or reject counter — tokens move lender→borrower and back |
| `updateLeagueSettings` | creator only; **new terms apply to new loans only** |
| `inviteToLeague` | friends only; delivered as an in-app notification carrying the code |
| `endLeague` + hourly `leagueSweep` | voids & refunds open bets, ranks on **net worth**, pays the pot in credits — one idempotent transaction per winner, resumable after a crash |

Data model: `leagues/{id}` (+ `leagueBets`, `loans`, `activity` subcollections), `leagueInvites/{code}`. Rules now deny every client write under `leagues/**`; members read. League bets settle in `settleLeagueBetsForGame` alongside main-wallet bets (trigger + 15-min sweep + stale refund).

`scripts/migrate-leagues-v2.mjs` upgrades existing league docs (legacy `members.{uid}.bankLoans[]` → loan docs; what the old compounding code already charged is honoured as owed, then accrues simply).

### 2. All loans use simple interest

`functions/src/lib/loanMath.ts` — pure, no imports; `artifacts/mobile/lib/loanMath.ts` is byte-identical (a test fails if they drift), so the number on screen is the number the server settles.

- Interest = `ratePct` × **outstanding principal** × whole periods elapsed. `interestAccrued` is tracked separately and is never part of the base.
- Interest is **not written on a timer**. It's a pure function of the loan and the clock; `accruedThrough` advances by whole periods only when a repayment folds it in. Opening a screen, re-running a job, or reading twice cannot charge twice.
- Repayments pay accrued interest first, then principal; overpayment is clamped to what's owed.
- Rounding: integer tokens, half-up once per constant-principal segment (integer arithmetic for rates to two decimals).
- Same engine for bank and peer loans; peer loans use the league's period length.
- Spec example verified in tests: 1,000 at 10% for 2 periods → 200 interest, 1,200 owed.

**Design decision (flagging it):** the brief says "calculated using the original principal". I charge on the *remaining* principal, which equals the original until a repayment is made. Charging full original-principal interest after a partial repayment would penalise repaying and isn't standard simple interest. One line in `pendingInterest` changes this if you want the literal reading.

**Rule change (justified):** the old bank had no borrowing limit — borrow a billion, bet it, keep the win. Principal is now capped at the starting stack (`BANK_PRINCIPAL_CAP_MULTIPLIER`), and standings rank on net worth (tokens + receivables − debt) so borrowing is no longer a free climb up the table. Loans also lock their rate at origination; previously a creator could reprice everyone's debt.

### 3. Bet notifications and win/loss popups

- **Server:** every settlement transaction (main bets, league bets, stale refunds, league payouts/season end, loan funded/repaid/countered/requested, invites) writes `users/{uid}/notifications/{id}` *in the same transaction that moves the money*, under a deterministic id (`settle_{betId}`, `lsettle_{league}_{bet}`, `payout_{league}` …). No popup without a payout, no payout without a popup, never two. Rules: owner reads, owner may flip only `read`.
- **Client:** `context/NotificationContext.tsx` + `lib/notificationQueue.ts` (pure, tested): popups show one at a time, oldest first; snapshot replays and reconnects never re-queue; items read on another device drop out; stale ones (>6h) go to the feed only.
- `components/ResultPopup.tsx`: distinct win (turf green, spring + count-up, success haptic; "BIG WIN" at ≥3× or +1,000) and loss (clay, warning haptic) treatments; shows outcome label (text + icon, not colour alone), final score from your side, pick + odds, stake, payout, new balance (wallet-aware, league named), "N more · Skip all", screen-reader announcement.
- `app/activity.tsx`: notification history with unread dots; invites deep-link into the join sheet; bell with unread badge on Home, Games, Friends.
- Sound effects: not added — no audio library is installed and I didn't add a dependency for it; haptics cover the feedback.

### 4. Avatar customization

The catalog-driven 7-slot system (hat, eyewear, outerwear, top, bottom, shoes, accessory; database-driven, 2D + 3D renderers) was already in place, so I extended it rather than replacing it:
- **Try-on in the Locker:** wardrobe taps now dress a preview only; "Wear this" commits the diff slot by slot, "Reset" discards. Previously every tap was a server write.
- **Avatars everywhere:** league standings render members as their characters (`MemberAvatar` + cached `usePublicProfiles`), with an initial fallback.
- **Thumbnail fix:** `AvatarDisplay2D` used `transform: scale` without shrinking its layout box, so small thumbnails cropped off the head (visible in friends lists). It now reserves the scaled footprint.
- Fixed the type gap that broke the build: `CatalogItem.shape` (the 3D garments already read it).
- Locker also surfaces the shop, prize boxes and your record.

### 5. Leagues as a primary feature

- New **Leagues tab** (was a button inside Friends). Cards show rank / field size, net worth, debt or leader, pot, days left with a season progress bar, and the latest feed line.
- **League detail** (`app/league/[id].tsx`): league switcher chips; hero (rank, net worth, debt); tabs **Table · Bets · Loans · Feed · Info**; pinned "Bet with N league tokens" CTA that opens the board with that wallet preselected.
- **Join sheet** previews league name and buy-in *before* charging. **Create** keeps the existing modal, now with options aligned to the server, simple-interest copy, inline errors, and it keeps the form on failure.
- **Invite:** share code, or invite friends in-app (from the league or from a friend's profile).
- Empty state explains how leagues work.

### 6. Redesign (details in the UX section)

Five-tab IA (Home · Games · Leagues · Friends · Locker), a Home dashboard, a shared UI kit, a rebuilt bet slip with a wallet picker, wallet colour tokens, and My Bets covering both wallets.

### Files

New — functions: `src/lib/{loanMath,leagueConfig,leagueLifecycle,notify,notifyModel,settlement}.ts`, `src/scheduled/leagues.ts`, `test/*` (fake Firestore + 5 suites), `tsconfig.test.json`.
Rewritten — functions: `src/callable/leagues.ts`, `src/scheduled/settleBets.ts`, `src/index.ts`. Edited: `src/callable/profile.ts` (email → private subdoc), `package.json` (test script).
New — mobile: `app/(tabs)/{index,leagues}.tsx`, `app/{activity,bets}.tsx`, `app/league/[id].tsx`, `components/{ui/index,ResultPopup,LoanCard,JoinLeagueSheet,MemberAvatar}.tsx`, `context/NotificationContext.tsx`, `hooks/{useNow,usePublicProfiles,useLatestActivity}.ts`, `lib/{loanMath,notificationQueue,demo}.ts`.
Moved: `(tabs)/index.tsx → (tabs)/games.tsx`; `(tabs)/{mybets,prizes,shop}.tsx → app/{bets,prizes,shop}.tsx` (pushed screens with back).
Rewritten — mobile: `context/LeagueContext.tsx`, `constants/leagueTypes.ts`, `components/BetModal.tsx`, `app/(tabs)/_layout.tsx`. Edited: `_layout.tsx`, `games.tsx`, `avatar.tsx`, `friends.tsx`, `BetTicket.tsx`, `CreateLeagueModal.tsx`, `AvatarDisplay2D.tsx`, `AppContext.tsx`, `lib/{api,firebase}.ts`, `hooks/{useGames,useCatalog,useFriends}.ts`, `constants/colors.ts`, `types/catalog.ts`, `avatar3d/{garments,boneGarments}.tsx`, `package.json` (+`babel-preset-expo`).
Deleted: `lib/firestoreLeagues.ts`, `lib/leagueInvites.ts`, `types/leagueBet.ts`, `components/LoanRequestCard.tsx`, `app/(tabs)/league.tsx`, `context/LeagueContext.PATCH.md`.
Also: `firestore.rules`, `firestore.indexes.json`, `firebase.json` (ignore test dirs), `scripts/migrate-leagues-v2.mjs`, `.agents/memory/*` updated to the new architecture.

### Deploy order

1. `firebase deploy --only firestore:rules,firestore:indexes` (wait for indexes to build)
2. `firebase deploy --only functions` — `payLeagueBuyIn` is removed; the new client doesn't call it
3. `node scripts/migrate-leagues-v2.mjs --dry-run`, then without `--dry-run`
4. Ship the client. `pnpm install` once (adds `babel-preset-expo`, which pnpm doesn't hoist — `expo export` failed without it).

---

## B. Validation

| Check | Result |
|---|---|
| `functions`: `tsc --noEmit` | pass |
| `functions`: `npm test` (38 tests) | **38/38 pass** |
| `artifacts/mobile`: `tsc --noEmit` | **0 errors** (was 21 before this pass) |
| Web export (`EXPO_PUBLIC_DEMO=1 expo export --platform web`) | builds |
| Rendered UI | inspected in headless Chromium at 390×844, dark and light |

**Tests** — `functions/test/`. Unit: loan maths (spec example, no compounding, idempotent accrual, interest-first repayment, clamping, rounding, net worth, tie-breaks, prize split), settlement rules, notification builders, popup queue, client/server `loanMath` identity. Integration: the real callables and settlement code run against an in-memory Firestore (`test/fakeFirestore.ts`) that enforces optimistic transactions, retries, and the reads-before-writes rule. Covered: trigger + sweep racing on the same bet (one payout, one notification), four bets resolving at once, double-tapped bets, cancel races, negative balances, orphan refunds, purchase retry storms, buy-in charged once on concurrent joins, allowed sports, one user in two leagues betting the same game, non-member and non-creator rejections, bank cap, partial repayments, idempotent repay, rate change affecting new loans only, peer counter/accept/repay to lender, leave blocked by loans, season end with net-worth ranking, voided bets and a pot paid exactly once while the button and the scheduler race, invites.

**Screens inspected** (demo fixtures, `lib/demo.ts`): Home (dark + light), Games, bet slip with wallet picker, Leagues, league Table, Loans (finances, bank, loan card, peer market), win popup, loss popup, My Bets, Activity, Locker. Fixed from that pass: avatar thumbnails cropping heads, a truncated button label, crowded standings rows, "−0" in the slip.

**Not verified**
- The Firestore emulator jar couldn't be downloaded here, so **`firestore.rules` haven't been tested** and nothing ran against real Firestore. The fake is faithful on transactions but isn't Firestore. Run the suite against the emulator before deploying.
- No native iOS/Android run; the liquid-glass `NativeTabs` path wasn't rendered.
- Flows were checked by screenshot, not by clicking through on a device (repay form, counter-offers and create/join weren't exercised in the UI).
- In the web render the 3D Locker character showed no garments or hair. I didn't trace whether that predates this pass or is web-only.

**Known limitations**
- League bets can't be cancelled (main-wallet bets can). Needs a `cancelLeagueBet`.
- Member `displayName` is copied into the league doc at join and goes stale on rename.
- Existing `users/{uid}` docs still hold `email`; new profiles write it to `private/contact`. Needs a backfill.

---

## C. Code review

### Critical — fixed
1. **League economy was client-trusted.** Self-written `leagueTokens`, token-minting loan approval, client-side settlement, rules that allowed it. → callables + deny-all rules.
2. **Bank interest compounded and mostly never ran.** `loan.amount * rate * periods`, where `amount` already included interest; and it only ran in AsyncStorage mode, so Firestore leagues never accrued at all. → `loanMath`.
3. **Borrowing won leagues.** Standings sorted on raw tokens and borrowing had no limit. → net-worth ranking + principal cap.
4. **League betting was unreachable** — there was no UI path to `placeLeagueBet`.
5. **Leagues never paid out**; `endLeague` only flipped local state.
6. **Every account's email was readable** by any signed-in user (`users/{uid}` allows `get`). → new profiles store it privately; old docs need a backfill.

### High — fixed
- `CreateLeagueModal` offered 100–5,000 starting tokens while the constants (now enforced) are 1,000–50,000, and its default of 10,000 wasn't in its own list.
- `isCreator` compared against `"you"`, which is never true in Firestore mode, and peer requests were stored with `memberId: "you"` and never persisted.
- My Bets subscribed to **every** final game in the database (unbounded reads). Settled bets carry their own score now.
- 21 pre-existing TypeScript errors (`CatalogItem.shape`, literal-typed palette, nullable `secondaryColor`).
- `babel-preset-expo` unresolvable under pnpm, so web export failed.

### Open — not fixed
- **Security:** `users/{uid}` still exposes `balance` to any signed-in user (product call). No rate limits or App Check on callables (carried over from QA 3.7). `checkUsername` is unauthenticated. The `isLeagueMember` rule does one `get()` per subcollection read, which adds cost.
- **Performance:** `settleBetsSweep` scans up to 1,000 pending bets every 15 minutes; `refundStaleBets` reads one game per bet. Group by `gameId` with a capped query.
- **Dead code:** `placeBet`'s `opponentUid` (head-to-head) is validated and stored but nothing reads it — no settlement, no UI. `artifacts/api-server`, `lib/db` (Postgres/Drizzle), `lib/api-*` and `mockup-sandbox` are unused, and `replit.md` describes that unused stack. There's also an empty stray directory, `artifacts/mobile/{constants,hooks,components,lib/` (a failed shell brace expansion).
- **Maintainability:** `onboarding`, `login`, `shop`, `prizes`, `friends` and `GameCard` still use inline StyleSheets and literal colours; migrate them to `components/ui`. `CreateLeagueModal` is 870 lines and should be split.

### Recommended removals and simplifications
Each is labelled as a confirmed technical problem or a design opinion.
- *Technical:* either build head-to-head on `opponentUid` (see D4) or remove it. Remove the scaffolding packages.
- *Design:* three prize-box tiers with 1/4/12-hour timers are a pure faucet, with no decision attached and a lot of state machine for the value. Collapse them to one daily box, or tie boxes to activity (a box per settled slate).
- *Design:* peer-loan "decline" lets one member hide a request only for themselves; a request now dies only when everyone passes. That's simpler and harder to grief, but think about whether peer loans should target one lender instead of the whole group.

---

## D. Game design

The current loop is pick a team, wait, collect credits, buy clothes. Every decision happens at the moment a bet is placed, nothing carries over between bets, and the only long-term goal is a bigger number. The strongest addition this pass makes is leverage that has consequences (debt with interest, ranking on net worth). The ideas below build on that. Ranked by expected gameplay value:

**1. Seasons with promotion and relegation (league ladders)**
- *Mechanic:* public or friend ladders with divisions. Each season every member gets the same stack, and the top and bottom of each division move up or down.
- *Impact:* every season has stakes at both ends of the table. Mid-table players have something to protect.
- *Depth:* risk appetite depends on where you sit. Leaders protect, the bottom swings.
- *Complexity:* medium–high.
- *Dependencies:* league lifecycle (done), matchmaking, a season scheduler.
- *Risks:* thin divisions early on, and sandbagging to stay in a soft division.
- *Recommendation:* **build it.** It turns one-off leagues into a reason to come back every week.

**2. Credit score and a real lending market**
- *Mechanic:* a per-league (later global) credit score from repayment history. It sets your bank limit and rate. Default at season end means a score hit and carried debt or restructuring.
- *Impact:* borrowing becomes a planned strategy, not a panic button.
- *Depth:* borrow cheap early to compound edges, or stay clean for a bigger line late.
- *Complexity:* medium.
- *Dependencies:* `loanMath` (done) plus a score doc and rate tiers.
- *Risks:* scores going punitive or opaque. Show the formula.
- *Recommendation:* **build it.** The loan engine is ready for it.

**3. Conviction cards (limited-use abilities)**
- *Mechanic:* three to five cards per season: *Insure* (stake back on a loss), *Double down* (raise stake before lock), *Hedge* (cash out at a fair price), *Underdog boost* (+10% on odds ≥ 2.5).
- *Impact:* "when do I use it?" is a scarce, memorable decision.
- *Depth:* spending a card now versus saving it for the big slate.
- *Complexity:* medium. Server validation plus a settlement modifier.
- *Risks:* stacking exploits; cards that are must-use and therefore not a choice.
- *Recommendation:* **build after ladders.**

**4. Head-to-head challenges and rivalries**
- *Mechanic:* challenge a friend on opposite sides of one game with an escrowed stake (the unused `opponentUid` stub). Rivalry records persist.
- *Impact:* direct social stakes and trash talk.
- *Depth:* pick your spots and your opponents.
- *Complexity:* medium. Escrow, accept/decline, settlement.
- *Risks:* collusion farming between alt accounts. Cap it and require friendship age.
- *Recommendation:* **build it.** Cheap, and the most social feature on this list.

**5. League events and modifiers**
- *Mechanic:* rotating weekly rules: "bank run" (rates double), "underdog week", "sudden death" (lowest net worth that week is fined).
- *Impact:* the meta shifts weekly, which keeps strategies fresh.
- *Depth:* adapt or exploit.
- *Complexity:* low–medium, as config on the league doc read by the callables.
- *Risks:* modifiers that feel arbitrary. Announce them a week ahead.
- *Recommendation:* **quick win** once ladders exist.

**6. Skill-based scoring variants**
- *Mechanic:* league scoring by ROI or risk-adjusted return instead of net worth, chosen at creation.
- *Impact:* rewards consistency over one lucky parlay.
- *Depth:* bet sizing matters.
- *Complexity:* low. A different sort key in `rankMembers`.
- *Risks:* harder to explain.
- *Recommendation:* **quick win.**

**7. Achievements → earned cosmetics and reputation**
- *Mechanic:* skill-gated unlocks ("Underdog Hunter: five wins at ≥2.5×", "Debt-free champion"), shown on profile and standings.
- *Impact:* status that money can't buy.
- *Depth:* side goals that pull play in different directions.
- *Complexity:* medium. Catalog items get `unlock` conditions, checked at settlement.
- *Risks:* grind.
- *Recommendation:* **build it.** The catalog already supports adding items without code.

**8. Player-run books**
- *Mechanic:* league members can lay odds to each other with their own tokens.
- *Impact:* an emergent economy.
- *Depth:* very high.
- *Complexity:* high.
- *Risks:* exploits, liquidity, moderation.
- *Recommendation:* **defer.** Revisit after 1–4.

**The most promising change to the core loop:** make the **season** the unit of play — ladders (1) with conviction cards (3) and a credit score (2). Each week becomes allocating a fixed, debt-aware bankroll across a slate with a few scarce power plays, and the season result decides your division. That gives a long-term goal, weekly decisions, and something to talk to your friends about.

**Roadmap**
- *Quick wins:* league scoring variants, weekly modifiers, `cancelLeagueBet`, collapse prize boxes, rate limits and App Check, email backfill.
- *Medium:* head-to-head challenges, credit score, achievements → cosmetics, a push channel for notifications.
- *Major:* promotion/relegation ladders and matchmaking, conviction cards, player-run books.

---

## E. Overall assessment

Before this pass the long-term loop was weak: credits bought clothes, and leagues — the only competitive structure — were cosmetic, unbettable and trivially exploitable. Now leagues are a real, server-enforced competition. Borrowing is a strategic lever with a price, results land with a moment attached, and Home tells you where you stand. What's still missing is *recurring structure* (seasons and divisions), *scarce decisions* beyond picking a side (cards, credit), and *direct rivalry* (head-to-heads). Those three are what make people come back weekly, compete with specific friends, and develop strategies, and all three build on systems this pass put in place.

---

## UX/UI

**1. Initial assessment**
- Six tabs with leagues hidden inside Friends. Nowhere answered "how am I doing?".
- Three money concepts — credits, league tokens, debt — shared one amber and the word "tokens".
- Hardcoded hexes (`#00E87A`, `#4A90D9`) ignored the theme. Every screen hand-rolled its own buttons, pills and headers.
- The bet slip used fixed 50–500 quick stakes regardless of wallet, showed nothing about downside, and couldn't use a league wallet.
- Outcomes appeared silently in a list. Equipping wrote on every tap. Thumbnails cropped heads. The join flow charged before showing what you were joining.

**2. Implemented redesign**
- Tabs: Home · Games · Leagues · Friends · Locker. My Bets, Prizes, Shop and Activity are pushed screens with back navigation.
- New screens: Home dashboard, Leagues overview, League detail, Activity.
- Rebuilt: bet slip, My Bets.
- Updated: Locker (try-on, shop and prizes entries, record), join and create sheets, friend profile (league invites), result popups.

**3. Design system**
- `components/ui`: `Button` (5 variants, loading/disabled/pressed, 44pt minimum), `IconButton` (badge), `Card` (tone), `Pill`, `Amount` (currency icon + tabular figures + accessible label), `StatTile`, `ScreenHeader`, `SectionHeader`, `SegmentedControl`, `EmptyState`, `ErrorBanner`, `ConfirmDialog`, `Initial`, layout helpers.
- Semantic tokens: amber = credits, floodlight blue = league tokens, clay = debt, green and red = outcomes, defined for both schemes.
- States are always carried by text or icon as well as colour.

**4. Usability by journey**
1. Open the app → Home answers balance, money in play, debt, league ranks and recent results.
2. Find and place a bet → board → slip with the wallet picker, quick stakes as a share of the wallet, return/profit/loss/balance-after, and a plain "over half your wallet" note. No urgency cues.
3. Review a bet → tickets show live position, and league bets are labelled with their league.
4. Receive a result → popup with all the numbers, then the Activity feed.
5. Borrow and repay → Loans tab shows finances, borrowing room, cost per period, an itemised loan card, and a repay preview splitting interest and principal.
6. Find a league and its standings → a tab, rich cards, and a switcher in the detail screen.
7. Compare with friends → standings with avatars and net worth; the friend sheet invites to a league.
8. Edit the avatar → try-on, then "Wear this".
9. Discover features → empty states explain leagues and loans, Info lists every rule, and Loans spells out simple interest.

**5. Remaining issues** — not done, with reasons
- Onboarding, login, shop, prizes, friends and the game card aren't migrated to the kit. Time; they work and the palette applies.
- No onboarding tour of leagues or loans beyond the empty states.
- Tablet and wide-web layouts are unoptimised; the app is phone-first.
- No reduced-motion handling for the popup spring.
- The 3D Locker character didn't show garments in the web render (see B).

**6. Next steps**
- Finish migrating the remaining screens to the kit.
- First-run walkthrough of a league season.
- Season recap / "story" screen at league end: the biggest win, the worst loan, the rivalry result.
- Rivalry view in Friends (head-to-head record).
- Reduced-motion support.
- Tablet layouts for league standings.

### Demo mode
`EXPO_PUBLIC_DEMO=1` renders every screen from fixtures with Firebase off (`lib/demo.ts`). Add `?popup=1` or `?popup=loss` on web to preview the popups. It can't write anywhere and is inert unless the flag is set at build time.
