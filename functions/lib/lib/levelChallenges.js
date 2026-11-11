"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.challengeById = exports.CHALLENGE_POOL = exports.THEME_CHALLENGE_ID = exports.CHALLENGE_SLOTS = exports.CLIENT_ACTIONS = void 0;
exports.dealChallenges = dealChallenges;
const progression_1 = require("./progression");
/** Metrics the app may report. Each counts once per call; challenges using them are one-offs or small. */
exports.CLIENT_ACTIONS = ["theme", "oddsFormat", "levelsViewed", "avatarSaved", "danced", "tutorial"];
exports.CHALLENGE_SLOTS = 3;
/** Paid straight away the first time the app color changes (recordChallengeAction). */
exports.THEME_CHALLENGE_ID = "x_theme";
exports.CHALLENGE_POOL = [
    // Level 1: explore the app.
    { id: "x_freebet", minLevel: 1, metric: "freeBets", target: 1, xp: 25, title: "Lock in your Daily Free Bet", to: "/(tabs)", explore: true },
    { id: "x_hat", minLevel: 1, metric: "ownedHat", target: 1, xp: 30, title: "Buy a hat in the Drip Shop", to: "/customize?category=hat", explore: true },
    { id: "x_theme", minLevel: 1, metric: "theme", target: 1, xp: progression_1.XP.themeChange, title: "Change the app color in Settings", to: "/settings", explore: true },
    { id: "x_bet", minLevel: 1, metric: "bets", target: 1, xp: 25, title: "Place your first bet", to: "/(tabs)/games", explore: true },
    { id: "x_friend", minLevel: 1, metric: "friends", target: 1, xp: 30, title: "Add a friend", to: "/(tabs)/leagues?seg=friends", explore: true },
    { id: "x_teams", minLevel: 1, metric: "favoriteTeams", target: 1, xp: 20, title: "Pick your favorite teams in Settings", to: "/settings", explore: true },
    { id: "x_avatar", minLevel: 1, metric: "avatarSaved", target: 1, xp: 20, title: "Save a new look for your character", to: "/customize?category=body", explore: true },
    { id: "x_odds", minLevel: 1, metric: "oddsFormat", target: 1, xp: 15, title: "Try another odds format in Settings", to: "/settings", explore: true },
    { id: "x_levels", minLevel: 1, metric: "levelsViewed", target: 1, xp: 15, title: "Check out the Levels page", to: "/levels", explore: true },
    { id: "x_dance", minLevel: 1, metric: "danced", target: 1, xp: 15, title: "Show off a dance move in your Locker", to: "/(tabs)/avatar", explore: true },
    { id: "x_tour", minLevel: 1, metric: "tutorial", target: 1, xp: 15, title: "Finish a tutorial from the ? menu", to: "/(tabs)", explore: true },
    // Level 2+
    { id: "l2_bets", minLevel: 2, metric: "bets", target: 5, xp: 40, title: "Place 5 bets", to: "/(tabs)/games" },
    { id: "l2_wins", minLevel: 2, metric: "wins", target: 2, xp: 50, title: "Win 2 bets", to: "/(tabs)/games" },
    { id: "l2_league", minLevel: 2, metric: "leagues", target: 1, xp: 50, title: "Join or start a league", to: "/(tabs)/leagues" },
    { id: "l2_parlay", minLevel: 2, metric: "parlays", target: 1, xp: 40, title: "Place a parlay", to: "/(tabs)/games" },
    { id: "l2_top", minLevel: 2, metric: "ownedTop", target: 2, xp: 40, title: "Own 2 tops", to: "/customize?category=top" },
    { id: "l2_scene", minLevel: 2, metric: "scene", target: 1, xp: 30, title: "Set a scene behind your character", to: "/customize?category=scenes" },
    // Level 4+
    { id: "l4_bets", minLevel: 4, metric: "bets", target: 15, xp: 70, title: "Place 15 bets", to: "/(tabs)/games" },
    { id: "l4_wins", minLevel: 4, metric: "wins", target: 6, xp: 90, title: "Win 6 bets", to: "/(tabs)/games" },
    { id: "l4_friends", minLevel: 4, metric: "friends", target: 3, xp: 70, title: "Have 3 friends", to: "/(tabs)/leagues?seg=friends" },
    { id: "l4_parlays", minLevel: 4, metric: "parlays", target: 3, xp: 70, title: "Place 3 parlays", to: "/(tabs)/games" },
    { id: "l4_moves", minLevel: 4, metric: "moves", target: 2, xp: 60, title: "Own 2 dance moves", to: "/customize?category=moves" },
    { id: "l4_shoes", minLevel: 4, metric: "ownedShoes", target: 2, xp: 60, title: "Own 2 pairs of shoes", to: "/customize?category=shoes" },
    // Level 7+
    { id: "l7_bets", minLevel: 7, metric: "bets", target: 40, xp: 120, title: "Place 40 bets", to: "/(tabs)/games" },
    { id: "l7_wins", minLevel: 7, metric: "wins", target: 15, xp: 150, title: "Win 15 bets", to: "/(tabs)/games" },
    { id: "l7_leagues", minLevel: 7, metric: "leagues", target: 2, xp: 110, title: "Play in 2 leagues", to: "/(tabs)/leagues" },
    { id: "l7_items", minLevel: 7, metric: "items", target: 10, xp: 110, title: "Own 10 Drip Shop items", to: "/customize?category=hat" },
    { id: "l7_freebets", minLevel: 7, metric: "freeBets", target: 14, xp: 120, title: "Use 14 Daily Free Bets", to: "/(tabs)" },
    // Level 12+
    { id: "l12_bets", minLevel: 12, metric: "bets", target: 100, xp: 200, title: "Place 100 bets", to: "/(tabs)/games" },
    { id: "l12_wins", minLevel: 12, metric: "wins", target: 40, xp: 250, title: "Win 40 bets", to: "/(tabs)/games" },
    { id: "l12_parlays", minLevel: 12, metric: "parlays", target: 10, xp: 200, title: "Place 10 parlays", to: "/(tabs)/games" },
    { id: "l12_friends", minLevel: 12, metric: "friends", target: 8, xp: 180, title: "Have 8 friends", to: "/(tabs)/leagues?seg=friends" },
    { id: "l12_items", minLevel: 12, metric: "items", target: 20, xp: 180, title: "Own 20 Drip Shop items", to: "/customize?category=hat" },
    // Level 20+
    { id: "l20_bets", minLevel: 20, metric: "bets", target: 250, xp: 350, title: "Place 250 bets", to: "/(tabs)/games" },
    { id: "l20_wins", minLevel: 20, metric: "wins", target: 100, xp: 400, title: "Win 100 bets", to: "/(tabs)/games" },
    { id: "l20_parlays", minLevel: 20, metric: "parlays", target: 30, xp: 350, title: "Place 30 parlays", to: "/(tabs)/games" },
    { id: "l20_freebets", minLevel: 20, metric: "freeBets", target: 60, xp: 350, title: "Use 60 Daily Free Bets", to: "/(tabs)" },
    // Level 30+
    { id: "l30_bets", minLevel: 30, metric: "bets", target: 600, xp: 600, title: "Place 600 bets", to: "/(tabs)/games" },
    { id: "l30_wins", minLevel: 30, metric: "wins", target: 250, xp: 700, title: "Win 250 bets", to: "/(tabs)/games" },
    { id: "l30_items", minLevel: 30, metric: "items", target: 40, xp: 500, title: "Own 40 Drip Shop items", to: "/customize?category=hat" },
];
const byId = new Map(exports.CHALLENGE_POOL.map((c) => [c.id, c]));
const challengeById = (id) => byId.get(id);
exports.challengeById = challengeById;
/**
 * Pure: the active list after carrying over unfinished challenges and filling
 * empty slots. Keeps order (old ones first) so the card doesn't reshuffle.
 */
function dealChallenges(active, claimed, level) {
    const keep = active.filter((id) => byId.has(id) && !claimed[id]);
    const taken = new Set(keep);
    const candidates = exports.CHALLENGE_POOL.filter((c) => c.minLevel <= level && !claimed[c.id] && !taken.has(c.id)).sort((a, b) => {
        if (!!a.explore !== !!b.explore)
            return a.explore ? -1 : 1;
        if (a.minLevel !== b.minLevel)
            return b.minLevel - a.minLevel;
        return exports.CHALLENGE_POOL.indexOf(a) - exports.CHALLENGE_POOL.indexOf(b);
    });
    // Never two of the same metric at once (e.g. "Place 5 bets" and "Place 15 bets").
    const metrics = new Set(keep.map((id) => byId.get(id).metric));
    for (const c of candidates) {
        if (keep.length >= exports.CHALLENGE_SLOTS)
            break;
        if (metrics.has(c.metric))
            continue;
        keep.push(c.id);
        metrics.add(c.metric);
    }
    return keep;
}
//# sourceMappingURL=levelChallenges.js.map