# SportDrip — QA pass and 3D avatar

Read of `Avatar-Bet-Shop_2.zip`: `artifacts/mobile` (Expo 54 / expo-router /
Firebase Web SDK v12), `functions/` (Cloud Functions v2, the trusted
boundary), `firestore.rules`, `firestore.indexes.json`, seed script.
`artifacts/mockup-sandbox` and `artifacts/api-server` are scaffolding and were
not reviewed in depth.

The trusted-boundary work from the previous pass holds up. Credits only move
through `applyCredits`, it refuses to go negative, ledger ids are derived from
idempotency keys, settlement is server-side with a trigger plus a sweep, and
the client cannot write balance, bets, inventory or prize state. The findings
below are the gaps left in and around that.

---

## Severity 1 — crash

### 1.1 Friends tab: infinite render loop

The stack you pasted, in full:

```
useFriends() returns a new object with new arrows every render
  -> friends.tsx debounce effect lists `search` in its deps
  -> effect re-runs on every render
  -> first statement is setResults([]) — a new array each time, so React
     cannot bail out on Object.is
  -> re-render -> new `search` -> effect -> setResults([]) -> 761 iterations
     until React gives up
```

`experiments.reactCompiler` is on, which is presumably why this shipped: the
compiler memoises what it can prove and it bailed on this hook. Compiler output
is not a contract — `useCallback` is.

Fixed in `hooks/useFriends.ts` (every returned function is stable, plus
memoised `friendUids` / `outgoingUids`), and in the `friends.tsx` diff, which
also stops writing a fresh `[]` into state.

The two secondary loops in the log (bundle offsets 195944 and 29406) are the
same storm re-entering through the tab navigator and a touch dispatch. Both
stop when the primary loop does. Worth re-running the log after the fix; if
anything survives, it will be visible on its own instead of buried under 1,400
lines of the same error.

---

## Severity 2 — security and data integrity

### 2.1 `bets` is listable by anyone signed in

```
allow list: if signedIn();     // constrain with a where('uid','==',...) query
```

The comment describes the intent; the rule does not enforce it. Any signed-in
client can page every bet in the app — who bets what, how much, and how often.
Fix in `PATCHES.md` §5: evaluate ownership per document, which forces the
query to carry the filter.

### 2.2 `users` is listable by anyone signed in

`allow get, list: if signedIn()` on a document that contains `email` and
`balance`. Discovery already goes through the `searchUsers` callable, which
returns public fields only, so `list` is not needed by the app at all.
Fix in §5.

### 2.3 Odds were decorative

`seededOdds()` hashed the event id into a number between 1.4 and 2.9. A
mismatch and a coin-flip priced the same, and the number moved only when the
event id did. Users learn quickly that the price means nothing, and the whole
economy loses its shape.

`functions/src/lib/sportsProvider.ts` is rewritten: where ESPN publishes a
two-way moneyline it is converted to decimal, the book's vig is stripped, and
a single house margin (`OVERROUND`, currently 4.5%) is applied. The hash
remains as the fallback so a thin feed never makes a game unbettable. Prices
are clamped to 1.15–6.00 — an unbounded longshot in a play economy is a credit
printer.

Consequence, handled in §7: prices now move between syncs, so `placeBet` takes
an optional `expectedOdds` and rejects a fill more than 5% worse than what the
user was shown.

### 2.4 Prize boxes never reach `ready`

`openPrizeBox` returns `{ state: "ready" }` when the cooldown has elapsed but
never writes it. The document stays `waiting` for good. The client currently
recomputes readiness from `readyAt` so the UI looks right, which is exactly why
this survived — any future server-side read of box state is wrong. `§6`.

Related: `resetPrizeBox` merges `{ state: "idle" }` over `openedAt`, `readyAt`
and `rewardCredits` from the spent cycle. Harmless today because
`openPrizeBox` overwrites them, but it means a box in the database is not
self-describing. Also cleared in §6.

Not a bug, worth knowing: if the app is killed between `claimPrizeBox` and
`resetPrizeBox`, the box sits at `claimed`. The credits are already banked —
claim commits before the wheel animates — and `openPrizeBox` treats `claimed`
as openable, so the user loses nothing.

### 2.5 Pruning can convert a win into a refund

`pruneGames` (05:00) deletes finals older than 48h. `refundStaleBets` (06:30)
refunds any pending bet whose game document is missing. A bet that failed to
settle for two days is refunded instead of paid, and the underlying settlement
failure is erased. §9 makes pruning skip games that still have pending bets.

### 2.6 Idempotency keys are minted per tap

`AppContext.placeBet` calls `newIdempotencyKey()` inside the request, so two
taps are two keys and therefore two bets. The `inFlight` ref is the only thing
stopping it, and it does not survive a remount or a retry after a dropped
response. §10 moves key generation to the moment the bet sheet opens.

`purchaseItem` is safe by a different route — the inventory document id is the
item id, so a duplicate purchase cannot exist regardless of the key.

---

## Severity 3 — correctness and performance

### 3.1 `AppContext` value object is not memoized

Every provider render hands consumers a new object, so one balance tick
re-renders the games list, the shop grid and the avatar stage. §2.

### 3.2 Incoming friend requests are anonymous

`friendRequests` documents hold uids only, and nothing resolves them, so the
UI reads "Someone wants to be friends" and asks people to accept a stranger.
`hooks/useFriends.ts` now resolves senders (`users/{uid}` is `get`-able by any
signed-in user, so no new callable); the row is updated in §1.

### 3.3 Two `useGames` subscriptions

The board subscribes to `["upcoming","live"]`, My Bets now needs `"final"` as
well. That is two listeners on the same collection. Acceptable at this size —
Firestore dedupes at the document level and both are cached — but if a third
consumer appears, lift `useGames` into a provider.

### 3.4 `startTimeLabel` is baked to Eastern time on the server

Every user in every timezone sees "7:30 PM ET". `startsAt` is on the document,
so the client can and should format locally. Left alone in this pass because
changing it touches the card, the sheet and the ticket; the new components read
`startTimeLabel` but `untilKickoff()` in `lib/odds.ts` already works off
`startsAt`, so the migration is now one string swap per site.

### 3.5 Games leave the board without going final

`syncGames` writes whatever is on today's scoreboard. A postponed fixture
simply disappears, and nothing flips it to `final`. `refundStaleBets` catches
it 72 hours later. Correct, slow. A `status: "postponed"` pass over games whose
`startsAt` is more than 6 hours old and are still `upcoming` would close it
same-day.

### 3.6 League subsystem is still outside the trusted boundary

`LeagueContext` (857 lines) writes leagues, league bets and bank loans from the
client, with `firestore.rules` doing what it can to limit the blast radius. The
rules do stop you editing another member's token balance, but a member can
still write their own `leagueTokens` to any value, and `loanRequests` is
writable by any member. League credits are separate from real credits and
`payLeagueBuyIn` is debit-only, so this cannot mint real balance — it can only
falsify a league standing. Out of scope for this pass; it is the Pass 2 work
the code comments already point at.

Two things in there worth fixing whenever it is touched:
`generateCode()` uses `Math.random().toString(36).substr(2, 6)` — `substr` is
deprecated, and six base-36 characters with no uniqueness check will collide
eventually. `publishLeagueInvite(...).catch(() => {})` swallows the failure, so
a league can exist with an invite code that was never published.

### 3.7 Missing rate limits

No callable has a per-user rate limit. `searchUsers` runs a Firestore range
query per keystroke-debounce, `checkUsername` one document read. Both are cheap
and both are trivially loopable by a script. `maxInstances: 20` caps the blast
radius on spend but not on read volume. Worth an App Check requirement before
launch, which is one line per callable.

---

## What shipped in this pass

### Colour scheme — full replacement

`constants/colors.ts` and the new `constants/theme.ts`.

The old scheme was `#0B0F19` near-black with `#00E87A` acid green on
everything: balance, CTAs, wins, active tabs, section accents. Two problems.
The green fought every team colour on the board — teams are the content, and
the chrome was louder than they were. And one colour carried both "money" and
"you won", so those two states looked identical.

The replacement is built from the subject: a pitch under sodium floodlights.

| | |
|---|---|
| Base | `#101614` turf ink — a green cast, not a blue one, so team blues and reds read as objects on grass rather than blending into a navy app |
| Surfaces | `#19211E` card, `#212B27` elevated — hierarchy by surface, not by shadow |
| Money | `#FFB03A` scoreboard amber. Balance, stake, payout, and one primary action per screen. Nowhere else |
| Outcomes | `#43C67F` turf green, `#E2564A` clay red, `#8FA098` push |
| Live | `#FF4D2E`, used only for the live pulse and never for errors |
| Light mode | Complete, with the amber darkened to `#B4700A` so it passes AA on white |

Every token key from the old file is preserved, so screens that read
`colors.primary` / `colors.card` / `colors.border` restyle without an edit.
Additions are `elevated`, `positive`, `negative`, `push`, `live`,
`subtleForeground`, `overlay`, plus `sport()`, `rarity()` and `alpha()`
helpers on `useColors()`.

`alpha()` is worth adopting deliberately: `colors.primary + "22"` appears in
roughly thirty places and breaks silently the moment a token becomes an
`rgba()` string, which several now are.

`constants/theme.ts` adds the type scale, spacing and radii. The screens still
hardcode `fontSize: 13, fontFamily: "Inter_600SemiBold"` in forty separate
StyleSheets, which is why sizes drift a point between tabs. Nothing breaks
while they do; migrate opportunistically. The one piece worth taking early is
`type.numeric` — tabular figures stop a live score jittering sideways every
time a digit changes.

### 3D avatar

Five files, no change to any calling screen.

```
lib/avatar3d/rig.ts          AvatarConfig -> proportions + named sockets
lib/avatar3d/garments.tsx    catalog item -> mesh at a socket
lib/avatar3d/GltfGarment.tsx the GLB path, lazy-loaded
lib/avatar3d/canvas.*.ts     platform split for the R3F canvas
components/Avatar3D.tsx      the character, lighting, gesture
components/AvatarDisplay.tsx picks 3D or 2D; same props as before
components/AvatarDisplay2D.tsx  the old renderer, now the fallback
```

The design constraint you set was that clothing must be addable forever
without rebuilding the avatar, and must be separate assets rather than baked
per-avatar. That is what `rig.ts` is for. A socket is a position, rotation and
girth in character space — `head`, `chest`, `waist`, `hips`, `leftFoot`,
`rightHand` and so on. Garments are authored against a socket, never against a
body, so when the wearer is 6'6" and heavy the socket moves and widens and the
jacket follows. Adding an item is a Firestore document. Adding a *kind* of
thing that has never existed — a cape, a mascot head — is one component in
`garments.tsx` and one line in the slot map, and neither touches the body.

Each item renders one of two ways, checked in order:

1. `assetUrl` set → the GLB is loaded lazily, cloned per wearer (the cached
   scene is shared; mutating it would resize one friend's jacket when another
   friend's card mounts), and scaled to fit the socket.
2. Otherwise → procedural geometry from `slot`, `color`, `secondaryColor` and
   an optional free-text `shape` field on the document (`beanie` / `snapback` /
   `bucket`, `tank` / `longsleeve`, `shorts` / `pants` / `joggers`,
   `hightop` / `boot`, `chain` / `wrist`). Unknown values fall back to the
   slot default.

Path 2 matters more than path 1 right now: every one of the 15 seeded catalogue
items has `assetUrl: null`, and with this they all render in 3D immediately.
The catalogue is never blocked on a 3D artist, and when art does arrive it
drops in per-item with no code change.

The body itself is generated from the config rather than being a model with
morph targets. Height maps to a real stature range (1.60–1.98m) and build to
girth multipliers, so the two sliders do not compound into something inhuman at
the corners — a maxed build on a minimum height is stocky, not spherical. Skin
derives three related tones from the one stored hex (base, a warmer subsurface
tone for ears and nose, a darker mouth line), which keeps the ten catalogue
tones consistent instead of needing thirty hand-picked hexes. The nine existing
`hairStyle` ids map to 3D recipes in `HAIR_3D`, so no stored profile needs
migrating and an unknown id degrades to a short cap.

Two performance decisions worth knowing about:

- `size="xs"` stays 2D. Twenty GL contexts in a FlatList is not a trade worth
  making for a 54px thumbnail. `AvatarDisplay` routes this automatically.
- Any failure inside the GL tree drops to the 2D renderer via an error boundary
  instead of taking the screen down. A device with no working WebGL still gets
  an avatar, and the failure is logged so device classes show up in crash
  reporting rather than silently serving everyone the flat renderer.

Interaction: drag to spin, with flick momentum and friction. Optional slow
turntable when untouched, off by default — the profile stage is the only place
it earns its keep.

New dependencies: `three`, `@react-three/fiber`, `@react-three/drei`,
`expo-gl`. See `PATCHES.md` §8. No Metro change needed;
`unstable_enablePackageExports` is already on, which is what lets
`@react-three/fiber/native` resolve.

### Showing more about bets and teams

`types/game.ts` grows optional fields, `functions/src/lib/sportsProvider.ts`
fills them from data ESPN was already returning and the app was discarding, and
three components consume them. Every field is optional and `syncGames` merges,
so documents written by the old sync still render — no migration, no empty
state.

**`components/GameCard.tsx`** — rewritten as a stacked scoreboard rather than
two columns. Side-by-side columns truncate team names at about 11 characters on
a phone and leave nowhere for a record; stacked rows are how every scoreboard
is set and they scan vertically with the list. Now carries: team logos,
overall and home/away records, last five results as pips, poll rank, a de-vigged
win-probability bar in the two teams' colours, the posted spread and total,
broadcast and venue, real period and clock while live, and — the one that
changes behaviour most — a strip showing what the user already has on the game
and whether it is currently ahead or behind.

**`components/GameDetailSheet.tsx`** — new, one tap from the card. Both teams
side by side, season scoring for and against, both prices in decimal and
American with fair probabilities, and the house edge stated as a number. That
last row is deliberate: a user comparing 1.85 and 2.05 has no way to know the
pair implies 105%, and stating the margin is the honest version of showing
odds at all. It costs one row.

**`components/BetTicket.tsx`** — replaces the inline `BetCard` in My Bets, and
joins each bet to the live game document the board is already subscribed to, so
no extra reads. An open bet now shows Ahead / Behind / Level with the live
score from the bettor's point of view (their team first, so "21–14" always
means "you're up seven"), the price as a probability, and profit split out from
total return. Previously an open bet looked identical whether the user's team
was up three scores or getting blown out, which is the one thing they open the
tab to find out.

**`lib/odds.ts`** — the maths, in one place: implied probability, vig removal,
decimal↔American, payout and profit, live position, kickoff countdown. Three
screens were each doing their own arithmetic on `odds`, which is fine until one
of them needs a probability.

---

## Suggested next, in order

1. Apply `PATCHES.md` §1 and verify the console is clean on the Friends tab.
2. Apply §5 (the two rules lines) and deploy rules. This is the only finding
   that is exploitable by anyone with the app installed.
3. Apply §7 and §10 together — they are one change to the bet flow.
4. Install the 3D dependencies and check `AvatarDisplay` on a real device
   before web. Web is the easier target and will hide native GL problems.
5. Migrate screens to `type.numeric` for scores, balances, odds and
   countdowns. Small change, very visible.
6. Then the league subsystem (§3.6), which is the last thing standing outside
   the trusted boundary.

## Not verified

No install, build, typecheck or device run — the container has no npm access to
this workspace's registry and the repo's `node_modules` are partial. The new
files are written against the versions in `package.json` and the existing code
conventions, but expect the first `tsc` to surface an import path or two,
particularly around `@react-three/drei/native`, whose entry point moved between
drei 9 and 10.
