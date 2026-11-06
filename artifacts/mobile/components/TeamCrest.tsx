import React, { memo } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { SPORT_COLORS } from "@/constants/colors";
import { onColor } from "@/constants/teams";

/** Badge glyph per sport (MaterialCommunityIcons). */
const SPORT_BADGE: Record<string, string> = {
  NFL: "football",
  NCAAF: "football",
  NBA: "basketball",
  NCAAB: "basketball",
  MLB: "baseball",
  NHL: "hockey-sticks",
  Soccer: "soccer",
};

const SHIELD = "M20 1.5 L37.5 6.5 V20 C37.5 31.5 30 39.5 20 44.5 C10 39.5 2.5 31.5 2.5 20 V6.5 Z";
const INNER = "M20 5 L34.5 9.2 V20 C34.5 29.6 28.3 36.5 20 40.8 C11.7 36.5 5.5 29.6 5.5 20 V9.2 Z";
const BAND = "M2.5 13 H37.5 V17.5 H2.5 Z";

function shade(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + (amt < 0 ? v * amt : (255 - v) * amt))));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * Team crest: a two-tone shield in the team's kit colours with its
 * abbreviation. Stands in for official logos (trademarked).
 */
function TeamCrest({
  abbr,
  color,
  altColor,
  size = 32,
  sport,
  style,
}: {
  abbr: string;
  color: string;
  altColor?: string | null;
  /** Adds a sport badge (sport-coloured ring) in the corner, at 26px and up. */
  sport?: string | null;
  /** Width in px; height is ~1.15×. */
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const base = /^#?[0-9a-f]{6}$/i.test(color) ? (color.startsWith("#") ? color : `#${color}`) : "#4A5568";
  const trim = altColor && /^#?[0-9a-f]{6}$/i.test(altColor) && altColor.replace("#", "").toLowerCase() !== base.replace("#", "").toLowerCase()
    ? (altColor.startsWith("#") ? altColor : `#${altColor}`)
    : onColor(base) === "#FFFFFF" ? "#FFFFFF" : "#0B1220";
  const id = `crest_${base.replace("#", "")}`;
  const label = abbr.slice(0, 4);
  const h = size * (46 / 40);
  return (
    <View style={[{ width: size, height: h }, style]} accessible accessibilityLabel={`${abbr} crest`}>
      <Svg width={size} height={h} viewBox="0 0 40 46">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={shade(base, 0.18)} />
            <Stop offset="1" stopColor={shade(base, -0.35)} />
          </LinearGradient>
        </Defs>
        <Path d={SHIELD} fill={trim} />
        <Path d={INNER} fill={`url(#${id})`} />
        <Path d={BAND} fill={trim} opacity={0.9} />
        <Path d="M20 5 L34.5 9.2 V13 H5.5 V9.2 Z" fill="#FFFFFF" opacity={0.12} />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.centre, { paddingTop: h * 0.2 }]} pointerEvents="none">
        <Text
          style={[styles.text, { color: onColor(base), fontSize: Math.max(7, size * (label.length > 3 ? 0.22 : 0.27)) }]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {label}
        </Text>
      </View>
      {sport && SPORT_BADGE[sport] && size >= 26 ? (
        <View
          pointerEvents="none"
          accessibilityLabel={sport}
          style={[
            styles.badge,
            {
              width: Math.round(size * 0.5),
              height: Math.round(size * 0.5),
              borderRadius: size * 0.25,
              right: -size * 0.16,
              bottom: -size * 0.08,
              borderColor: SPORT_COLORS[sport] ?? "#9aa0a6",
            },
          ]}
        >
          <MaterialCommunityIcons name={SPORT_BADGE[sport] as never} size={Math.round(size * 0.3)} color={SPORT_COLORS[sport] ?? "#ffffff"} />
        </View>
      ) : null}
    </View>
  );
}

export default memo(TeamCrest);

const styles = StyleSheet.create({
  badge: { position: "absolute", backgroundColor: "#0E0F12", borderWidth: 2, alignItems: "center", justifyContent: "center" },
  centre: { alignItems: "center", justifyContent: "center", paddingHorizontal: "14%" },
  text: { fontFamily: "Inter_900Black", letterSpacing: 0.2, textShadowColor: "rgba(0,0,0,0.25)", textShadowRadius: 2 },
});
