import React, { memo } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { onColor } from "@/constants/teams";
import type { Sport } from "@/types/game";

const TEE = "M17 4 L9 6.5 L2 14.5 L8.5 21.5 L12.5 18.5 V44.5 H35.5 V18.5 L39.5 21.5 L46 14.5 L39 6.5 L31 4 C29.5 7.6 27 9.2 24 9.2 C21 9.2 18.5 7.6 17 4 Z";
const TANK = "M15.5 3.5 C15.5 10 13.5 13.5 10 15.5 V44.5 H38 V15.5 C34.5 13.5 32.5 10 32.5 3.5 H28.5 C27.6 7.8 26 9.8 24 9.8 C22 9.8 20.4 7.8 19.5 3.5 Z";
const TEE_TRIM = "M2 14.5 L4.2 12 L10.7 19 L8.5 21.5 Z M46 14.5 L43.8 12 L37.3 19 L39.5 21.5 Z M17 4 C18.5 7.6 21 9.2 24 9.2 C27 9.2 29.5 7.6 31 4 L29.4 3.5 C28.2 6.4 26.3 7.4 24 7.4 C21.7 7.4 19.8 6.4 18.6 3.5 Z";
const TANK_TRIM = "M19.5 3.5 C20.4 7.8 22 9.8 24 9.8 C26 9.8 27.6 7.8 28.5 3.5 L26.9 3.5 C26.2 6.6 25.2 8 24 8 C22.8 8 21.8 6.6 21.1 3.5 Z";

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .replace(/[^A-Za-z]/g, "")
    .slice(0, 2)
    .toUpperCase();

/**
 * A player shown as their team's jersey with their initials (or number) on
 * the chest — a tank for basketball, a crew jersey for everything else.
 */
function PlayerJersey({
  name,
  number,
  color,
  altColor,
  sport,
  size = 36,
  style,
}: {
  name: string;
  number?: string | number | null;
  color: string;
  altColor?: string | null;
  sport?: Sport | string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const base = /^#[0-9a-f]{6}$/i.test(color) ? color : "#4A5568";
  const trim = altColor && /^#[0-9a-f]{6}$/i.test(altColor) && altColor.toLowerCase() !== base.toLowerCase() ? altColor : onColor(base);
  const tank = sport === "NBA" || sport === "NCAAB";
  const id = `jersey_${base.slice(1)}`;
  const label = number != null && `${number}`.length ? `${number}` : initialsOf(name);
  return (
    <View style={[{ width: size, height: size }, style]} accessible accessibilityLabel={`${name} jersey`}>
      <Svg width={size} height={size} viewBox="0 0 48 48">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={base} stopOpacity={1} />
            <Stop offset="1" stopColor={base} stopOpacity={0.78} />
          </LinearGradient>
        </Defs>
        <Path d={tank ? TANK : TEE} fill={`url(#${id})`} stroke="rgba(0,0,0,0.25)" strokeWidth={0.8} />
        <Path d={tank ? TANK_TRIM : TEE_TRIM} fill={trim} />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.centre, { paddingTop: size * 0.2 }]} pointerEvents="none">
        <Text style={[styles.text, { color: trim, fontSize: size * (label.length > 2 ? 0.24 : 0.3) }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
}

export default memo(PlayerJersey);

const styles = StyleSheet.create({
  centre: { alignItems: "center", justifyContent: "center" },
  text: { fontFamily: "Inter_900Black", letterSpacing: -0.3 },
});
