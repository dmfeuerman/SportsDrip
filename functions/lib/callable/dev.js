"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.devTools = void 0;
const https_1 = require("firebase-functions/v2/https");
const firebase_functions_1 = require("firebase-functions");
const zod_1 = require("zod");
const economy_1 = require("../lib/economy");
const avatarRules_1 = require("../lib/avatarRules");
const leagueConfig_1 = require("../lib/leagueConfig");
const settleBets_1 = require("../scheduled/settleBets");
/**
 * Test-data tools behind the mobile app's dev launch flags
 * (artifacts/mobile/scripts/dev-test.js → lib/devFlags.ts).
 *
 * OFF unless the functions run in the emulator or with DEV_TOOLS=1 in
 * functions/.env. With DEV_TOOLS_UIDS set (comma-separated), only those
 * accounts may use it. Everything it writes is tagged `dev: true`.
 */
function allowed(uid) {
    const on = process.env.FUNCTIONS_EMULATOR === "true" || process.env.DEV_TOOLS === "1";
    if (!on)
        return false;
    const list = (process.env.DEV_TOOLS_UIDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return list.length === 0 || list.includes(uid);
}
const Input = zod_1.z.object({
    /** Fake friends to ensure exist (0–20). */
    friends: zod_1.z.number().int().min(0).max(20).optional(),
    /** Incoming friend requests from extra fake players (0–10). */
    requests: zod_1.z.number().int().min(0).max(10).optional(),
    /** Fake leagues to ensure exist, with your fake friends as members (0–5). */
    leagues: zod_1.z.number().int().min(0).max(5).optional(),
    /** Set the main wallet to exactly this many credits. */
    cash: zod_1.z.number().int().min(0).max(10_000_000).optional(),
    /** Every prize box ready to claim. */
    chests: zod_1.z.boolean().optional(),
    /** Settle your newest pending bet (or a new dev bet) as a win / loss. */
    hitBet: zod_1.z.boolean().optional(),
    loseBet: zod_1.z.boolean().optional(),
    /** Fake friends message you (DMs + league chat) — exercises chat pushes and badges. */
    chat: zod_1.z.boolean().optional(),
});
const SKINS = ["#8D5524", "#C68642", "#F1C27D", "#FFDBAC", "#5C3A21", "#E0AC69"];
const HAIR = ["fade", "braids", "curls", "buzz", "afro", "long", "ponytail", "short_crop"];
const HAIR_COLORS = ["#0F0A08", "#2B1B12", "#6F4023", "#A9662E", "#C9963F", "#B03030"];
const NAMES = ["Maya", "Theo", "Sam", "Jordan", "Riley", "Avery", "Quinn", "Kai", "Nico", "Zoe", "Eli", "Luca", "Ivy", "Rowan", "Jade", "Milo", "Sage", "Remy", "Tess", "Omar"];
const OUTFITS = [
    { top: "top_mvp_jersey", bottom: "bottom_court_shorts", shoes: "shoes_fresh_kicks" },
    { top: "top_stealth_hoodie", bottom: "bottom_track_joggers", shoes: "shoes_fire_reds", hat: "hat_courtside_beanie" },
    { top: "tee_basic_white", outerwear: "outerwear_bomber", bottom: "bottom_cargo_pants", shoes: "shoes_basic_white" },
    { top: "tee_basic_white", bottom: "shorts_basic_navy", shoes: "shoes_basic_white", hat: "hat_champion_snapback" },
];
const BOT_LINES = [
    "you really took that line? bold",
    "lock of the week incoming 🔒",
    "who's riding the late game with me",
    "that parlay was robbery",
    "loan me 500, I'm good for it 😅",
    "gg on that last one",
];
/** Bot uids are alphanumeric (DM thread ids split on "_"). */
const botUid = (me, kind, i) => `devbot${kind}${me.replace(/[^A-Za-z0-9]/g, "").slice(0, 8)}${i}`;
async function ensureBot(me, kind, i) {
    const uid = botUid(me, kind, i);
    const ref = economy_1.db.collection("users").doc(uid);
    const snap = await ref.get();
    const name = `${NAMES[i % NAMES.length]} ${kind === "r" ? "(req)" : "Bot"}`;
    if (!snap.exists) {
        const username = `bot${kind}${i}_${me.replace(/[^A-Za-z0-9]/g, "").slice(0, 8).toLowerCase()}`;
        const batch = economy_1.db.batch();
        batch.set(economy_1.db.collection("usernames").doc(username), { uid, dev: true, createdAt: economy_1.FieldValue.serverTimestamp() });
        const won = 5 + ((i * 7) % 20);
        const lost = 4 + ((i * 5) % 15);
        batch.set(ref, {
            uid,
            username,
            displayName: name,
            balance: 1000 + i * 1750,
            avatar: {
                ...avatarRules_1.DEFAULT_AVATAR,
                skinTone: SKINS[i % SKINS.length],
                hairStyle: HAIR[i % HAIR.length],
                hairColor: HAIR_COLORS[i % HAIR_COLORS.length],
                height: 0.35 + ((i * 13) % 40) / 100,
                bodyType: 0.3 + ((i * 17) % 50) / 100,
            },
            equipped: OUTFITS[i % OUTFITS.length],
            stats: { betsPlaced: won + lost, betsWon: won, betsLost: lost, betsPush: 0, creditsWon: won * 120, creditsStaked: (won + lost) * 150 },
            onboarded: true,
            dev: true,
            createdAt: economy_1.FieldValue.serverTimestamp(),
            updatedAt: economy_1.FieldValue.serverTimestamp(),
        });
        for (const itemId of new Set([...economy_1.STARTER_ITEMS, ...Object.values(OUTFITS[i % OUTFITS.length])])) {
            batch.set(ref.collection("inventory").doc(itemId), { itemId, source: "dev", acquiredAt: economy_1.FieldValue.serverTimestamp() });
        }
        await batch.commit();
    }
    return { uid, name: snap.get("displayName") ?? name };
}
async function seedFriends(me, n) {
    const bots = [];
    for (let i = 0; i < n; i++) {
        const bot = await ensureBot(me, "f", i);
        await economy_1.db.collection("friendships").doc((0, economy_1.pairId)(me, bot.uid)).set({ users: [me, bot.uid].sort(), dev: true, createdAt: economy_1.FieldValue.serverTimestamp() }, { merge: true });
        bots.push(bot);
    }
    return bots;
}
async function seedRequests(me, n) {
    for (let i = 0; i < n; i++) {
        const bot = await ensureBot(me, "r", i);
        const ref = economy_1.db.collection("friendRequests").doc(`${bot.uid}_${me}`);
        const snap = await ref.get();
        if (snap.exists && snap.get("status") === "pending")
            continue;
        await ref.set({ from: bot.uid, to: me, status: "pending", dev: true, createdAt: economy_1.FieldValue.serverTimestamp() });
    }
}
async function seedLeagues(me, myName, n, bots) {
    const ids = [];
    const now = Date.now();
    const tokens = 10_000;
    for (let i = 0; i < n; i++) {
        const leagueId = `lg_dev_${me.slice(0, 8)}_${i}`;
        ids.push(leagueId);
        const ref = economy_1.db.collection("leagues").doc(leagueId);
        if ((await ref.get()).exists)
            continue;
        const mates = bots.slice(i, i + 4).length ? bots.slice(i, i + 4) : bots.slice(0, 4);
        const roster = [{ uid: me, name: myName }, ...mates];
        const members = {};
        roster.forEach((p, j) => {
            const won = j === 0 ? 0 : (j * 3) % 7;
            const lost = j === 0 ? 0 : (j * 2) % 5;
            members[p.uid] = {
                uid: p.uid,
                displayName: p.name,
                avatarColor: leagueConfig_1.MEMBER_COLORS[j % leagueConfig_1.MEMBER_COLORS.length],
                leagueTokens: j === 0 ? tokens : tokens + (won - lost) * 400,
                startingLeagueTokens: tokens,
                joinedAt: now - (roster.length - j) * 3_600_000,
                betsWon: won,
                betsLost: lost,
                betsPush: 0,
                locksWon: 0,
                locksLost: 0,
                locksPush: 0,
                lastLockWeek: null,
                pickPoints: won,
                eliminated: false,
                eliminatedAt: null,
                eliminatedWeek: null,
                usedTeams: [],
                h2h: { w: 0, l: 0, t: 0 },
            };
        });
        const code = (0, leagueConfig_1.randomCode)();
        const name = ["Dev League", "Sunday Sweats", "Group Chat FC", "Bad Beats", "Late Night Locks"][i % 5];
        const batch = economy_1.db.batch();
        batch.set(ref, {
            schemaVersion: 2,
            id: leagueId,
            name,
            code,
            mode: "bankroll",
            matchupsEnabled: false,
            createdAt: now,
            endsAt: now + leagueConfig_1.DURATIONS["1 Month"] * 86_400_000,
            duration: "1 Month",
            durationWeeks: (0, leagueConfig_1.durationWeeks)("1 Month"),
            status: "active",
            creatorId: me,
            startingLeagueTokens: tokens,
            buyIn: 0,
            pot: 0,
            prizeDistribution: { preset: "top-3", ...leagueConfig_1.PRIZE_PRESETS["top-3"] },
            allowedSports: [...leagueConfig_1.SPORTS],
            bankLoanEnabled: true,
            bankInterestRate: 10,
            bankInterestIntervalHours: 24,
            memberIds: roster.map((p) => p.uid),
            formerMemberIds: [],
            members,
            endVotes: [],
            lastActivityAt: now,
            payoutStatus: "none",
            dev: true,
        });
        batch.set(economy_1.db.collection("leagueInvites").doc(code), { code, leagueId, leagueName: name, buyIn: 0, creatorId: me, createdAt: now, dev: true });
        roster.forEach((p, j) => {
            batch.set(ref.collection("activity").doc(`dev_join_${j}`), {
                amount: 0,
                reactions: {},
                reactors: {},
                type: j === 0 ? "created" : "joined",
                uid: p.uid,
                name: p.name,
                text: j === 0 ? `${p.name} started the league` : `${p.name} joined`,
                at: now - (roster.length - j) * 3_600_000,
            });
        });
        await batch.commit();
    }
    return ids;
}
async function setCash(me, cash) {
    await economy_1.db.runTransaction(async (tx) => {
        const u = await tx.get(economy_1.db.collection("users").doc(me));
        const current = u.get("balance") ?? 0;
        if (current === cash)
            return;
        await (0, economy_1.applyCredits)(tx, me, {
            delta: cash - current,
            type: "dev_grant",
            idempotencyKey: `dev_cash_${Date.now()}`,
            note: `Dev tools: balance set to ${cash.toLocaleString("en-US")}`,
        });
    });
}
async function readyChests(me) {
    const now = Date.now();
    const batch = economy_1.db.batch();
    for (const tier of Object.keys(economy_1.PRIZE_BOXES)) {
        batch.set(economy_1.db.collection("users").doc(me).collection("prizeBoxes").doc(tier), {
            tier,
            state: "waiting",
            openedAt: now - economy_1.PRIZE_BOXES[tier].waitHours * 3_600_000,
            readyAt: now - 1000,
            rewardCredits: null,
            claimedAt: null,
            dev: true,
            updatedAt: economy_1.FieldValue.serverTimestamp(),
        });
    }
    await batch.commit();
}
/** Newest pending main-wallet bet, or a fresh 100-credit dev bet when there is none. */
async function betToSettle(me) {
    const pending = await economy_1.db.collection("bets").where("uid", "==", me).where("status", "==", "pending").get();
    const newest = pending.docs.sort((a, b) => (b.get("placedAt")?.toMillis?.() ?? 0) - (a.get("placedAt")?.toMillis?.() ?? 0))[0];
    if (newest)
        return newest.ref;
    const ref = economy_1.db.collection("bets").doc(`${me}_dev_${Date.now()}`);
    await economy_1.db.runTransaction(async (tx) => {
        await (0, economy_1.applyCredits)(tx, me, { delta: -100, type: "bet_stake", idempotencyKey: `bet_stake_dev_${ref.id}`, ref: ref.id, note: "Dev bet" });
        tx.set(ref, {
            id: ref.id,
            uid: me,
            gameId: "DEV:sim",
            sport: "NBA",
            market: "ml",
            selection: "home",
            side: "home",
            line: null,
            label: "BOS",
            teamName: "Boston Celtics",
            teamAbbr: "BOS",
            teamColor: "#007A33",
            opponentAbbr: "NYK",
            stake: 100,
            odds: 2.1,
            potentialPayout: 210,
            status: "pending",
            startsAt: Date.now() - 3 * 3_600_000,
            opponentUid: null,
            placedAt: economy_1.FieldValue.serverTimestamp(),
            settledAt: null,
            dev: true,
        });
        tx.update(economy_1.db.collection("users").doc(me), { "stats.betsPlaced": economy_1.FieldValue.increment(1), "stats.creditsStaked": economy_1.FieldValue.increment(100) });
    });
    return ref;
}
async function simulateResult(me, outcome) {
    const ref = await betToSettle(me);
    const bet = await ref.get();
    const homeWins = (bet.get("selection") ?? bet.get("side")) === "home" || bet.get("selection") === "over";
    const win = outcome === "won";
    const scores = homeWins === win ? { home: 112, away: 104 } : { home: 98, away: 107 };
    await (0, settleBets_1.settleMainBet)(ref, scores, outcome);
    return ref.id;
}
async function sendChat(me, myName, bots, leagueIds) {
    const now = Date.now();
    for (const [i, bot] of bots.slice(0, 3).entries()) {
        const threadId = me < bot.uid ? `dm_${me}_${bot.uid}` : `dm_${bot.uid}_${me}`;
        const id = `dm_dev_${now.toString(36)}_${i}`;
        await economy_1.db.collection("directMessages").doc(threadId).collection("messages").doc(id).set({
            id,
            threadId,
            senderUid: bot.uid,
            senderName: bot.name,
            recipientUid: me,
            recipientName: myName,
            kind: "text",
            text: BOT_LINES[i % BOT_LINES.length],
            at: now + i,
            replyTo: null,
            dev: true,
            createdAt: economy_1.FieldValue.serverTimestamp(),
        });
    }
    for (const [j, leagueId] of leagueIds.entries()) {
        const league = await economy_1.db.collection("leagues").doc(leagueId).get();
        const mates = (league.get("memberIds") ?? []).filter((u) => u !== me);
        const uid = mates[0];
        if (!uid)
            continue;
        const name = league.get(`members.${uid}.displayName`) ?? "League-mate";
        await economy_1.db.collection("leagues").doc(leagueId).collection("messages").doc(`dev_${now.toString(36)}_${j}`).set({
            uid,
            name,
            kind: "text",
            text: BOT_LINES[(j + 3) % BOT_LINES.length],
            at: now + 10 + j,
            replyTo: null,
            reactions: {},
            reactors: {},
            dev: true,
            createdAt: economy_1.FieldValue.serverTimestamp(),
        });
    }
}
exports.devTools = (0, https_1.onCall)({ region: "us-central1", timeoutSeconds: 120 }, async (req) => {
    const me = (0, economy_1.requireAuth)(req.auth);
    if (!allowed(me)) {
        throw new https_1.HttpsError("permission-denied", "Dev tools are off. Set DEV_TOOLS=1 (and DEV_TOOLS_UIDS) in functions/.env, or use the emulator.");
    }
    const input = Input.parse(req.data ?? {});
    const meSnap = await economy_1.db.collection("users").doc(me).get();
    if (!meSnap.exists)
        throw new https_1.HttpsError("failed-precondition", "Create your profile first.");
    const myName = meSnap.get("displayName") || "You";
    const done = [];
    const wantFriends = Math.max(input.friends ?? 0, input.leagues || input.chat ? 3 : 0);
    const bots = wantFriends ? await seedFriends(me, wantFriends) : [];
    if (input.friends)
        done.push(`${input.friends} friends`);
    if (input.requests) {
        await seedRequests(me, input.requests);
        done.push(`${input.requests} friend requests`);
    }
    const leagueIds = input.leagues ? await seedLeagues(me, myName, input.leagues, bots) : [];
    if (input.leagues)
        done.push(`${input.leagues} leagues`);
    if (input.cash !== undefined) {
        await setCash(me, input.cash);
        done.push(`${input.cash.toLocaleString("en-US")} credits`);
    }
    if (input.chests) {
        await readyChests(me);
        done.push("prize boxes ready");
    }
    if (input.hitBet)
        done.push(`bet ${await simulateResult(me, "won")} won`);
    if (input.loseBet)
        done.push(`bet ${await simulateResult(me, "lost")} lost`);
    if (input.chat) {
        const ids = leagueIds.length
            ? leagueIds
            : (await economy_1.db.collection("leagues").where("memberIds", "array-contains", me).limit(20).get()).docs
                .filter((d) => d.get("status") === "active")
                .slice(0, 3)
                .map((d) => d.id);
        await sendChat(me, myName, bots, ids);
        done.push("chat messages sent");
    }
    firebase_functions_1.logger.info("dev tools applied", { uid: me, done });
    return { ok: true, done };
});
//# sourceMappingURL=dev.js.map