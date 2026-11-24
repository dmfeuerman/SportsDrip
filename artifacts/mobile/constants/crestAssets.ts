import type { ImageSourcePropType } from "react-native";

/**
 * 3-tier copyright-free team crest resolver backed by `assets/crests/version_2/`:
 *  1. Exact team crest (`nfl/`, `nba/`, `mlb/`, `nhl/`, `mls/`) — 100% of all 154 US pro teams
 *  2. Generic animal/mascot crest (`generic/`) for college & international clubs
 *  3. `null` -> caller (`TeamCrest`) renders the existing SVG monogram badge.
 *
 * All `require()` calls are static so Metro bundles every PNG cleanly.
 */

import { genericCandidates, normalize, normalizeAbbr, recordCrestMiss, sportFamily, MLS_NAME_HINT, type CrestKey } from "@/lib/crestMatcher";

export type { CrestKey } from "@/lib/crestMatcher";
/** @deprecated use CrestKey */
export type GenericCrestKey = CrestKey;

/**
 * Generic crest art. Metro needs static require()s, so a key with no PNG yet stays
 * commented out; the resolver then walks to that team's next candidate. To add art:
 * drop `<key>.png` into assets/crests/version_2/generic/ and uncomment its line.
 */
export const GENERIC_CRESTS: Partial<Record<CrestKey, ImageSourcePropType>> = {
  alligator: require("@/assets/crests/version_2/generic/alligator.png"),
  badger: require("@/assets/crests/version_2/generic/badger.png"),
  bear: require("@/assets/crests/version_2/generic/bear.png"),
  bison: require("@/assets/crests/version_2/generic/bison.png"),
  boar: require("@/assets/crests/version_2/generic/boar.png"),
  cannon: require("@/assets/crests/version_2/generic/cannon.png"),
  clover: require("@/assets/crests/version_2/generic/clover.png"),
  cougar: require("@/assets/crests/version_2/generic/cougar.png"),
  crown: require("@/assets/crests/version_2/generic/crown.png"),
  dog: require("@/assets/crests/version_2/generic/dog.png"),
  duck: require("@/assets/crests/version_2/generic/duck.png"),
  eagle: require("@/assets/crests/version_2/generic/eagle.png"),
  elephant: require("@/assets/crests/version_2/generic/elephant.png"),
  hawk: require("@/assets/crests/version_2/generic/hawk.png"),
  husky: require("@/assets/crests/version_2/generic/husky.png"),
  knight: require("@/assets/crests/version_2/generic/knight.png"),
  lion: require("@/assets/crests/version_2/generic/lion.png"),
  longhorn: require("@/assets/crests/version_2/generic/longhorn.png"),
  oak_leaf: require("@/assets/crests/version_2/generic/oak_leaf.png"),
  owl: require("@/assets/crests/version_2/generic/owl.png"),
  ram: require("@/assets/crests/version_2/generic/ram.png"),
  rooster: require("@/assets/crests/version_2/generic/rooster.png"),
  seagull: require("@/assets/crests/version_2/generic/seagull.png"),
  spear: require("@/assets/crests/version_2/generic/spear.png"),
  stallion: require("@/assets/crests/version_2/generic/stallion.png"),
  tiger: require("@/assets/crests/version_2/generic/tiger.png"),
  train: require("@/assets/crests/version_2/generic/train.png"),
  trident: require("@/assets/crests/version_2/generic/trident.png"),
  turtle: require("@/assets/crests/version_2/generic/turtle.png"),
  wildcat: require("@/assets/crests/version_2/generic/wildcat.png"),
  wolf: require("@/assets/crests/version_2/generic/wolf.png"),
  wolverine: require("@/assets/crests/version_2/generic/wolverine.png"),

  warrior_helmet: require("@/assets/crests/version_2/generic/warrior_helmet.png"),
  tricorn_colonial: require("@/assets/crests/version_2/generic/tricorn_colonial.png"),
  halo_saint: require("@/assets/crests/version_2/generic/halo_saint.png"),
  lightning_bolt: require("@/assets/crests/version_2/generic/lightning_bolt.png"),
  hornet: require("@/assets/crests/version_2/generic/hornet.png"),
  covered_wagon: require("@/assets/crests/version_2/generic/covered_wagon.png"),
  cowboy_hat: require("@/assets/crests/version_2/generic/cowboy_hat.png"),
  viking_helmet: require("@/assets/crests/version_2/generic/viking_helmet.png"),
  pirate_skull: require("@/assets/crests/version_2/generic/pirate_skull.png"),
  wheat_tractor: require("@/assets/crests/version_2/generic/wheat_tractor.png"),
  rocket_comet: require("@/assets/crests/version_2/generic/rocket_comet.png"),
  anchor_ship: require("@/assets/crests/version_2/generic/anchor_ship.png"),
  mountain_peak: require("@/assets/crests/version_2/generic/mountain_peak.png"),
  gear_wrench: require("@/assets/crests/version_2/generic/gear_wrench.png"),
  wave: require("@/assets/crests/version_2/generic/wave.png"),
  bird: require("@/assets/crests/version_2/generic/bird.png"),
  highlander_thistle: require("@/assets/crests/version_2/generic/highlander_thistle.png"),
  beaver: require("@/assets/crests/version_2/generic/beaver.png"),
  pick_axe: require("@/assets/crests/version_2/generic/pick_axe.png"),
  shark: require("@/assets/crests/version_2/generic/shark.png"),
  lumber_axe: require("@/assets/crests/version_2/generic/lumber_axe.png"),
  flame: require("@/assets/crests/version_2/generic/flame.png"),
  griffin_phoenix: require("@/assets/crests/version_2/generic/griffin_phoenix.png"),
  dragon: require("@/assets/crests/version_2/generic/dragon.png"),
  rabbit_kangaroo: require("@/assets/crests/version_2/generic/rabbit_kangaroo.png"),
  fleur_de_lis: require("@/assets/crests/version_2/generic/fleur_de_lis.png"),
  maple_leaf: require("@/assets/crests/version_2/generic/maple_leaf.png"),
  snake: require("@/assets/crests/version_2/generic/snake.png"),
  mammoth: require("@/assets/crests/version_2/generic/mammoth.png"),
  zebra: require("@/assets/crests/version_2/generic/zebra.png"),
  magpie: require("@/assets/crests/version_2/generic/magpie.png"),
  goat: require("@/assets/crests/version_2/generic/goat.png"),
  bat: require("@/assets/crests/version_2/generic/bat.png"),
  castle_tower: require("@/assets/crests/version_2/generic/castle_tower.png"),
  canary: require("@/assets/crests/version_2/generic/canary.png"),
  fox: require("@/assets/crests/version_2/generic/fox.png"),
  frog: require("@/assets/crests/version_2/generic/frog.png"),
  music_note: require("@/assets/crests/version_2/generic/music_note.png"),
  fallback_football: require("@/assets/crests/version_2/generic/fallback_football.png"),
  fallback_basketball: require("@/assets/crests/version_2/generic/fallback_basketball.png"),
  fallback_baseball: require("@/assets/crests/version_2/generic/fallback_baseball.png"),
  fallback_hockey: require("@/assets/crests/version_2/generic/fallback_hockey.png"),
  fallback_soccer: require("@/assets/crests/version_2/generic/fallback_soccer.png"),
};

const NFL_CRESTS: Record<string, ImageSourcePropType> = {
  ARI: require("@/assets/crests/version_2/nfl/ARI.png"),
  ATL: require("@/assets/crests/version_2/nfl/ATL.png"),
  BAL: require("@/assets/crests/version_2/nfl/BAL.png"),
  BUF: require("@/assets/crests/version_2/nfl/BUF.png"),
  CAR: require("@/assets/crests/version_2/nfl/CAR.png"),
  CHI: require("@/assets/crests/version_2/nfl/CHI.png"),
  CIN: require("@/assets/crests/version_2/nfl/CIN.png"),
  CLE: require("@/assets/crests/version_2/nfl/CLE.png"),
  DAL: require("@/assets/crests/version_2/nfl/DAL.png"),
  DEN: require("@/assets/crests/version_2/nfl/DEN.png"),
  DET: require("@/assets/crests/version_2/nfl/DET.png"),
  GB: require("@/assets/crests/version_2/nfl/GB.png"),
  HOU: require("@/assets/crests/version_2/nfl/HOU.png"),
  IND: require("@/assets/crests/version_2/nfl/IND.png"),
  JAX: require("@/assets/crests/version_2/nfl/JAX.png"),
  KC: require("@/assets/crests/version_2/nfl/KC.png"),
  LAC: require("@/assets/crests/version_2/nfl/LAC.png"),
  LAR: require("@/assets/crests/version_2/nfl/LAR.png"),
  LV: require("@/assets/crests/version_2/nfl/LV.png"),
  MIA: require("@/assets/crests/version_2/nfl/MIA.png"),
  MIN: require("@/assets/crests/version_2/nfl/MIN.png"),
  NE: require("@/assets/crests/version_2/nfl/NE.png"),
  NO: require("@/assets/crests/version_2/nfl/NO.png"),
  NYG: require("@/assets/crests/version_2/nfl/NYG.png"),
  NYJ: require("@/assets/crests/version_2/nfl/NYJ.png"),
  PHI: require("@/assets/crests/version_2/nfl/PHI.png"),
  PIT: require("@/assets/crests/version_2/nfl/PIT.png"),
  SEA: require("@/assets/crests/version_2/nfl/SEA.png"),
  SF: require("@/assets/crests/version_2/nfl/SF.png"),
  TB: require("@/assets/crests/version_2/nfl/TB.png"),
  TEN: require("@/assets/crests/version_2/nfl/TEN.png"),
  WSH: require("@/assets/crests/version_2/nfl/WSH.png"),
};

const NBA_CRESTS: Record<string, ImageSourcePropType> = {
  ATL: require("@/assets/crests/version_2/nba/ATL.png"),
  BKN: require("@/assets/crests/version_2/nba/BKN.png"),
  BOS: require("@/assets/crests/version_2/nba/BOS.png"),
  CHA: require("@/assets/crests/version_2/nba/CHA.png"),
  CHI: require("@/assets/crests/version_2/nba/CHI.png"),
  CLE: require("@/assets/crests/version_2/nba/CLE.png"),
  DAL: require("@/assets/crests/version_2/nba/DAL.png"),
  DEN: require("@/assets/crests/version_2/nba/DEN.png"),
  DET: require("@/assets/crests/version_2/nba/DET.png"),
  GS: require("@/assets/crests/version_2/nba/GS.png"),
  HOU: require("@/assets/crests/version_2/nba/HOU.png"),
  IND: require("@/assets/crests/version_2/nba/IND.png"),
  LAC: require("@/assets/crests/version_2/nba/LAC.png"),
  LAL: require("@/assets/crests/version_2/nba/LAL.png"),
  MEM: require("@/assets/crests/version_2/nba/MEM.png"),
  MIA: require("@/assets/crests/version_2/nba/MIA.png"),
  MIL: require("@/assets/crests/version_2/nba/MIL.png"),
  MIN: require("@/assets/crests/version_2/nba/MIN.png"),
  NO: require("@/assets/crests/version_2/nba/NO.png"),
  NYK: require("@/assets/crests/version_2/nba/NYK.png"),
  OKC: require("@/assets/crests/version_2/nba/OKC.png"),
  ORL: require("@/assets/crests/version_2/nba/ORL.png"),
  PHI: require("@/assets/crests/version_2/nba/PHI.png"),
  PHX: require("@/assets/crests/version_2/nba/PHX.png"),
  POR: require("@/assets/crests/version_2/nba/POR.png"),
  SA: require("@/assets/crests/version_2/nba/SA.png"),
  SAC: require("@/assets/crests/version_2/nba/SAC.png"),
  TOR: require("@/assets/crests/version_2/nba/TOR.png"),
  UTAH: require("@/assets/crests/version_2/nba/UTAH.png"),
  WSH: require("@/assets/crests/version_2/nba/WSH.png"),
};

const MLB_CRESTS: Record<string, ImageSourcePropType> = {
  ARI: require("@/assets/crests/version_2/mlb/ARI.png"),
  ATH: require("@/assets/crests/version_2/mlb/ATH.png"),
  ATL: require("@/assets/crests/version_2/mlb/ATL.png"),
  BAL: require("@/assets/crests/version_2/mlb/BAL.png"),
  BOS: require("@/assets/crests/version_2/mlb/BOS.png"),
  CHC: require("@/assets/crests/version_2/mlb/CHC.png"),
  CHW: require("@/assets/crests/version_2/mlb/CHW.png"),
  CIN: require("@/assets/crests/version_2/mlb/CIN.png"),
  CLE: require("@/assets/crests/version_2/mlb/CLE.png"),
  COL: require("@/assets/crests/version_2/mlb/COL.png"),
  DET: require("@/assets/crests/version_2/mlb/DET.png"),
  HOU: require("@/assets/crests/version_2/mlb/HOU.png"),
  KC: require("@/assets/crests/version_2/mlb/KC.png"),
  LAA: require("@/assets/crests/version_2/mlb/LAA.png"),
  LAD: require("@/assets/crests/version_2/mlb/LAD.png"),
  MIA: require("@/assets/crests/version_2/mlb/MIA.png"),
  MIL: require("@/assets/crests/version_2/mlb/MIL.png"),
  MIN: require("@/assets/crests/version_2/mlb/MIN.png"),
  NYM: require("@/assets/crests/version_2/mlb/NYM.png"),
  NYY: require("@/assets/crests/version_2/mlb/NYY.png"),
  PHI: require("@/assets/crests/version_2/mlb/PHI.png"),
  PIT: require("@/assets/crests/version_2/mlb/PIT.png"),
  SD: require("@/assets/crests/version_2/mlb/SD.png"),
  SEA: require("@/assets/crests/version_2/mlb/SEA.png"),
  SF: require("@/assets/crests/version_2/mlb/SF.png"),
  STL: require("@/assets/crests/version_2/mlb/STL.png"),
  TB: require("@/assets/crests/version_2/mlb/TB.png"),
  TEX: require("@/assets/crests/version_2/mlb/TEX.png"),
  TOR: require("@/assets/crests/version_2/mlb/TOR.png"),
  WSH: require("@/assets/crests/version_2/mlb/WSH.png"),
};

const NHL_CRESTS: Record<string, ImageSourcePropType> = {
  ANA: require("@/assets/crests/version_2/nhl/ANA.png"),
  BOS: require("@/assets/crests/version_2/nhl/BOS.png"),
  BUF: require("@/assets/crests/version_2/nhl/BUF.png"),
  CAR: require("@/assets/crests/version_2/nhl/CAR.png"),
  CBJ: require("@/assets/crests/version_2/nhl/CBJ.png"),
  CGY: require("@/assets/crests/version_2/nhl/CGY.png"),
  CHI: require("@/assets/crests/version_2/nhl/CHI.png"),
  COL: require("@/assets/crests/version_2/nhl/COL.png"),
  DAL: require("@/assets/crests/version_2/nhl/DAL.png"),
  DET: require("@/assets/crests/version_2/nhl/DET.png"),
  EDM: require("@/assets/crests/version_2/nhl/EDM.png"),
  FLA: require("@/assets/crests/version_2/nhl/FLA.png"),
  LA: require("@/assets/crests/version_2/nhl/LA.png"),
  MIN: require("@/assets/crests/version_2/nhl/MIN.png"),
  MTL: require("@/assets/crests/version_2/nhl/MTL.png"),
  NJ: require("@/assets/crests/version_2/nhl/NJ.png"),
  NSH: require("@/assets/crests/version_2/nhl/NSH.png"),
  NYI: require("@/assets/crests/version_2/nhl/NYI.png"),
  NYR: require("@/assets/crests/version_2/nhl/NYR.png"),
  OTT: require("@/assets/crests/version_2/nhl/OTT.png"),
  PHI: require("@/assets/crests/version_2/nhl/PHI.png"),
  PIT: require("@/assets/crests/version_2/nhl/PIT.png"),
  SEA: require("@/assets/crests/version_2/nhl/SEA.png"),
  SJ: require("@/assets/crests/version_2/nhl/SJ.png"),
  STL: require("@/assets/crests/version_2/nhl/STL.png"),
  TB: require("@/assets/crests/version_2/nhl/TB.png"),
  TOR: require("@/assets/crests/version_2/nhl/TOR.png"),
  UTA: require("@/assets/crests/version_2/nhl/UTA.png"),
  VAN: require("@/assets/crests/version_2/nhl/VAN.png"),
  VGK: require("@/assets/crests/version_2/nhl/VGK.png"),
  WPG: require("@/assets/crests/version_2/nhl/WPG.png"),
  WSH: require("@/assets/crests/version_2/nhl/WSH.png"),
};

const MLS_CRESTS: Record<string, ImageSourcePropType> = {
  ATL: require("@/assets/crests/version_2/mls/ATL.png"),
  ATX: require("@/assets/crests/version_2/mls/ATX.png"),
  CHI: require("@/assets/crests/version_2/mls/CHI.png"),
  CIN: require("@/assets/crests/version_2/mls/CIN.png"),
  CLB: require("@/assets/crests/version_2/mls/CLB.png"),
  CLT: require("@/assets/crests/version_2/mls/CLT.png"),
  COL: require("@/assets/crests/version_2/mls/COL.png"),
  DAL: require("@/assets/crests/version_2/mls/DAL.png"),
  DC: require("@/assets/crests/version_2/mls/DC.png"),
  HOU: require("@/assets/crests/version_2/mls/HOU.png"),
  LAFC: require("@/assets/crests/version_2/mls/LAFC.png"),
  LAG: require("@/assets/crests/version_2/mls/LAG.png"),
  MIA: require("@/assets/crests/version_2/mls/MIA.png"),
  MIN: require("@/assets/crests/version_2/mls/MIN.png"),
  MTL: require("@/assets/crests/version_2/mls/MTL.png"),
  NE: require("@/assets/crests/version_2/mls/NE.png"),
  NSH: require("@/assets/crests/version_2/mls/NSH.png"),
  NYC: require("@/assets/crests/version_2/mls/NYC.png"),
  ORL: require("@/assets/crests/version_2/mls/ORL.png"),
  PHI: require("@/assets/crests/version_2/mls/PHI.png"),
  POR: require("@/assets/crests/version_2/mls/POR.png"),
  RBNY: require("@/assets/crests/version_2/mls/RBNY.png"),
  RSL: require("@/assets/crests/version_2/mls/RSL.png"),
  SD: require("@/assets/crests/version_2/mls/SD.png"),
  SEA: require("@/assets/crests/version_2/mls/SEA.png"),
  SJ: require("@/assets/crests/version_2/mls/SJ.png"),
  SKC: require("@/assets/crests/version_2/mls/SKC.png"),
  STL: require("@/assets/crests/version_2/mls/STL.png"),
  TOR: require("@/assets/crests/version_2/mls/TOR.png"),
  VAN: require("@/assets/crests/version_2/mls/VAN.png"),
};

const TEAM_CRESTS_BY_SPORT: Record<string, Record<string, ImageSourcePropType>> = {
  NFL: NFL_CRESTS,
  NBA: NBA_CRESTS,
  MLB: MLB_CRESTS,
  NHL: NHL_CRESTS,
  MLS: MLS_CRESTS,
  Soccer: MLS_CRESTS,
};

/** Common ESPN abbreviation variants -> canonical filename key. */
const ABBR_ALIASES: Record<string, Record<string, string>> = {
  NFL: { JAC: "JAX", LA: "LAR", LVR: "LV", WAS: "WSH" },
  NBA: { GSW: "GS", NOP: "NO", NY: "NYK", PHO: "PHX", SAS: "SA", UTA: "UTAH", WAS: "WSH" },
  MLB: { CWS: "CHW", KCR: "KC", OAK: "ATH", SDP: "SD", SFG: "SF", TBR: "TB", WAS: "WSH" },
  NHL: { LAK: "LA", NJD: "NJ", SJS: "SJ", TBL: "TB", UTAH: "UTA", WAS: "WSH" },
  Soccer: {
    ATLU: "ATL",
    DCU: "DC",
    FCC: "CIN",
    FCD: "DAL",
    IMCF: "MIA",
    MNUFC: "MIN",
    LA: "LAG",
    NER: "NE",
    NSC: "NSH",
    NY: "RBNY",
    NYCFC: "NYC",
    NYRB: "RBNY",
    ORLC: "ORL",
    PHL: "PHI",
    PTFC: "POR",
    SDFC: "SD",
    SJE: "SJ",
    SSFC: "SEA",
    TFC: "TOR",
    VWFC: "VAN",
  },
};

const CACHE = new Map<string, ImageSourcePropType | null>();

/** Sport label -> which exact-crest map to use. Unknown labels map by family so "Pro Football" still works. */
function exactMapFor(sport: string): { map: Record<string, ImageSourcePropType>; aliases: Record<string, string> } | null {
  const direct = TEAM_CRESTS_BY_SPORT[sport];
  if (direct) return { map: direct, aliases: ABBR_ALIASES[sport] ?? ABBR_ALIASES[sport === "MLS" ? "Soccer" : sport] ?? {} };
  const up = sport.toUpperCase();
  for (const k of Object.keys(TEAM_CRESTS_BY_SPORT)) if (k.toUpperCase() === up) return exactMapFor(k);
  return null;
}

function exactCrest(abbr: string, sport: string, name: string | null | undefined): ImageSourcePropType | null {
  const m = exactMapFor(sport);
  if (!m) return null;
  const key = m.map[abbr] ? abbr : m.aliases[abbr];
  if (!key || !m.map[key]) return null;
  // Soccer spans many leagues but only MLS has exact crests: Torino (TOR) must not get Toronto FC's.
  if (sportFamily(sport) === "soccer" && name) {
    const hint = MLS_NAME_HINT[key];
    if (!hint || !` ${normalize(name)} `.includes(` ${hint} `)) return null;
  }
  return m.map[key]!;
}

/**
 * Resolves a team crest:
 *  1. exact pro crest (NFL/NBA/MLB/NHL/MLS) by abbreviation + alias
 *  2. first generic candidate from lib/crestMatcher that has art (club name, mascot keywords, abbr override)
 *  3. the sport fallback crest, if drawn
 *  4. `null` -> TeamCrest renders its SVG monogram
 * Never throws; results are memoized per (sport, abbr, name).
 */
export function resolveCrestAsset(
  abbr: string | null | undefined,
  sport?: string | null,
  name?: string | null
): ImageSourcePropType | null {
  const cacheKey = `${sport ?? ""}|${abbr ?? ""}|${name ?? ""}`;
  const hit = CACHE.get(cacheKey);
  if (hit !== undefined) return hit;

  let result: ImageSourcePropType | null = null;
  try {
    const a = normalizeAbbr(abbr);
    if (a && sport) result = exactCrest(a, sport, name);
    if (!result) {
      const candidates = genericCandidates(a, sport, name);
      for (const k of candidates) {
        const art = GENERIC_CRESTS[k];
        if (art) {
          result = art;
          if (k.startsWith("fallback_")) recordCrestMiss(sport, abbr, name, "sport-fallback");
          break;
        }
      }
      if (!result) recordCrestMiss(sport, abbr, name, candidates.length ? `no-art:${candidates[0]}` : "no-match");
    }
  } catch {
    result = null;
  }
  CACHE.set(cacheKey, result);
  return result;
}
