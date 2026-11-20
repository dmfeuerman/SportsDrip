import React, { useId } from "react";
import { Image, StyleSheet, View, type ImageSourcePropType } from "react-native";
import Svg, { Defs, Ellipse, G, LinearGradient, Path, Polygon, RadialGradient, Stop } from "react-native-svg";
import type { BoxTier } from "@/lib/api";

export interface PrizeBoxVisualTheme {
  glow: string;
  rim: string;
  accent: string;
  buttonBg: string;
  buttonText: string;
  pillBg: string;
  pillBorder: string;
  pillText: string;
  dotActive: string;
}

export const PRIZE_BOX_THEME: Record<BoxTier, PrizeBoxVisualTheme> = {
  bronze: {
    glow: "#E08A3C",
    rim: "rgba(246, 198, 148, 0.72)",
    accent: "#E59852",
    buttonBg: "#E08E45",
    buttonText: "#1A0D04",
    pillBg: "rgba(224, 138, 60, 0.16)",
    pillBorder: "rgba(232, 162, 96, 0.42)",
    pillText: "#F7C594",
    dotActive: "#E59852",
  },
  silver: {
    glow: "#94B8E0",
    rim: "rgba(226, 238, 255, 0.76)",
    accent: "#CBD5E1",
    buttonBg: "#DCE6F2",
    buttonText: "#0B1220",
    pillBg: "rgba(148, 184, 224, 0.16)",
    pillBorder: "rgba(203, 213, 225, 0.42)",
    pillText: "#E2E8F0",
    dotActive: "#DCE6F2",
  },
  gold: {
    glow: "#F5C451",
    rim: "rgba(255, 240, 178, 0.80)",
    accent: "#F5C451",
    buttonBg: "#F5C451",
    buttonText: "#161004",
    pillBg: "rgba(245, 196, 81, 0.16)",
    pillBorder: "rgba(245, 196, 81, 0.42)",
    pillText: "#FCE092",
    dotActive: "#F5C451",
  },
};

const PALETTES: Record<
  BoxTier,
  {
    topA: string;
    topB: string;
    leftA: string;
    leftB: string;
    rightA: string;
    rightB: string;
    lidLeftA: string;
    lidLeftB: string;
    lidRightA: string;
    lidRightB: string;
    ribbonLight: string;
    ribbonMid: string;
    ribbonDark: string;
    bowInner: string;
    spec: string;
    shadow: string;
  }
> = {
  bronze: {
    topA: "#F6C28B",
    topB: "#C26F2B",
    leftA: "#B86422",
    leftB: "#6E350D",
    rightA: "#8E4815",
    rightB: "#4C2207",
    lidLeftA: "#DA843B",
    lidLeftB: "#9A4E16",
    lidRightA: "#B66220",
    lidRightB: "#76380D",
    ribbonLight: "#FFE0BC",
    ribbonMid: "#DF8B42",
    ribbonDark: "#803D0E",
    bowInner: "#5E2A08",
    spec: "#FFF2DF",
    shadow: "#2A1103",
  },
  silver: {
    topA: "#FFFFFF",
    topB: "#B9C6D6",
    leftA: "#C5D0DE",
    leftB: "#738398",
    rightA: "#94A3B8",
    rightB: "#4E5D70",
    lidLeftA: "#E2E9F2",
    lidLeftB: "#9AA9BC",
    lidRightA: "#B9C5D4",
    lidRightB: "#748499",
    ribbonLight: "#FFFFFF",
    ribbonMid: "#CFD9E6",
    ribbonDark: "#697A90",
    bowInner: "#465466",
    spec: "#FFFFFF",
    shadow: "#141D29",
  },
  gold: {
    topA: "#FFF8D4",
    topB: "#E2A622",
    leftA: "#E8B030",
    leftB: "#9A640B",
    rightA: "#C78B14",
    rightB: "#6E4405",
    lidLeftA: "#FFE380",
    lidLeftB: "#CC8E16",
    lidRightA: "#E6AC28",
    lidRightB: "#9E670B",
    ribbonLight: "#FFFCE8",
    ribbonMid: "#FAD05A",
    ribbonDark: "#9E660A",
    bowInner: "#754806",
    spec: "#FFFFFF",
    shadow: "#2B1902",
  },
};

/**
 * Optional raster PNG overrides if you want to drop custom 3D renders into
 * `assets/prizes/{bronze,silver,gold}.png` and require() them here.
 */
const IMAGE_OVERRIDES: Partial<Record<BoxTier, ImageSourcePropType>> = {};

/**
 * 3D-shaded isometric metallic gift box art for Bronze, Silver, and Gold tiers.
 * Replaces legacy OS emojis with crisp, transparent, Liquid Glass-ready artwork.
 */
export default function PrizeBoxArt({
  tier,
  size = 128,
}: {
  tier: BoxTier;
  size?: number;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const override = IMAGE_OVERRIDES[tier];
  if (override) {
    return (
      <View style={[styles.wrap, { width: size, height: size }]}>
        <Image source={override} style={{ width: size, height: size }} resizeMode="contain" />
      </View>
    );
  }

  const p = PALETTES[tier];
  const id = (name: string) => `pb_${uid}_${name}`;

  return (
    <View style={[styles.wrap, { width: size, height: size }]} pointerEvents="none">
      <Svg width={size} height={size} viewBox="0 0 200 200">
        <Defs>
          <RadialGradient id={id("ambient")} cx="50%" cy="46%" rx="48%" ry="46%">
            <Stop offset="0" stopColor={p.spec} stopOpacity="0.28" />
            <Stop offset="0.55" stopColor={p.topB} stopOpacity="0.14" />
            <Stop offset="1" stopColor={p.topB} stopOpacity="0" />
          </RadialGradient>
          <LinearGradient id={id("top")} x1="15%" y1="10%" x2="85%" y2="90%">
            <Stop offset="0" stopColor={p.topA} />
            <Stop offset="0.52" stopColor={p.lidLeftA} />
            <Stop offset="1" stopColor={p.topB} />
          </LinearGradient>
          <LinearGradient id={id("left")} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0" stopColor={p.leftA} />
            <Stop offset="1" stopColor={p.leftB} />
          </LinearGradient>
          <LinearGradient id={id("right")} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0" stopColor={p.rightA} />
            <Stop offset="1" stopColor={p.rightB} />
          </LinearGradient>
          <LinearGradient id={id("lidL")} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0" stopColor={p.lidLeftA} />
            <Stop offset="1" stopColor={p.lidLeftB} />
          </LinearGradient>
          <LinearGradient id={id("lidR")} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0" stopColor={p.lidRightA} />
            <Stop offset="1" stopColor={p.lidRightB} />
          </LinearGradient>
          <LinearGradient id={id("ribV")} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0" stopColor={p.ribbonLight} />
            <Stop offset="0.48" stopColor={p.ribbonMid} />
            <Stop offset="1" stopColor={p.ribbonDark} />
          </LinearGradient>
          <LinearGradient id={id("ribTop")} x1="0%" y1="0%" x2="100%" y2="0%">
            <Stop offset="0" stopColor={p.ribbonMid} />
            <Stop offset="0.5" stopColor={p.ribbonLight} />
            <Stop offset="1" stopColor={p.ribbonMid} />
          </LinearGradient>
          <LinearGradient id={id("bowL")} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0" stopColor={p.ribbonLight} />
            <Stop offset="0.55" stopColor={p.ribbonMid} />
            <Stop offset="1" stopColor={p.ribbonDark} />
          </LinearGradient>
          <LinearGradient id={id("bowR")} x1="100%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0" stopColor={p.ribbonLight} />
            <Stop offset="0.55" stopColor={p.ribbonMid} />
            <Stop offset="1" stopColor={p.ribbonDark} />
          </LinearGradient>
        </Defs>

        {/* Soft floor contact shadow */}
        <Ellipse cx="100" cy="176" rx="56" ry="12" fill={p.shadow} opacity="0.45" />
        <Ellipse cx="100" cy="100" rx="88" ry="84" fill={`url(#${id("ambient")})`} />

        {/* Box Base — Left Face */}
        <Path
          d="M 38 94 L 100 124 L 100 178 Q 100 181 96 179 L 42 152 Q 38 150 38 145 Z"
          fill={`url(#${id("left")})`}
        />
        {/* Box Base — Right Face */}
        <Path
          d="M 162 94 L 100 124 L 100 178 Q 100 181 104 179 L 158 152 Q 162 150 162 145 Z"
          fill={`url(#${id("right")})`}
        />
        {/* Subtle vertical specular crease down front center */}
        <Path d="M 99 124 L 101 124 L 101 178 L 99 178 Z" fill={p.spec} opacity="0.28" />

        {/* Vertical Ribbon Stripes on Base */}
        <Polygon points="61,105 76,112 76,169 61,161" fill={`url(#${id("ribV")})`} opacity="0.96" />
        <Polygon points="124,112 139,105 139,161 124,169" fill={`url(#${id("ribV")})`} opacity="0.88" />
        {/* Under-lid ambient shadow cast onto base */}
        <Polygon points="38,94 100,124 162,94 162,102 100,132 38,102" fill={p.shadow} opacity="0.34" />

        {/* Chamfered Lid — Left Rim */}
        <Path
          d="M 31 76 Q 31 73 34 74 L 100 105 L 100 122 Q 100 125 96 123 L 34 93 Q 31 91 31 87 Z"
          fill={`url(#${id("lidL")})`}
        />
        {/* Chamfered Lid — Right Rim */}
        <Path
          d="M 169 76 Q 169 73 166 74 L 100 105 L 100 122 Q 100 125 104 123 L 166 93 Q 169 91 169 87 Z"
          fill={`url(#${id("lidR")})`}
        />

        {/* Chamfered Lid — Top Face */}
        <Path
          d="M 100 44 L 166 74 Q 169 76 166 78 L 100 108 L 34 78 Q 31 76 34 74 Z"
          fill={`url(#${id("top")})`}
        />
        {/* Crisp top chamfer highlight */}
        <Path
          d="M 36 75 L 100 105 L 164 75"
          fill="none"
          stroke={p.spec}
          strokeWidth="2.2"
          strokeLinecap="round"
          opacity="0.72"
        />

        {/* Ribbon Cross on Lid Top & Side Rims */}
        <Polygon points="57,63 73,56 142,88 126,95" fill={`url(#${id("ribTop")})`} />
        <Polygon points="127,56 143,63 74,95 58,88" fill={`url(#${id("ribTop")})`} />
        <Polygon points="58,88 74,95 74,113 58,105" fill={`url(#${id("ribV")})`} />
        <Polygon points="126,95 142,88 142,105 126,113" fill={`url(#${id("ribV")})`} opacity="0.92" />

        {/* Sculpted 3D Satin Bow */}
        <G>
          {/* Back-left bow loop */}
          <Path
            d="M 98 69 C 78 52, 60 36, 72 28 C 84 20, 96 42, 100 62 Z"
            fill={`url(#${id("bowL")})`}
          />
          <Path
            d="M 94 64 C 81 51, 71 40, 76 35 C 82 31, 91 45, 96 60 Z"
            fill={p.bowInner}
            opacity="0.58"
          />

          {/* Back-right bow loop */}
          <Path
            d="M 102 69 C 122 52, 140 36, 128 28 C 116 20, 104 42, 100 62 Z"
            fill={`url(#${id("bowR")})`}
          />
          <Path
            d="M 106 64 C 119 51, 129 40, 124 35 C 118 31, 109 45, 104 60 Z"
            fill={p.bowInner}
            opacity="0.58"
          />

          {/* Front-left fuller bow loop */}
          <Path
            d="M 98 73 C 73 79, 54 68, 60 54 C 66 41, 86 50, 99 67 Z"
            fill={`url(#${id("bowL")})`}
          />
          <Path
            d="M 92 70 C 76 73, 66 66, 69 58 C 72 51, 84 56, 94 66 Z"
            fill={p.bowInner}
            opacity="0.5"
          />

          {/* Front-right fuller bow loop */}
          <Path
            d="M 102 73 C 127 79, 146 68, 140 54 C 134 41, 114 50, 101 67 Z"
            fill={`url(#${id("bowR")})`}
          />
          <Path
            d="M 108 70 C 124 73, 134 66, 131 58 C 128 51, 116 56, 106 66 Z"
            fill={p.bowInner}
            opacity="0.5"
          />

          {/* Center satin knot */}
          <Path
            d="M 91 65 Q 100 57 109 65 Q 112 73 100 76 Q 88 73 91 65 Z"
            fill={`url(#${id("ribTop")})`}
          />
          <Ellipse cx="99" cy="65" rx="5.5" ry="2.6" fill={p.spec} opacity="0.72" />
        </G>

        {/* Subtle specular star glint on top-right corner */}
        <Path
          d="M 152 60 L 154 67 L 161 69 L 154 71 L 152 78 L 150 71 L 143 69 L 150 67 Z"
          fill={p.spec}
          opacity="0.82"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
  },
});
