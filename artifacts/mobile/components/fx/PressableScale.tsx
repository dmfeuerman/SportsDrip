import React from "react";
import { Platform, Pressable, type GestureResponderEvent, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";
import { withTap } from "@/components/fx/Tap";
import { haptic as buzz, SPRING } from "@/lib/motion";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, "style"> & {
  style?: StyleProp<ViewStyle>;
  /** How far it sinks while held. */
  scaleTo?: number;
  /** Dim while held, on top of the scale. */
  dimTo?: number;
  /**
   * Haptic on touch-down (the moment the finger lands, like a physical key).
   * Left unset, a light click fires on release instead (scroll-safe for cards
   * in lists). `false` for silence.
   */
  haptic?: "tick" | "light" | "medium" | "heavy" | false;
};

/**
 * A Pressable that sinks under the finger on a UI-thread spring and springs
 * back on release — the tactile press state every card and button shares.
 */
export default function PressableScale({
  style,
  scaleTo = 0.96,
  dimTo = 1,
  haptic,
  disabled,
  onPress,
  onPressIn,
  onPressOut,
  accessibilityRole,
  children,
  ...rest
}: Props) {
  const reduced = useReducedMotion();
  const pressed = useSharedValue(0);
  const anim = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - (1 - scaleTo) * pressed.value }],
    opacity: 1 - (1 - dimTo) * pressed.value,
  }));

  return (
    <AnimatedPressable
      {...rest}
      accessibilityRole={Platform.OS === "web" && accessibilityRole === "button" ? undefined : accessibilityRole}
      disabled={disabled}
      onPress={haptic === undefined ? withTap(onPress, "light") : onPress}
      onPressIn={(e: GestureResponderEvent) => {
        if (!disabled) {
          pressed.value = reduced ? 1 : withSpring(1, SPRING.snappy);
          if (haptic) buzz[haptic]();
        }
        onPressIn?.(e);
      }}
      onPressOut={(e: GestureResponderEvent) => {
        pressed.value = reduced ? 0 : withSpring(0, SPRING.pop);
        onPressOut?.(e);
      }}
      style={[style, anim]}
    >
      {children}
    </AnimatedPressable>
  );
}
