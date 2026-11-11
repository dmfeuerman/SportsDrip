import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { formRecord, splitOnly, streakOf, winPct, type FormResult } from "@/lib/teamIdentity";
import type { Game, TeamSide } from "@/types/game";

/**
 * Team context shown right where a pick is made: home/away, record, current
 * streak and the last five. Everything is derived on the device from the
 * games feed; nothing here costs a read or a function call.
 */

/** HOME / AWAY / NEUTRAL tag. */
export const VenueTag = memo(function VenueTag({ side, neutral }: { side: "home" | "away"; neutral?: boolean | null }) {
  const c = useColors();
  const label = neutral ? "NEUTRAL" : side === "home" ? "HOME" : "AWAY";
  return (
    <View style={[styles.tag, { borderColor: c.alpha(c.foreground, 0.22) }]} accessibilityLabel={neutral ? "Neutral site" : side === "home" ? "Home team" : "Away team"}>
      <Text style={[styles.tagText, { color: c.mutedForeground }]}>{label}</Text>
    </View>
  );
});

/** Flame for a winning run, snowflake for a losing one. Hidden for a run of one. */
export const StreakBadge = memo(function StreakBadge({ form, min = 2 }: { form?: readonly FormResult[] | null; min?: number }) {
  const c = useColors();
  const s = streakOf(form);
  if (!s || s.count < min || s.kind === "D") return null;
  const win = s.kind === "W";
  const tone = win ? c.positive : c.negative;
  // A run that fills the whole sample may be longer than we can see.
  const plus = form && s.count === form.length && form.length >= 5 ? "+" : "";
  return (
    <View
      style={[styles.streak, { backgroundColor: c.alpha(tone, 0.16) }]}
      accessibilityLabel={`${win ? "Won" : "Lost"} last ${s.count}${plus ? " or more" : ""}`}
    >
      <MaterialCommunityIcons name={win ? "fire" : "snowflake"} size={11} color={tone} />
      <Text style={[styles.streakText, { color: tone }]}>
        {s.kind}
        {s.count}
        {plus}
      </Text>
    </View>
  );
});

/** Last five as lettered chips, oldest on the left so it reads like a timeline. */
export const FormChips = memo(function FormChips({ form, size = 16 }: { form?: readonly FormResult[] | null; size?: number }) {
  const c = useColors();
  if (!form?.length) return null;
  const shown = form.slice(0, 5).reverse();
  return (
    <View style={styles.chips} accessibilityLabel={`Last ${shown.length}: ${formRecord(form.slice(0, 5))}, most recent ${form[0] === "W" ? "win" : form[0] === "L" ? "loss" : "draw"}`}>
      {shown.map((r, i) => {
        const tone = r === "W" ? c.positive : r === "L" ? c.negative : c.push;
        const latest = i === shown.length - 1;
        return (
          <View
            key={i}
            style={{
              width: size,
              height: size,
              borderRadius: size / 4,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: c.alpha(tone, latest ? 0.95 : 0.2),
              borderWidth: latest ? 0 : StyleSheet.hairlineWidth,
              borderColor: c.alpha(tone, 0.5),
            }}
          >
            <Text style={{ fontSize: size * 0.58, fontFamily: "Inter_800ExtraBold", color: latest ? c.background : tone }}>{r}</Text>
          </View>
        );
      })}
    </View>
  );
});

/** One compact line for a board row: AWAY · 9-3 · 🔥W3. */
export const TeamInfoLine = memo(function TeamInfoLine({
  team,
  side,
  neutral,
}: {
  team: TeamSide;
  side: "home" | "away";
  neutral?: boolean | null;
}) {
  const c = useColors();
  const split = splitOnly(team.splitRecord);
  return (
    <View style={styles.line}>
      <VenueTag side={side} neutral={neutral} />
      {team.record ? (
        <Text style={[styles.record, { color: c.mutedForeground }]} numberOfLines={1}>
          {team.record}
          {split && !neutral ? <Text style={{ color: c.subtleForeground }}>{`  ${split} ${side === "home" ? "home" : "away"}`}</Text> : null}
        </Text>
      ) : null}
      <StreakBadge form={team.form} />
    </View>
  );
});

type TapeRow = { label: string; away: string | null; home: string | null; better?: "home" | "away" | null };

function higher(a: number | null | undefined, h: number | null | undefined, lowerWins = false): "home" | "away" | null {
  if (a == null || h == null || a === h) return null;
  return (lowerWins ? a < h : a > h) ? "away" : "home";
}

/** Rows for the side-by-side comparison. Exported so screens can test for "anything to show". */
export function tapeRows(game: Pick<Game, "homeTeam" | "awayTeam" | "neutralSite">): TapeRow[] {
  const a = game.awayTeam;
  const h = game.homeTeam;
  const rows: TapeRow[] = [];
  if (a.rank || h.rank) rows.push({ label: "Rank", away: a.rank ? `#${a.rank}` : "—", home: h.rank ? `#${h.rank}` : "—", better: higher(a.rank ?? 999, h.rank ?? 999, true) });
  if (a.record || h.record) rows.push({ label: "Record", away: a.record ?? "—", home: h.record ?? "—", better: higher(winPct(a.record), winPct(h.record)) });
  const as = splitOnly(a.splitRecord);
  const hs = splitOnly(h.splitRecord);
  if (!game.neutralSite && (as || hs)) rows.push({ label: "Away / Home", away: as ?? "—", home: hs ?? "—", better: higher(winPct(as), winPct(hs)) });
  const af = formRecord(a.form?.slice(0, 5));
  const hf = formRecord(h.form?.slice(0, 5));
  if (af || hf) rows.push({ label: `Last ${Math.max(a.form?.slice(0, 5).length ?? 0, h.form?.slice(0, 5).length ?? 0)}`, away: af ?? "—", home: hf ?? "—", better: higher(winPct(af), winPct(hf)) });
  if (a.pointsFor != null || h.pointsFor != null)
    rows.push({ label: "Scores / game", away: a.pointsFor?.toFixed(1) ?? "—", home: h.pointsFor?.toFixed(1) ?? "—", better: higher(a.pointsFor, h.pointsFor) });
  if (a.pointsAgainst != null || h.pointsAgainst != null)
    rows.push({ label: "Allows / game", away: a.pointsAgainst?.toFixed(1) ?? "—", home: h.pointsAgainst?.toFixed(1) ?? "—", better: higher(a.pointsAgainst, h.pointsAgainst, true) });
  return rows;
}

/** Tale of the tape: away on the left, home on the right, the better number highlighted. */
export const MatchupTape = memo(function MatchupTape({ game }: { game: Game }) {
  const c = useColors();
  const rows = tapeRows(game);
  if (rows.length === 0) return null;
  return (
    <View style={[styles.tape, { borderColor: c.border, backgroundColor: c.card }]}>
      <View style={styles.tapeHead}>
        <View style={[styles.swatch, { backgroundColor: game.awayTeam.color }]} />
        <Text style={[styles.tapeTeam, { color: c.foreground }]}>{game.awayTeam.abbreviation}</Text>
        <Text style={[styles.tapeTitle, { color: c.subtleForeground }]}>TALE OF THE TAPE</Text>
        <Text style={[styles.tapeTeam, { color: c.foreground, textAlign: "right" }]}>{game.homeTeam.abbreviation}</Text>
        <View style={[styles.swatch, { backgroundColor: game.homeTeam.color }]} />
      </View>
      {rows.map((r) => (
        <View key={r.label} style={[styles.tapeRow, { borderTopColor: c.border }]}>
          <Text style={[styles.tapeVal, { color: r.better === "away" ? c.positive : c.cardForeground }]}>{r.away}</Text>
          <Text style={[styles.tapeLabel, { color: c.mutedForeground }]}>{r.label}</Text>
          <Text style={[styles.tapeVal, { color: r.better === "home" ? c.positive : c.cardForeground, textAlign: "right" }]}>{r.home}</Text>
        </View>
      ))}
      {game.awayTeam.form?.length || game.homeTeam.form?.length ? (
        <View style={[styles.tapeRow, { borderTopColor: c.border }]}>
          <View style={styles.tapeForm}>
            <FormChips form={game.awayTeam.form} size={15} />
          </View>
          <Text style={[styles.tapeLabel, { color: c.mutedForeground }]}>Form</Text>
          <View style={[styles.tapeForm, { alignItems: "flex-end" }]}>
            <FormChips form={game.homeTeam.form} size={15} />
          </View>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  tag: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  tagText: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.4 },
  streak: { flexDirection: "row", alignItems: "center", gap: 1, borderRadius: 999, paddingLeft: 3, paddingRight: 5, paddingVertical: 1 },
  streakText: { fontSize: 11, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"] },
  chips: { flexDirection: "row", gap: 3 },
  line: { flexDirection: "row", alignItems: "center", gap: 6, overflow: "hidden" },
  record: { fontSize: 11, fontFamily: "Inter_600SemiBold", flexShrink: 1, fontVariant: ["tabular-nums"] },
  tape: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 4 },
  tapeHead: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 },
  swatch: { width: 4, height: 14, borderRadius: 2 },
  tapeTeam: { flex: 1, fontSize: 13, fontFamily: "Inter_800ExtraBold" },
  tapeTitle: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.2 },
  tapeRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  tapeVal: { flex: 1, fontSize: 14, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  tapeLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", textAlign: "center", minWidth: 96 },
  tapeForm: { flex: 1 },
});
