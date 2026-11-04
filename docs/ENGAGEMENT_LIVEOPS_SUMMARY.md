# Engagement: how to run the rotating / promotional items

These items change on a schedule, need content, or carry legal or editorial review, so they are deliberately **not** part of the static plan. Each section lists the static hook it depends on (built in `ENGAGEMENT_STATIC_PLAN.md`), the data it needs, and how to operate it.

**One-time prerequisite: admin tooling.** Every item below is driven by Firestore config docs (`meta/*`, `catalog/*`, `bracketTemplates/*`). Build a single admin surface (a protected Forge/web page or a `scripts/` CLI using the service account) with schema validation per doc. Content edits should never need an app release.

---

### 1. Weekly featured shop rotation (A13)
- **What:** a predictable weekly set of featured items, with wishlist alerts when a wished item rotates in. Avoid daily FOMO churn.
- **Data:** `meta/shopRotation/{weekKey}` = `{ featuredItemIds[], startsAt, endsAt }`. Wishlists live at `users/{uid}/wishlist/{itemId}`.
- **Code hook:** the shop reads the current week's doc. A Monday job sends a `wishlist_available` notification as an **engagement** push, so it is subject to the budget.
- **Ops:** plan 4 weeks ahead; mix rarities.
- **Rule:** "Limited" means truly limited, with a real `endsAt` shown in the UI.

### 2. Calendar drops (rivalry week, playoffs, opening day)
- **What:** themed items tied to the sports calendar.
- **Data:** catalog items with `availableFrom` / `availableUntil`, plus an optional `eventTag`.
- **Ops:** keep a sports calendar sheet, and create the items and art 2–3 weeks ahead.
- **Rule:** no countdown nags. The prize-box card's "never a countdown nag" stance applies.

### 3. "Live" team jerseys
- **What:** a jersey gains trim when that team wins that week.
- **Data:** an item flag `liveTeam: "NFL:KC"`. A weekly job writes `teamForm/{teamKey}.wins` and the renderer picks the trim level from it.
- **Ops:** choose which teams get live jerseys each season and review the art for each trim level.

### 4. Cosmetic drops in prize boxes
- **What:** boxes can drop cosmetics as well as credits.
- **Data:** `meta/boxTables/{tier}` holds the segments (credits **or** itemId) with weights. The server and the client odds display read the same doc. Today's tables are hard-coded and mirrored, so move them to config before this item.
- **Ops:** every table change must update the published odds at the same moment (one doc, so this is automatic) and keep the pity guarantee.
- **Rule:** never sell boxes or wager credits for money. Odds stay visible.

### 5. Season pass content (A12)
- **What:** the free cosmetic track for each season (calendar month or league season).
- **Data:** `meta/seasons/{seasonId}` holds tiers, XP thresholds and reward item ids. The engine validates the doc.
- **Ops:** author the tiers and rewards one season ahead, and announce at season start (in-app banner, push within budget).
- **Premium track:** only if priced in credits, and the pass may **never** return enough credits to buy the next one (the validator enforces this). No real-money pass that grants wager credits.

### 6. Weekly quest pools
- **What:** rotate the 3 weekly quests from a pool instead of fixed definitions.
- **Data:** `meta/questPools` holds effort, social and skill pools with XP values. The week's selection is deterministic (`hash(week)`) so everyone sees the same set.
- **Ops:** add or retire quests monthly.
- **Rule:** every quest must point at the core loop (picks, H2H, social acts). The research found gamification unrelated to core value was neutral.

### 7. Co-op goal rewards (A15)
- **What:** the league-exclusive item unlocked by the weekly co-op goal.
- **Data:** `meta/coopRewards.current` = itemId, rotated monthly.
- **Ops:** read the experiment results before scaling; the research has no effect size for this.

### 8. Tentpole brackets (A17)
- **What:** March Madness and other tournaments as an acquisition and invite moment.
- **Data:** a `bracketTemplates/{id}` per event (slots, feeds, provider game-id mapping, lock time).
- **Ops:**
  - Build the template once the field is set (Selection Sunday for March Madness).
  - Pre-announce a week ahead.
  - Make "create a bracket league and invite" the primary CTA.
  - Monitor settlement mapping each round.
- **Calendar:** NCAA tournament, NFL playoffs, NBA playoffs, World Cup / Euros when relevant.

### 9. Drip Wrapped campaigns (A16)
- **What:** the yearly (December) and season-end recaps, generated statically, plus the campaign around them.
- **Ops:**
  - In-app banner and one push to lapsed users (the reactivation lever).
  - Share-card copy review.
  - Track shares per recap as the KPI.
  - Keep copy free of "bet more" messaging.

### 10. Push campaigns and reactivation
- **What:** occasional engagement pushes (new season, Wrapped, tentpole launch).
- **Data/hook:** a campaign doc `meta/campaigns/{id}` with audience (segment query), copy, send window and arm (experiment). The sender respects the per-user budget, quiet hours and marketing opt-in (Apple 4.5.4).
- **Rule:** never "come back and bet" after a loss; never to users on a break or at a daily limit.

### 11. Promotions with real-world prizes
- **What:** any giveaway with a tangible prize.
- **Must be:**
  - separate from credits (no credits → prize path)
  - free to enter
  - backed by official rules and a developer-sponsored "Apple is not a sponsor" disclaimer
  - geo-checked against states with sweepstakes restrictions (CA AB 831, NY, NJ, CT, MT and new 2026 bills)
- **Ops:** legal review per promotion; consider a third-party sweepstakes administrator.
- **Code:** a standalone entry flow, never connected to the wallet or bets.

### 12. Daily Pick editorial override
- **What:** featuring a marquee game over the automatic choice.
- **Data:** `dailyPick/{day}` can be pre-written by admin tooling; `chooseDailyPick` already respects an existing doc.
- **Ops:** use it for tentpoles (Super Bowl, Game 7s, rivalry week).

### 13. Experiment calendar
- **What:** which experiments run, at what split, for how long.
- **Data:** `meta/experiments` holds arms and splits only; treatments are code.
- **Ops:**
  - Run each test across full sports weeks.
  - Size for 2–5% relative effects.
  - Keep the global holdout permanently.
  - Randomise by league for social features.
  - Read results by intent-to-treat for anything users opt into (widgets, Live Activities).

---

## Cadence at a glance
| Cadence | Items |
|---|---|
| Daily | Daily Pick override (as needed) |
| Weekly | Shop rotation, quest selection (automatic), co-op goal, live-jersey refresh |
| Monthly | Season pass content, co-op reward, quest pool review |
| Seasonal / event | Calendar drops, tentpole brackets, Wrapped, push campaigns |
| Per promotion | Legal review, official rules, geo-gating |
