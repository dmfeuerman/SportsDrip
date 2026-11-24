import React, { useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import AvatarDisplay from "@/components/AvatarDisplay";
import { Pressable } from "@/components/fx/Tap";
import { Button } from "@/components/ui";
import theme from "@/constants/theme";
import { useCatalog } from "@/hooks/useCatalog";
import { useColors } from "@/hooks/useColors";
import type { AvatarConfig, Equipped } from "@/types/avatar";

export interface TauntPayload {
  moveId?: string;
  text: string;
  avatar?: Partial<AvatarConfig> | null;
  equipped?: Equipped | null;
}

/**
 * A taunt row: a still portrait in the list (no 3D mounted in chat), and a
 * modal that plays the move on tap.
 */
export default function TauntCard({ taunt }: { taunt: TauntPayload }) {
  const c = useColors();
  const { byId } = useCatalog();
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(0);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${taunt.text}. Play the dance`}
        onPress={() => {
          setN((x) => x + 1);
          setOpen(true);
        }}
        style={[styles.row, { borderColor: c.border, backgroundColor: c.secondary }]}
      >
        {/* Stills fill their parent: give it a frame so it sits beside the text, not over the whole row. */}
        <View style={[styles.thumb, { backgroundColor: c.background }]}>
          <AvatarDisplay avatar={taunt.avatar} equipped={taunt.equipped} catalog={byId} size="sm" interactive={false} />
        </View>
        <Text style={[styles.text, { color: c.foreground }]} numberOfLines={1}>
          Tap to play the dance
        </Text>
        <Text style={[styles.play, { color: c.primary }]}>▶︎</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <View style={[styles.scrim, { backgroundColor: c.overlay }]}>
          <View accessibilityViewIsModal style={[styles.stage, { backgroundColor: c.elevated, borderColor: c.border }]}>
            <View style={[styles.dance, { backgroundColor: c.secondary }]}>
              {open && taunt.moveId ? (
                <AvatarDisplay
                  avatar={taunt.avatar}
                  equipped={taunt.equipped}
                  catalog={byId}
                  size="lg"
                  interactive={false}
                  focus="dance"
                  move={{ id: taunt.moveId, n }}
                />
              ) : null}
            </View>
            <Text style={[styles.text, { color: c.foreground, textAlign: "center" }]}>{taunt.text}</Text>
            <Button label="Replay" variant="secondary" onPress={() => setN((x) => x + 1)} />
            <Button label="Close" variant="ghost" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, padding: 8, minWidth: 200 },
  thumb: { width: 40, height: 50, borderRadius: 8, overflow: "hidden" },
  dance: { height: 340, borderRadius: 16, overflow: "hidden" },
  text: { ...theme.type.bodyStrong, flex: 1 },
  play: theme.type.heading,
  scrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  stage: { width: "100%", maxWidth: 360, borderWidth: 1, borderRadius: 24, padding: 16, gap: 10, alignItems: "stretch" },
});
