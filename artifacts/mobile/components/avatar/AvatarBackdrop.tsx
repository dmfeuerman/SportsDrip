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
export function ZoomingBackdrop({ id, cam }: { id: string | null | undefined; cam: SharedValue<BackdropCam> }) {
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: cam.value.x }, { translateY: cam.value.y }, { scale: cam.value.s }],
  }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <AvatarBackdropMemo id={id} />
    </Animated.View>
  );
}

function AvatarBackdrop({ id, style }: { id: string | null | undefined; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  const scene = backgroundOf(id);
  // Gradient ids are document-global on web; a suffix keeps two backdrops on one screen apart.
  const suffix = useRef(`_${++instances}`).current;
  return (
    <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      <IdSuffix.Provider value={suffix}>
      <Svg width="100%" height="100%" viewBox="0 0 100 140" preserveAspectRatio="xMidYMid slice">
        {scene === "locker_room" ? <LockerRoom c={c} /> : null}
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
function Spot({ color, opacity = 0.22, cy = 64 }: { color: string; opacity?: number; cy?: number }) {
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
            <Rect x={x} y="16" width="15" height="84" rx="1" fill={fill} stroke={line} strokeWidth="0.4" />
            {[22, 24.2, 26.4].map((y) => (
              <Line key={y} x1={x + 4} y1={y} x2={x + 11} y2={y} stroke={line} strokeWidth="0.6" />
            ))}
            <Rect x={x + 11.5} y="56" width="1.4" height="5" rx="0.6" fill={line} />
          </G>
        );
      })}
      <Rect x="0" y="100" width="100" height="40" fill={fill} />
      <Line x1="0" y1="100" x2="100" y2="100" stroke={c.alpha(c.primary, 0.28)} strokeWidth="0.4" />
      <Rect x="6" y="103" width="88" height="2.6" rx="1.2" fill={c.alpha(c.foreground, c.isDark ? 0.06 : 0.07)} />
      <Rect x="0" y="0" width="100" height="140" fill={`url(#lrGlow${u})`} />
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
      <Rect x="0" y="0" width="100" height="84" fill={`url(#nsSky${u})`} />
      <Stars seed={7} count={26} maxY={44} />
      <Polygon points="0,54 100,54 100,84 0,84" fill="#0A1024" />
      <Crowd seed={11} y0={55} y1={83} colors={["#FF4D63", "#4C9BFF", "#FFFFFF", "#FFC23D", "#2FE38A"]} opacity={0.5} />
      <Rect x="0" y="82.5" width="100" height="1.6" fill="#1D2A4A" />
      {[8, 92].map((x) => (
        <G key={x}>
          <Polygon points={`${x},14 ${x < 50 ? 60 : 40},120 ${x < 50 ? 30 : 70},120`} fill={`url(#nsBeam${u})`} />
          <Rect x={x - 0.5} y="16" width="1" height="40" fill="#1B2440" />
          <Rect x={x - 6} y="9" width="12" height="7" rx="0.8" fill="#1B2440" />
          {[0, 1, 2].map((r) =>
            [0, 1, 2, 3].map((col) => <Circle key={`${r}${col}`} cx={x - 4.2 + col * 2.8} cy={10.8 + r * 1.9} r="0.8" fill="#FFF6D5" />)
          )}
          <Ellipse cx={x} cy="12.5" rx="10" ry="7" fill="#FFF6D5" opacity="0.12" />
        </G>
      ))}
      <Rect x="0" y="84" width="100" height="56" fill={`url(#nsField${u})`} />
      {Array.from({ length: 7 }, (_, i) => (
        <Rect key={i} x="0" y={84 + i * 8} width="100" height="4" fill="#FFFFFF" opacity="0.035" />
      ))}
      <Line x1="0" y1="96" x2="100" y2="96" stroke="#FFFFFF" strokeWidth="0.45" opacity="0.4" />
      <Ellipse cx="50" cy="114" rx="28" ry="7" fill="none" stroke="#FFFFFF" strokeWidth="0.45" opacity="0.35" />
      <Spot color="#FFF6D5" opacity={0.16} />
    </>
  );
}

function Hardwood() {
  const u = useContext(IdSuffix);
  const planks = [86, 89.5, 93.5, 98, 103.5, 110, 117.5, 126, 136];
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
      <Rect x="0" y="0" width="100" height="84" fill={`url(#hwArena${u})`} />
      <Crowd seed={23} y0={40} y1={80} colors={["#FFB74D", "#FFFFFF", "#E53935", "#90A4AE"]} opacity={0.32} />
      <Rect x="34" y="6" width="32" height="14" rx="1.5" fill="#111" stroke="#3A2B1C" strokeWidth="0.6" />
      <Rect x="36" y="8" width="12.5" height="10" rx="0.8" fill="#E53935" opacity="0.85" />
      <Rect x="51.5" y="8" width="12.5" height="10" rx="0.8" fill="#1E88E5" opacity="0.85" />
      <Ellipse cx="50" cy="13" rx="26" ry="12" fill="#FFB74D" opacity="0.08" />
      {[18, 50, 82].map((x) => (
        <Polygon key={x} points={`${x - 1.5},0 ${x + 1.5},0 ${x + 14},84 ${x - 14},84`} fill="#FFE0B2" opacity="0.05" />
      ))}
      <Rect x="0" y="84" width="100" height="56" fill={`url(#hwFloor${u})`} />
      {planks.map((y) => (
        <Line key={y} x1="0" y1={y} x2="100" y2={y} stroke="#6E4320" strokeWidth="0.3" opacity="0.4" />
      ))}
      <Polygon points="37,84 63,84 71,140 29,140" fill="#8E2430" opacity="0.6" />
      <Line x1="0" y1="84" x2="100" y2="84" stroke="#FFFFFF" strokeWidth="0.7" opacity="0.85" />
      <Polygon points="37,84 63,84 71,140 29,140" fill="none" stroke="#FFFFFF" strokeWidth="0.6" opacity="0.8" />
      <Ellipse cx="50" cy="98" rx="12" ry="3.6" fill="none" stroke="#FFFFFF" strokeWidth="0.6" opacity="0.8" />
      <Ellipse cx="50" cy="108" rx="34" ry="12" fill={`url(#hwShine${u})`} />
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
      <Rect x="0" y="0" width="100" height="72" fill={`url(#bcSky${u})`} />
      <Circle cx="80" cy="18" r="18" fill={`url(#bcSun${u})`} />
      <Circle cx="80" cy="18" r="7" fill="#FFF59D" />
      {[
        [18, 16, 1],
        [58, 30, 0.8],
        [30, 44, 0.65],
      ].map(([x, y, s], i) => (
        <G key={i} opacity="0.92">
          <Ellipse cx={x} cy={y} rx={9 * s} ry={3 * s} fill="#FFFFFF" />
          <Ellipse cx={x - 4 * s} cy={y - 1.5 * s} rx={4.5 * s} ry={3 * s} fill="#FFFFFF" />
          <Ellipse cx={x + 3 * s} cy={y - 2.2 * s} rx={5 * s} ry={3.6 * s} fill="#FFFFFF" />
        </G>
      ))}
      <Rect x="0" y="70" width="100" height="12" fill={`url(#bcSea${u})`} />
      {[73, 76.5, 80].map((y, i) => (
        <Path key={y} d={`M0 ${y} Q 6 ${y - 1} 12 ${y} T 24 ${y} T 36 ${y} T 48 ${y} T 60 ${y} T 72 ${y} T 84 ${y} T 96 ${y} T 108 ${y}`} stroke="#FFFFFF" strokeWidth="0.35" fill="none" opacity={0.55 - i * 0.12} />
      ))}
      <Path d="M0 82 Q 25 79 50 82 T 100 81 L100 140 L0 140 Z" fill={`url(#bcSand${u})`} />
      <Stars seed={41} count={60} maxY={140} color="#B8894A" maxR={0.25} />
      <Rect x="0" y="0" width="100" height="0" />
      {/* palm on the left */}
      <Path d="M10 120 Q 6 96 13 70 L15.5 70 Q 9.5 96 13.5 120 Z" fill="#7B5532" />
      <G fill="#2E7D32">
        <Path d="M14 70 Q 2 64 -6 72 Q 4 66 14 71 Z" />
        <Path d="M14 70 Q 4 58 -2 58 Q 8 62 14 70 Z" />
        <Path d="M14 70 Q 18 56 30 56 Q 20 61 15 70 Z" />
        <Path d="M14 70 Q 26 64 34 72 Q 24 67 14 71 Z" />
        <Path d="M14 70 Q 12 60 16 52 Q 15 61 15 70 Z" />
      </G>
      <Circle cx="13.5" cy="71.5" r="1.4" fill="#5D4037" />
      {/* beach ball */}
      <G>
        <Circle cx="86" cy="128" r="5" fill="#FFFFFF" />
        <Path d="M86 123 A5 5 0 0 1 91 128 L86 128 Z" fill="#E53935" />
        <Path d="M86 133 A5 5 0 0 1 81 128 L86 128 Z" fill="#1E88E5" />
        <Path d="M81 128 A5 5 0 0 1 86 123 L86 128 Z" fill="#FFC107" />
        <Circle cx="86" cy="128" r="5" fill="none" stroke="#000" strokeOpacity="0.15" strokeWidth="0.3" />
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
      <Rect x="0" y="0" width="100" height="80" fill={`url(#ssSky${u})`} />
      <Stars seed={5} count={12} maxY={22} maxR={0.3} />
      <Circle cx="50" cy="76" r="34" fill={`url(#ssSun${u})`} />
      <Circle cx="50" cy="76" r="14" fill="#FFD27F" />
      {[64, 67, 70].map((y, i) => (
        <Rect key={y} x="30" y={y + i * 0.3} width="40" height={0.9 + i * 0.4} fill="#E2557A" opacity="0.9" />
      ))}
      <Path d="M0 74 Q 14 64 28 72 T 58 70 T 84 66 T 100 70 L100 80 L0 80 Z" fill="#3A1A4A" />
      <Path d="M-4 78 Q 20 70 40 77 T 76 75 T 104 77 L104 82 L-4 82 Z" fill="#2A1236" />
      {[
        [22, 34],
        [27, 31],
        [70, 26],
      ].map(([x, y], i) => (
        <Path key={i} d={`M${x - 1.6} ${y} Q ${x - 0.8} ${y - 1} ${x} ${y} Q ${x + 0.8} ${y - 1} ${x + 1.6} ${y}`} stroke="#2A1236" strokeWidth="0.35" fill="none" />
      ))}
      <Rect x="0" y="80" width="100" height="60" fill={`url(#ssField${u})`} />
      {Array.from({ length: 8 }, (_, i) => (
        <Rect key={i} x="0" y={80 + i * 7.5} width="100" height="3.6" fill="#FFD27F" opacity="0.045" />
      ))}
      <G stroke="#FFD54F" strokeWidth="0.9" opacity="0.85" strokeLinecap="round">
        <Line x1="80" y1="58" x2="80" y2="86" />
        <Line x1="72" y1="58" x2="88" y2="58" />
        <Line x1="72" y1="58" x2="72" y2="38" />
        <Line x1="88" y1="58" x2="88" y2="38" />
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
      <Rect x="0" y="0" width="100" height="80" fill={`url(#irArena${u})`} />
      <Crowd seed={31} y0={30} y1={56} colors={["#90CAF9", "#FFFFFF", "#E53935", "#1E88E5"]} opacity={0.35} />
      {[20, 50, 80].map((x) => (
        <G key={x}>
          <Polygon points={`${x - 1},0 ${x + 1},0 ${x + 12},80 ${x - 12},80`} fill="#E3F2FD" opacity="0.06" />
          <Rect x={x - 5} y="3" width="10" height="2" rx="1" fill="#E3F2FD" opacity="0.8" />
        </G>
      ))}
      <Rect x="0" y="56" width="100" height="16" fill="#BBDEFB" opacity="0.07" />
      {[0, 20, 40, 60, 80, 100].map((x) => (
        <Line key={x} x1={x} y1="56" x2={x} y2="72" stroke="#E3F2FD" strokeWidth="0.3" opacity="0.25" />
      ))}
      <Rect x="0" y="72" width="100" height="9" fill="#F5F7FA" />
      <Rect x="0" y="72" width="100" height="1.4" fill="#1565C0" />
      <Rect x="0" y="80" width="100" height="0.9" fill="#FFC107" />
      <Rect x="0" y="81" width="100" height="59" fill={`url(#irIce${u})`} />
      <Line x1="0" y1="93" x2="100" y2="93" stroke="#1E88E5" strokeWidth="1.1" opacity="0.55" />
      <Line x1="0" y1="106" x2="100" y2="106" stroke="#E53935" strokeWidth="1.1" opacity="0.6" />
      <Line x1="0" y1="124" x2="100" y2="124" stroke="#1E88E5" strokeWidth="1.1" opacity="0.55" />
      <Ellipse cx="50" cy="112" rx="20" ry="5.5" fill="none" stroke="#E53935" strokeWidth="0.5" opacity="0.6" />
      <Circle cx="50" cy="112" r="0.9" fill="#1E88E5" opacity="0.7" />
      {Array.from({ length: 9 }, (_, i) => (
        <Line key={i} x1={8 + i * 10} y1={88 + (i % 3) * 14} x2={18 + i * 10} y2={90 + (i % 3) * 14} stroke="#FFFFFF" strokeWidth="0.3" opacity="0.8" />
      ))}
      <Ellipse cx="50" cy="100" rx="40" ry="10" fill="#FFFFFF" opacity="0.25" />
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
      const h = 14 + r() * 34;
      const win: Array<{ x: number; y: number; c: string }> = [];
      for (let wy = 92 - h + 3; wy < 89; wy += 3.2) {
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
      <Rect x="0" y="0" width="100" height="92" fill={`url(#ncSky${u})`} />
      <Stars seed={3} count={30} maxY={40} maxR={0.3} />
      <Circle cx="50" cy="52" r="22" fill={`url(#ncSun${u})`} />
      {[56, 61, 66, 70.5].map((y, i) => (
        <Rect key={y} x="26" y={y} width="48" height={1 + i * 0.55} fill="#3A0B5C" />
      ))}
      {buildings.map((b, i) => (
        <G key={i}>
          <Rect x={b.x} y={92 - b.h} width={b.w} height={b.h} fill="#120428" />
          <Rect x={b.x} y={92 - b.h} width={b.w} height="0.5" fill="#FF2E97" opacity="0.7" />
          {b.win.map((w, j) => (
            <Rect key={j} x={w.x} y={w.y} width="1.2" height="1.4" fill={w.c} opacity="0.75" />
          ))}
        </G>
      ))}
      <Rect x="0" y="92" width="100" height="48" fill={`url(#ncFloor${u})`} />
      <Line x1="0" y1="92" x2="100" y2="92" stroke="#00E5FF" strokeWidth="0.6" opacity="0.9" />
      <G stroke="#FF2E97" strokeWidth="0.3" opacity="0.6">
        {[94, 96.5, 99.5, 103.5, 108.5, 115, 123, 133].map((y) => (
          <Line key={y} x1="0" y1={y} x2="100" y2={y} />
        ))}
        {Array.from({ length: 15 }, (_, i) => {
          const bx = -90 + i * 20;
          return <Line key={i} x1="50" y1="92" x2={bx} y2="140" />;
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
    return Array.from({ length: 70 }, () => ({ x: r() * 100, y: r() * 110, w: 0.8 + r() * 1.2, h: 0.4 + r() * 0.6, a: r() * 180, c: palette[Math.floor(r() * palette.length)]! }));
  }, []);
  return (
    <>
      <Defs>
        <RadialGradient id={`pdBg${u}`} cx="50%" cy="38%" rx="80%" ry="70%">
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
      <Polygon points="-6,0 6,0 62,124 38,124" fill={`url(#pdBeam${u})`} />
      <Polygon points="94,0 106,0 62,124 38,124" fill={`url(#pdBeam${u})`} />
      {confetti.map((p, i) => (
        <Rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} fill={p.c} opacity="0.85" transform={`rotate(${p.a} ${p.x} ${p.y})`} />
      ))}
      <Rect x="12" y="127" width="25" height="13" fill="#B8C4CC" />
      <Rect x="12" y="127" width="25" height="1.2" fill="#E3EAEE" />
      <Rect x="63" y="130" width="25" height="10" fill="#B87333" />
      <Rect x="63" y="130" width="25" height="1.2" fill="#D9955A" />
      <Rect x="36" y="121" width="28" height="19" fill={`url(#pdGold${u})`} />
      <Rect x="36" y="121" width="28" height="1.4" fill="#FFF0B3" />
      <Circle cx="50" cy="131" r="4" fill="none" stroke="#8A5E0A" strokeWidth="0.6" />
      <Path d="M49.2 129.2 L50.4 128.3 L50.4 133.6" stroke="#8A5E0A" strokeWidth="0.7" fill="none" />
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
        const y = 136 - row * 4.2;
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
        <Line key={i} x1={i * 11} y1="0" x2={i * 11} y2="104" stroke="#3B2A0E" strokeWidth="0.4" />
      ))}
      <Circle cx="50" cy="56" r="40" fill={`url(#gvGlow${u})`} />
      <Circle cx="50" cy="56" r="31" fill="#2A1C07" stroke="#9C7A2E" strokeWidth="2.2" />
      <Circle cx="50" cy="56" r="25" fill="none" stroke="#6E5420" strokeWidth="0.8" />
      {Array.from({ length: 16 }, (_, i) => {
        const a = (i / 16) * Math.PI * 2;
        return <Circle key={i} cx={50 + Math.cos(a) * 28} cy={56 + Math.sin(a) * 28} r="0.9" fill="#C9A24A" />;
      })}
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return <Line key={i} x1="50" y1="56" x2={50 + Math.cos(a) * 9} y2={56 + Math.sin(a) * 9} stroke="#9C7A2E" strokeWidth="1.2" strokeLinecap="round" />;
      })}
      <Circle cx="50" cy="56" r="3" fill="#C9A24A" />
      <Rect x="0" y="104" width="100" height="36" fill="#120C03" />
      <Line x1="0" y1="104" x2="100" y2="104" stroke="#6E5420" strokeWidth="0.5" />
      {bars(1, false)}
      {bars(99, true)}
      <Sparkle x={14} y={112} s={2.2} color="#FFF3C4" />
      <Sparkle x={86} y={114} s={1.8} color="#FFF3C4" />
      <Sparkle x={30} y={30} s={1.4} color="#FFE58A" opacity={0.7} />
      <Sparkle x={74} y={22} s={1.6} color="#FFE58A" opacity={0.7} />
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
          <Rect x={x} y="0" width="8" height="100" fill="#4A1823" />
          <Rect x={x + 1.2} y="0" width="1" height="100" fill="#5E2430" />
          <Rect x={x - 1} y="96" width="10" height="4" fill="#5E2430" />
        </G>
      ))}
      {banners.map((col, i) => {
        const x = 17 + i * 15.5;
        return (
          <G key={i}>
            <Rect x={x - 0.4} y="0" width="0.8" height="3" fill="#8D6420" />
            <Path d={`M${x - 5} 3 L${x + 5} 3 L${x + 5} 34 L${x} 29 L${x - 5} 34 Z`} fill={col} opacity="0.9" />
            <Path d={`M${x - 5} 3 L${x + 5} 3 L${x + 5} 5 L${x - 5} 5 Z`} fill="#000" opacity="0.2" />
            <Sparkle x={x} y={15} s={2.4} color={col === "#FFC23D" ? "#7A0E1E" : "#FFC23D"} />
          </G>
        );
      })}
      <Rect x="0" y="82" width="100" height="1.4" fill="#5E2430" />
      {[trophy(9, 72, 1), trophy(91, 72, 1), trophy(20, 75, 0.7), trophy(80, 75, 0.7)]}
      <Rect x="0" y="100" width="100" height="40" fill="#24070E" />
      <Polygon points="40,100 60,100 82,140 18,140" fill={`url(#chCarpet${u})`} />
      <Polygon points="40,100 60,100 82,140 18,140" fill="none" stroke="#FFC23D" strokeWidth="0.5" opacity="0.7" />
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
      <Sparkle x={70} y={52} s={1.3} color="#E1D4FF" />
      <Sparkle x={34} y={96} s={1.2} color="#C8FFF4" />
      <Circle cx="82" cy="22" r="8" fill={`url(#gxPlanet${u})`} />
      <Ellipse cx="82" cy="22" rx="14" ry="3" fill="none" stroke="#FFD9A8" strokeWidth="0.7" opacity="0.8" transform="rotate(-18 82 22)" />
      <Circle cx="14" cy="64" r="3" fill="#4C9BFF" opacity="0.8" />
      <Ellipse cx="50" cy="123" rx="34" ry="8" fill={`url(#gxPad${u})`} />
      <Ellipse cx="50" cy="123" rx="24" ry="4.4" fill="none" stroke="#B07BFF" strokeWidth="0.5" opacity="0.8" />
      <Ellipse cx="50" cy="123" rx="17" ry="3" fill="none" stroke="#00E5FF" strokeWidth="0.35" opacity="0.6" />
      <Spot color="#B07BFF" opacity={0.14} />
    </>
  );
}
