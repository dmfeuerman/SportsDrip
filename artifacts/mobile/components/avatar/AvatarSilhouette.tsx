import React, { memo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Ellipse, Path, Rect } from "react-native-svg";

/**
 * Flat stand-in shown while a 3D avatar loads, and permanently where WebGL
 * isn't available. Same mannequin proportions and colours as the real thing,
 * so the swap to the rendered portrait doesn't jump.
 */
function AvatarSilhouette({
  skin,
  top,
  bottom,
  framing = "full",
}: {
  skin: string;
  top?: string | null;
  bottom?: string | null;
  framing?: "bust" | "full";
}) {
  const shirt = top ?? skin;
  const shorts = bottom ?? skin;
  const vb = framing === "bust" ? "20 0 60 75" : "0 0 100 125";
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox={vb} preserveAspectRatio="xMidYMid meet">
        <Ellipse cx={50} cy={121} rx={18} ry={2.6} fill="#000" opacity={0.18} />
        {/* legs */}
        <Rect x={41} y={70} width={7.5} height={48} rx={3.7} fill={skin} />
        <Rect x={51.5} y={70} width={7.5} height={48} rx={3.7} fill={skin} />
        {/* arms */}
        <Rect x={29} y={30} width={6.5} height={40} rx={3.2} fill={skin} />
        <Rect x={64.5} y={30} width={6.5} height={40} rx={3.2} fill={skin} />
        {/* hips + torso */}
        <Path d="M38 60 L62 60 L61 80 L51 80 L50 74 L49 80 L39 80 Z" fill={shorts} />
        <Path d="M34 28 Q50 24 66 28 L63 62 Q50 66 37 62 Z" fill={shirt} />
        {/* neck + head */}
        <Rect x={46.5} y={18} width={7} height={9} rx={3} fill={skin} />
        <Circle cx={50} cy={11.5} r={9} fill={skin} />
      </Svg>
    </View>
  );
}

export default memo(AvatarSilhouette);
