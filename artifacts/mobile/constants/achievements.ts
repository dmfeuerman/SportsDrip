/**
 * DISPLAY ONLY. Mirrors functions/src/lib/achievements.ts ACHIEVEMENTS (the
 * server awards them); keep ids, titles and icons in sync.
 */
export type TrophyMetal = "bronze" | "silver" | "gold" | "platinum";

export interface AchievementInfo {
  id: string;
  title: string;
  icon: string;
  /** How to earn it, shown on locked trophies. */
  how: string;
  metal: TrophyMetal;
}

export const ACHIEVEMENTS: AchievementInfo[] = [
  { id: "first_win", title: "First Win", icon: "check-decagram", how: "Win your first bet", metal: "bronze" },
  { id: "wins_10", title: "10 Wins", icon: "medal-outline", how: "Win 10 bets", metal: "silver" },
  { id: "wins_50", title: "50 Wins", icon: "medal", how: "Win 50 bets", metal: "gold" },
  { id: "picks_100", title: "100 Picks", icon: "ticket-confirmation-outline", how: "Place 100 bets", metal: "silver" },
  { id: "streak_7", title: "7-Day Streak", icon: "fire", how: "Keep a 7-day streak", metal: "bronze" },
  { id: "streak_30", title: "30-Day Streak", icon: "fire-circle", how: "Keep a 30-day streak", metal: "gold" },
  { id: "streak_100", title: "100-Day Streak", icon: "crown-outline", how: "Keep a 100-day streak", metal: "platinum" },
  { id: "daily_10", title: "Daily Pick Sharp", icon: "calendar-check", how: "Win 10 Daily Picks", metal: "silver" },
  { id: "level_5", title: "Level 5", icon: "star-outline", how: "Reach level 5", metal: "bronze" },
  { id: "level_10", title: "Level 10", icon: "star", how: "Reach level 10", metal: "silver" },
  { id: "level_25", title: "Level 25", icon: "star-shooting", how: "Reach level 25", metal: "platinum" },
  { id: "friends_3", title: "Squad Up", icon: "account-group", how: "Add 3 friends", metal: "bronze" },
  { id: "friends_10", title: "Crew Chief", icon: "account-group-outline", how: "Add 10 friends", metal: "gold" },
];

export const METALS: Record<TrophyMetal, { hi: string; mid: string; lo: string }> = {
  bronze: { hi: "#F4B98A", mid: "#C97A3D", lo: "#7A421A" },
  silver: { hi: "#FFFFFF", mid: "#BFC7CF", lo: "#6E7881" },
  gold: { hi: "#FFF3B0", mid: "#F2B925", lo: "#8C5F05" },
  platinum: { hi: "#F2FBFF", mid: "#9FE3F5", lo: "#3D7E92" },
};
