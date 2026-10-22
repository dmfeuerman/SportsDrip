/**
 * Sports data provider adapter.
 *
 * The rest of the codebase only knows about `NormalizedGame`. Swapping ESPN for
 * a paid feed means replacing the body of `fetchGames` and nothing else.
 *
 * This runs server-side on a schedule, so there is exactly one upstream request
 * per sport per cycle for the whole user base — not one per device.
 *
 * This revision extracts everything the scoreboard already returns and the app
 * was throwing away: logos, records, ranks, venue, broadcast, live clock and
 * situation, the posted spread and total, and — the significant one — the
 * actual moneyline. Odds used to be a hash of the event id, which meant the
 * "2.31x" on a mismatch was decoration. Where a book line exists it is now
 * used, with the hash kept only as a fallback so a game never becomes
 * unbettable because the odds feed is thin.
 *
 * Every new field is optional on the way out. Documents keep merging, and the
 * client renders whatever is present.
 */

export type Sport = "NFL" | "NBA" | "MLB" | "NHL" | "Soccer";
export type GameStatus = "upcoming" | "live" | "final";

export interface TeamSide {
  name: string;
  abbreviation: string;
  color: string;
  odds: number;
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
  startsAt: number;
  startTimeLabel: string;
  homeScore: number | null;
  awayScore: number | null;
  homeTeam: TeamSide;
  awayTeam: TeamSide;
  updatedAt: number;
  period: number | null;
  clock: string | null;
  situation: string | null;
  lastPlay: string | null;
  venue: string | null;
  city: string | null;
  neutralSite: boolean;
  broadcast: string | null;
  seasonLabel: string | null;
  line: GameLine | null;
}

const SPORT_CONFIGS: Array<{ sport: Sport; path: string; sportIcon: string }> = [
  { sport: "NFL", path: "football/nfl", sportIcon: "football" },
  { sport: "NBA", path: "basketball/nba", sportIcon: "basketball" },
  { sport: "MLB", path: "baseball/mlb", sportIcon: "baseball" },
  { sport: "NHL", path: "hockey/nhl", sportIcon: "hockey-puck" },
  { sport: "Soccer", path: "soccer/eng.1", sportIcon: "soccer" },
];

const BASE = "https://site.api.espn.com/apis/site/v2/sports";

/** House margin applied when deriving decimal odds from a moneyline pair. */
const OVERROUND = 0.045;

/** Bounds. A 12.0x longshot is a credit-printing machine in a play economy. */
const MIN_ODDS = 1.15;
const MAX_ODDS = 6.0;

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Deterministic fallback price. Unchanged from the original so payouts stay
 * consistent for sports and fixtures where no book line is published.
 */
function seededOdds(seed: string, min = 1.4, max = 2.9): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = Math.imul(31, h) + seed.charCodeAt(i);
  h = Math.abs(h >>> 0);
  return round2(min + ((h % 1000) / 1000) * (max - min));
}

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
function priceMarket(
  homeMl: number | null,
  awayMl: number | null,
  seed: string
): { home: number; away: number } {
  const h = homeMl !== null ? moneylineToDecimal(homeMl) : null;
  const a = awayMl !== null ? moneylineToDecimal(awayMl) : null;

  if (!h || !a) {
    return { home: seededOdds(seed + "home"), away: seededOdds(seed + "away", 1.6, 3.0) };
  }

  const pHome = 1 / h;
  const pAway = 1 / a;
  const total = pHome + pAway;
  if (total <= 0) {
    return { home: seededOdds(seed + "home"), away: seededOdds(seed + "away", 1.6, 3.0) };
  }

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

function toStatus(name: string): GameStatus {
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

function buildTeam(competitor: any, odds: number, homeAway: "home" | "away"): TeamSide {
  const team = competitor?.team ?? {};
  const records: any[] = competitor?.records ?? [];

  return {
    name: team.displayName ?? team.name ?? (homeAway === "home" ? "Home" : "Away"),
    abbreviation: team.abbreviation ?? team.shortDisplayName?.slice(0, 3)?.toUpperCase() ?? "TBD",
    color: toColor(team.color),
    altColor: team.alternateColor ? toColor(team.alternateColor, "#FFFFFF") : null,
    odds,
    logoUrl: team.logo ?? team.logos?.[0]?.href ?? null,
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

function buildClock(event: any, status: GameStatus): { period: number | null; clock: string | null } {
  if (status !== "live") return { period: null, clock: null };
  const s = event?.status ?? {};
  const period = Number.isFinite(Number(s.period)) ? Number(s.period) : null;
  // shortDetail is already league-appropriate: "Q3 4:12", "Top 7th", "78'".
  const clock = s.type?.shortDetail ?? (s.displayClock ? String(s.displayClock) : null);
  return { period, clock };
}

function parseEvent(
  event: any,
  sport: Sport,
  sportIcon: string,
  seasonLabel: string | null
): NormalizedGame | null {
  const comp = event?.competitions?.[0];
  if (!comp) return null;

  const competitors: any[] = comp.competitors ?? [];
  const home = competitors.find((c) => c.homeAway === "home");
  const away = competitors.find((c) => c.homeAway === "away");
  if (!home || !away) return null;

  const status = toStatus(event.status?.type?.name ?? "STATUS_SCHEDULED");
  const scored = status !== "upcoming";

  const bookOdds = comp.odds?.[0];
  const prices = priceMarket(
    Number.isFinite(Number(bookOdds?.homeTeamOdds?.moneyLine))
      ? Number(bookOdds.homeTeamOdds.moneyLine)
      : null,
    Number.isFinite(Number(bookOdds?.awayTeamOdds?.moneyLine))
      ? Number(bookOdds.awayTeamOdds.moneyLine)
      : null,
    String(event.id)
  );

  const { period, clock } = buildClock(event, status);

  return {
    id: `${sport}:${event.id}`,
    sport,
    sportIcon,
    status,
    startsAt: Date.parse(event.date) || 0,
    startTimeLabel:
      status === "live" ? (clock ?? "LIVE") : formatStartTime(event.date),
    homeScore: scored ? Number.parseInt(home.score ?? "0", 10) : null,
    awayScore: scored ? Number.parseInt(away.score ?? "0", 10) : null,
    homeTeam: buildTeam(home, prices.home, "home"),
    awayTeam: buildTeam(away, prices.away, "away"),
    period,
    clock,
    situation: comp.status?.type?.detail ?? null,
    lastPlay: comp.situation?.lastPlay?.text ?? null,
    venue: comp.venue?.fullName ?? null,
    city: comp.venue?.address?.city ?? null,
    neutralSite: Boolean(comp.neutralSite),
    broadcast: buildBroadcast(comp),
    seasonLabel,
    line: buildLine(comp),
    updatedAt: Date.now(),
  };
}

function seasonLabelFor(data: any, sport: Sport): string | null {
  const week = data?.week?.number;
  if (Number.isFinite(Number(week))) {
    return sport === "Soccer" ? `Matchday ${week}` : `Week ${week}`;
  }
  return data?.leagues?.[0]?.season?.type?.name ?? null;
}

async function fetchSport(cfg: (typeof SPORT_CONFIGS)[number]): Promise<NormalizedGame[]> {
  const res = await fetch(`${BASE}/${cfg.path}/scoreboard`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`ESPN ${cfg.sport} ${res.status}`);

  const data = (await res.json()) as { events?: unknown[] };
  const label = seasonLabelFor(data, cfg.sport);

  return (data.events ?? [])
    .map((e) => parseEvent(e, cfg.sport, cfg.sportIcon, label))
    .filter((g): g is NormalizedGame => g !== null);
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/** One pass across every configured sport. Partial failures are tolerated. */
export async function fetchGames(): Promise<{ games: NormalizedGame[]; failures: string[] }> {
  const results = await Promise.allSettled(SPORT_CONFIGS.map(fetchSport));
  const games: NormalizedGame[] = [];
  const failures: string[] = [];

  results.forEach((r, i) => {
    if (r.status === "fulfilled") games.push(...r.value);
    else failures.push(`${SPORT_CONFIGS[i]?.sport}: ${String(r.reason)}`);
  });

  return { games, failures };
}
