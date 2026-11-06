import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { memo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Polygon, Rect, Stop } from "react-native-svg";
import { ACHIEVEMENTS, METALS, type TrophyMetal } from "@/constants/achievements";
import type { TrophyItem } from "@/constants/leagueTypes";

/**
 * Every trophy and achievement drawn as its own piece of hardware: a cup, a
 * championship belt, a torch, a crown… on a wooden plinth. One SVG per design
 * in a 64 × 84 box; the metal sets the colours.
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
export function trophyLook(t: Pick<TrophyItem, "id" | "kind" | "achievementId">): { design: TrophyDesign; metal: TrophyMetal; icon: string } {
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

const LOCKED = { hi: "#3A414B", mid: "#262B33", lo: "#171A20" };
/** Where (in the 84-high box) the design's icon is stamped, if it has one. */
const ICON_Y: Partial<Record<TrophyDesign, number>> = { cup: 22, medal: 34, shield: 26, lovingCup: 24, bowl: 18 };

function TrophyArt({
  design,
  metal,
  earned = true,
  size,
  icon,
  uid = "t",
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
  const m = earned ? METALS[metal] : LOCKED;
  const h = size * (84 / 64);
  const id = `ta_${uid}_${design}_${size}`;
  const M = `url(#${id}_m)`;
  const V = `url(#${id}_v)`;
  const iconColor = earned ? (metal === "silver" || metal === "platinum" ? "#24313A" : "#4A2C05") : "rgba(255,255,255,0.35)";
  const ribbonA = earned ? "#C62F3B" : "#2A2F36";
  const ribbonB = earned ? "#2850B8" : "#30363F";
  const flame = earned ? "#FF7A1A" : "#2C3138";
  const flameCore = earned ? "#FFD84A" : "#3A3F46";
  const leaf = earned ? m.mid : LOCKED.mid;
  const iconY = ICON_Y[design];

  const art = (() => {
    switch (design) {
      case "cup":
        return (
          <>
            <Path d="M16 13 C3 13 4 34 21 36" stroke={m.mid} strokeWidth={3.5} fill="none" />
            <Path d="M48 13 C61 13 60 34 43 36" stroke={m.mid} strokeWidth={3.5} fill="none" />
            <Path d="M14 8 H50 V16 C50 32 42 40 32 41 C22 40 14 32 14 16 Z" fill={M} />
            <Rect x={12} y={5.5} width={40} height={4.5} rx={2} fill={m.hi} />
            <Path d="M29 41 H35 L36.5 52 H27.5 Z" fill={M} />
            <Rect x={24} y={51} width={16} height={4} rx={2} fill={m.mid} />
          </>
        );
      case "lovingCup":
        return (
          <>
            <Path d="M22 14 C6 10 6 36 24 38" stroke={m.mid} strokeWidth={3} fill="none" />
            <Path d="M42 14 C58 10 58 36 40 38" stroke={m.mid} strokeWidth={3} fill="none" />
            <Path d="M22 6 H42 L40 12 C46 18 46 32 38 40 H26 C18 32 18 18 24 12 Z" fill={M} />
            <Ellipse cx={32} cy={6} rx={11} ry={2.5} fill={m.hi} />
            <Rect x={29} y={40} width={6} height={8} fill={M} />
            <Ellipse cx={32} cy={50} rx={9} ry={3} fill={m.mid} />
            <Rect x={26} y={51} width={12} height={4} fill={m.lo} />
          </>
        );
      case "bowl":
        return (
          <>
            <Path d="M6 12 H58 C56 26 46 32 32 32 C18 32 8 26 6 12 Z" fill={M} />
            <Ellipse cx={32} cy={12} rx={26} ry={4} fill={m.hi} />
            <Rect x={30} y={32} width={4} height={16} fill={M} />
            <Path d="M22 55 C22 49 42 49 42 55 Z" fill={m.mid} />
          </>
        );
      case "medal":
        return (
          <>
            <Path d="M20 2 H29 L35 22 H26 Z" fill={ribbonA} />
            <Path d="M44 2 H35 L29 22 H38 Z" fill={ribbonB} />
            <Circle cx={32} cy={34} r={17} fill={M} />
            <Circle cx={32} cy={34} r={13} fill="none" stroke={m.hi} strokeWidth={1.2} opacity={0.8} />
            <Rect x={29} y={50} width={6} height={5} fill={m.mid} />
          </>
        );
      case "laurel":
        return (
          <>
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const a = (-200 + i * 26) * (Math.PI / 180);
              const b = (20 - i * 26) * (Math.PI / 180);
              const p = (ang: number) => [32 + Math.cos(ang) * 20, 30 + Math.sin(ang) * 20];
              const [x1, y1] = p(a);
              const [x2, y2] = p(b);
              return (
                <G key={i}>
                  <Ellipse cx={x1} cy={y1} rx={4.5} ry={2} fill={leaf} transform={`rotate(${(a * 180) / Math.PI + 90} ${x1} ${y1})`} />
                  <Ellipse cx={x2} cy={y2} rx={4.5} ry={2} fill={leaf} transform={`rotate(${(b * 180) / Math.PI + 90} ${x2} ${y2})`} />
                </G>
              );
            })}
            <Circle cx={32} cy={30} r={12} fill={M} />
            <Polygon points="32,22 34.4,27.6 40.4,28 35.8,31.8 37.3,37.6 32,34.4 26.7,37.6 28.2,31.8 23.6,28 29.6,27.6" fill={m.hi} />
            <Path d="M26 46 L32 42 L38 46 L36 55 H28 Z" fill={ribbonA} />
          </>
        );
      case "star":
        return (
          <>
            <Polygon points="32,3 38.5,17.5 54,19 42.3,29.5 45.8,45 32,37 18.2,45 21.7,29.5 10,19 25.5,17.5" fill={M} />
            <Polygon points="32,10 36,19.5 46,20.5 38.5,27.3 40.7,37.3 32,32 23.3,37.3 25.5,27.3 18,20.5 28,19.5" fill="none" stroke={m.hi} strokeWidth={1} />
            <Rect x={29.5} y={40} width={5} height={12} fill={M} />
            <Rect x={25} y={51} width={14} height={4} rx={1.5} fill={m.mid} />
          </>
        );
      case "risingStar":
        return (
          <>
            <Path d="M24 8 L14 4 M40 8 L50 4 M22 16 L10 16 M42 16 L54 16" stroke={m.hi} strokeWidth={1.6} strokeLinecap="round" />
            <Polygon points="32,2 35.5,10 44,10.8 37.6,16.6 39.4,25 32,20.6 24.6,25 26.4,16.6 20,10.8 28.5,10" fill={M} />
            <Path d="M28 24 H36 L37.5 52 H26.5 Z" fill={M} />
            <Path d="M29.5 28 H34.5" stroke={m.hi} strokeWidth={1} />
            <Path d="M29 34 H35 M28.6 40 H35.4 M28.2 46 H35.8" stroke={m.lo} strokeWidth={0.8} opacity={0.6} />
            <Rect x={23} y={51} width={18} height={4} rx={1.5} fill={m.mid} />
          </>
        );
      case "torch":
        return (
          <>
            <Path d="M32 2 C40 10 42 16 38 22 C36 18 34 17 32 20 C30 16 26 18 26 22 C22 16 24 9 32 2 Z" fill={flame} />
            <Path d="M32 9 C36 14 36 18 34 21 C33 19 31 19 30 21 C28 17 29 13 32 9 Z" fill={flameCore} />
            <Path d="M22 22 H42 L40 28 H24 Z" fill={M} />
            <Path d="M25 28 H39 L34 52 H30 Z" fill={M} />
            <Path d="M27 34 H37 M28.4 40 H35.6" stroke={m.lo} strokeWidth={1} opacity={0.7} />
            <Rect x={26} y={51} width={12} height={4} rx={1.5} fill={m.mid} />
          </>
        );
      case "cauldron":
        return (
          <>
            <Path d="M32 1 C44 9 46 18 40 24 C38 19 35 18 33 22 C31 17 26 18 25 24 C18 17 21 8 32 1 Z" fill={flame} />
            <Path d="M20 6 C26 12 25 18 22 22 C19 18 18 12 20 6 Z M44 6 C38 12 39 18 42 22 C45 18 46 12 44 6 Z" fill={flame} opacity={0.85} />
            <Path d="M32 10 C37 15 37 20 34 23 C33 21 31 21 30 23 C27 19 28 14 32 10 Z" fill={flameCore} />
            <Path d="M10 22 H54 C53 36 44 42 32 42 C20 42 11 36 10 22 Z" fill={M} />
            <Ellipse cx={32} cy={22} rx={22} ry={3.5} fill={m.hi} />
            <Path d="M22 41 L18 55 M42 41 L46 55 M32 42 V55" stroke={m.mid} strokeWidth={3} strokeLinecap="round" />
          </>
        );
      case "crown":
        return (
          <>
            <Path d="M10 40 L8 14 L20 26 L32 8 L44 26 L56 14 L54 40 Z" fill={M} />
            <Rect x={9} y={38} width={46} height={7} rx={2} fill={m.mid} />
            {[[8, 14], [32, 8], [56, 14]].map(([x, y], i) => (
              <Circle key={i} cx={x} cy={y} r={3} fill={m.hi} />
            ))}
            {[18, 32, 46].map((x, i) => (
              <Circle key={i} cx={x} cy={41.5} r={2.2} fill={earned ? (i === 1 ? "#D9283A" : "#2A6FDB") : LOCKED.lo} />
            ))}
            <Path d="M14 46 C14 52 50 52 50 46 L50 55 H14 Z" fill={earned ? "#7A1E2E" : "#22262C"} />
          </>
        );
      case "shield":
        return (
          <>
            <Path d="M32 4 L52 10 V26 C52 40 43 48 32 52 C21 48 12 40 12 26 V10 Z" fill={M} />
            <Path d="M32 9 L47 13.5 V26 C47 37 40 43.5 32 47 C24 43.5 17 37 17 26 V13.5 Z" fill="none" stroke={m.hi} strokeWidth={1.2} />
            <Rect x={28} y={51} width={8} height={4} fill={m.mid} />
          </>
        );
      case "obelisk":
        return (
          <>
            <Polygon points="32,2 36,8 38,52 26,52 28,8" fill={M} />
            <Polygon points="32,2 36,8 28,8" fill={m.hi} />
            <Path d="M30 16 H34 M29.6 24 H34.4 M29.2 32 H34.8 M28.8 40 H35.2" stroke={m.lo} strokeWidth={0.9} opacity={0.7} />
            <Rect x={22} y={50} width={20} height={5} rx={1} fill={m.mid} />
          </>
        );
      case "diamond":
        return (
          <>
            <Polygon points="18,14 46,14 54,24 32,50 10,24" fill={M} />
            <Polygon points="18,14 46,14 40,24 24,24" fill={m.hi} opacity={0.9} />
            <Path d="M10 24 H54 M24 24 L32 50 L40 24 M18 14 L24 24 M46 14 L40 24 M32 14 V24" stroke={m.lo} strokeWidth={0.8} opacity={0.6} fill="none" />
            <Path d="M26 52 H38 L36 55 H28 Z" fill={m.mid} />
          </>
        );
      case "globe":
        return (
          <>
            <Path d="M14 30 C14 44 22 50 32 50 C42 50 50 44 50 30" stroke={m.mid} strokeWidth={3} fill="none" />
            <Circle cx={32} cy={24} r={17} fill={M} />
            <Ellipse cx={32} cy={24} rx={7} ry={17} fill="none" stroke={m.lo} strokeWidth={1} opacity={0.7} />
            <Path d="M15 24 H49 M17.5 15 H46.5 M17.5 33 H46.5" stroke={m.lo} strokeWidth={1} opacity={0.7} />
            <Rect x={29} y={49} width={6} height={6} fill={m.mid} />
          </>
        );
      case "belt":
        return (
          <>
            <Path d="M2 26 C10 22 18 21 22 22 L22 40 C18 39 10 40 2 44 Z" fill={earned ? "#1E1E22" : "#22262C"} />
            <Path d="M62 26 C54 22 46 21 42 22 L42 40 C46 39 54 40 62 44 Z" fill={earned ? "#1E1E22" : "#22262C"} />
            {[6, 12, 52, 58].map((x) => (
              <Circle key={x} cx={x} cy={33} r={2.2} fill={m.mid} />
            ))}
            <Ellipse cx={32} cy={31} rx={14} ry={16} fill={M} />
            <Ellipse cx={32} cy={31} rx={10} ry={12} fill="none" stroke={m.hi} strokeWidth={1.2} />
            <Polygon points="32,23 34.2,28.4 40,28.8 35.6,32.5 37,38 32,35 27,38 28.4,32.5 24,28.8 29.8,28.4" fill={earned ? "#D9283A" : LOCKED.lo} />
            <Rect x={27} y={48} width={10} height={7} fill={m.mid} />
          </>
        );
      case "lock":
        return (
          <>
            <Path d="M22 26 V18 C22 10 26 6 32 6 C38 6 42 10 42 18 V26" stroke={M} strokeWidth={5} fill="none" />
            <Rect x={16} y={24} width={32} height={26} rx={4} fill={M} />
            <Circle cx={32} cy={34} r={3.5} fill={m.lo} />
            <Rect x={30.6} y={35} width={2.8} height={8} rx={1} fill={m.lo} />
            <Rect x={28} y={50} width={8} height={5} fill={m.mid} />
          </>
        );
      case "bolt":
        return (
          <>
            <Polygon points="36,2 16,30 29,30 24,52 48,20 34,20 40,2" fill={M} />
            <Polygon points="36,2 40,2 34,20 31,20" fill={m.hi} opacity={0.8} />
            <Rect x={22} y={51} width={20} height={4} rx={1.5} fill={m.mid} />
          </>
        );
      case "spoon":
      default:
        return (
          <>
            <Path d="M32 4 C22 4 20 14 20 20 C20 28 26 32 30 33 L29 55 H35 L34 33 C38 32 44 28 44 20 C44 14 42 4 32 4 Z" fill={earned ? "#9A6A3C" : m.mid} />
            <Path d="M26 12 C27 8 30 7 32 7" stroke="rgba(255,255,255,0.35)" strokeWidth={1.5} fill="none" />
          </>
        );
    }
  })();

  return (
    <View style={{ width: size, height: h }}>
      {earned ? <View style={[styles.glow, { width: size * 0.9, height: size * 0.9, borderRadius: size, left: size * 0.05, top: h * 0.05, backgroundColor: m.mid }]} /> : null}
      <Svg width={size} height={h} viewBox="0 0 64 84">
        <Defs>
          <LinearGradient id={`${id}_m`} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={m.lo} />
            <Stop offset="0.35" stopColor={m.hi} />
            <Stop offset="0.6" stopColor={m.mid} />
            <Stop offset="1" stopColor={m.lo} />
          </LinearGradient>
          <LinearGradient id={`${id}_v`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={earned ? "#4A2D16" : "#20242A"} />
            <Stop offset="1" stopColor={earned ? "#22130A" : "#121418"} />
          </LinearGradient>
        </Defs>
        {art}
        <Path d="M20 55 H44 L46.5 72 H17.5 Z" fill={V} />
        <Rect x={17} y={71} width={30} height={4} rx={1} fill={earned ? "#1A0E06" : "#0E1013"} />
        <Rect x={24} y={60} width={16} height={6} rx={1} fill={m.mid} opacity={earned ? 1 : 0.6} />
      </Svg>
      {(iconY !== undefined && icon) || !earned ? (
        <View pointerEvents="none" style={[styles.iconWrap, { top: ((iconY ?? 30) / 84) * h - size * 0.13, width: size, height: size * 0.26 }]}>
          <MaterialCommunityIcons name={(earned ? icon : "lock") as never} size={size * 0.24} color={iconColor} />
        </View>
      ) : null}
    </View>
  );
}

export default memo(TrophyArt);

const styles = StyleSheet.create({
  glow: { position: "absolute", opacity: 0.16 },
  iconWrap: { position: "absolute", left: 0, alignItems: "center", justifyContent: "center" },
});
