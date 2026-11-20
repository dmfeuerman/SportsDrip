import { MaterialCommunityIcons } from "@expo/vector-icons";
import { router, usePathname } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeIn, FadeOut, ZoomIn } from "react-native-reanimated";
import { Pressable } from "@/components/fx/Tap";
import { TourTarget } from "@/components/tour/TourTarget";
import { LiquidGlass } from "@/components/ui/LiquidGlass";
import { slipOdds, useParlay } from "@/context/ParlayContext";
import { useColors } from "@/hooks/useColors";
import { formatOdds } from "@/lib/odds";
import { useOddsFormat } from "@/lib/settings";

const TAB_BAR = 72;

/**
 * The floating parlay button: shows once a pick is on the slip, with the leg
 * count and combined price, and opens the full parlay slip (app/parlay.tsx).
 */
export default function ParlaySlip() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const fmt = useOddsFormat();
  const path = usePathname();
  const { legs } = useParlay();

  if (!legs.length || path === "/parlay" || path === "/checkout") return null;
  const odds = slipOdds(legs);
  const ready = legs.length >= 2;

  return (
    <Animated.View entering={FadeIn} exiting={FadeOut} style={[styles.pillWrap, { bottom: insets.bottom + TAB_BAR + 44 }]}>
      <TourTarget id="parlay.pill">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Parlay slip, ${legs.length} legs. Open`}
          onPress={() => router.push("/parlay" as never)}
          style={({ pressed }) => [{ opacity: pressed ? 0.88 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }]}
        >
          <LiquidGlass
            variant="pill"
            interactive
            tintColor={c.alpha(c.primary, 0.88)}
            borderColor={c.alpha("#FFFFFF", 0.45)}
            borderWidth={1.25}
            style={[styles.shadow, { shadowColor: c.primary }]}
            contentStyle={styles.pill}
          >
            <MaterialCommunityIcons name="cart-outline" size={17} color="#000" />
            <Animated.View key={legs.length} entering={ZoomIn.springify()} style={styles.count}>
              <Text style={styles.countText}>{legs.length}</Text>
            </Animated.View>
            <Text style={styles.pillText}>
              Parlay{ready ? ` · ${formatOdds(odds, fmt)}` : " · add 1 more leg"}
            </Text>
            <MaterialCommunityIcons name="chevron-right" size={17} color="#000" />
          </LiquidGlass>
        </Pressable>
      </TourTarget>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pillWrap: { position: "absolute", right: 16, zIndex: 40 },
  shadow: {
    shadowOpacity: 0.42,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  pill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10 },
  count: { minWidth: 20, height: 20, borderRadius: 10, backgroundColor: "#000", alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  countText: { color: "#fff", fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  pillText: { color: "#000", fontSize: 13, fontFamily: "Inter_800ExtraBold" },
});
