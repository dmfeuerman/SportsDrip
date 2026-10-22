import React, { memo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Defs, Ellipse, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";
import { useColors } from "@/hooks/useColors";

/**
 * The room behind the character: a dark floodlit gradient, a soft spotlight
 * where the character stands, and a vignette. Static SVG, drawn once — the
 * WebGL canvas above it is transparent.
 */
function StageBackdrop({ spotY = 0.42 }: { spotY?: number }) {
  const c = useColors();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
        <Defs>
          <LinearGradient id="sdBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#0B1210" />
            <Stop offset="0.55" stopColor={c.card} />
            <Stop offset="1" stopColor="#0A100E" />
          </LinearGradient>
          <RadialGradient id="sdSpot" cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor="#FFE2B0" stopOpacity="0.20" />
            <Stop offset="0.45" stopColor="#7FB59C" stopOpacity="0.08" />
            <Stop offset="1" stopColor="#7FB59C" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="sdVignette" cx="50%" cy="45%" rx="75%" ry="70%">
            <Stop offset="0.6" stopColor="#000" stopOpacity="0" />
            <Stop offset="1" stopColor="#000" stopOpacity="0.55" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill="url(#sdBg)" />
        <Ellipse cx="50" cy={spotY * 100} rx="62" ry="40" fill="url(#sdSpot)" />
        <Rect x="0" y="0" width="100" height="100" fill="url(#sdVignette)" />
      </Svg>
    </View>
  );
}

export default memo(StageBackdrop);
