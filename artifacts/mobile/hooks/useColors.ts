import { useColorScheme } from "react-native";
import colors, { RARITY_RAMP, SPORT_COLORS, type Palette } from "@/constants/colors";
import theme from "@/constants/theme";
import { useThemeId } from "@/lib/settings";

/**
 * Design tokens for the active colour scheme.
 *
 * Same call signature and same token names as before, so no screen needs an
 * edit to pick up the new palette. Additions: outcome colours (positive /
 * negative / push / live), `elevated` for anything floating above a card,
 * `sport()` and `rarity()` lookups, and the type/space/radii scales from
 * constants/theme.
 *
 * The previous implementation did a `"dark" in colors` runtime check and cast
 * through `unknown` because the scaffold shipped light-only. Both palettes are
 * complete now, so the lookup is a plain index and the return type is real.
 */
export function useColors() {
  const scheme = useColorScheme();
  const themeId = useThemeId();
  const set = colors.schemes[themeId] ?? colors;
  const palette: Palette = scheme === "light" ? set.light : set.dark;

  return {
    ...palette,
    radius: colors.radius,
    themeId,
    isDark: scheme !== "light",
    type: theme.type,
    space: theme.space,
    radii: theme.radii,
    elevation: theme.elevation,
    /** Team-neutral accent for a sport. Falls back to the amber brand colour. */
    sport: (name: string) => SPORT_COLORS[name] ?? palette.primary,
    rarity: (r: keyof typeof RARITY_RAMP) => RARITY_RAMP[r] ?? palette.mutedForeground,
    /** Hex + alpha, so screens stop concatenating "22" onto colour strings. */
    alpha: (hex: string, a: number) => withAlpha(hex, a),
  };
}

export type Colors = ReturnType<typeof useColors>;

/**
 * `colors.primary + "22"` is used in about thirty places today. It breaks the
 * moment a token becomes an rgba() string, which several now are.
 */
export function withAlpha(color: string, a: number): string {
  const clamped = Math.max(0, Math.min(1, a));
  if (color.startsWith("rgba")) return color.replace(/[\d.]+\)$/, `${clamped})`);
  if (color.startsWith("rgb")) return color.replace("rgb(", "rgba(").replace(")", `, ${clamped})`);

  const hex = color.replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return color;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${clamped})`;
}
