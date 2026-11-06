import React, { useState } from "react";
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { CloseButton } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import { useFriends } from "@/hooks/useFriends";
import * as api from "@/lib/api";
import { haptic } from "@/lib/motion";
import type { CatalogItem } from "@/types/catalog";

/** Pick a friend and buy them `item`. Server checks friendship, account age, price and ownership. */
export default function GiftSheet({ item, onClose }: { item: CatalogItem | null; onClose: () => void }) {
  const c = useColors();
  const { profile, balance } = useApp();
  const { friends } = useFriends(profile?.uid ?? null);
  const { show } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const send = async (toUid: string, name: string) => {
    if (!item) return;
    setBusy(toUid);
    setErr(null);
    try {
      await api.giftItem({ itemId: item.id, toUid, idempotencyKey: api.newIdempotencyKey() });
      haptic.success();
      show({ kind: "win", title: `Gift sent to ${name} 🎁`, body: `${item.name} is in their wardrobe.` });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't send that gift.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible={!!item} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose} />
      {item && (
        <View style={[styles.sheet, { backgroundColor: c.card, borderColor: c.border }]}>
          <Text style={[styles.title, { color: c.foreground }]}>Gift {item.name}</Text>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>
            {item.price.toLocaleString()} credits from your balance ({balance.toLocaleString()}).
          </Text>
          {err ? <Text style={[styles.sub, { color: c.destructive }]}>{err}</Text> : null}
          <FlatList
            data={friends}
            keyExtractor={(f) => f.uid}
            style={{ maxHeight: 360 }}
            ListEmptyComponent={<Text style={[styles.sub, { color: c.mutedForeground }]}>Add friends to send gifts.</Text>}
            renderItem={({ item: f }) => (
              <Pressable
                style={[styles.row, { borderColor: c.border, opacity: busy && busy !== f.uid ? 0.5 : 1 }]}
                disabled={!!busy || balance < item.price}
                onPress={() => void send(f.uid, f.displayName)}
                accessibilityLabel={`Gift to ${f.displayName}`}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.name, { color: c.foreground }]}>{f.displayName}</Text>
                  <Text style={[styles.sub, { color: c.mutedForeground }]}>@{f.username}</Text>
                </View>
                {busy === f.uid ? <ActivityIndicator color={c.primary} /> : <Text style={{ color: c.primary, fontWeight: "700" }}>Send</Text>}
              </Pressable>
            )}
          />
          <CloseButton onPress={onClose} style={styles.close} />
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: 20, paddingBottom: 36, gap: 10 },
  title: { fontSize: 18, fontWeight: "800" },
  sub: { fontSize: 13 },
  name: { fontSize: 15, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 },
  close: { position: "absolute", top: 12, right: 12 },
});
