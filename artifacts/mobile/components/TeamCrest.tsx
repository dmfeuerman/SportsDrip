import React, { memo } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { ClipPath, Defs, G, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { SPORT_COLORS } from "@/constants/colors";
import { secondaryFor } from "@/constants/teamColors";
import { crestStyle, isLight, normHex, pickTrim, shade, type CrestPattern, type CrestShape } from "@/lib/teamIdentity";

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

/** Outer silhouette and the inset field, on a 40×46 canvas. All original artwork. */
const SHAPE: Record<CrestShape, { outer: string; inner: string }> = {
  shield: {
    outer: "M20 1.5 L37.5 6.5 V20 C37.5 31.5 30 39.5 20 44.5 C10 39.5 2.5 31.5 2.5 20 V6.5 Z",
    inner: "M20 5 L34.5 9.2 V20 C34.5 29.6 28.3 36.5 20 40.8 C11.7 36.5 5.5 29.6 5.5 20 V9.2 Z",
  },
  roundel: {
    outer: "M20 3 A20 20 0 1 1 19.99 3 Z",
    inner: "M20 6 A17 17 0 1 1 19.99 6 Z",
  },
  hex: {
    outer: "M20 1.5 L37.5 11.5 V34.5 L20 44.5 L2.5 34.5 V11.5 Z",
    inner: "M20 5 L34.5 13.3 V32.7 L20 41 L5.5 32.7 V13.3 Z",
  },
  plate: {
    outer: "M4 2.5 H36 Q37.5 2.5 37.5 4 V31 L20 44.5 L2.5 31 V4 Q2.5 2.5 4 2.5 Z",
    inner: "M6.5 5.5 H33.5 Q34.5 5.5 34.5 6.5 V29.6 L20 40.8 L5.5 29.6 V6.5 Q5.5 5.5 6.5 5.5 Z",
  },
};

/** Where the monogram sits (fraction of height) so it clears each pattern. */
const TEXT_SHIFT: Record<CrestPattern, number> = { band: 0.2, chevron: -0.1, stripes: 0.02, sash: 0.02, halves: 0.02 };

function Pattern({ kind, trim, base }: { kind: CrestPattern; trim: string; base: string }) {
  switch (kind) {
    case "band":
      return <Rect x={0} y={12.5} width={40} height={5} fill={trim} opacity={0.92} />;
    case "chevron":
      return (
        <>
          <Path d="M0 37 L20 27.5 L40 37 V41.5 L20 32 L0 41.5 Z" fill={trim} opacity={0.92} />
          <Path d="M0 44 L20 34.5 L40 44 V46 L20 37 L0 46 Z" fill={trim} opacity={0.5} />
        </>
      );
    case "stripes":
      return (
        <G opacity={0.24}>
          <Rect x={10.5} y={0} width={2.2} height={46} fill={trim} />
          <Rect x={18.9} y={0} width={2.2} height={46} fill={trim} />
          <Rect x={27.3} y={0} width={2.2} height={46} fill={trim} />
        </G>
      );
    case "sash":
      return <Path d="M-2 36 L30 0 H41 L7 46 H-2 Z" fill={trim} opacity={0.3} />;
    case "halves":
      return <Rect x={20} y={0} width={20} height={46} fill={shade(base, isLight(base) ? -0.28 : 0.2)} opacity={0.55} />;
  }
}

/**
 * Team crest: an original two-tone badge in the team's colours with its
 * abbreviation as a monogram. The silhouette (shield, roundel, hex or plate)
 * and the field pattern (band, chevron, pinstripes, sash or halves) are picked
 * deterministically per team, so a team always looks the same and two teams
 * in a matchup rarely look alike. No league or club logos are used.
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
  const base = normHex(color) ?? "#4A5568";
  const trim = pickTrim(base, altColor, secondaryFor(sport, abbr));
  const { shape, pattern: picked } = crestStyle(abbr, sport);
  // Fine patterns turn to noise on tiny crests: keep those to the simple band.
  const pattern: CrestPattern = size < 24 ? "band" : picked;
  const paths = SHAPE[shape];
  const key = base.slice(1);
  const gid = `cg_${key}`;
  const cid = `cc_${shape}`;
  const label = abbr.slice(0, 4);
  const h = size * (46 / 40);
  const ink = isLight(base) ? "#0B1220" : "#FFFFFF";
  return (
    <View style={[{ width: size, height: h }, style]} accessible accessibilityLabel={`${abbr} crest`}>
      <Svg width={size} height={h} viewBox="0 0 40 46">
        <Defs>
          <LinearGradient id={gid} x1="0" y1="0" x2="0.35" y2="1">
            <Stop offset="0" stopColor={shade(base, 0.22)} />
            <Stop offset="0.55" stopColor={base} />
            <Stop offset="1" stopColor={shade(base, -0.4)} />
          </LinearGradient>
          <ClipPath id={cid}>
            <Path d={paths.inner} />
          </ClipPath>
        </Defs>
        <Path d={paths.outer} fill={shade(trim, isLight(trim) ? -0.12 : 0.1)} />
        <Path d={paths.outer} fill={trim} opacity={0.85} transform="translate(0 -0.6)" />
        <Path d={paths.inner} fill={`url(#${gid})`} />
        <G clipPath={`url(#${cid})`}>
          <Pattern kind={pattern} trim={trim} base={base} />
          <Rect x={0} y={0} width={40} height={pattern === "band" ? 12.5 : 15} fill="#FFFFFF" opacity={0.1} />
        </G>
        <Path d={paths.inner} fill="none" stroke={ink} strokeOpacity={0.22} strokeWidth={0.7} />
        {/* A near-black trim vanishes on the dark theme: give the silhouette a hairline. */}
        {!isLight(trim) && !isLight(shade(trim, 0.5)) ? <Path d={paths.outer} fill="none" stroke="#FFFFFF" strokeOpacity={0.22} strokeWidth={0.6} /> : null}
      </Svg>
      <View
        style={[
          StyleSheet.absoluteFill,
          styles.centre,
          TEXT_SHIFT[pattern] >= 0 ? { paddingTop: h * TEXT_SHIFT[pattern] } : { paddingBottom: h * -TEXT_SHIFT[pattern] },
        ]}
        pointerEvents="none"
      >
        <Text
          style={[
            styles.text,
            {
              color: ink,
              fontSize: Math.max(7, size * (label.length > 3 ? 0.22 : label.length > 2 ? 0.27 : 0.32)),
              textShadowColor: ink === "#FFFFFF" ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.45)",
            },
          ]}
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
  text: { fontFamily: "Inter_900Black", letterSpacing: 0.3, textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 2 },
});
