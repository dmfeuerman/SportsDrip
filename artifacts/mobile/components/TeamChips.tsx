import React, { memo } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import TeamCrest from "@/components/TeamCrest";
import { teamKey } from "@/constants/teams";
import { useColors } from "@/hooks/useColors";
import type { FavoriteTeam } from "@/lib/api";

/**
 * Favourite teams as team-coloured chips. `compact` is the abbreviation-only
 * row for league cards; the full size shows the name too, for profiles.
 */
function TeamChips({
  teams,
  max = 3,
  compact,
  style,
}: {
  teams?: FavoriteTeam[] | null;
  max?: number;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  if (!teams?.length) return null;
  const shown = teams.slice(0, max);
  const more = teams.length - shown.length;
  return (
    <View
      style={[styles.row, style]}
      accessible
      accessibilityLabel={`Favorite teams: ${teams.map((t) => t.name).join(", ")}`}
    >
      {shown.map((t) =>
        compact ? (
          <TeamCrest key={teamKey(t)} abbr={t.abbr} color={t.color} size={26} sport={t.sport} style={styles.crestSm} />
        ) : (
          <View key={teamKey(t)} style={[styles.chip, { backgroundColor: c.secondary, borderColor: c.alpha(c.foreground, 0.12) }]}>
            <TeamCrest abbr={t.abbr} color={t.color} size={28} sport={t.sport} />
            <Text style={[styles.name, { color: c.foreground }]} numberOfLines={1}>
              {t.name}
            </Text>
          </View>
        )
      )}
      {more > 0 && <Text style={[styles.more, { color: c.mutedForeground }]}>+{more}</Text>}
    </View>
  );
}

export default memo(TeamChips);

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  chip: { flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 8, paddingRight: 14, paddingVertical: 6, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, maxWidth: 220 },
  crestSm: { marginRight: 4 },
  chipSm: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth },
  abbr: { fontSize: 12, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.3 },
  abbrSm: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.3 },
  name: { fontSize: 13, fontFamily: "Inter_700Bold", flexShrink: 1 },
  more: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
