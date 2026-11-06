# Static engagement pass — report

Nothing committed. Both typechecks are clean. `npm test` (functions): **156 pass / 2 fail**, against a baseline of 131 / 2. The two failures are the same pre-existing tests as before, left unedited: "opposing league bets record head-to-head rivalry…" and "profiles carry the loadout…". There are 27 new tests.

## Per item

| # | Item | Status | Files | Deviations |
|---|------|--------|-------|------------|
| 1 | Bet cards in league chat | Implemented | `components/chat/BetChatCard.tsx`, `app/messages.tsx`, `app/league/[id].tsx`, `callable/leagues.ts` | Bet chat docs no longer carry `stake`/`potentialPayout`, and activity/chat copy no longer states stake (guardrail 3). Hidden picks now post a locked card with no side/pick fields (previously no card). The `audit.test.ts` hidden-pick assertion was updated to match. It was not a pre-existing failing test. |
| 2 | Bet banners | Implemented | `context/ChatContext.tsx` | Other members' bet cards banner with "View", throttled to 1 per league per hour. |
| 3 | Tail sheet from "League is on this" | Implemented | `components/TailSheet.tsx`, `components/GameCard.tsx`, `app/(tabs)/games.tsx`, `context/LeagueContext.tsx` | `useBoardLeagueSides` now returns side/betId/leagueId. Hidden picks show as locked. Tail/Fade prefill your own stake, never theirs. |
| 4 | Streak repair + no-game days | Implemented | `lib/streak.ts`, `lib/streakDays.ts`, `callable/{bets,leagues,picks,dailyPick}.ts`, `components/DailyPickCard.tsx` | Repair = 2 qualifying actions the same day after exactly one miss with no freeze. Changing your Daily Pick side doesn't count. Empty days are marked `dailyPick/{day}.empty` from noon ET. |
| 5 | Celebration ladder | Implemented | `lib/celebrate.ts`, `ResultPopup`, `LevelUpHost`, `StreakMilestoneCard`, `LadderPromotionHost` | — |
| 6 | First-week checklist + activation | Implemented | `components/FirstWeekChecklist.tsx`, home tab | Activation threshold `ACTIVATION_FRIENDS = 1` is a placeholder (product call). Hidden for the global holdout. |
| 7 | Push budget + quiet hours | Implemented | `lib/pushBudget.ts`, `triggers/push.ts`, `callable/players.ts` (`setAlertPrefs` gains `quietHours`, `tz`), `PlayLimitsCard`, `AppContext` | Defaults: cap 4/day, quiet 23:00–08:00 local. Transactional types always send. Engagement pushes are blocked for anyone on a break or at their daily limit. Lock/team reminders are blocked within 12 h of a loss. Suppressed pushes are marked `pushSuppressed` on the notification doc. |
| 8 | Prompt gate | Implemented | `lib/promptGate.ts`, `lib/settings.ts`, `ToastHost`, `onboarding`, `AdsContext`, `lib/ads/sdk*.ts` | ATT now waits for session ≥2. Until then, ads serve non-personalised. Review prompt: the repo has none, so the gate only defines the slot. |
| 9 | Achievement badges | Implemented | `lib/achievements.ts`, standings + H2H rows | Count is mirrored to `members.{uid}.achievementCount` in active leagues. |
| 10 | Social quest | Implemented | `lib/questProgress.ts`, `callable/social.ts`, `triggers/chatPush.ts`, `callable/quests.ts` | Counts distinct items (a set), not raw increments, so toggling can't farm it. Replaced `daily3` with `react2`. |
| 11 | Measurement + experiments | Implemented | `lib/analytics.ts`, `firestore.rules`, `BetModal`, `shareCard`, `LeagueContext`, `DailyPickCard`, `QuestsCard`, `CrewFeed`, `lib/experiments.ts` ×2 | The global holdout applies to uid-unit experiments only (league-unit arms must be shared by the whole league). |
| 12 | Economy guardrails | Implemented | `lib/parlay.ts`, `callable/parlays.ts`, `callable/leagues.ts` (`requestReset`), Bank tab, `SpinWheel.tsx` | The 25% cap applies to create, add-leg and ride stakes, not just ride. Reset also requires no pending league bets and is once per league. Wheel lands at wedge centre ±20%, prefers a winning wedge not adjacent to the top prize, and uses even easing. |
| 13 | Live data freshness | Implemented | `scheduled/syncGames.ts` (`syncLiveGames`), `lib/sportsProvider.ts` | A 1-minute job refreshes twice (+15 s, +45 s), only for sports that have staked live games. |
| 14 | Type & a11y pass | Partial | `scripts/type-literals.mjs` (`npm run lint:type`), 78 sub-11pt sizes raised to 11, `GameCard` live pulse moved to reanimated with `useReducedMotion` | No ESLint config exists in the repo, so the guard is the script (it fails when anything is <11pt). Not done: `theme.type` migration (566 literals), hex→tokens (354), 115 unlabeled `onPress`. |
| 15 | Pick'em / Survivor audit | Done | `test/modesAudit.test.ts`, `lib/loanMath.ts` ×2, `LeagueContext` | **Gap found and fixed:** client live standings ranked pick'em/survivor by net worth, while season end ranked by points/survival. `rankByMode` now mirrors `finalizeLeague`. Survivor was already covered end to end in `audit.test.ts`. |
| 16 | Taunts | Implemented | `callable/taunts.ts` (`sendTaunt`, `setMuteTaunts`), `chat/TauntCard.tsx`, chat surfaces, "Send a dance" on won H2H rows, mute toggle | Lists use the existing `sm` cached still (`AvatarPortraitStudio` is a dev screen, not a still API). Not added to the bet win popup because it has no matchup context; added to H2H results only. Taunts don't push. |
| 17 | Co-op goals | Implemented (experiment) | `lib/coop.ts`, `settleBets.ts`, `CoopGoalCard.tsx` | Runs after settlement commits, not inside it (side effects after money). |
| 18 | Drip Wrapped | Implemented | `lib/wrapped.ts`, `scheduled/wrapped.ts`, `leagueLifecycle.ts`, `app/wrapped/[id].tsx` | The worst-beat card is private (no Share). |
| 19 | Ladder | Implemented (experiment, gated) | `lib/ladder.ts`, `scheduled/ladder.ts`, `app/ladder.tsx`, `LadderPromotionHost`, standings pill | Tier names as specified; min actives default 200 (`meta/ladder.minWeeklyActives`). 16–19 players form one cohort (they can't split into ≥10s). No moves happen in cohorts under 7. |
| 20 | Season pass | Implemented | `lib/seasonPass.ts`, `callable/seasonPass.ts`, `lib/xp.ts`, `app/season.tsx`, `functions/config/seasons.placeholder.json` | **Path:** `seasons/{id}`, not `meta/seasons/{id}` (that isn't a valid collection path). Premium purchase is not built; the validator enforces the never-buys-the-next-pass rule. |
| 21 | Bracket mode | Implemented | `lib/bracket.ts`, `callable/brackets.ts`, `leagueConfig`, `leagueLifecycle`, `CreateLeagueModal`, `BracketFill.tsx` | Templates are live-ops. They must carry `gameIds` (array) for settlement lookup. Zoom is iOS-only (`ScrollView.maximumZoomScale`). |
| 22 | Live Activity | Code written, unbuilt | `targets/widgets/*`, `modules/live-activity/*`, `app.config.js`, `lib/apns.ts`, `callable/liveActivities.ts`, `ToastHost`, `EngagementWatchers` | Behind `ENABLE_APPLE_TARGETS=1` + `@bacons/apple-targets` (not installed). The H2H delta/cover margin fields exist but the server sends score/clock/status only. |
| 23 | Widget | Code written, unbuilt | same target, `EngagementWatchers.useWidgetSnapshot`, `lib/widgetRefresh.ts`, `weekly.ts`, `ResultPopup` promo | The H2H snapshot uses your league net worth and opponent 0, because no live matchup delta is stored. The silent push is sent, but there is no background handler yet. |

Also: `EngagementWatchers.useBigBets` was removed ("going big" is keyed on another member's stake size). Other members' stakes are no longer shown in the Bets tab or parlay rider lists.

## Deploy checklist

**New functions:** `requestReset`, `syncLiveGames`, `sendTaunt`, `setMuteTaunts`, `yearWrapped`, `claimSeasonTier`, `ladderOpen`, `ladderClose`, `submitBracket`, `registerLiveActivity`, `pushLiveActivityOnGame` (needs the APNs secrets; skip it until they exist).
**Changed:** `setAlertPrefs` (all fields now optional), `placeLeagueBet`, `reactToItem`, parlay callables, `pushOnNotification`, `makeDailyPick`, `scheduleDailyPick`, `onGameFinal` (brackets), `leagueMatchupJobs`.

**Rules:** new analytics event names. New collections: `users/{uid}/pushBudget`, `questProgress`, `wrapped`, `liveActivities`, `seasonClaims`; `meta/{experiments|coopRewards|ladder}` (read); `seasons`; `bracketTemplates`; `ladderCohorts`; `leagues/{id}/coop`, `brackets`.

**Indexes added:** `leagueBets` collection group `(uid, placedAt)`; `liveActivities` collection group `(gameId, endedAt)`. None removed. Duplicate check passes.

**Secrets:** `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`.

**Config to seed:**
- `meta/experiments`: `{ globalHoldout, experiments: [coop_goals_v1 (leagueId), widget_promo_v1 (uid), ladder_v1 (uid)] }`. All surfaces are off until this exists.
- `meta/coopRewards.current`
- `meta/ladder.minWeeklyActives`
- `seasons/*` (validate with `validateSeason`)
- `bracketTemplates/*`

## Device verification (not run here)

- Prebuild with `ENABLE_APPLE_TARGETS=1` after installing `@bacons/apple-targets`. Confirm the widget target builds, the App Group entitlement is on both targets, and `NSSupportsLiveActivities` is set.
- `LiveActivity` native module autolinks from `modules/live-activity`. `start` fires on lock-in, and the push token reaches `users/{uid}/liveActivities`.
- APNs topic `com.dmfeuerman.mobile.push-type.liveactivity` accepts updates. The end event dismisses. The 8 h stale date behaves.
- Widget renders small/medium from the snapshot and reloads on change. The silent push wakes the app (needs a background notification task).
- ATT is not asked in session 1, and at most one system prompt shows per session.
- Taunt modal plays the move. Bracket pinch-zoom works. Live pulse stops under Reduce Motion.
- Quiet hours behave in a non-ET timezone.
