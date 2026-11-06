import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Keyboard,
  KeyboardAvoidingView,
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
import { useColors } from "@/hooks/useColors";

const DISMISS_DISTANCE = 90;
const DISMISS_VELOCITY = 1.1;

/**
 * Bottom sheet that stays above the software keyboard.
 *
 * The sheets used to be `<Modal>` + overlay + a bottom-pinned View with no
 * keyboard handling, so an autofocused input (the invite-code box) opened
 * straight under the keyboard. `behavior="padding"` is used on both
 * platforms on purpose: KeyboardAvoidingView pads by the measured overlap
 * between the keyboard frame and this view, so it is correct whether or not
 * Android also resized the window (edge-to-edge modals don't).
 *
 * Three ways out, always: the close button, a tap on the backdrop, and a
 * downward swipe on the grab bar. Tall sheets (a player's profile at 90%)
 * left almost no backdrop to tap, which is what made them hard to close.
 * `dismissible={false}` holds all three while something is in flight.
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
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const drag = useRef(new Animated.Value(0)).current;

  // PanResponder is created once; read the latest props through a ref.
  const latest = useRef({ onClose, dismissible });
  latest.current = { onClose, dismissible };

  useEffect(() => {
    if (visible) drag.setValue(0);
  }, [visible, drag]);

  // The keyboard already covers the home-indicator area, so keeping the
  // safe-area bottom padding while it's up floats the sheet's footer ~50pt
  // above the keyboard. Drop it so the bottom action sits right on top.
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", () => setKeyboardUp(true));
    const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
      setKeyboardUp(false);
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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent navigationBarTranslucent>
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
        <Pressable style={[styles.fill, { backgroundColor: c.overlay }]} onPress={close} accessibilityLabel="Close" />
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: c.elevated, borderColor: c.border, paddingBottom: keyboardUp ? 8 : insets.bottom + 16, maxHeight, transform: [{ translateY: drag }] },
            style,
            // The keyboard covers the home indicator, so the bottom action sits right on
            // top of it whatever padding the sheet asked for.
            keyboardUp ? { paddingBottom: 8 } : null,
          ]}
        >
          <View {...pan.panHandlers} style={[styles.grab, headerStyle]} hitSlop={{ top: 12 }}>
            <View style={[styles.handle, { backgroundColor: c.border }]} />
            {showClose ? <CloseButton onPress={close} disabled={!dismissible} style={styles.close} /> : null}
          </View>
          {children}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, borderBottomWidth: 0, padding: 20, paddingTop: 8, gap: 12, flexShrink: 1 },
  // Tall enough to grab with a thumb; the close button sits at its right edge.
  grab: { height: 40, alignItems: "center", justifyContent: "center", marginBottom: -4 },
  handle: { width: 40, height: 5, borderRadius: 3 },
  close: { position: "absolute", right: 0, top: 2 },
});
