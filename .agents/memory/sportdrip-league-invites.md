---
name: SportDrip league architecture (Pass 4)
description: Leagues are shared server-owned Firestore docs; invites are code lookups
---

`leagues/{id}` is one shared document (config, pot, `members` map, `memberIds`, `results`) with subcollections `leagueBets`, `loans`, `activity`. Firestore rules deny all client writes; every change is a callable in `functions/src/callable/leagues.ts`.

`leagueInvites/{code}` maps a 6-char code to `{leagueId, leagueName, buyIn}`. `createLeague` allocates the code in its transaction; `joinLeague` charges the buy-in and adds the member atomically. Leaving is permanent (`formerMemberIds`).

League bets settle in `settleLeagueBetsForGame` (collection group `leagueBets`), alongside main-wallet bets. Seasons end via `endLeague` or the hourly `leagueSweep`; payouts are one idempotent transaction per winner.
