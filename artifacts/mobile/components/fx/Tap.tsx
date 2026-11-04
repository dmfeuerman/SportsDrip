import React, { forwardRef } from "react";
import {
  Pressable as RNPressable,
  Switch as RNSwitch,
  TouchableOpacity as RNTouchableOpacity,
  type PressableProps,
  type SwitchProps,
  type TouchableOpacityProps,
} from "react-native";
import { haptic as buzz, hapticSeq } from "@/lib/motion";

export type TapHaptic = "tick" | "light" | "medium" | "heavy" | false;

/**
 * Wraps a handler so a press always clicks: runs the handler, then fires
 * `kind` unless the handler already buzzed on its own (a success, an error…).
 * Fires on release, so starting a scroll over a button never vibrates.
 */
export function withTap<A extends unknown[]>(fn: ((...args: A) => unknown) | null | undefined, kind: TapHaptic) {
  if (!fn || !kind) return fn ?? undefined;
  return (...args: A) => {
    const before = hapticSeq();
    try {
      fn(...args);
    } finally {
      if (hapticSeq() === before) buzz[kind]();
    }
  };
}

type Props = PressableProps & {
  /** Click on press (long-press always gets a firmer one). `false` to stay silent. */
  haptic?: TapHaptic;
};

/** Drop-in `Pressable` that clicks under the finger. */
export const Pressable = forwardRef<React.ComponentRef<typeof RNPressable>, Props>(function Pressable(
  { haptic = "light", onPress, onLongPress, ...rest },
  ref
) {
  return <RNPressable ref={ref} {...rest} onPress={withTap(onPress, haptic)} onLongPress={withTap(onLongPress, haptic && "medium")} />;
});

/** Drop-in `TouchableOpacity` that clicks under the finger. */
export const TouchableOpacity = forwardRef<React.ComponentRef<typeof RNTouchableOpacity>, TouchableOpacityProps & { haptic?: TapHaptic }>(
  function TouchableOpacity({ haptic = "light", onPress, onLongPress, ...rest }, ref) {
    return <RNTouchableOpacity ref={ref} {...rest} onPress={withTap(onPress, haptic)} onLongPress={withTap(onLongPress, haptic && "medium")} />;
  }
);

/** Drop-in `Switch` with a detent: a click on, a softer tick off. */
export const Switch = forwardRef<React.ComponentRef<typeof RNSwitch>, SwitchProps>(function Switch({ onValueChange, ...rest }, ref) {
  return (
    <RNSwitch
      ref={ref}
      {...rest}
      onValueChange={
        onValueChange
          ? (v: boolean) => {
              const before = hapticSeq();
              onValueChange(v);
              if (hapticSeq() === before) (v ? buzz.light : buzz.tick)();
            }
          : undefined
      }
    />
  );
});
