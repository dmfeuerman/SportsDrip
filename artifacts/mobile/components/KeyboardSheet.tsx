import React, { useEffect, useMemo, useRef, useState } from "react";
import { TourModalLayer } from "@/components/tour/TourHost";
import { BlurView } from "expo-blur";
import {
  Animated,
  Dimensions,
  Keyboard,
  Modal,
  PanResponder,
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CloseButton } from "@/components/ui";
import { GlassDomeSheen } from "@/components/ui/LiquidGlass";
import { useColors } from "@/hooks/useColors";

const DISMISS_DISTANCE = 90;
const DISMISS_VELOCITY = 1.1;

/**
 * Liquid Glass sheet that stays above the software keyboard.
 *
 * Uses a dimmed + blurred backdrop and frosted Liquid Glass surface with a
 * directional dome glow and specular top rim so every secondary sheet matches
 * the 2026 Liquid Glass design language.
 */
export default function KeyboardSheet({
  visible,
  onClose,
  children,
  style,
  headerStyle,
  maxHeight = "92%",
  dismissible = true,
  showClose = true,
  glowColor,
}: {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Insets for the grab bar / close row, for sheets with no horizontal padding. */
  headerStyle?: StyleProp<ViewStyle>;
  maxHeight?: `${number}%` | number;
  dismissible?: boolean;
  showClose?: boolean;
  /** Optional accent glow tint for the Liquid Glass dome sheen. */
  glowColor?: string;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const drag = useRef(new Animated.Value(0)).current;

  const latest = useRef({ onClose, dismissible });
  latest.current = { onClose, dismissible };

  useEffect(() => {
    if (visible) drag.setValue(0);
  }, [visible, drag]);

  const [kbH, setKbH] = useState(0);
  const keyboardUp = kbH > 0;
  useEffect(() => {
    if (!visible) return;
    const ios = Platform.OS === "ios";
    const h = (e: { endCoordinates: { screenY: number; height: number } }) =>
      setKbH(Math.max(0, ios ? Dimensions.get("screen").height - e.endCoordinates.screenY : e.endCoordinates.height));
    const show = Keyboard.addListener(ios ? "keyboardWillChangeFrame" : "keyboardDidShow", h);
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setKbH(0));
    return () => {
      show.remove();
      hide.remove();
      setKbH(0);
    };
  }, [visible]);

  const close = () => {
    if (latest.current.dismissible) latest.current.onClose();
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          const fling = g.dy > DISMISS_DISTANCE || g.vy > DISMISS_VELOCITY;
          if (fling && latest.current.dismissible) {
            Animated.timing(drag, { toValue: Dimensions.get("window").height, duration: 160, useNativeDriver: true }).start(() =>
              latest.current.onClose()
            );
          } else {
            Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
          }
        },
        onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start(),
      }),
    [drag]
  );

  const sheetBg = c.isDark ? "rgba(16, 20, 30, 0.84)" : c.alpha(c.elevated, 0.88);
  const sheetBorder = c.isDark ? "rgba(255, 255, 255, 0.18)" : c.alpha(c.foreground, 0.14);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
      <View style={styles.fill}>
        {Platform.OS !== "web" ? (
          <BlurView intensity={28} tint={c.isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
        ) : null}
        <Pressable
          style={[styles.fill, { backgroundColor: c.isDark ? "rgba(5, 9, 16, 0.45)" : c.overlay }]}
          onPress={close}
          accessibilityLabel="Close"
        />
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: sheetBg,
              borderColor: sheetBorder,
              paddingBottom: keyboardUp ? 8 : insets.bottom + 16,
              maxHeight,
              transform: [{ translateY: drag }],
            },
            style,
            keyboardUp ? { paddingBottom: kbH + 8 } : null,
          ]}
        >
          {Platform.OS !== "web" ? (
            <BlurView intensity={c.isDark ? 70 : 80} tint={c.isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
          ) : null}
          <GlassDomeSheen id="sheet" glowColor={glowColor ?? c.primary} intensity={0.22} />
          <View {...pan.panHandlers} style={[styles.grab, headerStyle]} hitSlop={{ top: 12 }}>
            <View style={[styles.handle, { backgroundColor: c.isDark ? "rgba(255,255,255,0.28)" : c.border }]} />
            {showClose ? <CloseButton onPress={close} disabled={!dismissible} style={styles.close} /> : null}
          </View>
          {children}
        </Animated.View>
      </View>
      <TourModalLayer />
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sheet: {
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderWidth: 1,
    borderBottomWidth: 0,
    padding: 20,
    paddingTop: 8,
    gap: 12,
    flexShrink: 1,
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOpacity: 0.45,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: -10 },
    elevation: 16,
  },
  grab: { height: 40, alignItems: "center", justifyContent: "center", marginBottom: -4 },
  handle: { width: 40, height: 5, borderRadius: 3 },
  close: { position: "absolute", right: 0, top: 2 },
});
