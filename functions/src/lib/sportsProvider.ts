/**
 * Sports data provider adapter.
 *
 * The rest of the codebase only knows about `NormalizedGame` and the
 * `SportsDataProvider` interface. syncGames calls `fetchGames()`; settlement
 * reads the games/* documents it writes. Swapping ESPN for a paid feed (The
 * Odds API, Sportradar) means writing another `SportsDataProvider` and
 * pointing `activeProvider` at it — nothing downstream changes.
 *
 * This runs server-side on a schedule, so there is exactly one upstream request
 * per sport per cycle for the whole user base — not one per device.
 *
 * Pricing: the feed's two-way moneyline when it has one (oddsSource "book").
 * When it doesn't, syncGames fills in the SportDrip model line
 * (lib/oddsModel.ts + lib/ratings.ts: shared per-team Elo ratings updated from
 * results, with a season-record prior), tagged oddsSource "model". A book line
 * always replaces a model one as soon as the feed carries it.
 */

export type Sport = "NFL" | "NBA" | "MLB" | "NHL" | "NCAAF" | "NCAAB" | "Soccer";
export type GameStatus = "upcoming" | "live" | "final";

export interface TeamSide {
  name: string;
  abbreviation: string;
  color: string;
  /** Decimal moneyline we pay out on. Null when the feed has no line. */
  odds: number | null;
  altColor: string | null;
  logoUrl: string | null;
  location: string | null;
  record: string | null;
  splitRecord: string | null;
  rank: number | null;
  form: Array<"W" | "L" | "D"> | null;
  pointsFor: number | null;
  pointsAgainst: number | null;
}

/** Live game state the scoreboard already carries. Only set while live. */
export interface LiveSituation {
  /** "3rd & 7 at KC 32" */
  downDistance: string | null;
  possession: "home" | "away" | null;
  redZone: boolean;
  balls: number | null;
  strikes: number | null;
  outs: number | null;
  onFirst: boolean;
  onSecond: boolean;
  onThird: boolean;
}

export interface Linescore {
  home: Array<number | null>;
  away: Array<number | null>;
}

export interface GameLine {
  spread: string | null;
  spreadHome: number | null;
  overUnder: number | null;
  provider: string | null;
}

export interface NormalizedGame {
  id: string;
  sport: Sport;
  sportIcon: string;
  status: GameStatus;
  /** Non-null when ESPN marks the fixture postponed or cancelled. */
  disrupted?: "postponed" | "canceled" | null;
  startsAt: number;
  startTimeLabel: string;
  homeScore: number | null;
  awayScore: number | null;
  homeTeam: TeamSide;
  awayTeam: TeamSide;
  /**
   * True only when both sides carry a moneyline from the feed. The bet
   * callables reject anything else, so this is the one switch that makes a
   * game bettable.
   */
  priced: boolean;
  /** Feed the prices came from ("ESPN BET", "DraftKings"), for attribution. */
  oddsProvider: string | null;
  /** "book" (feed moneyline), "model" (lib/oddsModel.ts) or null (unpriced). Set by syncGames. */
  oddsSource?: "book" | "model" | null;
  /** Model details when oddsSource is "model". */
  model?: { pHome: number; confidence: "low" | "medium" | "high"; version: string; pricedAt: number } | null;
  updatedAt: number;
  period: number | null;
  clock: string | null;
  /** Seconds remaining in the period (elapsed for soccer) while live. */
  clockSec?: number | null;
  situation: string | null;
  lastPlay: string | null;
  venue: string | null;
  city: string | null;
  neutralSite: boolean;
  broadcast: string | null;
  seasonLabel: string | null;
  line: GameLine | null;
  /** ESPN path the game came from ("soccer/eng.1"), so the summary can be fetched later. */
  providerPath: string;
  linescore: Linescore | null;
  live: LiveSituation | null;
}

interface SportConfig {
  sport: Sport;
  path: string;
  sportIcon: string;
  /** Competition name shown on the card when a sport spans several leagues. */
  label?: string;
}

const SPORT_CONFIGS: SportConfig[] = [
  { sport: "NFL", path: "football/nfl", sportIcon: "football" },
  { sport: "NBA", path: "basketball/nba", sportIcon: "basketball" },
  { sport: "MLB", path: "baseball/mlb", sportIcon: "baseball" },
  { sport: "NHL", path: "hockey/nhl", sportIcon: "hockey-puck" },
  { sport: "NCAAF", path: "football/college-football", sportIcon: "football" },
  { sport: "NCAAB", path: "basketball/mens-college-basketball", sportIcon: "basketball" },
  { sport: "Soccer", path: "soccer/eng.1", sportIcon: "soccer", label: "Premier League" },
  { sport: "Soccer", path: "soccer/esp.1", sportIcon: "soccer", label: "La Liga" },
  { sport: "Soccer", path: "soccer/ita.1", sportIcon: "soccer", label: "Serie A" },
  { sport: "Soccer", path: "soccer/ger.1", sportIcon: "soccer", label: "Bundesliga" },
  { sport: "Soccer", path: "soccer/fra.1", sportIcon: "soccer", label: "Ligue 1" },
  { sport: "Soccer", path: "soccer/uefa.champions", sportIcon: "soccer", label: "Champions League" },
  { sport: "Soccer", path: "soccer/usa.1", sportIcon: "soccer", label: "MLS" },
];

const BASE = "https://site.api.espn.com/apis/site/v2/sports";
export const ESPN_BASE = BASE;

/** Every provider path a sport can come from. Soccer spans several leagues. */
export function providerPathsFor(sport: Sport): string[] {
  return SPORT_CONFIGS.filter((c) => c.sport === sport).map((c) => c.path);
}

/** House margin applied when deriving decimal odds from a moneyline pair. */
const OVERROUND = 0.045;

/** Bounds. A 12.0x longshot is a credit-printing machine in a play economy. */
const MIN_ODDS = 1.15;
const MAX_ODDS = 6.0;

/* eslint-disable @typescript-eslint/no-explicit-any */

const round2 = (n: number) => Math.round(n * 100) / 100;
const clampOdds = (n: number) => round2(Math.min(MAX_ODDS, Math.max(MIN_ODDS, n)));

/** American moneyline to decimal. -150 -> 1.67, +180 -> 2.80. */
function moneylineToDecimal(ml: number): number | null {
  if (!Number.isFinite(ml) || ml === 0) return null;
  return ml > 0 ? 1 + ml / 100 : 1 + 100 / Math.abs(ml);
}

/**
 * Turns a book's two-way moneyline into the pair of decimal prices we pay out
 * on. The book's own vig is stripped first and a flat house margin applied, so
 * the app's edge is a single number set here rather than whatever the feed
 * happened to carry that day.
 */
export function priceMarket(
  homeMl: number | null,
  awayMl: number | null
): { home: number; away: number } | null {
  const h = homeMl !== null ? moneylineToDecimal(homeMl) : null;
  const a = awayMl !== null ? moneylineToDecimal(awayMl) : null;
  if (!h || !a || h <= 1 || a <= 1) return null;

  const pHome = 1 / h;
  const pAway = 1 / a;
  const total = pHome + pAway;
  if (!Number.isFinite(total) || total <= 0) return null;

  const fairHome = pHome / total;
  const fairAway = pAway / total;
  const scale = 1 + OVERROUND;

  return {
    home: clampOdds(1 / (fairHome * scale)),
    away: clampOdds(1 / (fairAway * scale)),
  };
}

function toColor(hex: string | undefined, fallback = "#4A90D9"): string {
  if (!hex) return fallback;
  const clean = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return fallback;
  // Pure white and pure black are ESPN's "we don't know" values and both
  // vanish against the app's surfaces.
  if (clean.toLowerCase() === "ffffff" || clean.toLowerCase() === "000000") return fallback;
  return `#${clean}`;
}

export function toDisrupted(name: string): "postponed" | "canceled" | null {
  if (name === "STATUS_POSTPONED" || name === "STATUS_SUSPENDED" || name === "STATUS_DELAYED") {
    return "postponed";
  }
  if (name === "STATUS_CANCELED" || name === "STATUS_CANCELLED" || name === "STATUS_ABANDONED") {
    return "canceled";
  }
  return null;
}

export function toStatus(name: string): GameStatus {
  if (
    name === "STATUS_IN_PROGRESS" ||
    name === "STATUS_HALFTIME" ||
    name === "STATUS_END_PERIOD" ||
    name === "STATUS_FIRST_HALF" ||
    name === "STATUS_SECOND_HALF"
  ) {
    return "live";
  }
  if (name === "STATUS_FINAL" || name === "STATUS_FULL_TIME" || name === "STATUS_FINAL_PEN") {
    return "final";
  }
  return "upcoming";
}

function formatStartTime(dateStr: string): string {
  try {
    return (
      new Date(dateStr).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: "America/New_York",
      }) + " ET"
    );
  } catch {
    return "TBD";
  }
}

/** ESPN gives soccer a "WWDLW" string; other leagues give nothing. */
function parseForm(raw: unknown): Array<"W" | "L" | "D"> | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const out = raw
    .toUpperCase()
    .split("")
    .filter((ch): ch is "W" | "L" | "D" => ch === "W" || ch === "L" || ch === "D");
  return out.length ? out.slice(0, 5) : null;
}

function findRecord(records: any[], ...names: string[]): string | null {
  for (const name of names) {
    const hit = records.find(
      (r) => String(r?.name ?? r?.type ?? "").toLowerCase() === name.toLowerCase()
    );
    if (hit?.summary) return String(hit.summary);
  }
  return null;
}

function findStat(records: any[], statName: string): number | null {
  for (const r of records ?? []) {
    const stat = (r?.stats ?? []).find((s: any) => s?.name === statName);
    if (stat && Number.isFinite(Number(stat.value))) return round2(Number(stat.value));
  }
  return null;
}

function buildTeam(competitor: any, odds: number | null, homeAway: "home" | "away"): TeamSide {
  const team = competitor?.team ?? {};
  const records: any[] = competitor?.records ?? [];

  return {
    name: team.displayName ?? team.name ?? (homeAway === "home" ? "Home" : "Away"),
    abbreviation: team.abbreviation ?? team.shortDisplayName?.slice(0, 3)?.toUpperCase() ?? "TBD",
    color: toColor(team.color),
    altColor: team.alternateColor ? toColor(team.alternateColor, "#FFFFFF") : null,
    odds,
    // Official team logos are trademarked; the app renders colour + abbreviation instead.
    logoUrl: null,
    location: team.location ?? null,
    record: findRecord(records, "overall", "total"),
    splitRecord: findRecord(records, homeAway === "home" ? "Home" : "Road", homeAway === "home" ? "home" : "away"),
    rank: Number.isFinite(Number(competitor?.curatedRank?.current))
      ? Number(competitor.curatedRank.current)
      : null,
    form: parseForm(competitor?.form),
    pointsFor: findStat(records, "avgPointsFor"),
    pointsAgainst: findStat(records, "avgPointsAgainst"),
  };
}

function buildLine(comp: any): GameLine | null {
  const odds = comp?.odds?.[0];
  if (!odds) return null;
  return {
    spread: odds.details ?? null,
    spreadHome: Number.isFinite(Number(odds.spread)) ? Number(odds.spread) : null,
    overUnder: Number.isFinite(Number(odds.overUnder)) ? Number(odds.overUnder) : null,
    provider: odds.provider?.name ?? null,
  };
}

function buildBroadcast(comp: any): string | null {
  const names: string[] = comp?.broadcasts?.[0]?.names ?? [];
  if (names.length) return names.join(" / ");
  const geo = comp?.geoBroadcasts?.[0]?.media?.shortName;
  return geo ?? null;
}

function buildClock(
  event: any,
  status: GameStatus
): { period: number | null; clock: string | null; clockSec: number | null } {
  if (status !== "live") return { period: null, clock: null, clockSec: null };
  const s = event?.status ?? {};
  const period = Number.isFinite(Number(s.period)) ? Number(s.period) : null;
  // shortDetail is already league-appropriate: "Q3 4:12", "Top 7th", "78'".
  const clock = s.type?.shortDetail ?? (s.displayClock ? String(s.displayClock) : null);
  const clockSec = Number.isFinite(Number(s.clock)) ? Number(s.clock) : null;
  return { period, clock, clockSec };
}

/** ESPN sends moneylines as numbers or strings ("+135", "EVEN", ""). */
function moneyline(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "string" && raw.trim().toUpperCase() === "EVEN") return 100;
  const n = Number(typeof raw === "string" ? raw.replace(/^\+/, "") : raw);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/**
 * ESPN has shipped the moneyline in more than one shape: the older
 * `homeTeamOdds.moneyLine` number, and the newer
 * `moneyline.home.close.odds` string ("-238", "+195", "EVEN", "OFF"). Now that
 * there is no synthetic fallback, reading only one shape would quietly make
 * every game unbettable, so every known shape is tried, closing line first.
 */
export function extractMoneylines(bookOdds: any): { home: number | null; away: number | null } {
  const pick = (side: "home" | "away"): number | null => {
    const teamOdds = bookOdds?.[side === "home" ? "homeTeamOdds" : "awayTeamOdds"];
    const ml = bookOdds?.moneyline?.[side];
    for (const raw of [
      teamOdds?.moneyLine,
      ml?.close?.odds,
      ml?.current?.odds,
      ml?.open?.odds,
      teamOdds?.current?.moneyLine?.american,
      teamOdds?.close?.moneyLine?.american,
    ]) {
      const n = moneyline(raw);
      if (n !== null) return n;
    }
    return null;
  };
  return { home: pick("home"), away: pick("away") };
}

const finiteOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isFinite(n) ? n : null;
};

function buildLinescore(home: any, away: any): Linescore | null {
  const h: Array<number | null> = (home?.linescores ?? []).map((l: any) => finiteOrNull(l?.value ?? l?.displayValue));
  const a: Array<number | null> = (away?.linescores ?? []).map((l: any) => finiteOrNull(l?.value ?? l?.displayValue));
  const n = Math.max(h.length, a.length);
  if (!n) return null;
  while (h.length < n) h.push(null);
  while (a.length < n) a.push(null);
  return { home: h, away: a };
}

function buildSituation(comp: any, home: any, away: any, status: GameStatus): LiveSituation | null {
  const s = comp?.situation;
  if (status !== "live" || !s) return null;
  const pos = s.possession != null ? String(s.possession) : null;
  return {
    downDistance: typeof s.downDistanceText === "string" ? s.downDistanceText : null,
    possession: pos && pos === String(home?.team?.id ?? home?.id) ? "home" : pos && pos === String(away?.team?.id ?? away?.id) ? "away" : null,
    redZone: Boolean(s.isRedZone),
    balls: finiteOrNull(s.balls),
    strikes: finiteOrNull(s.strikes),
    outs: finiteOrNull(s.outs),
    onFirst: Boolean(s.onFirst),
    onSecond: Boolean(s.onSecond),
    onThird: Boolean(s.onThird),
  };
}

export function parseEvent(
  event: any,
  sport: Sport,
  sportIcon: string,
  seasonLabel: string | null,
  providerPath: string
): NormalizedGame | null {
  const comp = event?.competitions?.[0];
  if (!comp) return null;

  const competitors: any[] = comp.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");
  if (!home || !away) return null;

  const rawStatusName = event.status?.type?.name ?? "STATUS_SCHEDULED";
  const disrupted = toDisrupted(rawStatusName);
  const status = disrupted ? "upcoming" : toStatus(rawStatusName);
  const scored = status !== "upcoming";

  const bookOdds = comp.odds?.[0];
  const ml = extractMoneylines(bookOdds);
  const prices = disrupted ? null : priceMarket(ml.home, ml.away);

  const { period, clock, clockSec } = buildClock(event, status);

  return {
    id: `${sport}:${event.id}`,
    sport,
    sportIcon,
    status,
    disrupted,
    startsAt: Date.parse(event.date) || 0,
    startTimeLabel:
      disrupted === "postponed"
        ? "POSTPONED"
        : disrupted === "canceled"
          ? "CANCELLED"
          : status === "live"
            ? (clock ?? "LIVE")
            : formatStartTime(event.date),
    homeScore: scored ? Number.parseInt(home.score ?? "0", 10) : null,
    awayScore: scored ? Number.parseInt(away.score ?? "0", 10) : null,
    homeTeam: buildTeam(home, prices?.home ?? null, "home"),
    awayTeam: buildTeam(away, prices?.away ?? null, "away"),
    priced: prices !== null,
    oddsProvider: prices ? (bookOdds?.provider?.name ?? "ESPN") : null,
    period,
    clock,
    clockSec,
    situation: comp.status?.type?.detail ?? null,
    lastPlay: comp.situation?.lastPlay?.text ?? null,
    venue: comp.venue?.fullName ?? null,
    city: comp.venue?.address?.city ?? null,
    neutralSite: Boolean(comp.neutralSite),
    broadcast: buildBroadcast(comp),
    seasonLabel,
    line: disrupted ? null : buildLine(comp),
    providerPath,
    linescore: scored ? buildLinescore(home, away) : null,
    live: buildSituation(comp, home, away, status),
    updatedAt: Date.now(),
  };
}

function seasonLabelFor(data: any, cfg: SportConfig): string | null {
  const week = data?.week?.number;
  const base = Number.isFinite(Number(week))
    ? cfg.sport === "Soccer"
      ? `Matchday ${week}`
      : `Week ${week}`
    : (data?.leagues?.[0]?.season?.type?.name ?? null);
  if (!cfg.label) return base;
  return base ? `${cfg.label} · ${base}` : cfg.label;
}

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");

/**
 * The scoreboard for yesterday through the next week. Without `dates`, ESPN
 * returns only its idea of "today" (or the current NFL week), so a game drops
 * out of the feed before it can be seen to finish, and the board has nothing
 * beyond tonight. Falls back to the default board if the range is refused.
 */
async function fetchScoreboard(cfg: SportConfig, now = Date.now()) {
  const range = `${ymd(now - 86_400_000)}-${ymd(now + 7 * 86_400_000)}`;
  for (const query of [`?dates=${range}&limit=300`, ""]) {
    const res = await fetch(`${BASE}/${cfg.path}/scoreboard${query}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      if (query) continue;
      throw new Error(`ESPN ${cfg.sport} ${res.status}`);
    }
    const data = (await res.json()) as { events?: unknown[] };
    if (query && !(data.events ?? []).length) continue;
    return data;
  }
  return { events: [] };
}

async function fetchSport(cfg: SportConfig): Promise<NormalizedGame[]> {
  const data = await fetchScoreboard(cfg);
  const label = seasonLabelFor(data, cfg);

  return (data.events ?? [])
    .map((e) => parseEvent(e, cfg.sport, cfg.sportIcon, label, cfg.path))
    .filter((g): g is NormalizedGame => g !== null);
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Provider interface
// ---------------------------------------------------------------------------

export interface FetchResult {
  games: NormalizedGame[];
  /** One entry per sport/competition that failed this cycle. */
  failures: string[];
}

/**
 * What syncGames needs from a feed. An implementation must:
 *  - namespace ids as `SPORT:providerEventId`
 *  - set `priced: true` only when both sides carry a decimal price > 1
 *  - tolerate partial failure (report it in `failures`, keep the rest)
 */
export interface SportsDataProvider {
  readonly name: string;
  /** `sports` limits the pass (live refresh); omitted = every configured sport. */
  fetchGames(sports?: ReadonlySet<Sport>): Promise<FetchResult>;
}

/** Free ESPN scoreboard. Moneylines only when ESPN's partner book posts one. */
export const espnProvider: SportsDataProvider = {
  name: "espn",
  async fetchGames(sports) {
    const configs = sports ? SPORT_CONFIGS.filter((c) => sports.has(c.sport)) : SPORT_CONFIGS;
    const results = await Promise.allSettled(configs.map(fetchSport));
    const games: NormalizedGame[] = [];
    const failures: string[] = [];

    results.forEach((r, i) => {
      if (r.status === "fulfilled") games.push(...r.value);
      else failures.push(`${configs[i]?.label ?? configs[i]?.sport}: ${String(r.reason)}`);
    });

    return { games, failures };
  },
};

/** The feed syncGames reads. Change this line to swap providers. */
export const activeProvider: SportsDataProvider = espnProvider;

/** One pass across every configured sport. Partial failures are tolerated. */
export function fetchGames(sports?: ReadonlySet<Sport>): Promise<FetchResult> {
  return activeProvider.fetchGames(sports);
}
