/**
 * League rules. Mirrors artifacts/mobile/constants/leagueTypes.ts, but this is
 * the copy that is enforced — the client's copy only drives the pickers.
 */

export const SPORTS = ["NFL", "NBA", "MLB", "NHL", "Soccer"] as const;
export const DURATIONS = { "1 Week": 7, "2 Weeks": 14, "1 Month": 30, "3 Months": 90 } as const;
export type Duration = keyof typeof DURATIONS;

export const TOKEN_START_OPTIONS = [1_000, 5_000, 10_000, 25_000, 50_000] as const;
export const BUY_IN_OPTIONS = [0, 100, 250, 500, 1_000] as const;

export const PRIZE_PRESETS = {
  "winner-all": { firstPct: 100, secondPct: 0, thirdPct: 0 },
  "top-2": { firstPct: 70, secondPct: 30, thirdPct: 0 },
  "top-3": { firstPct: 60, secondPct: 30, thirdPct: 10 },
} as const;

export const MAX_MEMBERS = 50;
export const MIN_LEAGUE_STAKE = 10;

/** Bank: rate is percent of outstanding principal per interval. */
export const BANK_RATE_MIN = 0.5;
export const BANK_RATE_MAX = 50;
export const BANK_INTERVAL_MIN_H = 1;
export const BANK_INTERVAL_MAX_H = 168;
/**
 * Total outstanding bank principal a member may carry, as a multiple of the
 * league's starting tokens. Unlimited borrowing turned the bank into infinite
 * leverage: borrow a billion, bet it, keep the win.
 */
export const BANK_PRINCIPAL_CAP_MULTIPLIER = 1;

/** Peer loans: the request form always said "Max 50% of starting tokens". */
export const PEER_LOAN_MAX_PCT = 0.5;
export const PEER_RATE_MAX = 50;
export const MAX_OPEN_REQUESTS = 3;

export const MEMBER_COLORS = [
  "#E2564A", "#43C67F", "#5AA9E6", "#A57BE0", "#FFB03A",
  "#E07BB5", "#4FC1B9", "#C4703B", "#8FA0E6", "#B8C94A",
];

/** No 0/O/1/I — codes get read aloud and typed from screenshots. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomCode(len = 6): string {
  let out = "";
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}
