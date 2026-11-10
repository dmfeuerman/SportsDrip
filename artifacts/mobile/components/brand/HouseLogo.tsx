import React from "react";
import { Text, useColorScheme, View } from "react-native";
import Svg, { Circle, G, Path, Rect } from "react-native-svg";

export const BRAND = {
  felt: "#0F5A3F",
  deepFelt: "#062A1D",
  surface: "#0B3D2E",
  gold: "#F5C542",
  cream: "#FFF8E1",
  muted: "#9FB8AC",
} as const;

const NOTCHES = [0, 45, 90, 135, 180, 225, 270, 315];

/** The "House Chip" mark: gold chip, house, check. `tile` draws the app-icon square behind it. */
export function HouseMark({ size = 96, tile = false }: { size?: number; tile?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox={tile ? "0 0 1024 1024" : "182 182 660 660"}>
      {tile ? <Rect width={1024} height={1024} rx={224} fill={BRAND.felt} /> : null}
      <Circle cx={512} cy={512} r={330} fill={BRAND.gold} />
      <G fill={BRAND.cream}>
        {NOTCHES.map((deg) => (
          <Rect key={deg} x={487} y={182} width={50} height={70} rx={8} transform={`rotate(${deg} 512 512)`} />
        ))}
      </G>
      <Circle cx={512} cy={512} r={250} fill={BRAND.surface} />
      <Circle cx={512} cy={512} r={232} fill="none" stroke={BRAND.gold} strokeWidth={10} strokeDasharray="20 18" />
      <Path d="M512 350 L672 480 L632 480 L632 660 L392 660 L392 480 L352 480 Z" fill={BRAND.gold} />
      <Path
        d="M450 570 L495 615 L580 525"
        fill="none"
        stroke={BRAND.surface}
        strokeWidth={34}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Mark stacked over the ON THE / HOUSE wordmark. */
export default function HouseLogo({
  size = 112,
  tagline,
  variant,
}: {
  size?: number;
  tagline?: string;
  variant?: "dark" | "light";
}) {
  const scheme = useColorScheme();
  const onLight = (variant ?? (scheme === "light" ? "light" : "dark")) === "light";
  const s = size / 112;
  return (
    <View style={{ alignItems: "center" }}>
      <HouseMark size={size} />
      <Text
        style={{ marginTop: 16 * s, fontFamily: "Inter_900Black", fontSize: 20 * s, letterSpacing: 4 * s, color: onLight ? BRAND.deepFelt : BRAND.cream }}
      >
        ON THE
      </Text>
      <Text
        style={{
          fontFamily: "Inter_900Black",
          fontSize: 48 * s,
          lineHeight: 52 * s,
          letterSpacing: 2 * s,
          color: onLight ? BRAND.felt : BRAND.gold,
        }}
      >
        HOUSE
      </Text>
      {tagline ? (
        <Text style={{ marginTop: 6 * s, fontFamily: "Inter_500Medium", fontSize: 14 * s, color: onLight ? "#5B6F65" : BRAND.muted }}>{tagline}</Text>
      ) : null}
    </View>
  );
}
