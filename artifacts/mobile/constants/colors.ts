/**
 * Colour schemes. Token names are identical across every scheme, so a scheme
 * swap restyles every screen without an edit. Keep values 6-digit hex where
 * screens concatenate alpha suffixes (primary, accent, etc.).
 *
 *   houseBlack  default. Sportsbook-black neutrals with chip gold as the one
 *               action colour, blue for info. Brand gold, DraftKings layering.
 *   nightGame   DraftKings-inspired: black + volt green action, orange accent.
 *   blueChip    FanDuel-inspired: deep navy + bright blue action, gold accent.
 *   afterDark   Sleeper-inspired: indigo night + cyan action, pink accent.
 *   felt        the original "High Roller Felt": casino greens + chip gold.
 *
 * Night Game and After Dark are level unlocks (unlockLevel).
 *
 * In every scheme: win green / loss red are the only outcome hues, league
 * tokens are violet, debt is orange, and live is never the loss red.
 */

const dark = {
  // base: deep felt, three steps of lift
  background: "#062A1D",
  card: "#0B3D2E",
  elevated: "#0F4836", // sheets, modals, anything floating above a card
  secondary: "#124C3A", // odds tiles, inputs, chips
  muted: "#124C3A",
  border: "#1B5E48",
  input: "#124C3A",
  overlay: "rgba(2, 16, 11, 0.8)",

  // text
  text: "#FFF8E1",
  foreground: "#FFF8E1",
  cardForeground: "#F6EED6",
  secondaryForeground: "#FFF8E1",
  mutedForeground: "#9FB8AC",
  subtleForeground: "#6E8B7E", // timestamps, disabled captions

  // brand: chip gold for balance, stakes, payouts, the primary CTA
  primary: "#F5C542",
  primaryForeground: "#062A1D",
  tint: "#F5C542",
  primarySoft: "rgba(245, 197, 66, 0.14)",

  // info accent: links, hints, selected filters
  accent: "#5AB8FF",
  accentForeground: "#04101F",

  // outcomes
  positive: "#2EE6A6",
  positiveSoft: "rgba(46, 230, 166, 0.14)",
  negative: "#FF5A5F",
  negativeSoft: "rgba(255, 90, 95, 0.14)",
  push: "#9FB8AC",
  destructive: "#FF5A5F",
  destructiveForeground: "#FFF5F6",

  // wallets: credits gold (primary), league tokens violet, debt orange
  league: "#A98BFF",
  leagueSoft: "rgba(169, 139, 255, 0.16)",
  debt: "#FF9F43",
  debtSoft: "rgba(255, 159, 67, 0.15)",

  // state
  // Live is its own hue (pending blue), never the loss red.
  live: "#5AB8FF",
  warning: "#FFB547",
  shadow: "rgba(0, 0, 0, 0.55)",
  scrim: "rgba(0, 0, 0, 0.5)",
} as const;

const light = {
  background: "#F7F3EA",
  card: "#FFFFFF",
  elevated: "#FFFFFF",
  secondary: "#EFE9DA",
  muted: "#EFE9DA",
  border: "#E0D8C3",
  input: "#EFE9DA",
  overlay: "rgba(6, 42, 29, 0.5)",

  text: "#0B241A",
  foreground: "#0B241A",
  cardForeground: "#0B241A",
  secondaryForeground: "#0B241A",
  mutedForeground: "#5B6F65",
  subtleForeground: "#87988F",

  primary: "#0F5A3F", // felt green; gold fails AA on cream
  primaryForeground: "#FFF8E1",
  tint: "#0F5A3F",
  primarySoft: "rgba(15, 90, 63, 0.12)",

  accent: "#1F6FE5",
  accentForeground: "#FFFFFF",

  positive: "#0E8A55",
  positiveSoft: "rgba(14, 138, 85, 0.12)",
  negative: "#D93A40",
  negativeSoft: "rgba(217, 58, 64, 0.1)",
  push: "#5B6F65",
  destructive: "#D93A40",
  destructiveForeground: "#FFFFFF",

  league: "#6A45E8",
  leagueSoft: "rgba(106, 69, 232, 0.11)",
  debt: "#C9640F",
  debtSoft: "rgba(201, 100, 15, 0.12)",

  live: "#1F78C8",
  warning: "#A86A00",
  shadow: "rgba(11, 36, 26, 0.14)",
  scrim: "rgba(11, 36, 26, 0.35)",
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
  Soccer: "#2EE6A6",
};

/**
 * Rarity ramp, the loot-tier convention players already know. Legendary gold
 * is the only rarity allowed to glow.
 */
export const RARITY_RAMP = {
  common: "#8D99AE",
  uncommon: "#2EE6A6",
  rare: "#4C9BFF",
  epic: "#B07BFF",
  legendary: "#F5C542",
} as const;

/** Token names are fixed; values differ per scheme. */
export type Palette = { readonly [K in keyof typeof dark]: string };

/** Shared outcome / wallet hues for the black- and navy-based dark schemes. */
const darkShared = {
  positive: "#2BD67B",
  positiveSoft: "rgba(43, 214, 123, 0.14)",
  negative: "#FF4D5E",
  negativeSoft: "rgba(255, 77, 94, 0.14)",
  destructive: "#FF4D5E",
  destructiveForeground: "#FFF5F6",
  league: "#A98BFF",
  leagueSoft: "rgba(169, 139, 255, 0.16)",
  debt: "#FF9F43",
  debtSoft: "rgba(255, 159, 67, 0.15)",
  warning: "#FFB547",
  shadow: "rgba(0, 0, 0, 0.6)",
  scrim: "rgba(0, 0, 0, 0.55)",
} as const;

/** Neutral light base (cool grey page, white cards) shared by the new schemes. */
const lightShared = {
  background: "#F3F5F8",
  card: "#FFFFFF",
  elevated: "#FFFFFF",
  secondary: "#E9EDF2",
  muted: "#E9EDF2",
  border: "#D9DFE7",
  input: "#E9EDF2",
  overlay: "rgba(10, 14, 20, 0.5)",
  text: "#0D1117",
  foreground: "#0D1117",
  cardForeground: "#0D1117",
  secondaryForeground: "#0D1117",
  mutedForeground: "#566170",
  subtleForeground: "#7F8A99",
  positive: "#0B7F45",
  positiveSoft: "rgba(11, 127, 69, 0.12)",
  negative: "#D6323F",
  negativeSoft: "rgba(214, 50, 63, 0.1)",
  push: "#566170",
  destructive: "#D6323F",
  destructiveForeground: "#FFFFFF",
  league: "#6A45E8",
  leagueSoft: "rgba(106, 69, 232, 0.11)",
  debt: "#C9640F",
  debtSoft: "rgba(201, 100, 15, 0.12)",
  warning: "#A86A00",
  shadow: "rgba(13, 17, 23, 0.14)",
  scrim: "rgba(13, 17, 23, 0.35)",
} as const;

/** Sportsbook black: four steps of cool-neutral lift so cards read without borders doing the work. */
const blackBase = {
  background: "#0A0C0F",
  card: "#14171C",
  elevated: "#1B1F26",
  secondary: "#20252D",
  muted: "#20252D",
  border: "#2B313A",
  input: "#20252D",
  overlay: "rgba(0, 0, 0, 0.8)",
  text: "#F4F6F8",
  foreground: "#F4F6F8",
  cardForeground: "#ECEFF3",
  secondaryForeground: "#F4F6F8",
  mutedForeground: "#9AA4B2",
  subtleForeground: "#6B7482",
  push: "#9AA4B2",
} as const;

const houseBlackDark: Palette = {
  ...blackBase,
  ...darkShared,
  primary: "#F5C542",
  primaryForeground: "#0A0C0F",
  tint: "#F5C542",
  primarySoft: "rgba(245, 197, 66, 0.14)",
  accent: "#4DA3FF",
  accentForeground: "#04101F",
  live: "#4DA3FF",
};
const houseBlackLight: Palette = {
  ...lightShared,
  primary: "#14171C", // black CTA; gold fails AA on white
  primaryForeground: "#F5C542",
  tint: "#14171C",
  primarySoft: "rgba(20, 23, 28, 0.08)",
  accent: "#1668D6",
  accentForeground: "#FFFFFF",
  live: "#1668D6",
};

const nightGameDark: Palette = {
  ...blackBase,
  ...darkShared,
  primary: "#B6F23C",
  primaryForeground: "#0A0C0F",
  tint: "#B6F23C",
  primarySoft: "rgba(182, 242, 60, 0.14)",
  accent: "#FF7A2F",
  accentForeground: "#1A0A00",
  // Wins sit apart from the volt action colour: cooler, mintier.
  positive: "#1FE0A0",
  positiveSoft: "rgba(31, 224, 160, 0.14)",
  live: "#FF7A2F",
};
const nightGameLight: Palette = {
  ...lightShared,
  primary: "#2C7A0B",
  primaryForeground: "#FFFFFF",
  tint: "#2C7A0B",
  primarySoft: "rgba(44, 122, 11, 0.1)",
  accent: "#C8500F",
  accentForeground: "#FFFFFF",
  live: "#C8500F",
};

const blueChipDark: Palette = {
  ...darkShared,
  background: "#081423",
  card: "#102238",
  elevated: "#162D49",
  secondary: "#1A3353",
  muted: "#1A3353",
  border: "#254468",
  input: "#1A3353",
  overlay: "rgba(3, 9, 18, 0.82)",
  text: "#F5F8FC",
  foreground: "#F5F8FC",
  cardForeground: "#EAF0F7",
  secondaryForeground: "#F5F8FC",
  mutedForeground: "#9DB2CC",
  subtleForeground: "#6C84A3",
  push: "#9DB2CC",
  primary: "#2C9EFF",
  primaryForeground: "#03101F",
  tint: "#2C9EFF",
  primarySoft: "rgba(44, 158, 255, 0.16)",
  accent: "#FFCB4D",
  accentForeground: "#1F1500",
  live: "#FF7A5C",
};
const blueChipLight: Palette = {
  ...lightShared,
  primary: "#0E67B3",
  primaryForeground: "#FFFFFF",
  tint: "#0E67B3",
  primarySoft: "rgba(14, 103, 179, 0.1)",
  accent: "#1F375B",
  accentForeground: "#FFFFFF",
  live: "#C8500F",
};

const afterDarkDark: Palette = {
  ...darkShared,
  background: "#0C0F1E",
  card: "#161A2E",
  elevated: "#1E233D",
  secondary: "#232947",
  muted: "#232947",
  border: "#30385E",
  input: "#232947",
  overlay: "rgba(4, 5, 14, 0.82)",
  text: "#F3F4FB",
  foreground: "#F3F4FB",
  cardForeground: "#E8EAF6",
  secondaryForeground: "#F3F4FB",
  mutedForeground: "#A1A8C9",
  subtleForeground: "#717A9E",
  push: "#A1A8C9",
  primary: "#3CD6F5",
  primaryForeground: "#04161C",
  tint: "#3CD6F5",
  primarySoft: "rgba(60, 214, 245, 0.15)",
  accent: "#FF6FAE",
  accentForeground: "#22030F",
  live: "#FF6FAE",
};
const afterDarkLight: Palette = {
  ...lightShared,
  primary: "#0A6E86",
  primaryForeground: "#FFFFFF",
  tint: "#0A6E86",
  primarySoft: "rgba(10, 110, 134, 0.1)",
  accent: "#C2256B",
  accentForeground: "#FFFFFF",
  live: "#C2256B",
};

export const SCHEMES = {
  houseBlack: { label: "House Black", dark: houseBlackDark, light: houseBlackLight },
  nightGame: { label: "Night Game", dark: nightGameDark, light: nightGameLight, unlockLevel: 3 },
  blueChip: { label: "Blue Chip", dark: blueChipDark, light: blueChipLight },
  afterDark: { label: "After Dark", dark: afterDarkDark, light: afterDarkLight, unlockLevel: 5 },
  felt: { label: "Felt", dark: dark as Palette, light: light as Palette },
} as const;

export type ThemeId = keyof typeof SCHEMES;
/** Level a theme unlocks at (0 = everyone). Cosmetic only, so the check lives on the client. */
export const themeUnlockLevel = (id: ThemeId): number => (SCHEMES[id] as { unlockLevel?: number }).unlockLevel ?? 0;
export const THEME_IDS = Object.keys(SCHEMES) as ThemeId[];
/** The scheme a fresh install gets. Players can change it in Settings → Display. */
export const DEFAULT_THEME: ThemeId = "houseBlack";
export const isThemeId = (v: unknown): v is ThemeId => typeof v === "string" && v in SCHEMES;

const colors = { ...SCHEMES[DEFAULT_THEME], schemes: SCHEMES, radius: 14 };

export default colors;
