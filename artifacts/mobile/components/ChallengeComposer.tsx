import { MaterialCommunityIcons } from "@expo/vector-icons";
import { haptic as buzz } from "@/lib/motion";
import React from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import MemberAvatar from "@/components/MemberAvatar";
import RollingNumber from "@/components/fx/RollingNumber";
import { Button } from "@/components/ui";
import { useChallenges } from "@/context/ChallengeContext";
import { useCatalog } from "@/hooks/useCatalog";
import { useColors } from "@/hooks/useColors";
import type { PublicUser } from "@/lib/api";
import {
  CHALLENGE_MAX_ODDS,
  CHALLENGE_MIN_ODDS,
  counterOdds,
  roundOdds,
  type ChallengeMode,
  type ChallengeTerms,
} from "@/lib/challengeMath";

/**
 * The "vs a friend" half of the bet slip: who, which format, what price, and
 * exactly what each of you puts in the pot. The stake box and the Send button
 * belong to the slip (BetModal), so the keyboard handling is shared.
 */

export interface ComposerProps {
  friends: PublicUser[];
  loading: boolean;
  friendUid: string | null;
  onFriend: (uid: string) => void;
  onFindFriends: () => void;
  format: ChallengeMode;
  onFormat: (m: ChallengeMode) => void;
  odds: number;
  onOdds: (x: number) => void;
  /** The book's price on the same pick, as a reference point. */
  /** The book's price on this pick, or null when there's no line yet. */
  marketOdds: number | null;
  teamAbbr: string;
  otherAbbr: string;
  disabled?: boolean;
}

const STEP = 0.1;

export function ChallengeSetup({
  friends,
  loading,
  friendUid,
  onFriend,
  onFindFriends,
  format,
  onFormat,
  odds,
  onOdds,
  marketOdds,
  teamAbbr,
  otherAbbr,
  disabled,
}: ComposerProps) {
  const c = useColors();
  const { byId } = useCatalog();
  const { headToHead } = useChallenges();
  const market = marketOdds != null ? clampOdds(marketOdds) : null;

  const bump = (dir: 1 | -1) => {
    buzz.tick();
    onOdds(clampOdds(odds + dir * STEP));
  };

  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 6 }}>
        <Text style={[styles.label, { color: c.mutedForeground }]}>CHALLENGE</Text>
        {friends.length === 0 ? (
          loading ? (
            <ActivityIndicator color={c.mutedForeground} style={{ alignSelf: "flex-start", marginVertical: 8 }} />
          ) : (
            <View style={[styles.noFriends, { backgroundColor: c.secondary, borderColor: c.border }]}>
              <MaterialCommunityIcons name="account-multiple-plus-outline" size={20} color={c.mutedForeground} />
              <Text style={[styles.noFriendsText, { color: c.mutedForeground }]}>Add a friend to challenge them head to head.</Text>
              <Button size="sm" variant="secondary" label="Find friends" onPress={onFindFriends} />
            </View>
          )
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8 }}>
            {friends.map((f) => {
              const on = f.uid === friendUid;
              const rec = headToHead(f.uid);
              const played = rec.won + rec.lost + rec.push;
              return (
                <Pressable
                  key={f.uid}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on, disabled }}
                  accessibilityLabel={`Challenge ${f.displayName}`}
                  disabled={disabled}
                  onPress={() => {
                    buzz.tick();
                    onFriend(f.uid);
                  }}
                  style={[styles.friend, { backgroundColor: on ? c.alpha(c.accent, 0.14) : c.secondary, borderColor: on ? c.accent : c.border }]}
                >
                  <MemberAvatar profile={f} name={f.displayName} color={c.accent} catalog={byId} size={34} ring={on ? c.accent : undefined} />
                  <View style={{ flexShrink: 1 }}>
                    <Text style={[styles.friendName, { color: on ? c.foreground : c.cardForeground }]} numberOfLines={1}>
                      {f.displayName}
                    </Text>
                    <Text style={[styles.friendMeta, { color: c.subtleForeground }]} numberOfLines={1}>
                      {played ? `You ${rec.won}–${rec.lost}${rec.push ? `–${rec.push}` : ""}` : `@${f.username}`}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>

      <View style={{ gap: 6 }}>
        <Text style={[styles.label, { color: c.mutedForeground }]}>FORMAT</Text>
        <View style={styles.formats}>
          <FormatCard
            on={format === "pot"}
            icon="treasure-chest"
            title="Winner takes the pot"
            body="You both put in the same"
            onPress={() => onFormat("pot")}
            disabled={disabled}
          />
          <FormatCard
            on={format === "odds"}
            icon="scale-balance"
            title="Set the odds"
            body="Your price, they cover it"
            onPress={() => onFormat("odds")}
            disabled={disabled}
          />
        </View>
      </View>

      {format === "odds" ? (
        <View style={{ gap: 8 }}>
          <View style={[styles.oddsRow, { backgroundColor: c.secondary, borderColor: c.border }]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Lower the odds" disabled={disabled || odds <= CHALLENGE_MIN_ODDS} onPress={() => bump(-1)} hitSlop={8} style={[styles.stepBtn, { borderColor: c.border, opacity: odds <= CHALLENGE_MIN_ODDS ? 0.4 : 1 }]}>
              <MaterialCommunityIcons name="minus" size={20} color={c.foreground} />
            </Pressable>
            <View style={{ flex: 1, alignItems: "center" }}>
              <Text style={[styles.oddsValue, { color: c.foreground }]}>{odds.toFixed(2)}x</Text>
              <Text style={[styles.friendMeta, { color: c.mutedForeground }]}>on {teamAbbr}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Raise the odds" disabled={disabled || odds >= CHALLENGE_MAX_ODDS} onPress={() => bump(1)} hitSlop={8} style={[styles.stepBtn, { borderColor: c.border, opacity: odds >= CHALLENGE_MAX_ODDS ? 0.4 : 1 }]}>
              <MaterialCommunityIcons name="plus" size={20} color={c.foreground} />
            </Pressable>
          </View>
          <View style={styles.presets}>
            {[
              ...(market != null ? [{ label: `Market ${market.toFixed(2)}x`, value: market }] : []),
              { label: "Even 2.00x", value: 2 },
              { label: "3.00x", value: 3 },
            ].map((p) => {
              const on = Math.abs(p.value - odds) < 0.001;
              return (
                <Pressable
                  key={p.label}
                  disabled={disabled}
                  onPress={() => {
                    buzz.tick();
                    onOdds(p.value);
                  }}
                  style={[styles.preset, { backgroundColor: on ? c.alpha(c.accent, 0.14) : c.secondary, borderColor: on ? c.accent : c.border }]}
                >
                  <Text style={[styles.presetText, { color: on ? c.foreground : c.mutedForeground }]}>{p.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.hint, { color: c.mutedForeground }]}>
            Higher odds mean your friend puts in more to cover you. They get {otherAbbr}.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** The money in plain terms: what each of you escrows and what the winner takes. */
export function ChallengeSummary({
  terms,
  friendName,
  teamAbbr,
  otherAbbr,
}: {
  terms: ChallengeTerms | null;
  friendName: string;
  teamAbbr: string;
  otherAbbr: string;
}) {
  const c = useColors();
  const mine = terms?.creatorStake ?? 0;
  const theirs = terms?.opponentStake ?? 0;
  const pot = terms?.pot ?? 0;
  return (
    <View style={[styles.summary, { borderColor: c.alpha(c.accent, 0.35), backgroundColor: c.alpha(c.accent, 0.06) }]}>
      <View style={styles.potHead}>
        <View style={styles.potSide}>
          <Text style={[styles.potWho, { color: c.mutedForeground }]} numberOfLines={1}>
            YOU · {teamAbbr}
          </Text>
          <Text style={[styles.potStake, { color: c.foreground }]}>{mine.toLocaleString()}</Text>
        </View>
        <View style={[styles.potCenter, { borderColor: c.alpha(c.accent, 0.5), backgroundColor: c.elevated }]}>
          <MaterialCommunityIcons name="treasure-chest" size={16} color={c.accent} />
          <RollingNumber value={pot} style={[styles.potTotal, { color: c.foreground }]} duration={380} flash={false} />
          <Text style={[styles.potWho, { color: c.mutedForeground }]}>POT</Text>
        </View>
        <View style={[styles.potSide, { alignItems: "flex-end" }]}>
          <Text style={[styles.potWho, { color: c.mutedForeground }]} numberOfLines={1}>
            {friendName.toUpperCase()} · {otherAbbr}
          </Text>
          <Text style={[styles.potStake, { color: c.foreground }]}>{theirs.toLocaleString()}</Text>
        </View>
      </View>
      <Row label={`If ${teamAbbr} wins`} value={`+${theirs.toLocaleString()} profit`} color={c.positive} />
      <Row label={`If ${otherAbbr} wins`} value={mine ? `−${mine.toLocaleString()}` : "0"} color={mine ? c.negative : undefined} />
      <Row label="If it's a draw" value="Both stakes back" />
      {terms && terms.mode === "odds" ? (
        <Row label={`${friendName}'s price on ${otherAbbr}`} value={`${counterOdds(terms).toFixed(2)}x`} />
      ) : null}
    </View>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  const c = useColors();
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: c.mutedForeground }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.rowValue, { color: color ?? c.foreground }]}>{value}</Text>
    </View>
  );
}

function FormatCard({
  on,
  icon,
  title,
  body,
  onPress,
  disabled,
}: {
  on: boolean;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  title: string;
  body: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected: on, disabled }}
      disabled={disabled}
      onPress={() => {
        if (!on) buzz.tick();
        onPress();
      }}
      style={[styles.format, { backgroundColor: on ? c.alpha(c.accent, 0.14) : c.secondary, borderColor: on ? c.accent : c.border }]}
    >
      <MaterialCommunityIcons name={icon} size={18} color={on ? c.accent : c.mutedForeground} />
      <Text style={[styles.formatTitle, { color: on ? c.foreground : c.cardForeground }]}>{title}</Text>
      <Text style={[styles.friendMeta, { color: c.mutedForeground }]}>{body}</Text>
    </Pressable>
  );
}

export function clampOdds(x: number): number {
  if (!Number.isFinite(x)) return 2;
  return roundOdds(Math.min(CHALLENGE_MAX_ODDS, Math.max(CHALLENGE_MIN_ODDS, x)));
}

const styles = StyleSheet.create({
  label: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  noFriends: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, padding: 10 },
  noFriendsText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
  friend: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1.5, borderRadius: 12, paddingLeft: 6, paddingRight: 12, paddingVertical: 6, maxWidth: 190 },
  friendName: { fontSize: 13, fontFamily: "Inter_700Bold" },
  friendMeta: { fontSize: 11, fontFamily: "Inter_500Medium" },
  formats: { flexDirection: "row", gap: 8 },
  format: { flex: 1, borderWidth: 1.5, borderRadius: 12, padding: 10, gap: 3 },
  formatTitle: { fontSize: 13, fontFamily: "Inter_700Bold" },
  oddsRow: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 14, padding: 8, gap: 8 },
  stepBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  oddsValue: { fontSize: 24, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"] },
  presets: { flexDirection: "row", gap: 8 },
  preset: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 8, alignItems: "center" },
  presetText: { fontSize: 12, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  hint: { fontSize: 11, fontFamily: "Inter_400Regular" },
  summary: { gap: 6, borderWidth: 1, borderRadius: 14, padding: 12 },
  potHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  potSide: { flex: 1, gap: 2 },
  potWho: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.6 },
  potStake: { fontSize: 18, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"] },
  potCenter: { alignItems: "center", borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6, minWidth: 86 },
  potTotal: { fontSize: 20, fontFamily: "Inter_900Black", fontVariant: ["tabular-nums"] },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  rowLabel: { flexShrink: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  rowValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
});
