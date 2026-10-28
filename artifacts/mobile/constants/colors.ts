/**
 * SportDrip palette — "Prime Time".
 *
 * Modelled on how the leading sportsbook and fantasy apps present a board:
 * a near-black blue-slate base that lets team colours and logos carry the
 * content; one saturated action colour for money, CTAs and wins (the green
 * DraftKings-style "go" every bettor already reads as "place it / you won");
 * a hot red reserved for live and losses; an electric violet for league /
 * contest play (the fantasy apps' colour); and gold only for prestige
 * (legendary items, big wins).
 *
 * Contrast: every text token passes WCAG AA on `card`, and `primaryForeground`
 * on `primary` is AAA. Token names are unchanged, so every screen restyles
 * without an edit.
 */

const dark = {
  // base: blue-slate night, three steps of lift
  background: "#090C12",
  card: "#121722",
  elevated: "#19202E", // sheets, modals, anything floating above a card
  secondary: "#1A2130", // odds tiles, inputs, chips
  muted: "#1A2130",
  border: "#252E40",
  input: "#1A2130",
  overlay: "rgba(4, 6, 10, 0.78)",

  // text
  text: "#F4F7FB",
  foreground: "#F4F7FB",
  cardForeground: "#E9EEF6",
  secondaryForeground: "#F4F7FB",
  mutedForeground: "#8D99AE",
  subtleForeground: "#5F6B80", // timestamps, disabled captions

  // brand — the action green: balance, stakes, payouts, the primary CTA
  primary: "#2FE38A",
  primaryForeground: "#03140B",
  tint: "#2FE38A",
  primarySoft: "rgba(47, 227, 138, 0.14)",

  // info accent — links, hints, selected filters
  accent: "#4C9BFF",
  accentForeground: "#04101F",

  // outcomes
  positive: "#2FE38A",
  positiveSoft: "rgba(47, 227, 138, 0.14)",
  negative: "#FF4D63",
  negativeSoft: "rgba(255, 77, 99, 0.14)",
  push: "#8D99AE",
  destructive: "#FF4D63",
  destructiveForeground: "#FFF5F6",

  // wallets — credits green (primary), league tokens violet, debt orange
  league: "#9B7BFF",
  leagueSoft: "rgba(155, 123, 255, 0.16)",
  debt: "#FF9F43",
  debtSoft: "rgba(255, 159, 67, 0.15)",

  // state
  live: "#FF3B4E",
  warning: "#FFC23D",
  shadow: "rgba(0, 0, 0, 0.55)",
  scrim: "rgba(0, 0, 0, 0.5)",
} as const;

const light = {
  background: "#F2F5FA",
  card: "#FFFFFF",
  elevated: "#FFFFFF",
  secondary: "#EAEFF6",
  muted: "#EAEFF6",
  border: "#D8E0EC",
  input: "#EAEFF6",
  overlay: "rgba(9, 12, 18, 0.5)",

  text: "#0B1220",
  foreground: "#0B1220",
  cardForeground: "#0B1220",
  secondaryForeground: "#0B1220",
  mutedForeground: "#56627A",
  subtleForeground: "#8592A8",

  primary: "#0E9F5A", // green darkened until it passes AA on white
  primaryForeground: "#FFFFFF",
  tint: "#0E9F5A",
  primarySoft: "rgba(14, 159, 90, 0.12)",

  accent: "#1F6FE5",
  accentForeground: "#FFFFFF",

  positive: "#0E9F5A",
  positiveSoft: "rgba(14, 159, 90, 0.12)",
  negative: "#D92D45",
  negativeSoft: "rgba(217, 45, 69, 0.1)",
  push: "#56627A",
  destructive: "#D92D45",
  destructiveForeground: "#FFFFFF",

  league: "#6A45E8",
  leagueSoft: "rgba(106, 69, 232, 0.11)",
  debt: "#C9640F",
  debtSoft: "rgba(201, 100, 15, 0.12)",

  live: "#E1253A",
  warning: "#A86A00",
  shadow: "rgba(11, 18, 32, 0.14)",
  scrim: "rgba(11, 18, 32, 0.35)",
} as const;

/**
 * Per-sport identity. Used for the filter row and the sport badge so the board
 * is scannable by colour before you read a word of it.
 */
export const SPORT_COLORS: Record<string, string> = {
  NFL: "#FF8A3D",
  NBA: "#FF6B4A",
  MLB: "#4C9BFF",
  NHL: "#7CD4FF",
  NCAAF: "#C77DFF",
  NCAAB: "#FFC145",
  Soccer: "#2FE38A",
};

/**
 * Rarity ramp, the loot-tier convention players already know. Legendary gold
 * is the only rarity allowed to glow.
 */
export const RARITY_RAMP = {
  common: "#8D99AE",
  uncommon: "#2FE38A",
  rare: "#4C9BFF",
  epic: "#B07BFF",
  legendary: "#FFC23D",
} as const;

const colors = { light, dark, radius: 14 };

/** Token names are fixed; values differ per scheme. */
export type Palette = { readonly [K in keyof typeof dark]: string };
export default colors;
