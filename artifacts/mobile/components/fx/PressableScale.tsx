import React from "react";
import { Pressable, type GestureResponderEvent, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";
import { haptic as buzz, SPRING } from "@/lib/motion";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, "style"> & {
  style?: StyleProp<ViewStyle>;
  /** How far it sinks while held. */
  scaleTo?: number;
  /** Dim while held, on top of the scale. */
  dimTo?: number;
  /** Haptic on touch-down (the moment the finger lands, like a physical key). */
  haptic?: "tick" | "light" | "medium" | false;
};

/**
 * A Pressable that sinks under the finger on a UI-thread spring and springs
 * back on release — the tactile press state every card and button shares.
 */
export default function PressableScale({ style, scaleTo = 0.96, dimTo = 1, haptic = false, disabled, onPressIn, onPressOut, children, ...rest }: Props) {
  const reduced = useReducedMotion();
  const pressed = useSharedValue(0);
  const anim = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - (1 - scaleTo) * pressed.value }],
    opacity: 1 - (1 - dimTo) * pressed.value,
  }));

  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
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
