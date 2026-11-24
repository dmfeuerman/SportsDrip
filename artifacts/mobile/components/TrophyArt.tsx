import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { memo, useId } from "react";
import { Image, StyleSheet, View, type ImageSourcePropType } from "react-native";
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  Polygon,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";
import { ACHIEVEMENTS, type TrophyMetal } from "@/constants/achievements";
import type { TrophyItem } from "@/constants/leagueTypes";

/**
 * Every trophy and achievement drawn as its own 3D-shaded metallic collectible:
 * a chamfered cup, a sculpted championship belt, a faceted diamond, a royal crown…
 * on a beveled 3D plinth. Matches the 3D metallic aesthetic of PrizeBoxArt.
 */
export type TrophyDesign =
  | "cup"
  | "lovingCup"
  | "bowl"
  | "medal"
  | "laurel"
  | "star"
  | "risingStar"
  | "torch"
  | "cauldron"
  | "crown"
  | "shield"
  | "obelisk"
  | "diamond"
  | "globe"
  | "belt"
  | "lock"
  | "spoon"
  | "bolt";

/** One design per achievement, so no two look alike. */
const ACHIEVEMENT_DESIGN: Record<string, TrophyDesign> = {
  first_win: "medal",
  wins_10: "laurel",
  wins_50: "star",
  picks_100: "shield",
  streak_7: "torch",
  streak_30: "cauldron",
  streak_100: "crown",
  daily_10: "obelisk",
  level_5: "bolt",
  level_10: "risingStar",
  level_25: "diamond",
  friends_3: "globe",
  friends_10: "lovingCup",
};
const FALLBACK: TrophyDesign[] = ["bowl", "cup", "lovingCup", "obelisk", "shield", "star", "globe", "laurel"];

const hashIndex = (s: string, n: number) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % n;
};

/** The design and metal for an achievement id. */
export function achievementLook(id: string): { design: TrophyDesign; metal: TrophyMetal; icon: string; title: string } {
  const a = ACHIEVEMENTS.find((x) => x.id === id);
  return {
    design: ACHIEVEMENT_DESIGN[id] ?? FALLBACK[hashIndex(id, FALLBACK.length)]!,
    metal: a?.metal ?? "silver",
    icon: a?.icon ?? "trophy-award",
    title: a?.title ?? id,
  };
}

/** The design and metal for any trophy on a player's shelf. */
export function trophyLook(t: Pick<TrophyItem, "id" | "kind" | "achievementId">): {
  design: TrophyDesign;
  metal: TrophyMetal;
  icon: string;
} {
  if (t.kind === "achievement") {
    const a = achievementLook(t.achievementId ?? t.id.replace(/^ach_/, ""));
    return { design: a.design, metal: a.metal, icon: a.icon };
  }
  switch (t.kind) {
    case "champion":
      return { design: "cup", metal: "gold", icon: "trophy" };
    case "h2h_champion":
      return { design: "belt", metal: "platinum", icon: "sword-cross" };
    case "lock_of_week":
      return { design: "lock", metal: "silver", icon: "lock" };
    case "last_place":
      return { design: "spoon", metal: "bronze", icon: "emoticon-sad-outline" };
    default:
      return { design: "bowl", metal: "bronze", icon: "trophy" };
  }
}

interface MetalPalette3D {
  spec: string;
  hi: string;
  mid: string;
  lo: string;
  deep: string;
  rim: string;
  glow: string;
  shadow: string;
  plinthTop: string;
  plinthLeft: string;
  plinthRight: string;
  plinthDeep: string;
  iconInk: string;
}

const PALETTES: Record<TrophyMetal, MetalPalette3D> = {
  bronze: {
    spec: "#FFF2DF",
    hi: "#F8C894",
    mid: "#D68038",
    lo: "#8F4715",
    deep: "#4E2307",
    rim: "#FFE0BA",
    glow: "#E08A3C",
    shadow: "#240F03",
    plinthTop: "#5B3821",
    plinthLeft: "#3F2414",
    plinthRight: "#26140A",
    plinthDeep: "#140A05",
    iconInk: "#4A2206",
  },
  silver: {
    spec: "#FFFFFF",
    hi: "#EEF4FB",
    mid: "#B8C6D6",
    lo: "#6B7C91",
    deep: "#3B4756",
    rim: "#FFFFFF",
    glow: "#94B8E0",
    shadow: "#101824",
    plinthTop: "#3B4554",
    plinthLeft: "#272F3B",
    plinthRight: "#181E27",
    plinthDeep: "#0D1118",
    iconInk: "#23303E",
  },
  gold: {
    spec: "#FFFDF0",
    hi: "#FFE994",
    mid: "#F2BA2E",
    lo: "#A86E0B",
    deep: "#5E3A04",
    rim: "#FFF5C4",
    glow: "#F5C451",
    shadow: "#261602",
    plinthTop: "#5E361C",
    plinthLeft: "#422310",
    plinthRight: "#281308",
    plinthDeep: "#150904",
    iconInk: "#4E2E04",
  },
  platinum: {
    spec: "#FFFFFF",
    hi: "#E6FAFF",
    mid: "#8BD9EE",
    lo: "#3C8AA3",
    deep: "#1E4D60",
    rim: "#F2FDFF",
    glow: "#7CE0FA",
    shadow: "#0B1E28",
    plinthTop: "#3B4A59",
    plinthLeft: "#24303C",
    plinthRight: "#151D26",
    plinthDeep: "#0B1016",
    iconInk: "#173A4A",
  },
};

/** Matte obsidian-charcoal 3D palette for locked trophies. */
const LOCKED_PALETTE: MetalPalette3D = {
  spec: "#6A7688",
  hi: "#465060",
  mid: "#2C333F",
  lo: "#1B2029",
  deep: "#10131A",
  rim: "#546072",
  glow: "#3B4657",
  shadow: "#07090D",
  plinthTop: "#2A303B",
  plinthLeft: "#1D222B",
  plinthRight: "#13171E",
  plinthDeep: "#0A0C10",
  iconInk: "rgba(255,255,255,0.45)",
};

/**
 * Optional raster PNG overrides if you want to drop custom 3D renders into
 * `assets/trophies/` and require() them here.
 */
const IMAGE_OVERRIDES: Partial<Record<TrophyDesign, ImageSourcePropType>> = {};

/** Where (in the 210-high viewBox) the design's emblem icon sits, if it has one. */
const ICON_Y: Partial<Record<TrophyDesign, number>> = {
  cup: 62,
  medal: 87,
  shield: 67,
  lovingCup: 64,
  bowl: 49,
};

/** Four-point specular sparkle glint matching PrizeBoxArt. */
function Glint({ cx, cy, r = 8, color, opacity = 0.85 }: { cx: number; cy: number; r?: number; color: string; opacity?: number }) {
  const k = r * 0.22;
  const d = `M ${cx} ${cy - r} L ${cx + k} ${cy - k} L ${cx + r} ${cy} L ${cx + k} ${cy + k} L ${cx} ${cy + r} L ${cx - k} ${cy + k} L ${cx - r} ${cy} L ${cx - k} ${cy - k} Z`;
  return <Path d={d} fill={color} opacity={opacity} />;
}

/** Grounded 3D metallic padlock badge for locked obsidian silhouettes. */
function LockedPadlock({ id }: { id: (name: string) => string }) {
  return (
    <G>
      {/* Subtle drop shadow behind padlock */}
      <Rect x={66} y={77} width={28} height={24} rx={5} fill="#06080C" opacity={0.6} />
      {/* Shackle */}
      <Path
        d="M 72 76 V 68 C 72 61 75.5 57 80 57 C 84.5 57 88 61 88 68 V 76"
        stroke={`url(#${id("lockMetal")})`}
        strokeWidth={4.2}
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M 73.5 74 V 68 C 73.5 62.5 76.2 59 80 59"
        stroke="#FFFFFF"
        strokeWidth={1.1}
        strokeLinecap="round"
        fill="none"
        opacity={0.55}
      />
      {/* Body */}
      <Rect x={67} y={74} width={26} height={22} rx={4.5} fill={`url(#${id("lockMetal")})`} />
      {/* Top chamfer highlight */}
      <Path d="M 70 75.5 H 90" stroke="#FFFFFF" strokeWidth={1.2} strokeLinecap="round" opacity={0.65} />
      {/* Keyhole */}
      <Circle cx={80} cy={83} r={2.6} fill="#141820" />
      <Path d="M 78.6 84.5 L 78 91 H 82 L 81.4 84.5 Z" fill="#141820" />
    </G>
  );
}

function TrophyArt({
  design,
  metal,
  earned = true,
  size,
  icon,
  uid,
}: {
  design: TrophyDesign;
  metal: TrophyMetal;
  earned?: boolean;
  size: number;
  /** MaterialCommunityIcons name stamped on cups, medals and shields. */
  icon?: string;
  /** Unique per instance on screen (SVG gradient ids are global on web). */
  uid?: string;
}) {
  const autoId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const override = earned ? IMAGE_OVERRIDES[design] : undefined;
  const h = size * (84 / 64);

  if (override) {
    return (
      <View style={[styles.wrap, { width: size, height: h }]} pointerEvents="none">
        <Image source={override} style={{ width: size, height: h }} resizeMode="contain" />
      </View>
    );
  }

  const p = earned ? PALETTES[metal] : LOCKED_PALETTE;
  const prefix = `ta_${(uid ?? autoId).replace(/[^a-zA-Z0-9_]/g, "")}_${design}`;
  const id = (name: string) => `${prefix}_${name}`;

  const M = `url(#${id("metal")})`;
  const M_VERT = `url(#${id("metalV")})`;
  const M_LIT = `url(#${id("metalLit")})`;
  const M_DARK = `url(#${id("metalDark")})`;
  const M_INNER = `url(#${id("metalInner")})`;
  const M_SPHERE = `url(#${id("sphere")})`;
  const FLAME = `url(#${id("flame")})`;
  const FLAME_CORE = `url(#${id("flameCore")})`;

  const ribbonA = earned ? "#D63344" : "#242A34";
  const ribbonADark = earned ? "#8A1724" : "#151920";
  const ribbonB = earned ? "#2D63D4" : "#2A313D";
  const ribbonBDark = earned ? "#193A8A" : "#181C24";
  const leather = earned ? "#242730" : "#1C212A";
  const leatherDark = earned ? "#111319" : "#11141A";
  const iconY = ICON_Y[design];

  const art = (() => {
    switch (design) {
      case "cup":
        return (
          <G>
            {/* Left & right sculpted 3D S-handles */}
            <Path
              d="M 41 36 C 14 34, 14 82, 49 88"
              stroke={p.deep}
              strokeWidth={10}
              strokeLinecap="round"
              fill="none"
            />
            <Path
              d="M 41 36 C 14 34, 14 82, 49 88"
              stroke={M_VERT}
              strokeWidth={7}
              strokeLinecap="round"
              fill="none"
            />
            <Path
              d="M 38 35 C 18 35, 17 70, 42 82"
              stroke={p.rim}
              strokeWidth={1.8}
              strokeLinecap="round"
              fill="none"
              opacity={0.7}
            />

            <Path
              d="M 119 36 C 146 34, 146 82, 111 88"
              stroke={p.deep}
              strokeWidth={10}
              strokeLinecap="round"
              fill="none"
            />
            <Path
              d="M 119 36 C 146 34, 146 82, 111 88"
              stroke={M_DARK}
              strokeWidth={7}
              strokeLinecap="round"
              fill="none"
            />
            <Path
              d="M 122 36 C 140 37, 141 68, 118 82"
              stroke={p.hi}
              strokeWidth={1.6}
              strokeLinecap="round"
              fill="none"
              opacity={0.5}
            />

            {/* Chalice stem & stepped collar */}
            <Path d="M 71 102 H 89 L 94 129 H 66 Z" fill={M} />
            <Ellipse cx={80} cy={104} rx={13} ry={4.5} fill={M_LIT} />
            <Ellipse cx={80} cy={132} rx={24} ry={7.5} fill={M_DARK} />
            <Ellipse cx={80} cy={130} rx={22} ry={6.2} fill={M} />
            <Ellipse cx={80} cy={128.5} rx={15} ry={3.8} fill={p.rim} opacity={0.45} />

            {/* Main 3D Cup Body */}
            <Path
              d="M 38 24 H 122 V 46 C 122 82, 104 103, 80 106 C 56 103, 38 82, 38 46 Z"
              fill={M}
            />
            {/* Vertical glossy specular band on left curve */}
            <Path
              d="M 48 34 C 48 64, 56 84, 68 95 C 62 84, 58 64, 58 34 Z"
              fill={p.spec}
              opacity={earned ? 0.34 : 0.14}
            />
            {/* Deep shadow edge on right curve */}
            <Path
              d="M 111 32 C 111 66, 102 88, 86 101 C 103 95, 118 74, 118 32 Z"
              fill={p.deep}
              opacity={0.35}
            />

            {/* Chamfered 3D Top Rim & Recessed Interior */}
            <Ellipse cx={80} cy={24} rx={43} ry={11} fill={M_LIT} />
            <Ellipse cx={80} cy={24} rx={34} ry={7.5} fill={M_INNER} />
            <Path
              d="M 40 24 A 40 10 0 0 0 120 24"
              fill="none"
              stroke={p.rim}
              strokeWidth={2.2}
              opacity={0.78}
            />

            {earned ? <Glint cx={116} cy={22} r={9} color={p.spec} /> : null}
          </G>
        );

      case "lovingCup":
        return (
          <G>
            {/* Sweeping tall handles */}
            <Path d="M 54 34 C 14 26, 14 92, 58 96" stroke={p.deep} strokeWidth={9} fill="none" strokeLinecap="round" />
            <Path d="M 54 34 C 14 26, 14 92, 58 96" stroke={M_VERT} strokeWidth={6} fill="none" strokeLinecap="round" />
            <Path d="M 106 34 C 146 26, 146 92, 102 96" stroke={p.deep} strokeWidth={9} fill="none" strokeLinecap="round" />
            <Path d="M 106 34 C 146 26, 146 92, 102 96" stroke={M_DARK} strokeWidth={6} fill="none" strokeLinecap="round" />

            {/* Stem & circular base */}
            <Path d="M 72 99 H 88 L 91 124 H 69 Z" fill={M} />
            <Ellipse cx={80} cy={127} rx={24} ry={7.5} fill={M_DARK} />
            <Ellipse cx={80} cy={125} rx={22} ry={6} fill={M} />
            <Ellipse cx={80} cy={134} rx={19} ry={5} fill={p.deep} opacity={0.5} />

            {/* Sculpted Urn Body */}
            <Path
              d="M 52 18 H 108 L 102 36 C 118 52, 116 84, 96 102 H 64 C 44 84, 42 52, 58 36 Z"
              fill={M}
            />
            <Path d="M 60 40 C 54 58, 56 80, 68 96 C 62 78, 62 56, 68 40 Z" fill={p.spec} opacity={earned ? 0.34 : 0.14} />

            {/* Top Rim & Inner Shadow */}
            <Ellipse cx={80} cy={18} rx={29} ry={7.5} fill={M_LIT} />
            <Ellipse cx={80} cy={18} rx={22} ry={5} fill={M_INNER} />
            <Path d="M 53 19 A 27 7 0 0 0 107 19" fill="none" stroke={p.rim} strokeWidth={1.8} opacity={0.75} />

            {earned ? <Glint cx={108} cy={22} r={8} color={p.spec} /> : null}
          </G>
        );

      case "bowl":
        return (
          <G>
            {/* Turned stem & dome foot */}
            <Path d="M 73 82 H 87 L 90 124 H 70 Z" fill={M} />
            <Ellipse cx={80} cy={88} rx={12} ry={4} fill={M_LIT} />
            <Path d="M 52 135 C 52 119, 108 119, 108 135 Z" fill={M} />
            <Ellipse cx={80} cy={135} rx={28} ry={6} fill={M_DARK} />

            {/* Wide 3D Trophy Bowl */}
            <Path d="M 16 34 H 144 C 139 70, 114 86, 80 86 C 46 86, 21 70, 16 34 Z" fill={M} />
            <Path d="M 32 46 C 36 66, 52 78, 70 81 C 54 74, 44 62, 42 46 Z" fill={p.spec} opacity={earned ? 0.34 : 0.12} />

            {/* Elliptical Rim & Bowl Interior */}
            <Ellipse cx={80} cy={34} rx={64} ry={13} fill={M_LIT} />
            <Ellipse cx={80} cy={34} rx={55} ry={9.5} fill={M_INNER} />
            <Path d="M 19 35 A 61 12 0 0 0 141 35" fill="none" stroke={p.rim} strokeWidth={2.2} opacity={0.78} />

            {earned ? <Glint cx={134} cy={30} r={8.5} color={p.spec} /> : null}
          </G>
        );

      case "medal":
        return (
          <G>
            {/* 3D Folded Satin V-Ribbon */}
            <Polygon points="44,10 68,10 88,62 64,62" fill={ribbonA} />
            <Polygon points="62,10 68,10 88,62 82,62" fill={ribbonADark} opacity={0.55} />
            <Polygon points="116,10 92,10 72,62 96,62" fill={ribbonB} />
            <Polygon points="92,10 98,10 78,62 72,62" fill={ribbonBDark} opacity={0.45} />

            {/* Stem to pedestal */}
            <Rect x={72} y={122} width={16} height={16} rx={3} fill={M} />

            {/* Extruded 3D Medallion Edge (thickness shifted right/down) */}
            <Circle cx={84} cy={88} r={42} fill={M_DARK} />
            {/* Front Face */}
            <Circle cx={79} cy={86} r={42} fill={M} />
            {/* Raised Bevel Ring */}
            <Circle cx={79} cy={86} r={34} fill="none" stroke={p.deep} strokeWidth={2.5} opacity={0.45} />
            <Circle cx={79} cy={86} r={33} fill="none" stroke={p.rim} strokeWidth={1.8} opacity={0.8} />
            {/* Inner recessed disk */}
            <Circle cx={79} cy={86} r={29} fill={M_LIT} opacity={0.35} />
            {/* Diagonal glossy sheen */}
            <Path d="M 52 62 L 66 50 L 96 116 L 82 124 Z" fill={p.spec} opacity={earned ? 0.22 : 0.08} />

            {earned ? <Glint cx={108} cy={56} r={9} color={p.spec} /> : null}
          </G>
        );

      case "laurel":
        return (
          <G>
            {/* Ribbon tails behind */}
            <Path d="M 64 114 L 80 104 L 96 114 L 92 138 L 80 130 L 68 138 Z" fill={ribbonA} />
            <Path d="M 80 104 L 96 114 L 92 138 L 80 130 Z" fill={ribbonB} />

            {/* Sculpted 3D Laurel Wreath Leaves */}
            {[0, 1, 2, 3, 4, 5, 6].map((i) => {
              const a = (-212 + i * 24) * (Math.PI / 180);
              const b = (32 - i * 24) * (Math.PI / 180);
              const x1 = 80 + Math.cos(a) * 51;
              const y1 = 74 + Math.sin(a) * 48;
              const x2 = 80 + Math.cos(b) * 51;
              const y2 = 74 + Math.sin(b) * 48;
              const deg1 = (a * 180) / Math.PI + 90;
              const deg2 = (b * 180) / Math.PI + 90;
              return (
                <G key={i}>
                  <Ellipse cx={x1 + 2} cy={y1 + 2} rx={12} ry={5.5} fill={p.deep} opacity={0.55} transform={`rotate(${deg1} ${x1} ${y1})`} />
                  <Ellipse cx={x1} cy={y1} rx={12} ry={5.5} fill={M_LIT} transform={`rotate(${deg1} ${x1} ${y1})`} />
                  <Ellipse cx={x2 + 2} cy={y2 + 2} rx={12} ry={5.5} fill={p.deep} opacity={0.55} transform={`rotate(${deg2} ${x2} ${y2})`} />
                  <Ellipse cx={x2} cy={y2} rx={12} ry={5.5} fill={M} transform={`rotate(${deg2} ${x2} ${y2})`} />
                </G>
              );
            })}

            {/* Central 3D Medallion */}
            <Circle cx={83} cy={76} r={30} fill={M_DARK} />
            <Circle cx={79} cy={74} r={30} fill={M} />
            <Circle cx={79} cy={74} r={24} fill="none" stroke={p.rim} strokeWidth={1.6} opacity={0.75} />
            {/* Faceted Star Crest inside medallion */}
            <Polygon
              points="79,55 85,68 99,69 88,78 91,92 79,84 67,92 70,78 59,69 73,68"
              fill={M_LIT}
            />
            <Polygon points="79,55 85,68 79,74" fill={p.spec} opacity={earned ? 0.65 : 0.25} />
            <Polygon points="79,74 88,78 91,92 79,84" fill={p.lo} opacity={0.6} />

            {earned ? <Glint cx={124} cy={42} r={8.5} color={p.spec} /> : null}
          </G>
        );

      case "star":
        return (
          <G>
            {/* Turned riser stem */}
            <Path d="M 72 98 H 88 L 93 130 H 67 Z" fill={M} />
            <Ellipse cx={80} cy={132} rx={24} ry={7} fill={M_DARK} />
            <Ellipse cx={80} cy={130} rx={22} ry={5.5} fill={M} />

            {/* Extruded 3D Star Back Shadow */}
            <Polygon
              points="84,14 101,51 141,56 111,83 119,122 84,102 49,122 57,83 27,56 67,51"
              fill={M_DARK}
            />
            {/* Main Faceted 3D Star (10 bevel triangles radiating from center 80,68) */}
            <Polygon points="80,10 63,48 80,68" fill={M_LIT} />
            <Polygon points="80,10 97,48 80,68" fill={M} />
            <Polygon points="97,48 138,53 80,68" fill={M_LIT} />
            <Polygon points="138,53 107,80 80,68" fill={M_DARK} />
            <Polygon points="107,80 116,120 80,68" fill={M} />
            <Polygon points="116,120 80,99 80,68" fill={M_DARK} />
            <Polygon points="80,99 44,120 80,68" fill={M} />
            <Polygon points="44,120 53,80 80,68" fill={M_DARK} />
            <Polygon points="53,80 22,53 80,68" fill={M} />
            <Polygon points="22,53 63,48 80,68" fill={M_LIT} />
            {/* Crisp bevel ridge highlight */}
            <Path d="M 80 10 L 80 68 L 138 53" stroke={p.spec} strokeWidth={1.6} fill="none" opacity={earned ? 0.7 : 0.25} />
            <Path d="M 22 53 L 80 68" stroke={p.rim} strokeWidth={1.4} fill="none" opacity={0.55} />

            {earned ? <Glint cx={126} cy={38} r={9} color={p.spec} /> : null}
          </G>
        );

      case "risingStar":
        return (
          <G>
            {/* Speed rays */}
            <Path d="M 56 26 L 30 14 M 104 26 L 130 14 M 48 48 L 22 48 M 112 48 L 138 48" stroke={p.rim} strokeWidth={3.5} strokeLinecap="round" opacity={earned ? 0.72 : 0.25} />

            {/* Fluted 3D Pillar */}
            <Polygon points="66,64 80,64 80,132 62,132" fill={M_LIT} />
            <Polygon points="80,64 94,64 98,132 80,132" fill={M_DARK} />
            <Path d="M 68 78 H 92 M 66 94 H 94 M 65 110 H 95" stroke={p.deep} strokeWidth={1.8} opacity={0.5} />
            <Ellipse cx={80} cy={133} rx={26} ry={7} fill={M_DARK} />
            <Ellipse cx={80} cy={131} rx={24} ry={5.5} fill={M} />

            {/* 3D Faceted Star at Summit */}
            <Polygon points="83,10 93,31 116,34 99,50 103,72 83,61 63,72 67,50 50,34 73,31" fill={M_DARK} />
            <Polygon points="80,8 70,29 80,42" fill={M_LIT} />
            <Polygon points="80,8 90,29 80,42" fill={M} />
            <Polygon points="90,29 113,32 80,42" fill={M_LIT} />
            <Polygon points="113,32 96,48 80,42" fill={M_DARK} />
            <Polygon points="96,48 100,70 80,42" fill={M} />
            <Polygon points="100,70 80,59 80,42" fill={M_DARK} />
            <Polygon points="80,59 60,70 80,42" fill={M} />
            <Polygon points="60,70 64,48 80,42" fill={M_DARK} />
            <Polygon points="64,48 47,32 80,42" fill={M} />
            <Polygon points="47,32 70,29 80,42" fill={M_LIT} />

            {earned ? <Glint cx={114} cy={22} r={8.5} color={p.spec} /> : null}
          </G>
        );

      case "torch":
        return (
          <G>
            {/* Sculpted 3D Tapered Handle */}
            <Path d="M 60 72 H 100 L 89 130 H 71 Z" fill={M} />
            <Path d="M 66 74 L 74 128 H 78 L 72 74 Z" fill={p.spec} opacity={earned ? 0.34 : 0.14} />
            <Path d="M 65 92 H 95 M 68 108 H 92" stroke={p.deep} strokeWidth={2} opacity={0.45} />
            {/* Collar foot */}
            <Ellipse cx={80} cy={133} rx={22} ry={6.5} fill={M_DARK} />
            <Ellipse cx={80} cy={131} rx={20} ry={5.2} fill={M} />

            {/* Beveled 3D Torch Cup */}
            <Path d="M 46 56 H 114 L 104 78 H 56 Z" fill={M} />
            <Ellipse cx={80} cy={56} rx={34} ry={9.5} fill={M_LIT} />
            <Ellipse cx={80} cy={56} rx={26} ry={6.5} fill={M_INNER} />

            {/* Sculpted 3D Layered Flame */}
            <Path
              d="M 80 6 C 102 24, 108 42, 97 58 C 91 49, 86 48, 81 55 C 76 46, 67 49, 64 58 C 52 44, 58 22, 80 6 Z"
              fill={FLAME}
            />
            <Path
              d="M 80 22 C 92 34, 93 48, 86 57 C 82 52, 78 52, 75 57 C 68 47, 70 33, 80 22 Z"
              fill={FLAME_CORE}
            />
            <Path d="M 78 14 C 71 26, 68 38, 71 48 C 72 36, 75 26, 80 16 Z" fill="#FFF7CC" opacity={earned ? 0.65 : 0.15} />

            {earned ? <Glint cx={112} cy={30} r={8.5} color={p.spec} /> : null}
          </G>
        );

      case "cauldron":
        return (
          <G>
            {/* Tripod 3D Legs */}
            <Path d="M 54 102 L 42 136" stroke={p.deep} strokeWidth={11} strokeLinecap="round" />
            <Path d="M 54 102 L 42 136" stroke={M_LIT} strokeWidth={7} strokeLinecap="round" />
            <Path d="M 106 102 L 118 136" stroke={p.deep} strokeWidth={11} strokeLinecap="round" />
            <Path d="M 106 102 L 118 136" stroke={M_DARK} strokeWidth={7} strokeLinecap="round" />
            <Path d="M 80 105 V 136" stroke={M} strokeWidth={8} strokeLinecap="round" />

            {/* Roaring Multi-Tongue 3D Flame */}
            <Path
              d="M 80 4 C 110 24, 118 44, 102 62 C 95 50, 88 49, 82 58 C 76 47, 65 50, 60 62 C 44 45, 52 22, 80 4 Z"
              fill={FLAME}
            />
            <Path
              d="M 46 22 C 62 34, 60 49, 53 60 C 44 50, 41 36, 46 22 Z M 114 22 C 98 34, 100 49, 107 60 C 116 50, 119 36, 114 22 Z"
              fill={FLAME}
              opacity={0.88}
            />
            <Path
              d="M 80 24 C 95 36, 95 50, 86 60 C 82 54, 78 54, 74 60 C 66 49, 68 35, 80 24 Z"
              fill={FLAME_CORE}
            />

            {/* Sculpted 3D Bowl */}
            <Path d="M 24 58 H 136 C 132 94, 110 110, 80 110 C 50 110, 28 94, 24 58 Z" fill={M} />
            <Path d="M 38 68 C 42 88, 56 100, 72 104 C 58 96, 48 84, 46 68 Z" fill={p.spec} opacity={earned ? 0.3 : 0.12} />
            <Ellipse cx={80} cy={58} rx={56} ry={11} fill={M_LIT} />
            <Ellipse cx={80} cy={58} rx={47} ry={7.5} fill={M_INNER} />

            {earned ? <Glint cx={128} cy={52} r={8.5} color={p.spec} /> : null}
          </G>
        );

      case "crown":
        return (
          <G>
            {/* Velvet Cushion on top of pedestal (matching luxury Example 2) */}
            <Path
              d="M 26 126 C 22 110, 38 104, 80 104 C 122 104, 138 110, 134 126 C 132 136, 114 141, 80 141 C 46 141, 28 136, 26 126 Z"
              fill={earned ? "#2A1224" : "#181C24"}
            />
            <Path
              d="M 28 125 C 46 133, 114 133, 132 125"
              fill="none"
              stroke={earned ? p.mid : p.lo}
              strokeWidth={3}
              strokeLinecap="round"
            />
            <Ellipse cx={80} cy={112} rx={44} ry={7} fill={earned ? "#441E3A" : "#232833"} opacity={0.65} />

            {/* Back inner peaks for true 3D depth */}
            <Polygon points="38,100 54,44 74,78 86,78 106,44 122,100" fill={M_INNER} />

            {/* Front 3D Crown Peaks */}
            <Path
              d="M 28 104 L 22 40 L 52 70 L 80 26 L 108 70 L 138 40 L 132 104 Z"
              fill={M}
            />
            {/* Beveled facet splits on center & side peaks */}
            <Polygon points="80,26 66,68 80,82" fill={p.spec} opacity={earned ? 0.36 : 0.14} />
            <Polygon points="80,26 94,68 80,82" fill={p.deep} opacity={0.28} />
            <Polygon points="22,40 38,76 28,100" fill={p.spec} opacity={earned ? 0.28 : 0.1} />

            {/* Crown Circlet Band */}
            <Path d="M 26 98 C 48 108, 112 108, 134 98 L 132 114 C 110 123, 50 123, 28 114 Z" fill={M} />
            <Path d="M 28 100 C 50 109, 110 109, 132 100" fill="none" stroke={p.rim} strokeWidth={2} opacity={0.8} />

            {/* Crown Peak Pearls / Finials */}
            {[
              [22, 38],
              [80, 24],
              [138, 38],
            ].map(([cx, cy], i) => (
              <G key={i}>
                <Circle cx={cx} cy={cy} r={6.5} fill={M_SPHERE} />
                <Circle cx={cx - 2} cy={cy - 2} r={2} fill={p.spec} opacity={0.8} />
              </G>
            ))}

            {/* Cabochon Gems */}
            {[
              { cx: 48, cy: 111, c: earned ? "#2B74E4" : "#222832", hi: "#99C7FF" },
              { cx: 80, cy: 114, c: earned ? "#E02843" : "#222832", hi: "#FF9EAD" },
              { cx: 112, cy: 111, c: earned ? "#2B74E4" : "#222832", hi: "#99C7FF" },
            ].map((g, i) => (
              <G key={i}>
                <Ellipse cx={g.cx} cy={g.cy} rx={6.2} ry={5.2} fill={p.deep} />
                <Ellipse cx={g.cx} cy={g.cy} rx={5} ry={4.2} fill={g.c} />
                {earned ? <Ellipse cx={g.cx - 1.5} cy={g.cy - 1.4} rx={1.8} ry={1.2} fill={g.hi} opacity={0.85} /> : null}
              </G>
            ))}

            {earned ? <Glint cx={136} cy={26} r={9} color={p.spec} /> : null}
          </G>
        );

      case "shield":
        return (
          <G>
            {/* Turned stem */}
            <Path d="M 71 122 H 89 L 92 135 H 68 Z" fill={M} />
            <Ellipse cx={80} cy={136} rx={22} ry={6} fill={M_DARK} />
            <Ellipse cx={80} cy={134} rx={20} ry={4.8} fill={M} />

            {/* Extruded 3D Right-Side Depth */}
            <Path
              d="M 85 14 L 135 29 V 68 C 135 102, 113 122, 85 132 C 57 122, 35 102, 35 68 V 29 Z"
              fill={M_DARK}
            />
            {/* Main Front Shield */}
            <Path
              d="M 79 12 L 128 27 V 66 C 128 100, 106 120, 79 130 C 52 120, 30 100, 30 66 V 27 Z"
              fill={M}
            />
            {/* Inner Beveled Frame */}
            <Path
              d="M 79 22 L 118 34 V 66 C 118 93, 100 110, 79 119 C 58 110, 40 93, 40 66 V 34 Z"
              fill={M_LIT}
              opacity={0.35}
              stroke={p.rim}
              strokeWidth={2.2}
            />
            {/* Diagonal metallic sheen */}
            <Path d="M 42 36 L 68 24 L 104 102 L 78 118 Z" fill={p.spec} opacity={earned ? 0.22 : 0.08} />

            {earned ? <Glint cx={124} cy={26} r={9} color={p.spec} /> : null}
          </G>
        );

      case "obelisk":
        return (
          <G>
            {/* Stepped collar */}
            <Polygon points="48,136 80,144 112,136 106,124 80,130 54,124" fill={M_DARK} />
            <Polygon points="54,124 80,130 106,124 80,118" fill={M_LIT} />

            {/* Isometric 2-Face Monument Shaft */}
            <Polygon points="80,8 66,28 58,128 80,134" fill={M_LIT} />
            <Polygon points="80,8 94,28 102,128 80,134" fill={M_DARK} />
            {/* Pyramidal Apex */}
            <Polygon points="80,8 66,28 80,33" fill={p.spec} opacity={earned ? 0.65 : 0.25} />
            <Polygon points="80,8 94,28 80,33" fill={M} />
            {/* Center ridge highlight */}
            <Path d="M 80 8 V 134" stroke={p.rim} strokeWidth={1.6} opacity={0.8} />
            {/* Engraved horizontal bands */}
            {[48, 68, 88, 108].map((y, i) => (
              <Path
                key={i}
                d={`M ${69 - i * 1.4} ${y} L 80 ${y + 3.5} L ${91 + i * 1.4} ${y}`}
                stroke={p.deep}
                strokeWidth={1.8}
                fill="none"
                opacity={0.55}
              />
            ))}

            {earned ? <Glint cx={80} cy={10} r={8.5} color={p.spec} /> : null}
          </G>
        );

      case "diamond":
        return (
          <G>
            {/* Floating hover shadow on pedestal */}
            <Ellipse cx={80} cy={134} rx={26} ry={6} fill={p.shadow} opacity={0.55} />

            {/* Multi-Faceted 3D Cut Diamond (Example 2 style) */}
            {/* Upper Table & Crown */}
            <Polygon points="44,32 116,32 100,58 60,58" fill={p.spec} opacity={earned ? 0.85 : 0.35} />
            <Polygon points="44,32 60,58 22,58" fill={M_LIT} />
            <Polygon points="116,32 138,58 100,58" fill={M} />
            <Polygon points="44,32 80,32 60,58" fill={p.rim} opacity={0.55} />
            <Polygon points="80,32 116,32 100,58" fill={M_LIT} opacity={0.7} />
            {/* Lower Pavilion Facets */}
            <Polygon points="22,58 60,58 80,124" fill={M} />
            <Polygon points="60,58 100,58 80,124" fill={M_LIT} />
            <Polygon points="100,58 138,58 80,124" fill={M_DARK} />
            {/* Inner refraction highlights */}
            <Polygon points="60,58 80,58 80,124" fill={p.spec} opacity={earned ? 0.35 : 0.12} />
            {/* Crisp facet wireframe */}
            <Path
              d="M 22 58 H 138 M 44 32 L 60 58 L 80 124 L 100 58 L 116 32 M 80 32 L 60 58 M 80 32 L 100 58"
              stroke={p.rim}
              strokeWidth={1.4}
              fill="none"
              opacity={0.75}
            />

            {earned ? (
              <>
                <Glint cx={118} cy={30} r={9.5} color={p.spec} />
                <Glint cx={46} cy={92} r={6} color={p.spec} opacity={0.75} />
              </>
            ) : null}
          </G>
        );

      case "globe":
        return (
          <G>
            {/* Turned stand */}
            <Path d="M 73 114 H 87 L 91 133 H 69 Z" fill={M} />
            <Ellipse cx={80} cy={135} rx={24} ry={6.5} fill={M_DARK} />
            <Ellipse cx={80} cy={133} rx={22} ry={5} fill={M} />

            {/* 3D Curved Meridian Cradle */}
            <Path d="M 32 68 C 32 108, 52 122, 80 122 C 108 122, 128 108, 128 68" stroke={p.deep} strokeWidth={10} fill="none" strokeLinecap="round" />
            <Path d="M 32 68 C 32 108, 52 122, 80 122 C 108 122, 128 108, 128 68" stroke={M} strokeWidth={6.5} fill="none" strokeLinecap="round" />

            {/* Spherical 3D Globe */}
            <Circle cx={80} cy={60} r={42} fill={M_SPHERE} />
            {/* Latitude & Longitude Graticule */}
            <Ellipse cx={80} cy={60} rx={18} ry={42} fill="none" stroke={p.deep} strokeWidth={1.8} opacity={0.55} />
            <Ellipse cx={80} cy={60} rx={34} ry={42} fill="none" stroke={p.deep} strokeWidth={1.4} opacity={0.35} />
            <Path d="M 38 60 H 122 M 44 38 H 116 M 44 82 H 116" stroke={p.deep} strokeWidth={1.6} opacity={0.5} />
            {/* Specular highlight on upper-left sphere */}
            <Ellipse cx={64} cy={42} rx={13} ry={8} fill={p.spec} opacity={earned ? 0.45 : 0.16} transform="rotate(-32 64 42)" />

            {earned ? <Glint cx={112} cy={28} r={8.5} color={p.spec} /> : null}
          </G>
        );

      case "belt":
        return (
          <G>
            {/* 3D Curved Leather Strap Loop (back + sides, Example 2 style) */}
            <Path
              d="M 16 62 C 24 38, 136 38, 144 62 L 142 108 C 134 128, 26 128, 18 108 Z"
              fill={leatherDark}
            />
            <Path
              d="M 12 68 C 30 56, 50 54, 60 56 V 104 C 50 102, 30 104, 12 116 Z"
              fill={leather}
              stroke={p.lo}
              strokeWidth={1.5}
            />
            <Path
              d="M 148 68 C 130 56, 110 54, 100 56 V 104 C 110 102, 130 104, 148 116 Z"
              fill={leather}
              stroke={p.lo}
              strokeWidth={1.5}
            />

            {/* Side Plates */}
            <Rect x={20} y={71} width={22} height={24} rx={5} fill={M} stroke={p.deep} strokeWidth={1.5} />
            <Rect x={118} y={71} width={22} height={24} rx={5} fill={M_DARK} stroke={p.deep} strokeWidth={1.5} />
            <Circle cx={31} cy={83} r={4.5} fill={p.rim} opacity={0.75} />
            <Circle cx={129} cy={83} r={4.5} fill={p.hi} opacity={0.65} />

            {/* Stand Collar */}
            <Rect x={66} y={118} width={28} height={18} rx={3} fill={M} />

            {/* Heavy Sculpted 3D Center Championship Plate */}
            <Ellipse cx={84} cy={84} rx={37} ry={42} fill={M_DARK} />
            <Ellipse cx={79} cy={82} rx={37} ry={42} fill={M} />
            <Ellipse cx={79} cy={82} rx={29} ry={34} fill="none" stroke={p.rim} strokeWidth={2.4} opacity={0.85} />
            <Ellipse cx={79} cy={82} rx={23} ry={27} fill={M_LIT} opacity={0.32} />

            {/* Center Star Crest */}
            <Polygon
              points="79,60 85,74 100,75 88,84 92,99 79,90 66,99 70,84 58,75 73,74"
              fill={earned ? "#D9283A" : "#222832"}
              stroke={p.rim}
              strokeWidth={1.2}
            />

            {earned ? <Glint cx={106} cy={46} r={9} color={p.spec} /> : null}
          </G>
        );

      case "lock":
        return (
          <G>
            {/* Stand collar */}
            <Rect x={68} y={120} width={24} height={16} rx={3} fill={M} />

            {/* Tubular 3D Shackle */}
            <Path
              d="M 54 66 V 44 C 54 24, 64 14, 80 14 C 96 14, 106 24, 106 44 V 66"
              stroke={p.deep}
              strokeWidth={16}
              fill="none"
              strokeLinecap="round"
            />
            <Path
              d="M 54 66 V 44 C 54 24, 64 14, 80 14 C 96 14, 106 24, 106 44 V 66"
              stroke={M}
              strokeWidth={11.5}
              fill="none"
              strokeLinecap="round"
            />
            <Path
              d="M 57 60 V 44 C 57 28, 65 20, 78 19"
              stroke={p.spec}
              strokeWidth={2.6}
              fill="none"
              strokeLinecap="round"
              opacity={earned ? 0.72 : 0.25}
            />

            {/* Extruded 3D Lock Body */}
            <Rect x={42} y={62} width={84} height={64} rx={12} fill={M_DARK} />
            <Rect x={36} y={59} width={84} height={64} rx={12} fill={M} />
            {/* Chamfered top highlight */}
            <Path d="M 46 62 H 110" stroke={p.spec} strokeWidth={2.4} strokeLinecap="round" opacity={earned ? 0.75 : 0.25} />
            {/* Recessed Keyhole */}
            <Circle cx={78} cy={84} r={9} fill={p.deep} />
            <Path d="M 73.5 88 L 71 108 H 85 L 82.5 88 Z" fill={p.deep} />
            <Circle cx={78} cy={84} r={7.2} fill={p.shadow} />

            {earned ? <Glint cx={116} cy={58} r={8.5} color={p.spec} /> : null}
          </G>
        );

      case "bolt":
        return (
          <G>
            {/* Base collar */}
            <Ellipse cx={80} cy={134} rx={26} ry={6.5} fill={M_DARK} />
            <Ellipse cx={80} cy={132} rx={24} ry={5} fill={M} />

            {/* Extruded 3D Side Thickness */}
            <Polygon points="95,10 45,78 78,78 65,132 126,54 91,54 106,10" fill={M_DARK} />
            {/* Main Front Bolt */}
            <Polygon points="89,8 38,76 72,76 59,130 120,52 85,52 100,8" fill={M} />
            {/* Bright lit facet */}
            <Polygon points="89,8 100,8 85,52 74,52 54,76 38,76" fill={M_LIT} opacity={0.8} />
            <Path d="M 89 8 L 38 76" stroke={p.spec} strokeWidth={2.2} opacity={earned ? 0.8 : 0.25} />

            {earned ? <Glint cx={116} cy={46} r={9} color={p.spec} /> : null}
          </G>
        );

      case "spoon":
      default:
        return (
          <G>
            {/* Extruded 3D Wooden Spoon Silhouette */}
            <Path
              d="M 84 14 C 58 14, 52 38, 52 54 C 52 74, 67 84, 76 86 L 73 138 H 91 L 88 86 C 97 84, 112 74, 112 54 C 112 38, 106 14, 84 14 Z"
              fill={earned ? "#4E2B12" : p.deep}
            />
            <Path
              d="M 79 12 C 53 12, 48 36, 48 52 C 48 72, 63 82, 72 84 L 70 138 H 88 L 86 84 C 95 82, 110 72, 110 52 C 110 36, 105 12, 79 12 Z"
              fill={earned ? `url(#${id("woodSpoon")})` : M}
            />
            {/* Concave Bowl Interior Shading */}
            <Ellipse cx={79} cy={49} rx={21} ry={26} fill={earned ? "#633A19" : p.lo} opacity={0.75} />
            <Path d="M 62 34 C 66 22, 74 18, 82 18" stroke={p.spec} strokeWidth={3} strokeLinecap="round" fill="none" opacity={earned ? 0.55 : 0.2} />

            {earned ? <Glint cx={104} cy={24} r={7.5} color={p.spec} opacity={0.7} /> : null}
          </G>
        );
    }
  })();

  return (
    <View style={[styles.wrap, { width: size, height: h }]} pointerEvents="none">
      <Svg width={size} height={h} viewBox="0 0 160 210">
        <Defs>
          {/* Ambient radial aura behind earned trophy */}
          <RadialGradient id={id("ambient")} cx="50%" cy="42%" rx="48%" ry="44%">
            <Stop offset="0" stopColor={p.spec} stopOpacity={earned ? "0.26" : "0.08"} />
            <Stop offset="0.52" stopColor={p.glow} stopOpacity={earned ? "0.16" : "0.03"} />
            <Stop offset="1" stopColor={p.glow} stopOpacity="0" />
          </RadialGradient>

          {/* Horizontal cylindrical 3D metallic sheen */}
          <LinearGradient id={id("metal")} x1="0%" y1="0%" x2="100%" y2="8%">
            <Stop offset="0" stopColor={p.lo} />
            <Stop offset="0.22" stopColor={p.hi} />
            <Stop offset="0.36" stopColor={p.spec} />
            <Stop offset="0.58" stopColor={p.mid} />
            <Stop offset="0.86" stopColor={p.lo} />
            <Stop offset="1" stopColor={p.deep} />
          </LinearGradient>

          {/* Vertical metallic gradient */}
          <LinearGradient id={id("metalV")} x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0" stopColor={p.hi} />
            <Stop offset="0.45" stopColor={p.mid} />
            <Stop offset="1" stopColor={p.lo} />
          </LinearGradient>

          {/* Lit 3D face gradient */}
          <LinearGradient id={id("metalLit")} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0" stopColor={p.spec} />
            <Stop offset="0.48" stopColor={p.hi} />
            <Stop offset="1" stopColor={p.mid} />
          </LinearGradient>

          {/* Shaded 3D right/extruded face gradient */}
          <LinearGradient id={id("metalDark")} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0" stopColor={p.mid} />
            <Stop offset="0.55" stopColor={p.lo} />
            <Stop offset="1" stopColor={p.deep} />
          </LinearGradient>

          {/* Recessed concave interior gradient */}
          <LinearGradient id={id("metalInner")} x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0" stopColor={p.deep} />
            <Stop offset="0.6" stopColor={p.lo} />
            <Stop offset="1" stopColor={p.mid} />
          </LinearGradient>

          {/* Spherical 3D metallic gradient */}
          <RadialGradient id={id("sphere")} cx="34%" cy="30%" rx="65%" ry="65%">
            <Stop offset="0" stopColor={p.spec} />
            <Stop offset="0.32" stopColor={p.hi} />
            <Stop offset="0.68" stopColor={p.mid} />
            <Stop offset="1" stopColor={p.deep} />
          </RadialGradient>

          {/* Sculpted 3D flame */}
          <LinearGradient id={id("flame")} x1="30%" y1="0%" x2="70%" y2="100%">
            <Stop offset="0" stopColor={earned ? "#FFE869" : "#3E4654"} />
            <Stop offset="0.48" stopColor={earned ? "#FF8A1F" : "#292F3A"} />
            <Stop offset="1" stopColor={earned ? "#CC3B0A" : "#181C24"} />
          </LinearGradient>
          <LinearGradient id={id("flameCore")} x1="50%" y1="0%" x2="50%" y2="100%">
            <Stop offset="0" stopColor={earned ? "#FFFBE0" : "#4E5766"} />
            <Stop offset="0.6" stopColor={earned ? "#FFD54A" : "#333A46"} />
            <Stop offset="1" stopColor={earned ? "#FF9224" : "#222731"} />
          </LinearGradient>

          {/* Polished wooden spoon gradient */}
          <LinearGradient id={id("woodSpoon")} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0" stopColor="#D69E68" />
            <Stop offset="0.5" stopColor="#A86E3B" />
            <Stop offset="1" stopColor="#6B3E18" />
          </LinearGradient>

          {/* Metallic padlock gradient for locked trophies */}
          <LinearGradient id={id("lockMetal")} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0" stopColor="#F2F6FA" />
            <Stop offset="0.45" stopColor="#B8C4D4" />
            <Stop offset="1" stopColor="#647285" />
          </LinearGradient>
        </Defs>

        {/* Ambient radial glow */}
        <Ellipse cx={80} cy={88} rx={74} ry={76} fill={`url(#${id("ambient")})`} />

        {/* Grounded contact shadow on the shelf */}
        <Ellipse cx={80} cy={196} rx={58} ry={11} fill={p.shadow} opacity={0.62} />

        {/* Sculpted 3D Beveled Pedestal (Octagonal / Isometric Plinth) */}
        <G>
          {/* Lower stepped lip */}
          <Path d="M 28 180 L 42 192 H 118 L 132 180 L 126 172 H 34 Z" fill={p.plinthDeep} />
          <Path d="M 32 178 L 44 188 H 116 L 128 178" fill="none" stroke={p.plinthTop} strokeWidth={1.6} opacity={0.65} />

          {/* Main Plinth Faces: Left (lit), Front (mid), Right (deep) */}
          <Polygon points="36,144 48,154 48,182 36,174" fill={p.plinthLeft} />
          <Polygon points="48,154 112,154 112,182 48,182" fill={p.plinthLeft} />
          <Polygon points="80,154 112,154 112,182 80,182" fill={p.plinthRight} opacity={0.55} />
          <Polygon points="112,154 124,144 124,174 112,182" fill={p.plinthRight} />

          {/* Top Chamfered Deck */}
          <Polygon points="48,136 112,136 124,144 112,154 48,154 36,144" fill={p.plinthTop} />
          {/* Crisp top edge specular highlight */}
          <Path d="M 38 144 L 49 154 H 111 L 122 144" fill="none" stroke={p.rim} strokeWidth={1.4} opacity={earned ? 0.42 : 0.2} />

          {/* Contact shadow cast by trophy onto plinth top */}
          <Ellipse cx={80} cy={143} rx={28} ry={6.5} fill={p.plinthDeep} opacity={0.65} />

          {/* Beveled Metallic Front Nameplate */}
          <Rect x={57} y={161} width={46} height={14} rx={2.5} fill={p.plinthDeep} />
          <Rect x={58} y={160} width={44} height={13} rx={2} fill={M} opacity={earned ? 0.96 : 0.42} />
          <Path d="M 60 161.5 H 100" stroke={p.spec} strokeWidth={1} opacity={earned ? 0.7 : 0.2} />
        </G>

        {/* Trophy Hardware */}
        {art}

        {/* Matte Obsidian Locked Padlock Overlay */}
        {!earned ? <LockedPadlock id={id} /> : null}
      </Svg>

      {/* Stamped Emblem Icon on Earned Cups, Medals & Shields */}
      {earned && iconY !== undefined && icon ? (
        <View
          pointerEvents="none"
          style={[
            styles.iconWrap,
            {
              top: (iconY / 210) * h - size * 0.13,
              width: size,
              height: size * 0.26,
            },
          ]}
        >
          <MaterialCommunityIcons name={icon as never} size={size * 0.23} color={p.iconInk} />
        </View>
      ) : null}
    </View>
  );
}

export default memo(TrophyArt);

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrap: {
    position: "absolute",
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
