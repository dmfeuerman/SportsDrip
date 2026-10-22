/**
 * SportDrip palette — "floodlit turf".
 *
 * The old scheme was near-black #0B0F19 with acid green #00E87A on everything:
 * balance, CTAs, wins, active tabs, section accents. Two problems. The green
 * fought every team colour on the board (teams are the content here, and the
 * chrome was louder than they were), and one colour carrying both "money" and
 * "you won" left nothing to distinguish them.
 *
 * This palette is built from the subject: a pitch under sodium floodlights.
 * Bases are ink with a green cast rather than a blue one, so team blues and
 * reds read as foreign objects on top of grass instead of blending into a navy
 * app. Money is scoreboard amber and is the only place that colour appears.
 * Results are turf green and clay red — legible next to each other and never
 * confused with a balance.
 *
 * Every key from the previous file is still here, so screens that already read
 * `colors.primary` / `colors.card` / `colors.border` restyle with no edit. New
 * tokens (positive, negative, live, elevated, overlay, …) are additive.
 */

const dark = {
  // base
  background: "#101614", // turf ink
  card: "#19211E",
  elevated: "#212B27", // sheets, modals, anything floating above a card
  secondary: "#1E2723",
  muted: "#1E2723",
  border: "#2C3833",
  input: "#1E2723",
  overlay: "rgba(8, 12, 11, 0.72)",

  // text
  text: "#F2F5F1",
  foreground: "#F2F5F1", // chalk
  cardForeground: "#F2F5F1",
  secondaryForeground: "#F2F5F1",
  mutedForeground: "#8FA098",
  subtleForeground: "#63736C", // timestamps, disabled captions

  // brand — amber is money. It appears on the balance, on a stake, on a
  // payout, and on the one primary action per screen. Nowhere else.
  primary: "#FFB03A",
  primaryForeground: "#171008",
  tint: "#FFB03A",
  primarySoft: "rgba(255, 176, 58, 0.14)",

  // secondary accent — informational only (links, hints, neutral highlights)
  accent: "#5AA9E6",
  accentForeground: "#0A1520",

  // outcomes
  positive: "#43C67F",
  positiveSoft: "rgba(67, 198, 127, 0.14)",
  negative: "#E2564A",
  negativeSoft: "rgba(226, 86, 74, 0.14)",
  push: "#8FA098",
  destructive: "#E2564A",
  destructiveForeground: "#FFF6F5",

  // wallets — credits are amber (primary); league tokens are floodlight blue,
  // debt is clay. Three currencies, three colours, never swapped.
  league: "#5AA9E6",
  leagueSoft: "rgba(90, 169, 230, 0.14)",
  debt: "#E0875A",
  debtSoft: "rgba(224, 135, 90, 0.14)",

  // state
  live: "#FF4D2E", // only ever the live pulse; not reused for errors
  warning: "#E8A33D",
  shadow: "rgba(0, 0, 0, 0.5)",
  scrim: "rgba(0, 0, 0, 0.45)",
} as const;

const light = {
  background: "#F3F6F2",
  card: "#FFFFFF",
  elevated: "#FFFFFF",
  secondary: "#E9EEE9",
  muted: "#E9EEE9",
  border: "#D9E1DA",
  input: "#E9EEE9",
  overlay: "rgba(16, 22, 20, 0.45)",

  text: "#101614",
  foreground: "#101614",
  cardForeground: "#101614",
  secondaryForeground: "#101614",
  mutedForeground: "#5B6B63",
  subtleForeground: "#84948C",

  primary: "#B4700A", // amber darkened until it passes AA on white
  primaryForeground: "#FFFFFF",
  tint: "#B4700A",
  primarySoft: "rgba(180, 112, 10, 0.12)",

  accent: "#1E6FA8",
  accentForeground: "#FFFFFF",

  positive: "#18754C",
  positiveSoft: "rgba(24, 117, 76, 0.12)",
  negative: "#B23A2E",
  negativeSoft: "rgba(178, 58, 46, 0.12)",
  push: "#5B6B63",
  destructive: "#B23A2E",
  destructiveForeground: "#FFFFFF",

  league: "#1E6FA8",
  leagueSoft: "rgba(30, 111, 168, 0.12)",
  debt: "#A8501F",
  debtSoft: "rgba(168, 80, 31, 0.12)",

  live: "#D93A1C",
  warning: "#9A6A11",
  shadow: "rgba(16, 22, 20, 0.14)",
  scrim: "rgba(16, 22, 20, 0.35)",
} as const;

/**
 * Per-sport identity. Used for the filter row and the sport badge so the board
 * is scannable by colour before you read a word of it.
 */
export const SPORT_COLORS: Record<string, string> = {
  NFL: "#C4703B",
  NBA: "#D96A4A",
  MLB: "#4F86C6",
  NHL: "#7FA6B8",
  Soccer: "#43C67F",
};

/**
 * Rarity ramp, retuned so it sits on the turf base instead of the old blue one.
 * Legendary is deliberately the only rarity allowed to glow.
 */
export const RARITY_RAMP = {
  common: "#8FA098",
  uncommon: "#43C67F",
  rare: "#5AA9E6",
  epic: "#A57BE0",
  legendary: "#FFB03A",
} as const;

const colors = { light, dark, radius: 14 };

/** Token names are fixed; values differ per scheme. */
export type Palette = { readonly [K in keyof typeof dark]: string };
export default colors;
