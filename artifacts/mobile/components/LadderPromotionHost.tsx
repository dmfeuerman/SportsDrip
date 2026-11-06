import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import { OVERLAY, useOverlayTurn } from "@/lib/overlayTurns";
import { Modal, StyleSheet, Text, View } from "react-native";
import Burst from "@/components/fx/Burst";
import LightBeams from "@/components/fx/LightBeams";
import { ActionChip, Button } from "@/components/ui";
import theme from "@/constants/theme";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";
import { celebrate } from "@/lib/celebrate";

const TIER_LABEL: Record<string, string> = { bronze: "Bronze", silver: "Silver", gold: "Gold", platinum: "Platinum", diamond: "Diamond" };
const KEY = "sportdrip.ladderSeen.v1";

/** Tier chip (links to the ladder) plus the "promotion" celebration, once per promotion. */
export default function LadderPromotionHost() {
  const c = useColors();
  const { profile } = useApp();
  const ladder = profile?.ladder as (NonNullable<typeof profile>["ladder"] & { lastResult?: string }) | null | undefined;
  const [show, setShow] = useState(false);
  const fx = celebrate("promotion");

  useEffect(() => {
    if (ladder?.lastResult !== "promoted" || !ladder.week || !profile?.uid) return;
    const k = `${KEY}.${profile.uid}`;
    AsyncStorage.getItem(k)
      .then((seen) => {
        if (seen === ladder.week) return;
        setShow(true);
        return AsyncStorage.setItem(k, ladder.week);
      })
      .catch(() => {});
  }, [ladder?.lastResult, ladder?.week, profile?.uid]);

  const myTurn = useOverlayTurn("ladder", show, OVERLAY.ladder);
  if (!ladder?.tier) return null;
  const label = TIER_LABEL[ladder.tier] ?? "Bronze";
  return (
    <>
      <ActionChip label={`${label} ladder`} icon="stairs-up" tone="accent" onPress={() => router.push("/ladder" as never)} />
      <Modal visible={show && myTurn} transparent animationType="fade" onRequestClose={() => setShow(false)} statusBarTranslucent>
        <View style={[styles.scrim, { backgroundColor: c.overlay }]}>
          {fx.beams ? (
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <LightBeams color={c.primary} size={520} beams={16} opacity={0.5} />
            </View>
          ) : null}
          {fx.burst ? <Burst colors={[c.primary, c.accent, c.warning, "#FFFFFF"]} count={fx.burst.count} power={fx.burst.power} duration={fx.burst.duration} originY={0.35} /> : null}
          <View accessibilityViewIsModal style={[styles.card, { backgroundColor: c.elevated, borderColor: c.border }]}>
            <Text style={[styles.kicker, { color: c.primary }]}>PROMOTED</Text>
            <Text style={[styles.big, { color: c.foreground }]}>{label}</Text>
            <Button label="Nice" onPress={() => setShow(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 320, borderWidth: 1, borderRadius: 24, padding: 24, gap: 10, alignItems: "center" },
  kicker: theme.type.overline,
  big: theme.type.display,
});
