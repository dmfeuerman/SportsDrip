import { Platform } from "react-native";

/**
 * The non-colour half of the design system.
 *
 * Screens currently hardcode `fontSize: 13, fontFamily: "Inter_600SemiBold"`
 * in forty separate StyleSheets, which is why the type sizes drift by a point
 * or two between tabs. These are the values to migrate to; nothing breaks
 * while a screen still has its own literals.
 */

/**
 * Modular scale, 1.2 ratio off a 15px body. Rounded to whole pixels.
 * Headlines and numbers use Inter ExtraBold / Black with tight tracking, the
 * dense, high-contrast type sportsbooks use so odds and balances read at a glance.
 */
export const FONT = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
  heavy: "Inter_800ExtraBold",
  black: "Inter_900Black",
} as const;

export const type = {
  display: { fontSize: 32, lineHeight: 36, fontFamily: FONT.black, letterSpacing: -1 },
  title: { fontSize: 24, lineHeight: 28, fontFamily: FONT.heavy, letterSpacing: -0.6 },
  heading: { fontSize: 18, lineHeight: 23, fontFamily: FONT.heavy, letterSpacing: -0.3 },
  body: { fontSize: 15, lineHeight: 21, fontFamily: "Inter_400Regular" },
  bodyStrong: { fontSize: 15, lineHeight: 21, fontFamily: "Inter_600SemiBold" },
  caption: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_400Regular" },
  captionStrong: { fontSize: 13, lineHeight: 18, fontFamily: "Inter_600SemiBold" },
  micro: { fontSize: 11, lineHeight: 14, fontFamily: "Inter_500Medium" },
  /** Section kickers and column labels: small caps-style, wide tracking. */
  overline: { fontSize: 10, lineHeight: 13, fontFamily: FONT.heavy, letterSpacing: 1 },
  /**
   * Scores, balances, odds, countdowns. Tabular figures stop a live score from
   * jittering horizontally every time a digit changes.
   */
  numeric: {
    fontSize: 17,
    lineHeight: 21,
    fontFamily: FONT.heavy,
    fontVariant: ["tabular-nums"] as const,
  },
  numericLarge: {
    fontSize: 28,
    lineHeight: 32,
    fontFamily: FONT.black,
    fontVariant: ["tabular-nums"] as const,
    letterSpacing: -1,
  },
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Radius carries hierarchy: pills for filters, cards, sheets. */
export const radii = { pill: 999, sm: 8, md: 12, lg: 16, xl: 22, sheet: 26 } as const;

export const elevation = {
  card: Platform.select({
    ios: { shadowColor: "#000", shadowOpacity: 0.16, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
    android: { elevation: 2 },
    default: {},
  }),
  sheet: Platform.select({
    ios: { shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 26, shadowOffset: { width: 0, height: -8 } },
    android: { elevation: 16 },
    default: {},
  }),
} as const;

export const motion = {
  /** One orchestrated moment per interaction; nothing animates on its own. */
  quick: 140,
  base: 220,
  reveal: 420,
} as const;

const theme = { type, space, radii, elevation, motion };
export default theme;
