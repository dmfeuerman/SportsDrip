import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useMemo, useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Pressable } from "@/components/fx/Tap";
import { useColors } from "@/hooks/useColors";

/**
 * Tracks whether a ScrollView has more content below the fold. Spread
 * `scrollProps` onto the ScrollView and render <ScrollHint visible={...} />
 * as its next sibling inside a relatively-positioned wrapper.
 */
export function useScrollHint(threshold = 24) {
  const [viewH, setViewH] = useState(0);
  const [contentH, setContentH] = useState(0);
  const [y, setY] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => setViewH(e.nativeEvent.layout.height), []);
  const onContentSizeChange = useCallback((_w: number, h: number) => setContentH(h), []);
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => setY(e.nativeEvent.contentOffset.y), []);
  const visible = viewH > 0 && contentH - viewH > threshold && y < 12;
  const scrollProps = useMemo(() => ({ onLayout, onContentSizeChange, onScroll, scrollEventThrottle: 32 }), [onLayout, onContentSizeChange, onScroll]);
  return { visible, scrollProps };
}

/** Bottom fade + "Scroll for more" pill, shown until the user starts scrolling. */
export default function ScrollHint({ visible, label = "Scroll For More", bg, onPress }: { visible: boolean; label?: string; bg?: string; onPress?: () => void }) {
  const c = useColors();
  if (!visible) return null;
  const pill = (
    <>
      <MaterialCommunityIcons name="chevron-double-down" size={16} color={c.background} />
      <Text style={[styles.text, { color: c.background }]}>{label}</Text>
    </>
  );
  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} pointerEvents="box-none" style={styles.wrap}>
      <LinearGradient pointerEvents="none" colors={["transparent", bg ?? c.elevated]} style={StyleSheet.absoluteFill} />
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          hitSlop={8}
          onPress={onPress}
          style={({ pressed }) => [styles.pill, styles.button, { backgroundColor: c.foreground, opacity: pressed ? 0.8 : 1 }]}
        >
          {pill}
        </Pressable>
      ) : (
        <View pointerEvents="none" style={[styles.pill, { backgroundColor: c.foreground }]}>
          {pill}
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, bottom: 0, height: 64, alignItems: "center", justifyContent: "flex-end", paddingBottom: 8 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  text: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  button: { paddingHorizontal: 14, paddingVertical: 8, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
});
