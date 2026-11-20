import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable, type GlassStyle } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useColors } from "@/hooks/useColors";

export type LiquidGlassVariant = "card" | "hero" | "pill" | "bar" | "tile";

interface LiquidGlassProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  variant?: LiquidGlassVariant;
  /** Optional accent tint blended subtly into the glass surface (defaults to theme surface). */
  tintColor?: string;
  /** Optional custom border color override (e.g., primary highlight when selected/active). */
  borderColor?: string;
  /** Optional custom border width override. */
  borderWidth?: number;
  /** Enables native iOS 26 interactive liquid glass press feedback when available. */
  interactive?: boolean;
  /** Glass style passed to native GlassView on iOS 26+. Defaults to "regular". */
  glassStyle?: GlassStyle;
  /** Border radius used to clip inner blur/specular layers. Defaults per variant. */
  radius?: number;
}

const DEFAULT_RADIUS: Record<LiquidGlassVariant, number> = {
  card: 20,
  hero: 24,
  pill: 999,
  bar: 0,
  tile: 12,
};

const BLUR_INTENSITY: Record<LiquidGlassVariant, { dark: number; light: number }> = {
  card: { dark: 38, light: 52 },
  hero: { dark: 46, light: 60 },
  pill: { dark: 30, light: 44 },
  bar: { dark: 56, light: 72 },
  tile: { dark: 24, light: 36 },
};

/**
 * Theme-adaptive Obsidian Liquid Glass surface.
 *
 * Uses native `GlassView` on iOS 26+ when available, and falls back to an
 * `expo-blur` + specular sheen + hairline rim stack on older iOS / Android / web.
 * All tints, specular highlights, and borders derive from `useColors()` so swapping
 * any colour scheme (House Black, Night Game, Blue Chip, After Dark, Felt) or
 * light/dark appearance automatically updates the glass tone.
 */
export function LiquidGlass({
  children,
  style,
  contentStyle,
  variant = "card",
  tintColor,
  borderColor,
  borderWidth,
  interactive = false,
  glassStyle = "regular",
  radius,
}: LiquidGlassProps) {
  const c = useColors();
  const r = radius ?? DEFAULT_RADIUS[variant];
  const nativeGlass = isLiquidGlassAvailable();
  const isBar = variant === "bar";

  // Surface tint adapts to the active theme's card/elevated/background tokens.
  const baseFill = tintColor
    ? tintColor
    : c.isDark
      ? variant === "hero"
        ? c.alpha(c.elevated, 0.56)
        : variant === "bar"
          ? c.alpha(c.background, 0.68)
          : variant === "tile"
            ? c.alpha(c.secondary, 0.52)
            : variant === "pill"
              ? c.alpha(c.secondary, 0.58)
              : c.alpha(c.card, 0.62)
      : variant === "hero"
        ? c.alpha(c.card, 0.78)
        : variant === "bar"
          ? c.alpha(c.background, 0.78)
          : variant === "tile"
            ? c.alpha(c.card, 0.68)
            : variant === "pill"
              ? c.alpha(c.card, 0.74)
              : c.alpha(c.card, 0.74);

  const rimColor =
    borderColor ??
    (c.isDark
      ? variant === "hero"
        ? c.alpha("#FFFFFF", 0.2)
        : c.alpha("#FFFFFF", 0.13)
      : c.alpha(c.foreground, 0.1));

  const specularTop: [string, string, string] = c.isDark
    ? [
        c.alpha("#FFFFFF", variant === "hero" ? 0.16 : variant === "tile" ? 0.1 : 0.12),
        c.alpha("#FFFFFF", 0.03),
        c.alpha("#FFFFFF", 0),
      ]
    : [
        c.alpha("#FFFFFF", 0.7),
        c.alpha("#FFFFFF", 0.2),
        c.alpha("#FFFFFF", 0),
      ];

  const shadowStyle: ViewStyle | undefined =
    variant === "card" || variant === "hero"
      ? {
          shadowColor: c.isDark ? "#000000" : c.foreground,
          shadowOpacity: c.isDark ? (variant === "hero" ? 0.45 : 0.32) : 0.09,
          shadowRadius: variant === "hero" ? 20 : 12,
          shadowOffset: { width: 0, height: variant === "hero" ? 10 : 6 },
          elevation: variant === "hero" ? 8 : 4,
        }
      : undefined;

  const innerRadiusStyle: ViewStyle = isBar ? {} : { borderRadius: r };

  const rimStyle: ViewStyle = isBar
    ? {
        borderBottomWidth: borderWidth ?? StyleSheet.hairlineWidth,
        borderBottomColor: rimColor,
      }
    : {
        borderRadius: r,
        borderWidth: borderWidth ?? 1,
        borderColor: rimColor,
      };

  const intensity = c.isDark ? BLUR_INTENSITY[variant].dark : BLUR_INTENSITY[variant].light;

  const surface = nativeGlass ? (
    <GlassView
      glassEffectStyle={glassStyle}
      tintColor={baseFill}
      isInteractive={interactive}
      colorScheme={c.isDark ? "dark" : "light"}
      style={[styles.inner, innerRadiusStyle, rimStyle, contentStyle]}
    >
      {!isBar && (
        <LinearGradient
          pointerEvents="none"
          colors={specularTop}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 0.55 }}
          style={[StyleSheet.absoluteFill, innerRadiusStyle]}
        />
      )}
      {children}
    </GlassView>
  ) : (
    <View style={[styles.inner, innerRadiusStyle, rimStyle, { backgroundColor: baseFill }, contentStyle]}>
      {Platform.OS !== "web" ? (
        <BlurView
          pointerEvents="none"
          intensity={intensity}
          tint={c.isDark ? "dark" : "light"}
          style={[StyleSheet.absoluteFill, innerRadiusStyle]}
        />
      ) : null}
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          innerRadiusStyle,
          { backgroundColor: baseFill },
        ]}
      />
      {!isBar && (
        <LinearGradient
          pointerEvents="none"
          colors={specularTop}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 0.5 }}
          style={[StyleSheet.absoluteFill, innerRadiusStyle]}
        />
      )}
      {children}
    </View>
  );

  if (shadowStyle) {
    return <View style={[shadowStyle, innerRadiusStyle, style]}>{surface}</View>;
  }
  return <View style={[innerRadiusStyle, style]}>{surface}</View>;
}

/**
 * Ambient atmospheric glow rendered behind the Games screen so Liquid Glass
 * surfaces visibly refract the active theme's primary and accent hues.
 */
export function ObsidianBackdrop() {
  const c = useColors();
  const primaryGlow = c.alpha(c.primary, c.isDark ? 0.16 : 0.14);
  const accentGlow = c.alpha(c.accent, c.isDark ? 0.14 : 0.12);
  const leagueGlow = c.alpha(c.league, c.isDark ? 0.08 : 0.07);
  const transparent = c.alpha(c.background, 0);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {/* Subtle top-to-bottom depth wash */}
      <LinearGradient
        colors={[
          c.alpha(c.elevated, c.isDark ? 0.55 : 0.35),
          c.background,
          c.background,
        ]}
        locations={[0, 0.38, 1]}
        style={StyleSheet.absoluteFill}
      />
      {/* Top-left warm theme primary bloom (e.g. gold in House Black, volt in Night Game) */}
      <LinearGradient
        colors={[primaryGlow, transparent]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.75, y: 0.55 }}
        style={[styles.orbTopLeft]}
      />
      {/* Mid-right accent bloom (e.g. electric blue in House Black, orange in Night Game) */}
      <LinearGradient
        colors={[accentGlow, transparent]}
        start={{ x: 1, y: 0.15 }}
        end={{ x: 0.15, y: 0.85 }}
        style={[styles.orbMidRight]}
      />
      {/* Lower-left subtle league violet bloom */}
      <LinearGradient
        colors={[leagueGlow, transparent]}
        start={{ x: 0, y: 1 }}
        end={{ x: 0.85, y: 0.2 }}
        style={[styles.orbBottomLeft]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  inner: {
    overflow: "hidden",
  },
  orbTopLeft: {
    position: "absolute",
    top: -40,
    left: -60,
    width: 340,
    height: 340,
    borderRadius: 170,
  },
  orbMidRight: {
    position: "absolute",
    top: 180,
    right: -80,
    width: 320,
    height: 360,
    borderRadius: 180,
  },
  orbBottomLeft: {
    position: "absolute",
    bottom: 60,
    left: -70,
    width: 300,
    height: 300,
    borderRadius: 150,
  },
});
