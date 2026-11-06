import { doc, onSnapshot } from "firebase/firestore";
import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { Button, Card, Pill } from "@/components/ui";
import theme from "@/constants/theme";
import type { League } from "@/constants/leagueTypes";
import { useColors } from "@/hooks/useColors";
import * as api from "@/lib/api";
import { getDb } from "@/lib/firebase";
import { haptic } from "@/lib/motion";

interface Slot {
  id: string;
  round: number;
  teams?: [string, string];
  feeds?: [string, string];
}
interface Template {
  name: string;
  locksAt: number;
  slots: Slot[];
  results?: Record<string, string>;
}

const COL_W = 132;

/** Mirrors functions/src/lib/bracket.ts slotOptions. */
function options(t: Template, picks: Record<string, string>, s: Slot): string[] {
  if (s.round === 1) return [...(s.teams ?? [])];
  return (s.feeds ?? []).map((f) => picks[f]).filter((x): x is string => !!x);
}

/** Pick a downstream winner and clear later picks that no longer follow. */
function cascade(t: Template, picks: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of [...t.slots].sort((a, b) => a.round - b.round)) {
    const p = picks[s.id];
    if (p && options(t, out, s).includes(p)) out[s.id] = p;
  }
  return out;
}

/** Bracket fill: one column per round, pinch to zoom (iOS) and pan in both directions. */
export default function BracketFill({ league, uid }: { league: League & { bracketTemplateId?: string | null }; uid: string | null }) {
  const c = useColors();
  const [tpl, setTpl] = useState<Template | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [points, setPoints] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const db = getDb();
    if (!db || !league.bracketTemplateId) return;
    return onSnapshot(doc(db, "bracketTemplates", league.bracketTemplateId), (s) => setTpl(s.exists() ? (s.data() as Template) : null), () => {});
  }, [league.bracketTemplateId]);
  useEffect(() => {
    const db = getDb();
    if (!db || !uid) return;
    return onSnapshot(
      doc(db, "leagues", league.id, "brackets", uid),
      (s) => {
        if (!s.exists()) return;
        setPicks((s.get("picks") as Record<string, string>) ?? {});
        setPoints((s.get("points") as number) ?? 0);
      },
      () => {}
    );
  }, [league.id, uid]);

  const rounds = useMemo(() => {
    const m = new Map<number, Slot[]>();
    for (const s of tpl?.slots ?? []) m.set(s.round, [...(m.get(s.round) ?? []), s]);
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [tpl]);

  if (!league.bracketTemplateId) {
    return (
      <Card>
        <Text style={[styles.sub, { color: c.mutedForeground }]}>No tournament is attached to this league yet.</Text>
      </Card>
    );
  }
  if (!tpl) return null;
  const locked = Date.now() >= tpl.locksAt;

  return (
    <Card style={{ gap: 8 }}>
      <View style={styles.head}>
        <Text style={[styles.title, { color: c.foreground, flex: 1 }]}>{tpl.name}</Text>
        <Pill label={locked ? `${points} pts` : "Open"} tone={locked ? "league" : "accent"} />
      </View>
      <ScrollView horizontal maximumZoomScale={2.5} minimumZoomScale={0.6} bouncesZoom showsHorizontalScrollIndicator={false}>
        <View style={styles.grid}>
          {rounds.map(([round, slots]) => (
            <View key={round} style={[styles.col, { width: COL_W }]}>
              <Text style={[styles.round, { color: c.mutedForeground }]}>Round {round}</Text>
              {slots.map((s) => {
                const opts = options(tpl, picks, s);
                const result = tpl.results?.[s.id];
                return (
                  <View key={s.id} style={[styles.slot, { borderColor: c.border, backgroundColor: c.secondary }]}>
                    {(opts.length ? opts : ["TBD", "TBD"]).map((team, i) => {
                      const on = picks[s.id] === team;
                      const tone = result ? (result === team ? c.positive : on ? c.negative : c.mutedForeground) : on ? c.primary : c.foreground;
                      return (
                        <Pressable
                          key={`${team}_${i}`}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on, disabled: locked || team === "TBD" }}
                          accessibilityLabel={`Round ${round}: pick ${team}`}
                          disabled={locked || team === "TBD"}
                          onPress={() => {
                            haptic.tick();
                            setPicks((p) => cascade(tpl, { ...p, [s.id]: team }));
                          }}
                          style={[styles.team, on && { backgroundColor: c.alpha(c.primary, 0.18) }]}
                        >
                          <Text style={[styles.teamText, { color: tone }]}>{team}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>
      {!locked ? (
        <Button
          label="Save Bracket"
          loading={busy}
          onPress={async () => {
            setBusy(true);
            setMsg(null);
            try {
              await api.submitBracket({ leagueId: league.id, picks });
              haptic.success();
              setMsg("Saved.");
            } catch (e) {
              setMsg(api.friendlyError(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}
      {msg ? <Text style={[styles.sub, { color: c.mutedForeground }]}>{msg}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: theme.type.bodyStrong,
  sub: theme.type.caption,
  round: theme.type.overline,
  grid: { flexDirection: "row", gap: 10, paddingVertical: 4 },
  col: { gap: 10, justifyContent: "space-around" },
  slot: { borderWidth: 1, borderRadius: 10, overflow: "hidden" },
  team: { paddingVertical: 8, paddingHorizontal: 10 },
  teamText: theme.type.captionStrong,
});
