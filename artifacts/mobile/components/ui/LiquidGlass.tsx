import { BlurView } from "expo-blur";
import { GlassView, isLiquidGlassAvailable, type GlassStyle } from "expo-glass-effect";
import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
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
  /** Glass style passed to native GlassView on iOS 26+. */
  glassStyle?: GlassStyle;
  /** Border radius used to clip inner blur/specular layers. Defaults per variant. */
  radius?: number;
}

const DEFAULT_RADIUS: Record<LiquidGlassVariant, number> = {
  card: 22,
  hero: 26,
  pill: 999,
  bar: 0,
  tile: 13,
};

const BLUR_INTENSITY: Record<LiquidGlassVariant, { dark: number; light: number }> = {
  card: { dark: 45, light: 60 },
  hero: { dark: 55, light: 68 },
  pill: { dark: 36, light: 50 },
  bar: { dark: 65, light: 78 },
  tile: { dark: 28, light: 40 },
};

/**
 * Theme-adaptive Obsidian Liquid Glass surface.
 *
 * Uses native `GlassView` on iOS 26+ when available (with light translucent tinting
 * so optical refraction stays clearly visible), and falls back to a true
 * transparent-base `BlurView` + smoked glass tint + diagonal sheen + specular top
 * edge rim on older iOS / Android / web.
 *
 * Every surface tint, glow, and border derives from `useColors()` so switching
 * colour schemes (`houseBlack`, `nightGame`, `blueChip`, `afterDark`, `felt`) or
 * light/dark appearance automatically adapts the glass palette.
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
  glassStyle,
  radius,
}: LiquidGlassProps) {
  const c = useColors();
  const r = radius ?? DEFAULT_RADIUS[variant];
  const nativeGlass = isLiquidGlassAvailable();
  const isBar = variant === "bar";

  // Native UIGlassEffect needs a light tint alpha so refraction stays vivid.
  const nativeTint = tintColor
    ? tintColor
    : c.isDark
      ? variant === "bar"
        ? c.alpha(c.background, 0.28)
        : variant === "hero"
          ? c.alpha(c.elevated, 0.22)
          : c.alpha(c.card, 0.18)
      : variant === "bar"
        ? c.alpha(c.background, 0.35)
        : c.alpha(c.card, 0.28);

  // Fallback tint sits ABOVE BlurView (never doubled on the outer container).
  const fallbackFill = tintColor
    ? tintColor
    : c.isDark
      ? variant === "bar"
        ? c.alpha(c.background, 0.56)
        : variant === "hero"
          ? c.alpha(c.elevated, 0.42)
          : variant === "tile"
            ? c.alpha(c.secondary, 0.38)
            : variant === "pill"
              ? c.alpha(c.secondary, 0.46)
              : c.alpha(c.card, 0.42)
      : variant === "bar"
        ? c.alpha(c.background, 0.68)
        : variant === "hero"
          ? c.alpha(c.card, 0.66)
          : c.alpha(c.card, 0.6);

  const rimColor =
    borderColor ??
    (c.isDark
      ? variant === "hero"
        ? c.alpha("#FFFFFF", 0.28)
        : c.alpha("#FFFFFF", 0.18)
      : c.alpha(c.foreground, 0.13));

  const specularSheen: [string, string, string] = c.isDark
    ? [
        c.alpha("#FFFFFF", variant === "hero" ? 0.22 : variant === "tile" ? 0.14 : 0.16),
        c.alpha("#FFFFFF", 0.04),
        c.alpha("#FFFFFF", 0),
      ]
    : [
        c.alpha("#FFFFFF", 0.85),
        c.alpha("#FFFFFF", 0.25),
        c.alpha("#FFFFFF", 0),
      ];

  const topHighlightColors: [string, string, string] = c.isDark
    ? [
        c.alpha("#FFFFFF", 0.04),
        c.alpha("#FFFFFF", variant === "hero" ? 0.52 : 0.36),
        c.alpha("#FFFFFF", 0.04),
      ]
    : [
        c.alpha("#FFFFFF", 0.2),
        c.alpha("#FFFFFF", 0.95),
        c.alpha("#FFFFFF", 0.2),
      ];

  const shadowStyle: ViewStyle | undefined =
    variant === "card" || variant === "hero"
      ? {
          shadowColor: c.isDark ? "#000000" : c.foreground,
          shadowOpacity: c.isDark ? (variant === "hero" ? 0.52 : 0.38) : 0.11,
          shadowRadius: variant === "hero" ? 24 : 14,
          shadowOffset: { width: 0, height: variant === "hero" ? 12 : 7 },
          elevation: variant === "hero" ? 10 : 5,
        }
      : undefined;

  const innerRadiusStyle: ViewStyle = isBar ? {} : { borderRadius: r };

  const rimStyle: ViewStyle = isBar
    ? {
        borderBottomWidth: borderWidth ?? 1,
        borderBottomColor: rimColor,
      }
    : {
        borderRadius: r,
        borderWidth: borderWidth ?? 1,
        borderColor: rimColor,
      };

  const intensity = c.isDark ? BLUR_INTENSITY[variant].dark : BLUR_INTENSITY[variant].light;
  const resolvedGlassStyle: GlassStyle = glassStyle ?? (variant === "bar" ? "regular" : "clear");

  const specularLayers = !isBar ? (
    <>
      {/* Diagonal optical glass sheen */}
      <LinearGradient
        pointerEvents="none"
        colors={specularSheen}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.85, y: 0.55 }}
        style={[StyleSheet.absoluteFill, innerRadiusStyle]}
      />
      {/* Crisp 1px top specular lip */}
      <LinearGradient
        pointerEvents="none"
        colors={topHighlightColors}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={styles.topSpecularLip}
      />
    </>
  ) : null;

  const surface = nativeGlass ? (
    <GlassView
      glassEffectStyle={resolvedGlassStyle}
      tintColor={nativeTint}
      isInteractive={interactive}
      colorScheme={c.isDark ? "dark" : "light"}
      style={[styles.inner, innerRadiusStyle, rimStyle, contentStyle]}
    >
      {specularLayers}
      {children}
    </GlassView>
  ) : (
    <View style={[styles.inner, innerRadiusStyle, rimStyle, contentStyle]}>
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
          { backgroundColor: fallbackFill },
        ]}
      />
      {specularLayers}
      {children}
    </View>
  );

  if (shadowStyle) {
    return <View style={[shadowStyle, innerRadiusStyle, style]}>{surface}</View>;
  }
  return <View style={[innerRadiusStyle, style]}>{surface}</View>;
}

/**
 * Smooth SVG radial ambient glow rendered behind screens so Liquid Glass
 * cards and floating headers visibly refract the active theme's primary,
 * accent, and league colours.
 */
export function ObsidianBackdrop() {
  const c = useColors();
  const primaryAlpha = c.isDark ? 0.34 : 0.24;
  const accentAlpha = c.isDark ? 0.28 : 0.2;
  const leagueAlpha = c.isDark ? 0.18 : 0.12;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="lgPrimary" cx="15%" cy="14%" rx="60%" ry="36%">
            <Stop offset="0%" stopColor={c.primary} stopOpacity={primaryAlpha} />
            <Stop offset="55%" stopColor={c.primary} stopOpacity={primaryAlpha * 0.28} />
            <Stop offset="100%" stopColor={c.primary} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="lgAccent" cx="88%" cy="40%" rx="62%" ry="38%">
            <Stop offset="0%" stopColor={c.accent} stopOpacity={accentAlpha} />
            <Stop offset="55%" stopColor={c.accent} stopOpacity={accentAlpha * 0.25} />
            <Stop offset="100%" stopColor={c.accent} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="lgLeague" cx="22%" cy="80%" rx="58%" ry="34%">
            <Stop offset="0%" stopColor={c.league} stopOpacity={leagueAlpha} />
            <Stop offset="60%" stopColor={c.league} stopOpacity={leagueAlpha * 0.22} />
            <Stop offset="100%" stopColor={c.league} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#lgPrimary)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#lgAccent)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#lgLeague)" />
      </Svg>
    </View>
  );
}

/**
 * Radial dome Liquid Glass sheen + specular top rim (matching Home Bento & PrizeVaultModal).
 * Drop inside any `overflow: "hidden"` container to give it directional luminous depth.
 */
export function GlassDomeSheen({
  id = "dome",
  glowColor,
  rimColor,
  intensity = 0.32,
}: {
  id?: string;
  glowColor?: string;
  rimColor?: string;
  intensity?: number;
}) {
  const c = useColors();
  const glow = glowColor ?? c.primary;
  const rim = rimColor ?? (c.isDark ? c.alpha(glow, 0.72) : c.alpha("#FFFFFF", 0.92));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id={`gd_${id}`} cx="50%" cy="12%" rx="78%" ry="56%">
            <Stop offset="0" stopColor={glow} stopOpacity={String(c.isDark ? intensity : intensity * 0.55)} />
            <Stop offset="0.52" stopColor={glow} stopOpacity={String(c.isDark ? intensity * 0.34 : intensity * 0.18)} />
            <Stop offset="1" stopColor={glow} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id={`gs_${id}`} cx="50%" cy="0%" rx="56%" ry="26%">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity={c.isDark ? "0.20" : "0.75"} />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#gd_${id})`} />
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#gs_${id})`} />
      </Svg>
      <LinearGradient
        colors={["transparent", rim, "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.domeTopRim}
      />
    </View>
  );
}

/**
 * Centered Liquid Glass modal surface matching the Prize Vault ("Luminous Spotlight") design:
 * blurred dark/light frosted glass card, radial dome glow, specular top rim, concentric 32pt radius.
 */
export function GlassModalSurface({
  children,
  glowColor,
  rimColor,
  style,
  id = "modal",
}: {
  children: React.ReactNode;
  glowColor?: string;
  rimColor?: string;
  style?: StyleProp<ViewStyle>;
  id?: string;
}) {
  const c = useColors();
  const bg = c.isDark ? "rgba(18, 22, 32, 0.80)" : c.alpha(c.elevated, 0.86);
  const border = c.isDark ? "rgba(255, 255, 255, 0.20)" : c.alpha(c.foreground, 0.14);

  return (
    <View style={[styles.modalCard, { backgroundColor: bg, borderColor: border }, style]}>
      {Platform.OS !== "web" ? (
        <BlurView intensity={c.isDark ? 72 : 82} tint={c.isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
      ) : null}
      <GlassDomeSheen id={id} glowColor={glowColor} rimColor={rimColor} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  inner: {
    overflow: "hidden",
  },
  topSpecularLip: {
    position: "absolute",
    top: 0,
    left: 16,
    right: 16,
    height: 1.25,
  },
  domeTopRim: {
    position: "absolute",
    top: 0,
    left: 22,
    right: 22,
    height: 1.5,
  },
  modalCard: {
    borderRadius: 32,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOpacity: 0.52,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 16 },
    elevation: 18,
  },
});
