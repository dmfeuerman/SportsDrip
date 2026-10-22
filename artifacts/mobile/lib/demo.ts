/**
 * Demo mode: `EXPO_PUBLIC_DEMO=1`.
 *
 * Renders every screen against fixed fixture data with Firebase switched off,
 * so the UI can be reviewed (and screenshotted) without a project, an account,
 * or live games. Mutations fail with "Firebase is not configured." — nothing
 * here can write anywhere. Not used unless the env flag is set at build time.
 */
import type { Profile, Bet, PrizeBoxState } from "@/context/AppContext";
import type { AppNotification } from "@/context/NotificationContext";
import type { League, LeagueActivity, LeagueBet, LeagueLoan } from "@/constants/leagueTypes";
import type { BoxTier, PublicUser } from "@/lib/api";
import type { CatalogItem } from "@/types/catalog";
import type { AvatarConfig } from "@/types/avatar";
import type { Game } from "@/types/game";

export const DEMO = process.env.EXPO_PUBLIC_DEMO === "1";

const H = 3_600_000;
const D = 24 * H;
const now = Date.now();
const ts = (ms: number) => ({ seconds: Math.floor(ms / 1000) });

export const demoUid = "me";

const avatar = (skinTone: string, hairStyle: string, hairColor: string, extra: Partial<AvatarConfig> = {}): AvatarConfig => ({
  height: 0.5,
  bodyType: 0.5,
  skinTone,
  hairStyle,
  hairColor,
  faceShape: "oval",
  eyeColor: "#3B2415",
  eyebrows: "soft",
  faceStyle: "features",
  base: "sd_base_v2",
  ...extra,
});

export const demoProfile: Profile = {
  uid: demoUid,
  username: "dylan",
  displayName: "Dylan F",
  email: null,
  balance: 2840,
  avatar: avatar("#C68642", "fade", "#2B1B12"),
  equipped: { top: "top_mvp_jersey", bottom: "bottom_court_shorts", shoes: "shoes_fresh_kicks", hat: "hat_champion_snapback" },
  stats: { betsPlaced: 31, betsWon: 17, betsLost: 12, betsPush: 1, creditsWon: 2210, creditsStaked: 5400 },
  onboarded: true,
};

const team = (name: string, abbreviation: string, color: string, odds: number, record: string) => ({ name, abbreviation, color, odds, record });

export const demoGames: Game[] = [
  { id: "NBA:1", sport: "NBA", sportIcon: "basketball", status: "live", startsAt: now - H, startTimeLabel: "Live", homeScore: 88, awayScore: 81, homeTeam: team("Boston Celtics", "BOS", "#007A33", 1.45, "9-3"), awayTeam: team("New York Knicks", "NYK", "#F58426", 2.75, "7-5"), updatedAt: now, clock: "Q4 · 6:12", period: 4 },
  { id: "NFL:2", sport: "NFL", sportIcon: "football", status: "upcoming", startsAt: now + 3 * H, startTimeLabel: "Today 8:20 PM", homeScore: null, awayScore: null, homeTeam: team("Kansas City Chiefs", "KC", "#E31837", 1.62, "6-1"), awayTeam: team("Buffalo Bills", "BUF", "#00338D", 2.35, "5-2"), updatedAt: now, venue: "Arrowhead Stadium" },
  { id: "NHL:3", sport: "NHL", sportIcon: "hockey-puck", status: "upcoming", startsAt: now + 5 * H, startTimeLabel: "Today 10:00 PM", homeScore: null, awayScore: null, homeTeam: team("Edmonton Oilers", "EDM", "#FF4C00", 1.9, "4-3"), awayTeam: team("Toronto Maple Leafs", "TOR", "#00205B", 1.95, "5-2"), updatedAt: now },
  { id: "Soccer:4", sport: "Soccer", sportIcon: "soccer", status: "upcoming", startsAt: now + 20 * H, startTimeLabel: "Tomorrow 3:00 PM", homeScore: null, awayScore: null, homeTeam: team("Arsenal", "ARS", "#EF0107", 1.85, "6-1-1"), awayTeam: team("Liverpool", "LIV", "#C8102E", 2.05, "5-2-1"), updatedAt: now },
  { id: "MLB:5", sport: "MLB", sportIcon: "baseball", status: "upcoming", startsAt: now + 26 * H, startTimeLabel: "Tomorrow 7:05 PM", homeScore: null, awayScore: null, homeTeam: team("Los Angeles Dodgers", "LAD", "#005A9C", 1.7, "98-64"), awayTeam: team("New York Yankees", "NYY", "#132448", 2.2, "94-68"), updatedAt: now },
];

export const demoBets: Bet[] = [
  { id: "b1", uid: demoUid, gameId: "NBA:1", sport: "NBA", side: "home", teamName: "Boston Celtics", teamAbbr: "BOS", teamColor: "#007A33", opponentAbbr: "NYK", stake: 250, odds: 1.45, potentialPayout: 363, status: "pending", opponentUid: null, placedAt: ts(now - 2 * H), settledAt: null },
  { id: "b2", uid: demoUid, gameId: "NFL:2", sport: "NFL", side: "away", teamName: "Buffalo Bills", teamAbbr: "BUF", teamColor: "#00338D", opponentAbbr: "KC", stake: 100, odds: 2.35, potentialPayout: 235, status: "pending", opponentUid: null, placedAt: ts(now - 30 * 60_000), settledAt: null },
  { id: "b3", uid: demoUid, gameId: "NBA:9", sport: "NBA", side: "away", teamName: "Denver Nuggets", teamAbbr: "DEN", teamColor: "#0E2240", opponentAbbr: "LAL", stake: 300, odds: 2.1, potentialPayout: 630, status: "won", opponentUid: null, placedAt: ts(now - D), settledAt: ts(now - 3 * H), finalHomeScore: 104, finalAwayScore: 112 },
  { id: "b4", uid: demoUid, gameId: "NFL:8", sport: "NFL", side: "home", teamName: "Dallas Cowboys", teamAbbr: "DAL", teamColor: "#003594", opponentAbbr: "PHI", stake: 200, odds: 1.9, potentialPayout: 380, status: "lost", opponentUid: null, placedAt: ts(now - 2 * D), settledAt: ts(now - D), finalHomeScore: 17, finalAwayScore: 24 },
];

export const demoInventory = ["tee_basic_white", "shorts_basic_navy", "shoes_basic_white", "top_mvp_jersey", "bottom_court_shorts", "shoes_fresh_kicks", "hat_champion_snapback", "hat_courtside_beanie", "top_stealth_hoodie", "bottom_track_joggers", "outerwear_bomber", "eyewear_shades_black", "accessory_sport_watch", "accessory_studio_headphones"];

const box = (tier: BoxTier, state: PrizeBoxState["state"], readyAt: number | null): PrizeBoxState => ({ tier, state, openedAt: readyAt ? readyAt - H : null, readyAt, rewardCredits: null });
export const demoPrizeBoxes: Record<BoxTier, PrizeBoxState> = {
  bronze: box("bronze", "waiting", now - 60_000),
  silver: box("silver", "waiting", now + 2 * H),
  gold: box("gold", "idle", null),
};

// Mirrors scripts/catalog-data.mjs (a functions test checks ids and models match).
const item = (id: string, name: string, slot: CatalogItem["slot"], model: string, price: number, rarity: CatalogItem["rarity"], color: string, secondaryColor: string | null = null): CatalogItem => ({
  id, name, slot, model, price, rarity, color, secondaryColor, description: "", thumbnailUrl: null, assetUrl: null, excludes: null, available: true, releaseAt: null,
});
export const demoCatalog: CatalogItem[] = [
  item("tee_basic_white", "Basic Tee", "top", "top_tee", 0, "common", "#F5F5F5", "#D9D9D9"),
  item("shorts_basic_navy", "Basic Shorts", "bottom", "bottom_shorts", 0, "common", "#1A237E", "#FFFFFF"),
  item("shoes_basic_white", "Basic Trainers", "shoes", "shoes_sneaker", 0, "common", "#FAFAFA", "#BDBDBD"),
  item("hat_champion_snapback", "Champion Snapback", "hat", "hat_cap", 150, "common", "#CC0000", "#FFFFFF"),
  item("hat_courtside_beanie", "Courtside Beanie", "hat", "hat_beanie", 140, "common", "#C62828", "#FFFFFF"),
  item("hat_sand_bucket", "Sand Bucket Hat", "hat", "hat_bucket", 160, "uncommon", "#C8B68E", "#8D7B55"),
  item("hat_game_helmet", "Game Helmet", "hat", "hat_helmet", 420, "rare", "#0D47A1", "#FFFFFF"),
  item("hat_gold_crown", "Champion's Crown", "hat", "hat_crown", 1500, "legendary", "#FFD54F", "#D32F2F"),
  item("top_mvp_jersey", "MVP Jersey", "top", "top_jersey", 300, "uncommon", "#1565C0", "#FFFFFF"),
  item("top_stealth_hoodie", "Stealth Hoodie", "top", "top_hoodie", 400, "rare", "#212121", "#424242"),
  item("top_warmup_longsleeve", "Warm-up Long Sleeve", "top", "top_longsleeve", 220, "common", "#37474F", "#FF6F00"),
  item("bottom_court_shorts", "Court Shorts", "bottom", "bottom_shorts", 200, "common", "#1A237E", "#FFFFFF"),
  item("bottom_track_joggers", "Track Joggers", "bottom", "bottom_joggers", 260, "uncommon", "#263238", "#FFFFFF"),
  item("bottom_cargo_pants", "Cargo Pants", "bottom", "bottom_pants", 280, "uncommon", "#5D4037", "#3E2723"),
  item("shoes_fresh_kicks", "Fresh Kicks", "shoes", "shoes_sneaker", 450, "rare", "#00E676", "#FFFFFF"),
  item("shoes_fire_reds", "Fire Reds", "shoes", "shoes_hightop", 500, "rare", "#D50000", "#FFFFFF"),
  item("outerwear_bomber", "Bomber Jacket", "outerwear", "outerwear_bomber", 550, "rare", "#558B2F", "#33691E"),
  item("outerwear_letterman", "Letterman Jacket", "outerwear", "outerwear_varsity", 600, "epic", "#4A148C", "#FFD700"),
  item("outerwear_ice_puffer", "Ice Puffer", "outerwear", "outerwear_puffer", 650, "epic", "#E3F2FD", "#90CAF9"),
  item("eyewear_shades_black", "Blackout Shades", "eyewear", "eyewear_shades", 220, "uncommon", "#0A0A0A"),
  item("accessory_gold_chain", "Gold Chain", "accessory", "acc_chain", 900, "legendary", "#FFD700", "#FFC107"),
  item("accessory_sport_watch", "Sport Watch", "accessory", "acc_watch", 300, "uncommon", "#212121", "#9E9E9E"),
  item("accessory_studio_headphones", "Studio Headphones", "accessory", "acc_headphones", 520, "rare", "#FAFAFA", "#212121"),
];

export const demoFriends: PublicUser[] = [
  { uid: "maya", username: "maya", displayName: "Maya R", avatar: avatar("#8D5524", "braids", "#0F0A08"), equipped: { top: "top_stealth_hoodie", bottom: "bottom_track_joggers", shoes: "shoes_fresh_kicks", accessory: "accessory_studio_headphones" }, balance: 4120, stats: { betsPlaced: 40, betsWon: 24, betsLost: 15, betsPush: 1, creditsWon: 3900, creditsStaked: 7000 } },
  { uid: "theo", username: "theo_k", displayName: "Theo K", avatar: avatar("#F5D9C4", "curls", "#A9662E", { height: 0.7, faceShape: "heart", eyeColor: "#2E5FA3" }), equipped: { top: "tee_basic_white", outerwear: "outerwear_letterman", bottom: "bottom_cargo_pants", shoes: "shoes_fire_reds" }, balance: 1650, stats: { betsPlaced: 22, betsWon: 9, betsLost: 13, betsPush: 0, creditsWon: 700, creditsStaked: 3100 } },
  { uid: "sam", username: "samj", displayName: "Sam J", avatar: avatar("#8D5524", "buzz", "#2B1B12", { bodyType: 0.85, faceShape: "square" }), equipped: { top: "top_mvp_jersey", hat: "hat_champion_snapback" }, balance: 980, stats: { betsPlaced: 12, betsWon: 5, betsLost: 7, betsPush: 0, creditsWon: 300, creditsStaked: 1500 } },
];

export const demoPublicProfiles: Record<string, PublicUser> = Object.fromEntries(
  [...demoFriends, { uid: demoUid, username: "dylan", displayName: "Dylan F", avatar: demoProfile.avatar, equipped: demoProfile.equipped }].map((u) => [u.uid, u])
);

const member = (uid: string, displayName: string, avatarColor: string, leagueTokens: number, joinedAt: number, w: number, l: number) => ({
  uid, displayName, avatarColor, leagueTokens, startingLeagueTokens: 10_000, joinedAt, betsWon: w, betsLost: l, betsPush: 0,
});

export const demoLeagues: League[] = [
  {
    id: "lg_office", name: "Office Sunday", code: "K7QMR4", createdAt: now - 9 * D, endsAt: now + 21 * D, status: "active", creatorId: demoUid,
    startingLeagueTokens: 10_000, buyIn: 250, pot: 1000,
    prizeDistribution: { preset: "top-3", firstPct: 60, secondPct: 30, thirdPct: 10 },
    allowedSports: ["NFL", "NBA", "NHL", "Soccer"], bankLoanEnabled: true, bankInterestRate: 5, bankInterestIntervalHours: 24,
    memberIds: [demoUid, "maya", "theo", "sam"],
    members: {
      me: member(demoUid, "Dylan F", "#E2564A", 14_200, now - 9 * D, 8, 5),
      maya: member("maya", "Maya R", "#43C67F", 12_950, now - 9 * D + H, 9, 4),
      theo: member("theo", "Theo K", "#5AA9E6", 6_400, now - 8 * D, 4, 8),
      sam: member("sam", "Sam J", "#A57BE0", 9_100, now - 7 * D, 5, 5),
    },
    lastActivityAt: now - 40 * 60_000, payoutStatus: "none",
  },
  {
    id: "lg_cousins", name: "Cousins Cup", code: "HX92PT", createdAt: now - 20 * D, endsAt: now + 4 * D, status: "active", creatorId: "maya",
    startingLeagueTokens: 5_000, buyIn: 0, pot: 0,
    prizeDistribution: { preset: "winner-all", firstPct: 100, secondPct: 0, thirdPct: 0 },
    allowedSports: ["NBA", "NFL"], bankLoanEnabled: false, bankInterestRate: 10, bankInterestIntervalHours: 24,
    memberIds: [demoUid, "maya"],
    members: { me: member(demoUid, "Dylan F", "#43C67F", 4_300, now - 19 * D, 3, 4), maya: member("maya", "Maya R", "#E2564A", 6_850, now - 20 * D, 6, 2) },
    lastActivityAt: now - 5 * H, payoutStatus: "none",
  },
];

const loan = (over: Partial<LeagueLoan> & Pick<LeagueLoan, "id" | "kind" | "borrowerId" | "borrowerName" | "principal">): LeagueLoan => ({
  leagueId: "lg_office", status: "active", lenderId: null, lenderName: "League Bank", principalOutstanding: over.principal, interestAccrued: 0, interestPaid: 0,
  accruedThrough: now - 3 * D - 4 * H, ratePct: 5, intervalHours: 24, createdAt: now - 3 * D - 4 * H, fundedAt: now - 3 * D - 4 * H, ...over,
});
export const demoLoans: Record<string, LeagueLoan[]> = {
  lg_office: [
    loan({ id: "bank_me_1", kind: "bank", borrowerId: demoUid, borrowerName: "Dylan F", principal: 4_000, principalOutstanding: 3_000, interestAccrued: 400, interestPaid: 400, accruedThrough: now - D - 2 * H }),
    loan({ id: "peer_theo_1", kind: "peer", borrowerId: "theo", borrowerName: "Theo K", lenderId: "maya", lenderName: "Maya R", principal: 2_000, ratePct: 4 }),
    loan({ id: "peer_sam_req", kind: "peer", status: "requested", borrowerId: "sam", borrowerName: "Sam J", principal: 1_500, ratePct: 6, proposedRate: 6, message: "Bills are a lock, trust me", declinedBy: [] }),
  ],
  lg_cousins: [],
};

export const demoLeagueBets: Record<string, LeagueBet[]> = {
  lg_office: [
    { id: "lb1", leagueId: "lg_office", uid: demoUid, displayName: "Dylan F", gameId: "NHL:3", sport: "NHL", side: "home", teamName: "Edmonton Oilers", teamAbbr: "EDM", teamColor: "#FF4C00", opponentAbbr: "TOR", stake: 1_500, odds: 1.9, potentialPayout: 2_850, status: "pending", placedAt: now - H },
    { id: "lb2", leagueId: "lg_office", uid: "maya", displayName: "Maya R", gameId: "NFL:2", sport: "NFL", side: "home", teamName: "Kansas City Chiefs", teamAbbr: "KC", teamColor: "#E31837", opponentAbbr: "BUF", stake: 3_000, odds: 1.62, potentialPayout: 4_860, status: "pending", placedAt: now - 2 * H },
    { id: "lb3", leagueId: "lg_office", uid: "theo", displayName: "Theo K", gameId: "NBA:9", sport: "NBA", side: "home", teamName: "Los Angeles Lakers", teamAbbr: "LAL", teamColor: "#552583", opponentAbbr: "DEN", stake: 2_500, odds: 1.75, potentialPayout: 4_375, status: "lost", placedAt: now - D },
  ],
  lg_cousins: [],
};

export const demoActivity: Record<string, LeagueActivity[]> = {
  lg_office: [
    { id: "a1", type: "bet_placed", uid: demoUid, name: "Dylan F", text: "Dylan F put 1,500 on EDM (1.90x)", amount: 1500, at: now - 40 * 60_000 },
    { id: "a2", type: "loan_request", uid: "sam", name: "Sam J", text: "Sam J is asking for 1,500 at 6%", amount: 1500, at: now - 3 * H },
    { id: "a3", type: "bet_lost", uid: "theo", name: "Theo K", text: "Theo K lost 2,500 on LAL", amount: -2500, at: now - 20 * H },
    { id: "a4", type: "loan_funded", uid: "maya", name: "Maya R", text: "Maya R lent Theo K 2,000 at 4%", amount: 2000, at: now - 3 * D },
  ],
  lg_cousins: [{ id: "c1", type: "bet_won", uid: "maya", name: "Maya R", text: "Maya R cashed KC for +900", amount: 900, at: now - 5 * H }],
};

const wantPopup = typeof window !== "undefined" && typeof window.location !== "undefined" && /popup/.test(window.location.search ?? "");
const wantLoss = typeof window !== "undefined" && typeof window.location !== "undefined" && /popup=loss/.test(window.location.search ?? "");

export const demoNotifications: AppNotification[] = [
  {
    id: "settle_b3", type: wantLoss ? "bet_lost" : "bet_won",
    title: wantLoss ? "DEN fell short" : "DEN came through",
    body: wantLoss ? "Denver Nuggets lost to LAL (104–112). 300 credits staked." : "Denver Nuggets beat LAL (112–104). +630 credits.",
    delta: wantLoss ? -300 : 630, balanceAfter: wantLoss ? 2210 : 2840, wallet: "credits", leagueId: null, leagueName: null,
    bet: { betId: "b3", gameId: "NBA:9", sport: "NBA", side: "away", teamName: "Denver Nuggets", teamAbbr: "DEN", teamColor: "#0E2240", opponentAbbr: "LAL", odds: 2.1, stake: 300, payout: 630, finalHomeScore: wantLoss ? 112 : 104, finalAwayScore: wantLoss ? 104 : 112 },
    popup: wantPopup, read: !wantPopup, createdAtMs: now - 3 * H, data: null,
  },
  { id: "loanreq_peer_sam_req", type: "loan_request", title: "Sam J wants a loan", body: "1,500 league tokens at 6% per 24h in Office Sunday.", delta: 0, balanceAfter: null, wallet: "league", leagueId: "lg_office", leagueName: "Office Sunday", bet: null, popup: false, read: false, createdAtMs: now - 3 * H, data: null },
  { id: "settle_b4", type: "bet_lost", title: "DAL fell short", body: "Dallas Cowboys lost to PHI (17–24). 200 credits staked.", delta: -200, balanceAfter: 2210, wallet: "credits", leagueId: null, leagueName: null,
    bet: { betId: "b4", gameId: "NFL:8", sport: "NFL", side: "home", teamName: "Dallas Cowboys", teamAbbr: "DAL", teamColor: "#003594", opponentAbbr: "PHI", odds: 1.9, stake: 200, payout: 380, finalHomeScore: 17, finalAwayScore: 24 }, popup: false, read: true, createdAtMs: now - D, data: null },
  { id: "invite_x", type: "league_invite", title: "Theo K invited you to Fantasy Degens", body: "Free to join. Code TT4N8Q.", delta: 0, balanceAfter: null, wallet: "credits", leagueId: "lg_x", leagueName: "Fantasy Degens", bet: null, popup: false, read: true, createdAtMs: now - 2 * D, data: { code: "TT4N8Q", leagueId: "lg_x" } },
];
