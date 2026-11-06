import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, { FadeIn, ZoomIn } from "react-native-reanimated";
import { Pressable } from "@/components/fx/Tap";
import { REACTION_EMOJIS } from "@/constants/leagueTypes";
import { useColors } from "@/hooks/useColors";
import { useOptimisticReaction } from "@/hooks/useOptimisticReaction";
import { haptic } from "@/lib/motion";

/**
 * Emoji reactions under a chat message: the ones in use as chips with counts,
 * plus a smiley that opens the full picker. My pick shows instantly.
 */
export default function ReactionRow({
  reactors,
  reactions,
  uid,
  onReact,
  canReact = true,
  align = "left",
}: {
  reactors?: Record<string, string>;
  reactions?: Record<string, number>;
  uid: string | null | undefined;
  /** Sends the toggle; resolve to an error string / false to roll back. */
  onReact: (emoji: string) => Promise<unknown> | unknown;
  canReact?: boolean;
  align?: "left" | "right";
}) {
  const c = useColors();
  const { mine, counts, toggle } = useOptimisticReaction(reactors, uid, reactions);
  const [picking, setPicking] = useState(false);
  const used = REACTION_EMOJIS.filter((e) => (counts[e] ?? 0) > 0);
  if (!used.length && !canReact) return null;

  const tap = (e: string) => {
    if (!canReact) return;
    haptic.tick();
    setPicking(false);
    void toggle(e, onReact);
  };

  return (
    <View style={[styles.row, align === "right" && { justifyContent: "flex-end" }]}>
      {used.map((e) => {
        const on = mine === e;
        return (
          <Animated.View key={e} entering={ZoomIn.springify().damping(14)}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${e} ${counts[e]}${on ? ", yours" : ""}`}
              disabled={!canReact}
              hitSlop={4}
              onPress={() => tap(e)}
              style={[styles.chip, { borderColor: on ? c.league : c.border, backgroundColor: on ? c.leagueSoft : c.secondary }]}
            >
              <Text style={styles.emoji}>{e}</Text>
              <Text style={[styles.count, { color: on ? c.league : c.mutedForeground }]}>{counts[e]}</Text>
            </Pressable>
          </Animated.View>
        );
      })}
      {canReact ? (
        picking ? (
          <Animated.View entering={FadeIn.duration(120)} style={[styles.picker, { backgroundColor: c.elevated, borderColor: c.border }]}>
            {REACTION_EMOJIS.map((e) => (
              <Pressable key={e} accessibilityRole="button" accessibilityLabel={`React ${e}`} hitSlop={3} onPress={() => tap(e)} style={[styles.pick, mine === e && { backgroundColor: c.leagueSoft }]}>
                <Text style={styles.pickEmoji}>{e}</Text>
              </Pressable>
            ))}
            <Pressable accessibilityRole="button" accessibilityLabel="Close reactions" hitSlop={6} onPress={() => setPicking(false)} style={styles.pick}>
              <MaterialCommunityIcons name="close" size={14} color={c.mutedForeground} />
            </Pressable>
          </Animated.View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add reaction"
            hitSlop={6}
            onPress={() => {
              haptic.tick();
              setPicking(true);
            }}
            style={[styles.chip, { borderColor: c.border, backgroundColor: "transparent" }]}
          >
            <MaterialCommunityIcons name="emoticon-plus-outline" size={14} color={c.mutedForeground} />
          </Pressable>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 4, paddingHorizontal: 4 },
  chip: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, borderWidth: 1, minHeight: 24 },
  emoji: { fontSize: 13 },
  count: { fontSize: 11, fontFamily: "Inter_700Bold" },
  picker: { flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 4, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  pick: { paddingHorizontal: 5, paddingVertical: 3, borderRadius: 999 },
  pickEmoji: { fontSize: 18 },
});
