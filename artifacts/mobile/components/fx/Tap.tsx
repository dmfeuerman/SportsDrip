import React, { createContext, forwardRef, useContext } from "react";
import {
  Platform,
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

/**
 * react-native-web renders role "button" as a real <button>, and HTML forbids a
 * <button> inside another (a card that opens, with a share button on it). On
 * web, a button-role pressable inside another drops to a plain focusable div.
 */
const IN_BUTTON = createContext(false);
const WEB = Platform.OS === "web";

function useWebButtonNesting<P extends { accessibilityRole?: unknown; role?: unknown; children?: unknown }>(props: P): P {
  const inButton = useContext(IN_BUTTON);
  if (!WEB) return props;
  const isButton = props.accessibilityRole === "button" || props.role === "button";
  if (!isButton) return props;
  if (inButton) return { ...props, accessibilityRole: undefined, role: undefined };
  const kids = props.children;
  return {
    ...props,
    children:
      typeof kids === "function"
        ? (state: unknown) => <IN_BUTTON.Provider value>{(kids as (s: unknown) => React.ReactNode)(state)}</IN_BUTTON.Provider>
        : <IN_BUTTON.Provider value>{kids as React.ReactNode}</IN_BUTTON.Provider>,
  };
}

/** Drop-in `Pressable` that clicks under the finger. */
export const Pressable = forwardRef<React.ComponentRef<typeof RNPressable>, Props>(function Pressable(
  { haptic = "light", onPress, onLongPress, ...rest },
  ref
) {
  const props = useWebButtonNesting(rest);
  return <RNPressable ref={ref} {...props} onPress={withTap(onPress, haptic)} onLongPress={withTap(onLongPress, haptic && "medium")} />;
});

/** Drop-in `TouchableOpacity` that clicks under the finger. */
export const TouchableOpacity = forwardRef<React.ComponentRef<typeof RNTouchableOpacity>, TouchableOpacityProps & { haptic?: TapHaptic }>(
  function TouchableOpacity({ haptic = "light", onPress, onLongPress, ...rest }, ref) {
    const props = useWebButtonNesting(rest);
    return <RNTouchableOpacity ref={ref} {...props} onPress={withTap(onPress, haptic)} onLongPress={withTap(onLongPress, haptic && "medium")} />;
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
