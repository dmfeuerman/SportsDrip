import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import KeyboardSheet from "@/components/KeyboardSheet";
import { Button } from "@/components/ui";
import { MAX_FAVORITE_TEAMS, onColor, teamKey, TEAMS } from "@/constants/teams";
import { useColors } from "@/hooks/useColors";
import { invalidatePlayerProfile } from "@/hooks/usePlayerProfile";
import * as api from "@/lib/api";
import type { FavoriteTeam } from "@/lib/api";
import { SPORTS, type Sport } from "@/types/game";

/**
 * Pick up to five teams. Saved through the updateFavoriteTeams callable —
 * users/{uid} is server-write-only, so the client never writes it directly.
 */
export default function FavoriteTeamsSheet({
  visible,
  initial,
  onClose,
  uid,
}: {
  visible: boolean;
  initial: FavoriteTeam[];
  onClose: () => void;
  uid?: string | null;
}) {
  const c = useColors();
  const [picked, setPicked] = useState<FavoriteTeam[]>(initial);
  const [sport, setSport] = useState<Sport | "All">("All");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setPicked(initial);
    setErr(null);
    setQ("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pickedKeys = useMemo(() => new Set(picked.map(teamKey)), [picked]);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return TEAMS.filter(
      (t) =>
        (sport === "All" || t.sport === sport) &&
        (!needle || t.name.toLowerCase().includes(needle) || t.abbr.toLowerCase().startsWith(needle))
    );
  }, [sport, q]);

  const full = picked.length >= MAX_FAVORITE_TEAMS;
  const toggle = (t: FavoriteTeam) => {
    const k = teamKey(t);
    if (pickedKeys.has(k)) setPicked((p) => p.filter((x) => teamKey(x) !== k));
    else if (!full) {
      Haptics.selectionAsync().catch(() => {});
      setPicked((p) => [...p, t]);
    }
  };

  const dirty = picked.map(teamKey).join() !== initial.map(teamKey).join();

  return (
    <KeyboardSheet visible={visible} onClose={onClose} style={{ height: "88%" }}>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>
          Favorite teams
        </Text>
        <Text style={[styles.count, { color: full ? c.warning : c.mutedForeground }]}>
          {picked.length}/{MAX_FAVORITE_TEAMS}
        </Text>
      </View>
      <Text style={[styles.sub, { color: c.mutedForeground }]}>Shown on your profile and next to your name in league standings.</Text>

      {picked.length > 0 && (
        <View style={styles.pickedRow}>
          {picked.map((t) => (
            <Pressable
              key={teamKey(t)}
              onPress={() => toggle(t)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${t.name}`}
              style={[styles.pickedChip, { backgroundColor: t.color }]}
            >
              <Text style={[styles.pickedText, { color: onColor(t.color) }]}>{t.abbr}</Text>
              <MaterialCommunityIcons name="close" size={12} color={onColor(t.color)} />
            </Pressable>
          ))}
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled">
        {(["All", ...SPORTS] as const).map((s) => {
          const on = s === sport;
          return (
            <Pressable
              key={s}
              onPress={() => setSport(s)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[styles.sport, { backgroundColor: on ? c.primarySoft : c.secondary, borderColor: on ? c.primary : c.border }]}
            >
              <Text style={[styles.sportText, { color: on ? c.primary : c.mutedForeground }]}>{s}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={[styles.search, { backgroundColor: c.secondary, borderColor: c.border }]}>
        <MaterialCommunityIcons name="magnify" size={18} color={c.mutedForeground} />
        <TextInput
          style={[styles.searchInput, { color: c.foreground }]}
          value={q}
          onChangeText={setQ}
          placeholder="Search teams"
          placeholderTextColor={c.subtleForeground}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search teams"
        />
      </View>

      <FlatList
        style={{ flex: 1 }}
        data={list}
        keyExtractor={teamKey}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={20}
        renderItem={({ item: t }) => {
          const on = pickedKeys.has(teamKey(t));
          const disabled = !on && full;
          return (
            <Pressable
              onPress={() => toggle(t)}
              disabled={disabled}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, disabled }}
              accessibilityLabel={`${t.name}, ${t.sport}`}
              style={({ pressed }) => [styles.row, { borderBottomColor: c.border, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 }]}
            >
              <View style={[styles.swatch, { backgroundColor: t.color }]}>
                <Text style={[styles.swatchText, { color: onColor(t.color) }]}>{t.abbr}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.teamName, { color: c.foreground }]} numberOfLines={1}>
                  {t.name}
                </Text>
                <Text style={[styles.teamSport, { color: c.subtleForeground }]}>{t.sport}</Text>
              </View>
              <MaterialCommunityIcons
                name={on ? "checkbox-marked-circle" : "checkbox-blank-circle-outline"}
                size={22}
                color={on ? c.primary : c.subtleForeground}
              />
            </Pressable>
          );
        }}
        ListEmptyComponent={<Text style={[styles.sub, { color: c.mutedForeground, textAlign: "center", marginTop: 16 }]}>No teams match.</Text>}
      />

      {err ? <Text style={[styles.sub, { color: c.negative }]}>{err}</Text> : null}
      <Button
        label={dirty ? "Save teams" : "Done"}
        size="lg"
        loading={busy}
        onPress={async () => {
          if (!dirty) return onClose();
          setBusy(true);
          setErr(null);
          try {
            await api.updateFavoriteTeams({ teams: picked });
            if (uid) invalidatePlayerProfile(uid);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            onClose();
          } catch (e) {
            setErr(api.friendlyError(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </KeyboardSheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  title: { fontSize: 20, fontFamily: "Inter_900Black" },
  count: { fontSize: 13, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  pickedRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pickedChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  pickedText: { fontSize: 12, fontFamily: "Inter_800ExtraBold" },
  sport: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  sportText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  search: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", padding: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  swatch: { width: 44, height: 30, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  swatchText: { fontSize: 11, fontFamily: "Inter_800ExtraBold" },
  teamName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  teamSport: { fontSize: 11, fontFamily: "Inter_500Medium" },
});
