#!/usr/bin/env node
/**
 * Crest coverage audit. Pulls every team the app can show from the ESPN feed and runs
 * each through lib/crestMatcher.ts, so new teams that would slip through are caught
 * before a user sees a bare monogram.
 *
 *   cd artifacts/mobile && node scripts/audit-crests.mjs           # summary + misses
 *   node scripts/audit-crests.mjs --all                             # every team -> key
 *
 * Needs Node 22.18+ (runs the .ts matcher directly) and network access to ESPN.
 */
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { genericCandidates, CREST_KEYWORDS, CLUB_OVERRIDES } from "../lib/crestMatcher.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = [
  ["NFL", "football/nfl"], ["NBA", "basketball/nba"], ["MLB", "baseball/mlb"], ["NHL", "hockey/nhl"],
  ["NCAAF", "football/college-football"], ["NCAAB", "basketball/mens-college-basketball"],
  ["Soccer", "soccer/eng.1"], ["Soccer", "soccer/esp.1"], ["Soccer", "soccer/ita.1"], ["Soccer", "soccer/ger.1"],
  ["Soccer", "soccer/fra.1"], ["Soccer", "soccer/uefa.champions"], ["Soccer", "soccer/usa.1"],
];
const showAll = process.argv.includes("--all");

const drawn = new Set(readdirSync(join(root, "assets/crests/version_2/generic")).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4)));
const exactDirs = { NFL: "nfl", NBA: "nba", MLB: "mlb", NHL: "nhl" };
const exact = Object.fromEntries(Object.entries(exactDirs).map(([s, d]) => [s, new Set(readdirSync(join(root, "assets/crests/version_2", d)).map((f) => f.replace(/\.png$/, "")))]));

const seen = new Set();
const byKey = new Map();
const fallbacks = [];
const noArt = new Map();
let total = 0;

for (const [sport, path] of SOURCES) {
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/${path}/teams?limit=1000`);
  if (!res.ok) { console.error(`! ${path}: HTTP ${res.status}`); continue; }
  const teams = (await res.json())?.sports?.[0]?.leagues?.[0]?.teams?.map((t) => t.team) ?? [];
  for (const t of teams) {
    const id = `${sport}|${t.abbreviation}|${t.displayName}`;
    if (seen.has(id)) continue;
    seen.add(id);
    total++;
    const cands = genericCandidates(t.abbreviation, sport, t.displayName);
    const key = cands[0] ?? "(none)";
    byKey.set(key, (byKey.get(key) ?? 0) + 1);
    if (showAll) console.log(`${sport.padEnd(6)} ${String(t.abbreviation).padEnd(5)} ${t.displayName.padEnd(40)} ${cands.join(" > ")}`);
    if (key.startsWith("fallback_") || key === "(none)") fallbacks.push(`${sport.padEnd(6)} ${t.abbreviation.padEnd(5)} ${t.displayName}`);
    const hasExact = exact[sport]?.has(t.abbreviation);
    const firstDrawn = cands.find((k) => drawn.has(k));
    if (!hasExact && firstDrawn !== key) noArt.set(key, (noArt.get(key) ?? 0) + 1);
  }
}

// Dictionary keys that map to the same thing in two places (typos, dead entries).
const dict = new Map();
for (const [key, phrases] of Object.entries(CREST_KEYWORDS)) for (const p of phrases) {
  if (dict.has(p) && dict.get(p) !== key) console.warn(`! keyword "${p}" is under both ${dict.get(p)} and ${key}`);
  dict.set(p, key);
}
const allKeys = new Set([...Object.keys(CREST_KEYWORDS), ...Object.values(CLUB_OVERRIDES)]);

console.log(`\nTeams: ${total}   named crest: ${total - fallbacks.length}   sport fallback only: ${fallbacks.length}`);
console.log(`\nTeams per key:\n${[...byKey].sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${k.padEnd(20)} ${n}${drawn.has(k) ? "" : "  (no PNG yet)"}`).join("\n")}`);
console.log(`\nKeys still to draw, by teams waiting on them:\n${[...noArt].sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${k.padEnd(20)} ${n}`).join("\n") || "  none"}`);
console.log(`\nUnused keys: ${[...allKeys].filter((k) => !byKey.has(k)).join(", ") || "none"}`);
console.log(`\nTeams with no mascot match (sport fallback). Add a keyword or CLUB_OVERRIDES entry if one fits:\n${fallbacks.map((f) => `  ${f}`).join("\n")}`);
