import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ItemIcon from "@/components/avatar/ItemIcon";
import TokenBalance from "@/components/TokenBalance";
import { ActionChip, Button, ErrorBanner } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { useCart } from "@/context/CartContext";
import { useCatalog } from "@/hooks/useCatalog";
import { useColors } from "@/hooks/useColors";
import { RARITY_COLORS, SLOT_LABELS, type CatalogItem } from "@/types/catalog";

type Phase = "review" | "paying" | "done";

const credits = (n: number) => n.toLocaleString();
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/**
 * The cart, as its own screen: every selected item as a product card (image,
 * name, details, price, Remove), an order summary, and one Checkout button.
 * Buys each item through the server (which owns balances and inventory and is
 * idempotent), then saves the look they were picked for, so paying means
 * wearing it.
 */
export default function CheckoutScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const cart = useCart();
  const { balance, inventory, purchaseItem, saveLook, error, clearError } = useApp();
  const { byId } = useCatalog();
  const [phase, setPhase] = useState<Phase>("review");
  const [failed, setFailed] = useState<string[]>([]);
  const [bought, setBought] = useState<CatalogItem[]>([]);
  const [lookSaved, setLookSaved] = useState(true);

  const owned = useMemo(() => new Set(inventory), [inventory]);
  const items = useMemo(
    () => cart.ids.map((id) => byId.get(id)).filter((i): i is CatalogItem => !!i && !owned.has(i.id)),
    [cart.ids, byId, owned]
  );
  const total = items.reduce((s, i) => s + i.price, 0);
  const after = balance - total;
  const short = after < 0;

  const back = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)/avatar"));

  const pay = async () => {
    if (!items.length || short) return;
    clearError();
    setFailed([]);
    setPhase("paying");
    const ok: CatalogItem[] = [];
    const bad: string[] = [];
    // One at a time: each purchase is its own atomic, idempotent server call,
    // and the balance check for the next one depends on the last.
    for (const item of items) {
      if (await purchaseItem(item.id)) ok.push(item);
      else bad.push(item.id);
    }
    setBought(ok);
    if (bad.length) {
      setFailed(bad);
      setPhase("review");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return;
    }
    // Everything in the look is owned now: wear it.
    const saved = cart.draft ? await saveLook(cart.draft.avatar, cart.draft.equipped) : true;
    cart.clear();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    if (saved) {
      router.dismissTo("/(tabs)");
      return;
    }
    setLookSaved(false);
    setPhase("done");
  };

  const top = (Platform.OS === "web" ? 12 : insets.top) + 6;

  return (
    <View style={[styles.fill, { backgroundColor: c.background }]}>
      {/* header */}
      <View style={[styles.header, { paddingTop: top, borderBottomColor: c.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={back}
          hitSlop={10}
          style={[styles.round, { backgroundColor: c.secondary, borderColor: c.border }]}
        >
          <MaterialCommunityIcons name="chevron-left" size={22} color={c.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>
            {phase === "done" ? "Order complete" : "Your cart"}
          </Text>
          {phase !== "done" ? (
            <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
              {items.length} {items.length === 1 ? "item" : "items"}
            </Text>
          ) : null}
        </View>
        <TokenBalance tokens={balance} size="sm" />
      </View>

      <ErrorBanner message={error} onDismiss={clearError} />

      {phase === "done" ? (
        <ScrollView contentContainerStyle={[styles.doneBody, { paddingBottom: insets.bottom + 24 }]}>
          <View style={[styles.doneIcon, { backgroundColor: c.positiveSoft }]}>
            <MaterialCommunityIcons name="check-bold" size={30} color={c.positive} />
          </View>
          <Text style={[styles.doneTitle, { color: c.foreground }]}>{lookSaved ? "You're wearing it" : "Purchase complete"}</Text>
          <Text style={[styles.doneText, { color: c.mutedForeground }]}>
            {lookSaved
              ? "Everything below is in your wardrobe and your look is saved."
              : "Everything below is in your wardrobe. Your look didn't save — tap Save in Customize."}
          </Text>
          <View style={[styles.receipt, { backgroundColor: c.card, borderColor: c.border }]}>
            {bought.map((item) => (
              <View key={item.id} style={styles.receiptRow}>
                <Text style={[styles.receiptName, { color: c.foreground }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.receiptPrice, { color: c.mutedForeground }]}>{credits(item.price)}</Text>
              </View>
            ))}
            <View style={[styles.divider, { backgroundColor: c.border }]} />
            <View style={styles.receiptRow}>
              <Text style={[styles.receiptName, styles.strong, { color: c.foreground }]}>Paid</Text>
              <Text style={[styles.receiptPrice, styles.strong, { color: c.foreground }]}>
                {credits(bought.reduce((s, i) => s + i.price, 0))}
              </Text>
            </View>
          </View>
          {lookSaved ? (
            <Button label="Back to Home" icon="home-variant-outline" onPress={() => router.dismissTo("/(tabs)")} style={styles.stretch} />
          ) : null}
          <Button label="Keep customizing" variant="secondary" onPress={back} style={styles.stretch} />
        </ScrollView>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, { backgroundColor: c.secondary }]}>
            <MaterialCommunityIcons name="cart-outline" size={34} color={c.mutedForeground} />
          </View>
          <Text style={[styles.doneTitle, { color: c.foreground }]}>Your cart is empty</Text>
          <Text style={[styles.doneText, { color: c.mutedForeground }]}>
            Tap a locked item in Customize to try it on. It lands here, ready to buy.
          </Text>
          <Button label="Continue shopping" icon="tshirt-crew-outline" onPress={back} style={styles.stretch} />
        </View>
      ) : (
        <>
          <ScrollView style={styles.fill} contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {items.map((item) => (
              <CartItem
                key={item.id}
                item={item}
                failed={failed.includes(item.id)}
                disabled={phase === "paying"}
                onRemove={() => {
                  Haptics.selectionAsync().catch(() => {});
                  cart.remove(item.id);
                }}
              />
            ))}

            <ActionChip label="Continue shopping" icon="arrow-left" chevron={false} tone="money" onPress={back} style={{ alignSelf: "flex-start" }} />

            {/* order summary */}
            <View style={[styles.summary, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[styles.summaryTitle, { color: c.foreground }]}>Order summary</Text>
              <Line label={`Subtotal (${items.length} ${items.length === 1 ? "item" : "items"})`} value={credits(total)} />
              <Line label="Fees" value="Free" />
              <View style={[styles.divider, { backgroundColor: c.border }]} />
              <Line label="Total" value={`${credits(total)} credits`} strong />
              <Line label="Your balance" value={credits(balance)} />
              <Line label="Balance after" value={credits(after)} tone={short ? c.negative : c.positive} />
              {short ? (
                <Text style={[styles.note, { color: c.negative }]}>
                  You're {credits(Math.abs(after))} credits short. Remove something or win a few bets first.
                </Text>
              ) : null}
              {bought.length && failed.length ? (
                <Text style={[styles.note, { color: c.mutedForeground }]}>
                  Bought {bought.map((b) => b.name).join(", ")}. The rest are still in your cart.
                </Text>
              ) : null}
            </View>
          </ScrollView>

          {/* sticky checkout */}
          <View style={[styles.footer, { borderTopColor: c.border, backgroundColor: c.background, paddingBottom: insets.bottom + 12 }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.footLabel, { color: c.mutedForeground }]}>Total</Text>
              <View style={styles.footTotal}>
                <MaterialCommunityIcons name="lightning-bolt" size={18} color={c.primary} />
                <Text style={[styles.footValue, { color: c.foreground }]}>{credits(total)}</Text>
              </View>
            </View>
            <Button
              label={phase === "paying" ? "Paying…" : "Checkout"}
              icon="lock-outline"
              size="lg"
              onPress={pay}
              loading={phase === "paying"}
              disabled={short || phase === "paying"}
              style={{ minWidth: 170 }}
            />
          </View>
        </>
      )}
    </View>
  );
}

/** One product in the cart: picture, name, details, price and Remove. */
function CartItem({ item, failed, disabled, onRemove }: { item: CatalogItem; failed: boolean; disabled: boolean; onRemove: () => void }) {
  const c = useColors();
  const rarity = RARITY_COLORS[item.rarity];
  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: failed ? c.negative : c.border }]}>
      <View style={[styles.image, { backgroundColor: c.secondary, borderColor: c.alpha(rarity, 0.5) }]}>
        <ItemIcon item={item} size={80} />
        <View style={[styles.rarityTag, { backgroundColor: rarity }]}>
          <Text style={styles.rarityText}>{item.rarity.toUpperCase()}</Text>
        </View>
      </View>
      <View style={styles.cardBody}>
        <Text style={[styles.name, { color: c.foreground }]} numberOfLines={2}>
          {item.name}
        </Text>
        <Text style={[styles.meta, { color: c.mutedForeground }]} numberOfLines={1}>
          {SLOT_LABELS[item.slot]} · {cap(item.rarity)} · Qty 1
        </Text>
        {item.description ? (
          <Text style={[styles.desc, { color: c.subtleForeground }]} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
        {failed ? <Text style={[styles.meta, { color: c.negative }]}>Couldn't buy this one. Try again.</Text> : null}
        <View style={styles.cardFoot}>
          <View style={styles.priceRow}>
            <MaterialCommunityIcons name="lightning-bolt" size={15} color={c.primary} />
            <Text style={[styles.price, { color: c.foreground }]}>{credits(item.price)}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.name} from cart`}
            hitSlop={8}
            disabled={disabled}
            onPress={onRemove}
            style={({ pressed }) => [styles.remove, { borderColor: c.border, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}
          >
            <MaterialCommunityIcons name="trash-can-outline" size={15} color={c.negative} />
            <Text style={[styles.removeText, { color: c.negative }]}>Remove</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function Line({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: string }) {
  const c = useColors();
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, { color: strong ? c.foreground : c.mutedForeground }, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.lineValue, { color: tone ?? (strong ? c.foreground : c.mutedForeground) }, strong && styles.strong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  round: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontFamily: "Inter_900Black" },
  subtitle: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 1 },
  body: { padding: 16, gap: 12, paddingBottom: 24 },

  card: { flexDirection: "row", gap: 12, padding: 12, borderRadius: 16, borderWidth: 1 },
  image: { width: 96, height: 108, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  rarityTag: { position: "absolute", left: 0, right: 0, bottom: 0, paddingVertical: 2, alignItems: "center" },
  rarityText: { color: "#fff", fontSize: 8, fontFamily: "Inter_700Bold", letterSpacing: 0.6 },
  cardBody: { flex: 1, gap: 3 },
  name: { fontSize: 15, fontFamily: "Inter_700Bold" },
  meta: { fontSize: 12, fontFamily: "Inter_500Medium" },
  desc: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_400Regular" },
  cardFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: "auto", paddingTop: 6 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  price: { fontSize: 16, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  remove: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  removeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  continue: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 4 },
  continueText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  summary: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 8 },
  summaryTitle: { fontSize: 16, fontFamily: "Inter_700Bold", marginBottom: 2 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  line: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  lineLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  lineValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  strong: { fontSize: 15, fontFamily: "Inter_700Bold" },
  note: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },

  footer: { flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 12 },
  footLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.4 },
  footTotal: { flexDirection: "row", alignItems: "center", gap: 2 },
  footValue: { fontSize: 20, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },

  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  doneBody: { alignItems: "center", padding: 24, paddingTop: 48, gap: 10 },
  doneIcon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  doneTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  doneText: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 6 },
  receipt: { alignSelf: "stretch", borderRadius: 16, borderWidth: 1, padding: 14, gap: 8, marginBottom: 8 },
  receiptRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  receiptName: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  receiptPrice: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  stretch: { alignSelf: "stretch" },
});
