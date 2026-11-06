import React, { memo } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { Circle, ClipPath, Defs, Path } from "react-native-svg";

/**
 * Generic head-and-shoulders placeholder for a real athlete. Player photos
 * aren't shown; an optional ring carries the team colour.
 */
function PlayerSilhouette({ size = 36, ring, style }: { size?: number; ring?: string; style?: StyleProp<ViewStyle>; }) {
  const id = `ps_${size}`;
  return (
    <View style={[{ width: size, height: size }, style]} accessible accessibilityLabel="Player">
      <Svg width={size} height={size} viewBox="0 0 48 48">
        <Defs>
          <ClipPath id={id}>
            <Circle cx={24} cy={24} r={23} />
          </ClipPath>
        </Defs>
        <Circle cx={24} cy={24} r={23} fill="#E9EAEC" />
        <Path
          clipPath={`url(#${id})`}
          fill="#B4B7BC"
          d="M24 9.5c-5 0-8.4 4-8.4 9.4 0 3.3 1.3 6.3 3.3 8.1v2.6c0 1-.6 1.8-1.6 2.2-5 1.8-9.8 3.4-11.8 6.3C4.3 40.4 4 44.2 4 48h40c0-3.8-.3-7.6-1.5-9.9-2-2.9-6.8-4.5-11.8-6.3-1-.4-1.6-1.2-1.6-2.2V27c2-1.8 3.3-4.8 3.3-8.1 0-5.4-3.4-9.4-8.4-9.4Z"
        />
        {ring ? <Circle cx={24} cy={24} r={22.6} fill="none" stroke={ring} strokeWidth={1.8} /> : null}
      </Svg>
    </View>
  );
}

export default memo(PlayerSilhouette);
