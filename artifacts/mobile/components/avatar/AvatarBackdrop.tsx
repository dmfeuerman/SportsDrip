import React, { createContext, memo, useContext, useMemo, useRef } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";
import Svg, { Circle, Defs, Ellipse, G, Line, LinearGradient, Path, Polygon, RadialGradient, Rect, Stop } from "react-native-svg";
import { backgroundOf } from "@/constants/backgrounds";
import { useColors, type Colors } from "@/hooks/useColors";

/**
 * The scene behind a character (constants/backgrounds.ts). Static SVG in a
 * 100 × 140 box, cropped to fill whatever it sits in — the hero card, a store
 * thumbnail, the preview sheet. The 3D canvas above it is transparent, and
 * the character stands around x 50, feet near y 122.
 *
 * Every scene is drawn from fixed numbers (a seeded generator for stars,
 * crowds and windows), so it renders the same on every device and every
 * frame, and memoises to one draw.
 */
/** Camera zoom (1 = default framing) and pan in px, written by the live stage each frame. */
export interface BackdropCam {
  s: number;
  x: number;
  y: number;
}
export const useBackdropCam = () => useSharedValue<BackdropCam>({ s: 1, x: 0, y: 0 });

/** A backdrop that zooms and pans with the stage's camera (pass the same `cam` to the stage). */
export function ZoomingBackdrop({
  id,
  cam,
  align = "mid",
  offsetY = 0,
  baseScale = 1,
}: {
  id: string | null | undefined;
  cam: SharedValue<BackdropCam>;
  align?: "mid" | "top";
  offsetY?: number;
  baseScale?: number;
}) {
  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: cam.value.x },
      { translateY: cam.value.y + offsetY },
      { scale: cam.value.s * baseScale },
    ],
  }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <AvatarBackdropMemo id={id} align={align} />
    </Animated.View>
  );
}

function AvatarBackdrop({ id, style, align = "mid" }: { id: string | null | undefined; style?: StyleProp<ViewStyle>; align?: "mid" | "top" }) {
  const c = useColors();
  const scene = backgroundOf(id);
  // Gradient ids are document-global on web; a suffix keeps two backdrops on one screen apart.
  const suffix = useRef(`_${++instances}`).current;
  return (
    <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <IdSuffix.Provider value={suffix}>
      <Svg width="100%" height="100%" viewBox="0 0 100 140" preserveAspectRatio={align === "top" ? "xMidYMin slice" : "xMidYMid slice"}>
        {scene === "locker_room" ? <LockerRoom c={c} /> : null}
        {scene === "liquid_glass" ? <LiquidGlass /> : null}
        {scene === "night_stadium" ? <NightStadium /> : null}
        {scene === "hardwood_court" ? <Hardwood /> : null}
        {scene === "beach_court" ? <Beach /> : null}
        {scene === "sunset_field" ? <Sunset /> : null}
        {scene === "ice_rink" ? <IceRink /> : null}
        {scene === "neon_city" ? <NeonCity /> : null}
        {scene === "confetti_podium" ? <Podium /> : null}
        {scene === "gold_vault" ? <GoldVault /> : null}
        {scene === "champions_hall" ? <ChampionsHall /> : null}
        {scene === "galaxy" ? <Galaxy /> : null}
        <Vignette strength={scene === "locker_room" ? (c.isDark ? 0.35 : 0.08) : 0.5} />
      </Svg>
      </IdSuffix.Provider>
    </View>
  );
}

const AvatarBackdropMemo = memo(AvatarBackdrop);
export default AvatarBackdropMemo;

let instances = 0;
const IdSuffix = createContext("");

/** True when the scene is drawn in fixed (dark) colours rather than the theme. */
export function isSceneBackdrop(id: string | null | undefined): boolean {
  return backgroundOf(id) !== "locker_room";
}

// ── helpers ─────────────────────────────────────────────────────────────────

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function Vignette({ strength }: { strength: number }) {
  const u = useContext(IdSuffix);
  return (
    <>
      <Defs>
        <RadialGradient id={`bdVig${u}`} cx="50%" cy="46%" rx="72%" ry="62%">
          <Stop offset="0.55" stopColor="#000" stopOpacity="0" />
          <Stop offset="1" stopColor="#000" stopOpacity={strength} />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="140" fill={`url(#bdVig${u})`} />
    </>
  );
}

/** Soft light where the character stands. */
function Spot({ color, opacity = 0.22, cy = 56 }: { color: string; opacity?: number; cy?: number }) {
  const u = useContext(IdSuffix);
  return (
    <>
      <Defs>
        <RadialGradient id={`bdSpot${u}`} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor={color} stopOpacity={opacity} />
          <Stop offset="1" stopColor={color} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Ellipse cx="50" cy={cy} rx="46" ry="52" fill={`url(#bdSpot${u})`} />
    </>
  );
}

function Stars({ seed, count, maxY, color = "#FFFFFF", maxR = 0.45 }: { seed: number; count: number; maxY: number; color?: string; maxR?: number }) {
  const pts = useMemo(() => {
    const r = rng(seed);
    return Array.from({ length: count }, () => ({ x: r() * 100, y: r() * maxY, r: 0.12 + r() * maxR, o: 0.35 + r() * 0.65 }));
  }, [seed, count, maxY, maxR]);
  return (
    <G>
      {pts.map((p, i) => (
        <Circle key={i} cx={p.x} cy={p.y} r={p.r} fill={color} opacity={p.o} />
      ))}
    </G>
  );
}

function Sparkle({ x, y, s, color, opacity = 0.9 }: { x: number; y: number; s: number; color: string; opacity?: number }) {
  return <Path d={`M${x} ${y - s} L${x + s * 0.22} ${y - s * 0.22} L${x + s} ${y} L${x + s * 0.22} ${y + s * 0.22} L${x} ${y + s} L${x - s * 0.22} ${y + s * 0.22} L${x - s} ${y} L${x - s * 0.22} ${y - s * 0.22} Z`} fill={color} opacity={opacity} />;
}

/** Rows of tiny coloured dots: a crowd in the stands. */
function Crowd({ seed, y0, y1, colors, opacity = 0.55 }: { seed: number; y0: number; y1: number; colors: string[]; opacity?: number }) {
  const dots = useMemo(() => {
    const r = rng(seed);
    const out: Array<{ x: number; y: number; c: string }> = [];
    for (let y = y0 + 1.2; y < y1; y += 2.2) {
      for (let x = 0.8; x < 100; x += 1.9) out.push({ x: x + (r() - 0.5) * 0.8, y: y + (r() - 0.5) * 0.5, c: colors[Math.floor(r() * colors.length)]! });
    }
    return out;
  }, [seed, y0, y1, colors]);
  return (
    <G opacity={opacity}>
      {dots.map((d, i) => (
        <Circle key={i} cx={d.x} cy={d.y} r={0.55} fill={d.c} />
      ))}
    </G>
  );
}

// ── scenes ──────────────────────────────────────────────────────────────────

function LockerRoom({ c }: { c: Colors }) {
  const u = useContext(IdSuffix);
  const line = c.alpha(c.foreground, c.isDark ? 0.07 : 0.08);
  const fill = c.alpha(c.foreground, c.isDark ? 0.035 : 0.03);
  return (
    <>
      <Defs>
        <LinearGradient id={`lrGlow${u}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={c.primary} stopOpacity={c.isDark ? 0.16 : 0.1} />
          <Stop offset="0.55" stopColor={c.primary} stopOpacity="0" />
          <Stop offset="1" stopColor={c.primary} stopOpacity={c.isDark ? 0.22 : 0.12} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="140" fill={c.elevated} />
      {Array.from({ length: 6 }, (_, i) => {
        const x = 1 + i * 16.6;
        return (
          <G key={i}>
            <Rect x={x} y="14" width="15" height="70" rx="1" fill={fill} stroke={line} strokeWidth="0.4" />
            {[19, 21.2, 23.4].map((y) => (
              <Line key={y} x1={x + 4} y1={y} x2={x + 11} y2={y} stroke={line} strokeWidth="0.6" />
            ))}
            <Rect x={x + 11.5} y="47" width="1.4" height="5" rx="0.6" fill={line} />
          </G>
        );
      })}
      <Rect x="0" y="84" width="100" height="56" fill={fill} />
      <Line x1="0" y1="84" x2="100" y2="84" stroke={c.alpha(c.primary, 0.28)} strokeWidth="0.4" />
      <Rect x="6" y="87" width="88" height="2.6" rx="1.2" fill={c.alpha(c.foreground, c.isDark ? 0.06 : 0.07)} />
      <Rect x="0" y="0" width="100" height="140" fill={`url(#lrGlow${u})`} />
    </>
  );
}

function LiquidGlass() {
  const u = useContext(IdSuffix);
  const orbs = [
    { cx: 14, cy: 62, r: 4.8, o: 0.42 },
    { cx: 83, cy: 52, r: 4.2, o: 0.36 },
    { cx: 86, cy: 76, r: 6.4, o: 0.48 },
    { cx: 19, cy: 84, r: 2.8, o: 0.32 },
    { cx: 76, cy: 36, r: 2.2, o: 0.28 },
  ];
  return (
    <>
      <Defs>
        <LinearGradient id={`lgBg${u}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#05080F" />
          <Stop offset="0.48" stopColor="#0A1324" />
          <Stop offset="0.74" stopColor="#0E1C33" />
          <Stop offset="1" stopColor="#060912" />
        </LinearGradient>
        <RadialGradient id={`lgAura${u}`} cx="50%" cy="44%" rx="52%" ry="42%">
          <Stop offset="0" stopColor="#38BDF8" stopOpacity="0.20" />
          <Stop offset="0.52" stopColor="#1E3A5F" stopOpacity="0.12" />
          <Stop offset="1" stopColor="#0A1324" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id={`lgTeal${u}`} cx="24%" cy="30%" rx="40%" ry="34%">
          <Stop offset="0" stopColor="#2DD4BF" stopOpacity="0.11" />
          <Stop offset="1" stopColor="#2DD4BF" stopOpacity="0" />
        </RadialGradient>
        <LinearGradient id={`lgFloor${u}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#13223A" stopOpacity="0.78" />
          <Stop offset="0.35" stopColor="#0A1220" stopOpacity="0.94" />
          <Stop offset="1" stopColor="#05080F" stopOpacity="1" />
        </LinearGradient>
        <LinearGradient id={`lgHorizon${u}`} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#93C5FD" stopOpacity="0" />
          <Stop offset="0.5" stopColor="#E0F2FE" stopOpacity="0.34" />
          <Stop offset="1" stopColor="#93C5FD" stopOpacity="0" />
        </LinearGradient>
        <RadialGradient id={`lgPool${u}`} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor="#E0F2FE" stopOpacity="0.26" />
          <Stop offset="0.48" stopColor="#60A5FA" stopOpacity="0.12" />
          <Stop offset="1" stopColor="#0A1220" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id={`lgOrb${u}`} cx="34%" cy="28%" rx="66%" ry="66%">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.46" />
          <Stop offset="0.45" stopColor="#93C5FD" stopOpacity="0.16" />
          <Stop offset="1" stopColor="#0B1528" stopOpacity="0.05" />
        </RadialGradient>
      </Defs>

      {/* Deep obsidian-to-indigo studio backdrop */}
      <Rect x="0" y="0" width="100" height="140" fill={`url(#lgBg${u})`} />
      <Rect x="0" y="0" width="100" height="140" fill={`url(#lgAura${u})`} />
      <Rect x="0" y="0" width="100" height="140" fill={`url(#lgTeal${u})`} />

      {/* Soft studio light shaft from top */}
      <Polygon points="24,0 76,0 92,102 8,102" fill="#BAE6FD" opacity="0.035" />

      {/* Floating Liquid Glass orbs */}
      {orbs.map((b, i) => (
        <G key={i} opacity={b.o}>
          <Circle cx={b.cx} cy={b.cy} r={b.r} fill={`url(#lgOrb${u})`} stroke="#E0F2FE" strokeOpacity="0.38" strokeWidth="0.35" />
          <Path
            d={`M${b.cx - b.r * 0.55} ${b.cy - b.r * 0.35} A${b.r * 0.68} ${b.r * 0.68} 0 0 1 ${b.cx + b.r * 0.25} ${b.cy - b.r * 0.58}`}
            stroke="#FFFFFF"
            strokeOpacity="0.65"
            strokeWidth="0.35"
            strokeLinecap="round"
            fill="none"
          />
        </G>
      ))}

      {/* Reflective obsidian glass floor */}
      <Rect x="0" y="98" width="100" height="42" fill={`url(#lgFloor${u})`} />
      <Rect x="0" y="97.6" width="100" height="0.7" fill={`url(#lgHorizon${u})`} />

      {/* Specular floor reflection beneath avatar's feet */}
      <Ellipse cx="50" cy="119" rx="38" ry="10.5" fill={`url(#lgPool${u})`} />
      <Ellipse cx="50" cy="119" rx="22" ry="4.6" fill="none" stroke="#E0F2FE" strokeOpacity="0.22" strokeWidth="0.35" />
      <Spot color="#93C5FD" opacity={0.14} cy={50} />
    </>
  );
}

function NightStadium() {
  const u = useContext(IdSuffix);
  return (
    <>
      <Defs>
        <LinearGradient id={`nsSky${u}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#03060F" />
          <Stop offset="1" stopColor="#0E1C3D" />
        </LinearGradient>
        <LinearGradient id={`nsField${u}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#13643C" />
          <Stop offset="1" stopColor="#08301D" />
        </LinearGradient>
        <LinearGradient id={`nsBeam${u}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFF6D5" stopOpacity="0.32" />
          <Stop offset="1" stopColor="#FFF6D5" stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="70" fill={`url(#nsSky${u})`} />
      <Stars seed={7} count={26} maxY={38} />
      <Polygon points="0,44 100,44 100,70 0,70" fill="#0A1024" />
      <Crowd seed={11} y0={45} y1={69} colors={["#FF4D63", "#4C9BFF", "#FFFFFF", "#FFC23D", "#2FE38A"]} opacity={0.5} />
      <Rect x="0" y="68.5" width="100" height="1.6" fill="#1D2A4A" />
      {[8, 92].map((x) => (
        <G key={x}>
          <Polygon points={`${x},14 ${x < 50 ? 60 : 40},102 ${x < 50 ? 30 : 70},102`} fill={`url(#nsBeam${u})`} />
          <Rect x={x - 0.5} y="16" width="1" height="30" fill="#1B2440" />
          <Rect x={x - 6} y="9" width="12" height="7" rx="0.8" fill="#1B2440" />
          {[0, 1, 2].map((r) =>
            [0, 1, 2, 3].map((col) => <Circle key={`${r}${col}`} cx={x - 4.2 + col * 2.8} cy={10.8 + r * 1.9} r="0.8" fill="#FFF6D5" />)
          )}
          <Ellipse cx={x} cy="12.5" rx="10" ry="7" fill="#FFF6D5" opacity="0.12" />
        </G>
      ))}
      <Rect x="0" y="70" width="100" height="70" fill={`url(#nsField${u})`} />
      {Array.from({ length: 9 }, (_, i) => (
        <Rect key={i} x="0" y={70 + i * 8} width="100" height="4" fill="#FFFFFF" opacity="0.035" />
      ))}
      <Line x1="0" y1="82" x2="100" y2="82" stroke="#FFFFFF" strokeWidth="0.45" opacity="0.4" />
      <Ellipse cx="50" cy="96" rx="28" ry="6.5" fill="none" stroke="#FFFFFF" strokeWidth="0.45" opacity="0.38" />
      <Spot color="#FFF6D5" opacity={0.16} />
    </>
  );
}

function Hardwood() {
  const u = useContext(IdSuffix);
  const planks = [72, 75.5, 79.5, 84, 89.5, 96, 103.5, 112, 122, 133];
  return (
    <>
      <Defs>
        <LinearGradient id={`hwArena${u}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#0B0908" />
          <Stop offset="1" stopColor="#21160E" />
        </LinearGradient>
        <LinearGradient id={`hwFloor${u}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#B87736" />
          <Stop offset="1" stopColor="#E0A35E" />
        </LinearGradient>
        <RadialGradient id={`hwShine${u}`} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.28" />
          <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="70" fill={`url(#hwArena${u})`} />
      <Crowd seed={23} y0={32} y1={66} colors={["#FFB74D", "#FFFFFF", "#E53935", "#90A4AE"]} opacity={0.32} />
      <Rect x="34" y="6" width="32" height="14" rx="1.5" fill="#111" stroke="#3A2B1C" strokeWidth="0.6" />
      <Rect x="36" y="8" width="12.5" height="10" rx="0.8" fill="#E53935" opacity="0.85" />
      <Rect x="51.5" y="8" width="12.5" height="10" rx="0.8" fill="#1E88E5" opacity="0.85" />
      <Ellipse cx="50" cy="13" rx="26" ry="12" fill="#FFB74D" opacity="0.08" />
      {[18, 50, 82].map((x) => (
        <Polygon key={x} points={`${x - 1.5},0 ${x + 1.5},0 ${x + 14},70 ${x - 14},70`} fill="#FFE0B2" opacity="0.05" />
      ))}
      <Rect x="0" y="70" width="100" height="70" fill={`url(#hwFloor${u})`} />
      {planks.map((y) => (
        <Line key={y} x1="0" y1={y} x2="100" y2={y} stroke="#6E4320" strokeWidth="0.3" opacity="0.4" />
      ))}
      <Polygon points="37,70 63,70 73,140 27,140" fill="#8E2430" opacity="0.6" />
      <Line x1="0" y1="70" x2="100" y2="70" stroke="#FFFFFF" strokeWidth="0.7" opacity="0.85" />
      <Polygon points="37,70 63,70 73,140 27,140" fill="none" stroke="#FFFFFF" strokeWidth="0.6" opacity="0.8" />
      <Ellipse cx="50" cy="85" rx="12" ry="3.6" fill="none" stroke="#FFFFFF" strokeWidth="0.6" opacity="0.8" />
      <Ellipse cx="50" cy="96" rx="34" ry="12" fill={`url(#hwShine${u})`} />
      <Spot color="#FFE0B2" opacity={0.14} />
    </>
  );
}

function Beach() {
  const u = useContext(IdSuffix);
  return (
    <>
      <Defs>
        <LinearGradient id={`bcSky${u}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#2D9CDB" />
          <Stop offset="1" stopColor="#B9E6FA" />
        </LinearGradient>
        <LinearGradient id={`bcSea${u}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#0277BD" />
          <Stop offset="1" stopColor="#26C6DA" />
        </LinearGradient>
        <LinearGradient id={`bcSand${u}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#F6DFAE" />
          <Stop offset="1" stopColor="#D9AE6A" />
        </LinearGradient>
        <RadialGradient id={`bcSun${u}`} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor="#FFF9C4" stopOpacity="0.9" />
          <Stop offset="1" stopColor="#FFF9C4" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="60" fill={`url(#bcSky${u})`} />
      <Circle cx="80" cy="18" r="18" fill={`url(#bcSun${u})`} />
      <Circle cx="80" cy="18" r="7" fill="#FFF59D" />
      {[
        [18, 16, 1],
        [58, 28, 0.8],
        [30, 38, 0.65],
      ].map(([x, y, s], i) => (
        <G key={i} opacity="0.92">
          <Ellipse cx={x} cy={y} rx={9 * s} ry={3 * s} fill="#FFFFFF" />
          <Ellipse cx={x - 4 * s} cy={y - 1.5 * s} rx={4.5 * s} ry={3 * s} fill="#FFFFFF" />
          <Ellipse cx={x + 3 * s} cy={y - 2.2 * s} rx={5 * s} ry={3.6 * s} fill="#FFFFFF" />
        </G>
      ))}
      <Rect x="0" y="58" width="100" height="12" fill={`url(#bcSea${u})`} />
      {[61, 64.5, 68].map((y, i) => (
        <Path key={y} d={`M0 ${y} Q 6 ${y - 1} 12 ${y} T 24 ${y} T 36 ${y} T 48 ${y} T 60 ${y} T 72 ${y} T 84 ${y} T 96 ${y} T 108 ${y}`} stroke="#FFFFFF" strokeWidth="0.35" fill="none" opacity={0.55 - i * 0.12} />
      ))}
      <Path d="M0 70 Q 25 67 50 70 T 100 69 L100 140 L0 140 Z" fill={`url(#bcSand${u})`} />
      <Stars seed={41} count={60} maxY={140} color="#B8894A" maxR={0.25} />
      <Rect x="0" y="0" width="100" height="0" />
      {/* palm on the left */}
      <Path d="M10 98 Q 6 77 13 56 L15.5 56 Q 9.5 77 13.5 98 Z" fill="#7B5532" />
      <G fill="#2E7D32">
        <Path d="M14 56 Q 2 50 -6 58 Q 4 52 14 57 Z" />
        <Path d="M14 56 Q 4 44 -2 44 Q 8 48 14 56 Z" />
        <Path d="M14 56 Q 18 42 30 42 Q 20 47 15 56 Z" />
        <Path d="M14 56 Q 26 50 34 58 Q 24 53 14 57 Z" />
        <Path d="M14 56 Q 12 46 16 38 Q 15 47 15 56 Z" />
      </G>
      <Circle cx="13.5" cy="57.5" r="1.4" fill="#5D4037" />
      {/* beach ball */}
      <G>
        <Circle cx="82" cy="96" r="4.8" fill="#FFFFFF" />
        <Path d="M82 91.2 A4.8 4.8 0 0 1 86.8 96 L82 96 Z" fill="#E53935" />
        <Path d="M82 100.8 A4.8 4.8 0 0 1 77.2 96 L82 96 Z" fill="#1E88E5" />
        <Path d="M77.2 96 A4.8 4.8 0 0 1 82 91.2 L82 96 Z" fill="#FFC107" />
        <Circle cx="82" cy="96" r="4.8" fill="none" stroke="#000" strokeOpacity="0.15" strokeWidth="0.3" />
      </G>
      <Spot color="#FFFFFF" opacity={0.18} />
    </>
  );
}

function Sunset() {
  const u = useContext(IdSuffix);
  return (
    <>
      <Defs>
        <LinearGradient id={`ssSky${u}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#24104F" />
          <Stop offset="0.45" stopColor="#C2366B" />
          <Stop offset="0.85" stopColor="#FF9E5E" />
          <Stop offset="1" stopColor="#FFC97A" />
        </LinearGradient>
        <LinearGradient id={`ssField${u}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#3E5A26" />
          <Stop offset="1" stopColor="#1A2C10" />
        </LinearGradient>
        <RadialGradient id={`ssSun${u}`} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor="#FFE29A" stopOpacity="0.85" />
          <Stop offset="1" stopColor="#FFE29A" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="68" fill={`url(#ssSky${u})`} />
      <Stars seed={5} count={12} maxY={20} maxR={0.3} />
      <Circle cx="50" cy="64" r="34" fill={`url(#ssSun${u})`} />
      <Circle cx="50" cy="64" r="14" fill="#FFD27F" />
      {[52, 55, 58].map((y, i) => (
        <Rect key={y} x="30" y={y + i * 0.3} width="40" height={0.9 + i * 0.4} fill="#E2557A" opacity="0.9" />
      ))}
      <Path d="M0 62 Q 14 52 28 60 T 58 58 T 84 54 T 100 58 L100 68 L0 68 Z" fill="#3A1A4A" />
      <Path d="M-4 66 Q 20 58 40 65 T 76 63 T 104 65 L104 70 L-4 70 Z" fill="#2A1236" />
      {[
        [22, 28],
        [27, 25],
        [70, 22],
      ].map(([x, y], i) => (
        <Path key={i} d={`M${x - 1.6} ${y} Q ${x - 0.8} ${y - 1} ${x} ${y} Q ${x + 0.8} ${y - 1} ${x + 1.6} ${y}`} stroke="#2A1236" strokeWidth="0.35" fill="none" />
      ))}
      <Rect x="0" y="68" width="100" height="72" fill={`url(#ssField${u})`} />
      {Array.from({ length: 10 }, (_, i) => (
        <Rect key={i} x="0" y={68 + i * 7.5} width="100" height="3.6" fill="#FFD27F" opacity="0.045" />
      ))}
      <G stroke="#FFD54F" strokeWidth="0.9" opacity="0.85" strokeLinecap="round">
        <Line x1="80" y1="48" x2="80" y2="76" />
        <Line x1="72" y1="48" x2="88" y2="48" />
        <Line x1="72" y1="48" x2="72" y2="28" />
        <Line x1="88" y1="48" x2="88" y2="28" />
      </G>
      <Spot color="#FFD27F" opacity={0.16} />
    </>
  );
}

function IceRink() {
  const u = useContext(IdSuffix);
  return (
    <>
      <Defs>
        <LinearGradient id={`irArena${u}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#070D18" />
          <Stop offset="1" stopColor="#15253F" />
        </LinearGradient>
        <LinearGradient id={`irIce${u}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#DCEEF8" />
          <Stop offset="1" stopColor="#F4FAFD" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="68" fill={`url(#irArena${u})`} />
      <Crowd seed={31} y0={22} y1={46} colors={["#90CAF9", "#FFFFFF", "#E53935", "#1E88E5"]} opacity={0.35} />
      {[20, 50, 80].map((x) => (
        <G key={x}>
          <Polygon points={`${x - 1},0 ${x + 1},0 ${x + 12},68 ${x - 12},68`} fill="#E3F2FD" opacity="0.06" />
          <Rect x={x - 5} y="3" width="10" height="2" rx="1" fill="#E3F2FD" opacity="0.8" />
        </G>
      ))}
      <Rect x="0" y="46" width="100" height="14" fill="#BBDEFB" opacity="0.07" />
      {[0, 20, 40, 60, 80, 100].map((x) => (
        <Line key={x} x1={x} y1="46" x2={x} y2="60" stroke="#E3F2FD" strokeWidth="0.3" opacity="0.25" />
      ))}
      <Rect x="0" y="60" width="100" height="9" fill="#F5F7FA" />
      <Rect x="0" y="60" width="100" height="1.4" fill="#1565C0" />
      <Rect x="0" y="68" width="100" height="0.9" fill="#FFC107" />
      <Rect x="0" y="69" width="100" height="71" fill={`url(#irIce${u})`} />
      <Line x1="0" y1="79" x2="100" y2="79" stroke="#1E88E5" strokeWidth="1.1" opacity="0.55" />
      <Line x1="0" y1="91" x2="100" y2="91" stroke="#E53935" strokeWidth="1.1" opacity="0.6" />
      <Line x1="0" y1="108" x2="100" y2="108" stroke="#1E88E5" strokeWidth="1.1" opacity="0.55" />
      <Ellipse cx="50" cy="96" rx="20" ry="5.2" fill="none" stroke="#E53935" strokeWidth="0.5" opacity="0.6" />
      <Circle cx="50" cy="96" r="0.9" fill="#1E88E5" opacity="0.7" />
      {Array.from({ length: 9 }, (_, i) => (
        <Line key={i} x1={8 + i * 10} y1={74 + (i % 3) * 14} x2={18 + i * 10} y2={76 + (i % 3) * 14} stroke="#FFFFFF" strokeWidth="0.3" opacity="0.8" />
      ))}
      <Ellipse cx="50" cy="86" rx="40" ry="10" fill="#FFFFFF" opacity="0.25" />
      <Spot color="#E3F2FD" opacity={0.12} />
    </>
  );
}

function NeonCity() {
  const u = useContext(IdSuffix);
  const buildings = useMemo(() => {
    const r = rng(99);
    const out: Array<{ x: number; w: number; h: number; win: Array<{ x: number; y: number; c: string }> }> = [];
    let x = -2;
    while (x < 102) {
      const w = 6 + r() * 9;
      const h = 12 + r() * 30;
      const win: Array<{ x: number; y: number; c: string }> = [];
      for (let wy = 78 - h + 3; wy < 75; wy += 3.2) {
        for (let wx = x + 1.5; wx < x + w - 1.5; wx += 2.6) {
          if (r() < 0.42) win.push({ x: wx, y: wy, c: r() < 0.6 ? "#FFD319" : "#00E5FF" });
        }
      }
      out.push({ x, w, h, win });
      x += w + 0.6;
    }
    return out;
  }, []);
  return (
    <>
      <Defs>
        <LinearGradient id={`ncSky${u}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#090221" />
          <Stop offset="0.6" stopColor="#3A0B5C" />
          <Stop offset="1" stopColor="#8E1170" />
        </LinearGradient>
        <LinearGradient id={`ncSun${u}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFD319" />
          <Stop offset="1" stopColor="#FF2E97" />
        </LinearGradient>
        <LinearGradient id={`ncFloor${u}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#1A0636" />
          <Stop offset="1" stopColor="#0A0216" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="78" fill={`url(#ncSky${u})`} />
      <Stars seed={3} count={30} maxY={36} maxR={0.3} />
      <Circle cx="50" cy="44" r="21" fill={`url(#ncSun${u})`} />
      {[48, 53, 58, 62.5].map((y, i) => (
        <Rect key={y} x="26" y={y} width="48" height={1 + i * 0.55} fill="#3A0B5C" />
      ))}
      {buildings.map((b, i) => (
        <G key={i}>
          <Rect x={b.x} y={78 - b.h} width={b.w} height={b.h} fill="#120428" />
          <Rect x={b.x} y={78 - b.h} width={b.w} height="0.5" fill="#FF2E97" opacity="0.7" />
          {b.win.map((w, j) => (
            <Rect key={j} x={w.x} y={w.y} width="1.2" height="1.4" fill={w.c} opacity="0.75" />
          ))}
        </G>
      ))}
      <Rect x="0" y="78" width="100" height="62" fill={`url(#ncFloor${u})`} />
      <Line x1="0" y1="78" x2="100" y2="78" stroke="#00E5FF" strokeWidth="0.6" opacity="0.9" />
      <G stroke="#FF2E97" strokeWidth="0.3" opacity="0.6">
        {[80, 82.5, 85.5, 89.5, 94.5, 101, 109, 119, 131].map((y) => (
          <Line key={y} x1="0" y1={y} x2="100" y2={y} />
        ))}
        {Array.from({ length: 15 }, (_, i) => {
          const bx = -90 + i * 20;
          return <Line key={i} x1="50" y1="78" x2={bx} y2="140" />;
        })}
      </G>
      <Spot color="#FF2E97" opacity={0.14} />
    </>
  );
}

function Podium() {
  const u = useContext(IdSuffix);
  const confetti = useMemo(() => {
    const r = rng(2024);
    const palette = ["#FFC23D", "#FF4D63", "#4C9BFF", "#2FE38A", "#B07BFF", "#FFFFFF"];
    return Array.from({ length: 70 }, () => ({ x: r() * 100, y: r() * 94, w: 0.8 + r() * 1.2, h: 0.4 + r() * 0.6, a: r() * 180, c: palette[Math.floor(r() * palette.length)]! }));
  }, []);
  return (
    <>
      <Defs>
        <RadialGradient id={`pdBg${u}`} cx="50%" cy="36%" rx="80%" ry="70%">
          <Stop offset="0" stopColor="#2B1F6B" />
          <Stop offset="1" stopColor="#0A0820" />
        </RadialGradient>
        <LinearGradient id={`pdBeam${u}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFF3C4" stopOpacity="0.35" />
          <Stop offset="1" stopColor="#FFF3C4" stopOpacity="0" />
        </LinearGradient>
        <LinearGradient id={`pdGold${u}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFD86B" />
          <Stop offset="1" stopColor="#C8901A" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="140" fill={`url(#pdBg${u})`} />
      <Polygon points="-6,0 6,0 62,102 38,102" fill={`url(#pdBeam${u})`} />
      <Polygon points="94,0 106,0 62,102 38,102" fill={`url(#pdBeam${u})`} />
      {confetti.map((p, i) => (
        <Rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} fill={p.c} opacity="0.85" transform={`rotate(${p.a} ${p.x} ${p.y})`} />
      ))}
      <Rect x="12" y="104" width="25" height="36" fill="#B8C4CC" />
      <Rect x="12" y="104" width="25" height="1.2" fill="#E3EAEE" />
      <Rect x="63" y="107" width="25" height="33" fill="#B87333" />
      <Rect x="63" y="107" width="25" height="1.2" fill="#D9955A" />
      <Polygon points="38,96.5 62,96.5 64,99.5 36,99.5" fill="#FFE58F" />
      <Rect x="36" y="99.5" width="28" height="40.5" fill={`url(#pdGold${u})`} />
      <Rect x="36" y="99.5" width="28" height="1.2" fill="#FFF3C4" />
      <Circle cx="50" cy="107" r="3.6" fill="none" stroke="#8A5E0A" strokeWidth="0.6" />
      <Path d="M49.3 105.4 L50.4 104.6 L50.4 109.4" stroke="#8A5E0A" strokeWidth="0.7" fill="none" />
      <Spot color="#FFF3C4" opacity={0.2} />
    </>
  );
}

function GoldVault() {
  const u = useContext(IdSuffix);
  const bars = (x0: number, flip: boolean) => {
    const out: React.ReactNode[] = [];
    const rows = [5, 4, 3, 2];
    rows.forEach((n, row) => {
      for (let i = 0; i < n; i++) {
        const x = flip ? x0 - (i + row * 0.5) * 6.4 - 6 : x0 + (i + row * 0.5) * 6.4;
        const y = 103 - row * 4.2;
        out.push(
          <G key={`${row}-${i}`}>
            <Polygon points={`${x},${y} ${x + 6},${y} ${x + 5},${y - 3.6} ${x + 1},${y - 3.6}`} fill="#E0A82E" />
            <Polygon points={`${x + 1},${y - 3.6} ${x + 5},${y - 3.6} ${x + 4.6},${y - 2.8} ${x + 1.4},${y - 2.8}`} fill="#FFE58A" />
          </G>
        );
      }
    });
    return out;
  };
  return (
    <>
      <Defs>
        <LinearGradient id={`gvBg${u}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#140D04" />
          <Stop offset="1" stopColor="#2E1F08" />
        </LinearGradient>
        <RadialGradient id={`gvGlow${u}`} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor="#FFC23D" stopOpacity="0.35" />
          <Stop offset="1" stopColor="#FFC23D" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="140" fill={`url(#gvBg${u})`} />
      {Array.from({ length: 10 }, (_, i) => (
        <Line key={i} x1={i * 11} y1="0" x2={i * 11} y2="86" stroke="#3B2A0E" strokeWidth="0.4" />
      ))}
      <Circle cx="50" cy="48" r="40" fill={`url(#gvGlow${u})`} />
      <Circle cx="50" cy="48" r="30" fill="#2A1C07" stroke="#9C7A2E" strokeWidth="2.2" />
      <Circle cx="50" cy="48" r="24" fill="none" stroke="#6E5420" strokeWidth="0.8" />
      {Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2;
        return <Circle key={i} cx={50 + Math.cos(a) * 27} cy={48 + Math.sin(a) * 27} r="0.9" fill="#C9A24A" />;
      })}
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return <Line key={i} x1="50" y1="48" x2={50 + Math.cos(a) * 9} y2={48 + Math.sin(a) * 9} stroke="#9C7A2E" strokeWidth="1.2" strokeLinecap="round" />;
      })}
      <Circle cx="50" cy="48" r="3" fill="#C9A24A" />
      <Rect x="0" y="86" width="100" height="54" fill="#120C03" />
      <Line x1="0" y1="86" x2="100" y2="86" stroke="#6E5420" strokeWidth="0.5" />
      {bars(1, false)}
      {bars(99, true)}
      <Sparkle x={14} y={85} s={2.2} color="#FFF3C4" />
      <Sparkle x={86} y={87} s={1.8} color="#FFF3C4" />
      <Sparkle x={30} y={26} s={1.4} color="#FFE58A" opacity={0.7} />
      <Sparkle x={74} y={20} s={1.6} color="#FFE58A" opacity={0.7} />
      <Spot color="#FFC23D" opacity={0.12} />
    </>
  );
}

function ChampionsHall() {
  const u = useContext(IdSuffix);
  const banners = ["#FFC23D", "#B71C1C", "#0D47A1", "#B71C1C", "#FFC23D"];
  const trophy = (x: number, y: number, s: number) => (
    <G key={`${x}-${y}`}>
      <Path d={`M${x - 3 * s} ${y} L${x + 3 * s} ${y} Q ${x + 3 * s} ${y + 4.5 * s} ${x} ${y + 5 * s} Q ${x - 3 * s} ${y + 4.5 * s} ${x - 3 * s} ${y} Z`} fill="#FFC23D" />
      <Path d={`M${x - 3 * s} ${y + 0.8 * s} Q ${x - 5 * s} ${y + 1 * s} ${x - 3.4 * s} ${y + 3 * s}`} stroke="#FFC23D" strokeWidth={0.5 * s} fill="none" />
      <Path d={`M${x + 3 * s} ${y + 0.8 * s} Q ${x + 5 * s} ${y + 1 * s} ${x + 3.4 * s} ${y + 3 * s}`} stroke="#FFC23D" strokeWidth={0.5 * s} fill="none" />
      <Rect x={x - 0.5 * s} y={y + 5 * s} width={1 * s} height={2 * s} fill="#D49A1E" />
      <Rect x={x - 2 * s} y={y + 7 * s} width={4 * s} height={1.2 * s} fill="#8D6420" />
    </G>
  );
  return (
    <>
      <Defs>
        <LinearGradient id={`chWall${u}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#1A050B" />
          <Stop offset="1" stopColor="#3A0D18" />
        </LinearGradient>
        <LinearGradient id={`chCarpet${u}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#7A0E1E" />
          <Stop offset="1" stopColor="#B3172E" />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="140" fill={`url(#chWall${u})`} />
      {[3, 89].map((x) => (
        <G key={x}>
          <Rect x={x} y="0" width="8" height="82" fill="#4A1823" />
          <Rect x={x + 1.2} y="0" width="1" height="82" fill="#5E2430" />
          <Rect x={x - 1} y="78" width="10" height="4" fill="#5E2430" />
        </G>
      ))}
      {banners.map((col, i) => {
        const x = 17 + i * 15.5;
        return (
          <G key={i}>
            <Rect x={x - 0.4} y="0" width="0.8" height="3" fill="#8D6420" />
            <Path d={`M${x - 5} 3 L${x + 5} 3 L${x + 5} 32 L${x} 27 L${x - 5} 32 Z`} fill={col} opacity="0.9" />
            <Path d={`M${x - 5} 3 L${x + 5} 3 L${x + 5} 5 L${x - 5} 5 Z`} fill="#000" opacity="0.2" />
            <Sparkle x={x} y={14} s={2.4} color={col === "#FFC23D" ? "#7A0E1E" : "#FFC23D"} />
          </G>
        );
      })}
      <Rect x="0" y="68" width="100" height="1.4" fill="#5E2430" />
      {[trophy(9, 58, 1), trophy(91, 58, 1), trophy(20, 61, 0.7), trophy(80, 61, 0.7)]}
      <Rect x="0" y="82" width="100" height="58" fill="#24070E" />
      <Polygon points="40,82 60,82 88,140 12,140" fill={`url(#chCarpet${u})`} />
      <Polygon points="40,82 60,82 88,140 12,140" fill="none" stroke="#FFC23D" strokeWidth="0.5" opacity="0.7" />
      <Spot color="#FFD86B" opacity={0.16} />
    </>
  );
}

function Galaxy() {
  const u = useContext(IdSuffix);
  return (
    <>
      <Defs>
        <RadialGradient id={`gxA${u}`} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor="#7B2FF7" stopOpacity="0.55" />
          <Stop offset="1" stopColor="#7B2FF7" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id={`gxB${u}`} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor="#00C9A7" stopOpacity="0.4" />
          <Stop offset="1" stopColor="#00C9A7" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id={`gxC${u}`} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor="#FF4D9D" stopOpacity="0.4" />
          <Stop offset="1" stopColor="#FF4D9D" stopOpacity="0" />
        </RadialGradient>
        <LinearGradient id={`gxPlanet${u}`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFB86C" />
          <Stop offset="1" stopColor="#B4436C" />
        </LinearGradient>
        <RadialGradient id={`gxPad${u}`} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0" stopColor="#B07BFF" stopOpacity="0.5" />
          <Stop offset="1" stopColor="#B07BFF" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="140" fill="#03020C" />
      <Ellipse cx="24" cy="40" rx="40" ry="30" fill={`url(#gxA${u})`} />
      <Ellipse cx="80" cy="82" rx="36" ry="28" fill={`url(#gxB${u})`} />
      <Ellipse cx="62" cy="24" rx="30" ry="18" fill={`url(#gxC${u})`} />
      <Path d="M-10 92 Q 30 60 60 64 T 112 30" stroke="#FFFFFF" strokeOpacity="0.06" strokeWidth="14" fill="none" />
      <Stars seed={77} count={90} maxY={140} maxR={0.4} />
      <Sparkle x={16} y={18} s={1.8} color="#FFFFFF" />
      <Sparkle x={70} y={48} s={1.3} color="#E1D4FF" />
      <Sparkle x={34} y={82} s={1.2} color="#C8FFF4" />
      <Circle cx="82" cy="22" r="8" fill={`url(#gxPlanet${u})`} />
      <Ellipse cx="82" cy="22" rx="14" ry="3" fill="none" stroke="#FFD9A8" strokeWidth="0.7" opacity="0.8" transform="rotate(-18 82 22)" />
      <Circle cx="14" cy="58" r="3" fill="#4C9BFF" opacity="0.8" />
      <Ellipse cx="50" cy="100" rx="34" ry="7.5" fill={`url(#gxPad${u})`} />
      <Ellipse cx="50" cy="100" rx="24" ry="4.2" fill="none" stroke="#B07BFF" strokeWidth="0.55" opacity="0.85" />
      <Ellipse cx="50" cy="100" rx="17" ry="2.8" fill="none" stroke="#00E5FF" strokeWidth="0.38" opacity="0.65" />
      <Spot color="#B07BFF" opacity={0.14} />
    </>
  );
}
