import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useEffect, useRef } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text } from "react-native";
import { useCart } from "@/context/CartContext";
import { useColors } from "@/hooks/useColors";

/**
 * Cart icon with a live count of selected (not yet owned) items. Opens
 * checkout. The badge pops when the count goes up so a new pick registers.
 */
export default function CartButton({ onPress }: { onPress?: () => void }) {
  const c = useColors();
  const { count } = useCart();
  const pop = useRef(new Animated.Value(1)).current;
  const prev = useRef(count);

  useEffect(() => {
    if (count > prev.current) {
      pop.setValue(1.35);
      Animated.spring(pop, { toValue: 1, friction: 4, tension: 160, useNativeDriver: Platform.OS !== "web" }).start();
    }
    prev.current = count;
  }, [count, pop]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count ? `Cart, ${count} ${count === 1 ? "item" : "items"}` : "Cart, empty"}
      hitSlop={8}
      onPress={onPress ?? (() => router.push("/checkout"))}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: count ? c.primarySoft : c.secondary,
          borderColor: count ? c.alpha(c.primary, 0.6) : c.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <MaterialCommunityIcons name={count ? "cart" : "cart-outline"} size={18} color={count ? c.primary : c.foreground} />
      {count > 0 ? (
        <Animated.View style={[styles.badge, { backgroundColor: c.primary, borderColor: c.background, transform: [{ scale: pop }] }]}>
          <Text style={[styles.badgeText, { color: c.primaryForeground }]}>{count > 9 ? "9+" : count}</Text>
        </Animated.View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  badge: {
    position: "absolute",
    top: -5,
    right: -5,
    minWidth: 19,
    height: 19,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: { fontSize: 10, fontFamily: "Inter_700Bold" },
});
