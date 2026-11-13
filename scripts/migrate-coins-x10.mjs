/**
 * One-off: the coin upgrade. Every credit and league-token amount already in
 * Firestore is multiplied by 10 to match the x10 economy in code (balances,
 * store prices, open and settled bets, league stacks and pots, loans, ledger
 * history, season-pass credit rewards). Ad-reward rows are left as they were:
 * the watch-a-video reward did not change.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json node scripts/migrate-coins-x10.mjs [--dry-run]
 *
 * Run it right after deploying the x10 functions, ideally while nobody is
 * playing. Idempotent and resumable: each migrated document gets
 * `coinScale: 10` and is skipped next time. A write that races a live update
 * fails its precondition and is picked up by simply running the script again.
 */
import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

initializeApp({ credential: applicationDefault() });
const db = getFirestore();
const dry = process.argv.includes("--dry-run");
const SCALE = 10;

/** Collection ids (top-level or nested, via collection groups) that hold credits or league tokens. */
const COLLECTIONS = [
  "users", "ledger", "inventory", "notifications", "activity",
  "bets", "slipParlays", "freeBets", "dailyPicks", "dailyPick", "flashPicks",
  "leagues", "leagueBets", "loans", "parlays", "picks", "matchups", "rivalries", "trophies", "wrapped",
  "challenges", "friendLoans", "prizeBoxes",
  "catalog", "moves", "backgrounds", "seasons",
];

/** Numeric fields that are amounts of credits or league tokens, wherever they sit in a document. */
const MONEY = new Set([
  "balance", "balanceAfter", "delta", "amount", "stake", "creatorStake", "opponentStake", "freeStake",
  "potentialPayout", "payout", "winnings", "pot", "buyIn", "price", "pricePaid",
  "leagueTokens", "startingLeagueTokens", "walletTokens", "tokens", "netWorth",
  "aStartNetWorth", "bStartNetWorth", "aEndNetWorth", "bEndNetWorth", "aDelta", "bDelta",
  "principal", "principalOutstanding", "principalRepaid", "interestAccrued", "interestPaid", "interestCharged",
  "interestOutstanding", "toPrincipal", "toInterest", "owed", "totalOwed", "totalRepayable", "totalRepaid",
  "totalVolume", "fundAmount", "stimulusTotal", "prizeTokens", "rewardCredits", "baseCredits", "streakBonus",
  "rewardAmount", "creditsWon", "creditsStaked",
]);
/** Maps whose every number is an amount (e.g. balances by uid). */
const MONEY_MAPS = new Set(["balances", "stakes"]);

/** Ledger and notification rows for the ad reward keep their amounts. */
const isAdRow = (data) => typeof data.type === "string" && /^ad_|_ad$|ad_reward/.test(data.type);

function scale(value, key, parent, inMoneyMap) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return value;
    if (inMoneyMap || MONEY.has(key)) {
      // A non-credit reward (`{ kind: "xp", amount }`) keeps its amount.
      if (key === "amount" && parent && typeof parent.kind === "string" && parent.kind !== "credits") return value;
      return Math.round(value * SCALE);
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => scale(v, key, parent, inMoneyMap));
  if (value && typeof value === "object" && value.constructor === Object) {
    const out = {};
    const money = inMoneyMap || MONEY_MAPS.has(key);
    for (const [k, v] of Object.entries(value)) out[k] = scale(v, k, value, money);
    return out;
  }
  return value; // Timestamps, references, strings, null
}

const writer = db.bulkWriter();
let failed = 0;
writer.onWriteError((err) => {
  failed++;
  console.warn(`  write failed (${err.documentRef.path}): ${err.message}`);
  return false; // re-run the script to pick it up
});

const totals = {};
for (const id of COLLECTIONS) {
  let seen = 0;
  let changed = 0;
  const snap = await db.collectionGroup(id).get();
  for (const doc of snap.docs) {
    seen++;
    const data = doc.data();
    if (data.coinScale === SCALE) continue;
    if ((id === "ledger" || id === "notifications" || id === "activity") && isAdRow(data)) continue;
    const update = {};
    for (const [k, v] of Object.entries(data)) {
      const next = scale(v, k, data, MONEY_MAPS.has(k));
      if (JSON.stringify(next) !== JSON.stringify(v)) update[k] = next;
    }
    if (!Object.keys(update).length) continue;
    changed++;
    update.coinScale = SCALE;
    if (dry) {
      if (changed <= 3) console.log(`  ${doc.ref.path}:`, JSON.stringify(Object.fromEntries(Object.keys(update).map((k) => [k, [data[k], update[k]]]))).slice(0, 400));
      continue;
    }
    writer.update(doc.ref, update, { lastUpdateTime: doc.updateTime });
  }
  totals[id] = { seen, changed };
  console.log(`${id}: ${changed}/${seen} ${dry ? "would change" : "queued"}`);
}

await writer.close();
console.log(dry ? "Dry run: nothing written." : `Done. ${failed ? `${failed} writes failed; run again to finish.` : "All writes applied."}`);
