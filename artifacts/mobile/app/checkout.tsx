import { MaterialCommunityIcons } from "@expo/vector-icons";
import { haptic as buzz } from "@/lib/motion";
import { router, useLocalSearchParams } from "expo-router";
import React, { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { TourTarget } from "@/components/tour/TourTarget";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ItemIcon from "@/components/avatar/ItemIcon";
import AvatarDisplay from "@/components/AvatarDisplay";
import Burst from "@/components/fx/Burst";
import { useCatalog } from "@/hooks/useCatalog";
import { shareViewOrText } from "@/lib/shareCard";
import TokenBalance from "@/components/TokenBalance";
import EarnCreditsButton from "@/components/ads/EarnCreditsButton";
import { ActionChip, BackButton, Button, ConfirmDialog, ErrorBanner } from "@/components/ui";
import { GlassDomeSheen, LiquidGlass, ObsidianBackdrop } from "@/components/ui/LiquidGlass";
import { useApp } from "@/context/AppContext";
import { useCart, type CartOrigin } from "@/context/CartContext";
import { useCartItems, type CartExtra } from "@/hooks/useCartItems";
import { useColors } from "@/hooks/useColors";
import { useDeferredMount } from "@/hooks/useDeferredMount";
import { RARITY_COLORS, SLOT_LABELS, type CatalogItem } from "@/types/catalog";

type Phase = "review" | "paying" | "done";

const credits = (n: number) => n.toLocaleString();
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/**
 * The cart, as its own screen: every selected item as a product card (image,
 * name, details, price, Remove), an order summary, and one Checkout button.
 */
export default function CheckoutScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const ready = useDeferredMount();
  const cart = useCart();
  const { balance, inventory, purchaseItem, purchaseMove, purchaseBackground, saveLook, error, clearError, profile } = useApp();
  const { byId } = useCatalog();
  const showcaseRef = useRef<React.ComponentRef<typeof View>>(null);
  const { from } = useLocalSearchParams<{ from?: CartOrigin }>();
  const [phase, setPhase] = useState<Phase>("review");
  const [failed, setFailed] = useState<string[]>([]);
  const [bought, setBought] = useState<Array<{ id: string; name: string; price: number }>>([]);
  const [lookSaved, setLookSaved] = useState(true);

  const [clearAsk, setClearAsk] = useState(false);
  const owned = useMemo(() => new Set(inventory), [inventory]);
  const { items, extras, count, total } = useCartItems();
  const after = balance - total;
  const short = after < 0;

  const back = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)/avatar"));
  const continueShopping = () => {
    if ((from === "customize" || from === "shop") && router.canGoBack()) router.back();
    else router.replace({ pathname: "/customize", params: { category: "hat" } });
  };
  const continueLabel = from === "customize" ? "Keep customizing" : "Continue shopping";
  const clearCart = () => {
    setClearAsk(false);
    setFailed([]);
    cart.clear();
    buzz.warning();
  };

  const pay = async () => {
    if (!count || short) return;
    clearError();
    setFailed([]);
    setPhase("paying");
    const ok: CatalogItem[] = [];
    const okExtras: Array<{ id: string; name: string; price: number }> = [];
    const bad: string[] = [];
    for (const item of items) {
      if (await purchaseItem(item.id, item.price, true)) ok.push(item);
      else bad.push(item.id);
    }
    for (const x of extras) {
      const done = x.kind === "move" ? await purchaseMove(x.refId) : await purchaseBackground(x.refId);
      if (done) {
        okExtras.push({ id: x.cartId, name: x.name, price: x.price });
        cart.remove(x.cartId);
      } else bad.push(x.cartId);
    }
    setBought([...ok, ...okExtras]);
    if (bad.length) {
      setFailed(bad);
      setPhase("review");
      buzz.error();
      return;
    }
    const mine = new Set([...owned, ...ok.map((i) => i.id)]);
    const draft = cart.draft;
    let equipped: Record<string, string> | null = null;
    if (draft) {
      equipped = {};
      const current = (profile?.equipped ?? {}) as Record<string, string | undefined>;
      for (const [slot, id] of Object.entries(draft.equipped)) {
        if (id && mine.has(id)) equipped[slot] = id;
        else if (id && current[slot] && mine.has(current[slot]!)) equipped[slot] = current[slot]!;
      }
    }
    const saved = draft && equipped ? await saveLook(draft.avatar, equipped) : true;
    cart.checkedOut();
    buzz.success();
    setLookSaved(saved);
    setPhase("done");
    router.dismissTo("/(tabs)/avatar");
  };

  const top = (Platform.OS === "web" ? 12 : insets.top) + 6;

  return (
    <View style={[styles.fill, { backgroundColor: c.background }]}>
      <ObsidianBackdrop />
      {/* Liquid Glass Header */}
      <LiquidGlass variant="bar" contentStyle={[styles.header, { paddingTop: top }]}>
        <BackButton onPress={back} />
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>
            {phase === "done" ? "Order complete" : "Your cart"}
          </Text>
          {phase !== "done" ? (
            <Text style={[styles.subtitle, { color: c.mutedForeground }]}>
              {count} {count === 1 ? "item" : "items"} in your cart
            </Text>
          ) : null}
        </View>
        <TokenBalance tokens={balance} size="sm" earn glass />
      </LiquidGlass>

      <ErrorBanner message={error} onDismiss={clearError} />

      {!ready ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={c.mutedForeground} />
        </View>
      ) : phase === "done" ? (
        <ScrollView contentContainerStyle={[styles.doneBody, { paddingBottom: insets.bottom + 24 }]}>
          {lookSaved ? (
            <LiquidGlass variant="hero" radius={24} style={styles.showcase}>
              <View ref={showcaseRef} collapsable={false} style={[styles.showcaseInner, { backgroundColor: c.positiveSoft }]}>
                <AvatarDisplay avatar={profile?.avatar} equipped={profile?.equipped} catalog={byId} size="lg" interactive={false} focus="reaction" reaction={{ kind: "win", id: 1 }} />
                <Burst colors={[c.positive, c.accent, "#FFFFFF", "#FFC83D"]} trigger={1} count={40} originY={0.35} />
              </View>
            </LiquidGlass>
          ) : (
            <View style={[styles.doneIcon, { backgroundColor: c.positiveSoft }]}>
              <MaterialCommunityIcons name="check-bold" size={30} color={c.positive} />
            </View>
          )}
          <Text style={[styles.doneTitle, { color: c.foreground }]}>{lookSaved ? "You're wearing it" : "Purchase complete"}</Text>
          <Text style={[styles.doneText, { color: c.mutedForeground }]}>
            {lookSaved
              ? "Everything below is in your wardrobe and your look is saved."
              : "Everything below is in your wardrobe. Your look didn't save — tap Save in Customize."}
          </Text>
          <LiquidGlass variant="card" radius={20} style={styles.stretch} contentStyle={styles.receipt}>
            {bought.map((item) => (
              <View key={item.id} style={styles.receiptRow}>
                <Text style={[styles.receiptName, { color: c.foreground }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.receiptPrice, { color: c.mutedForeground }]}>{item.price === 0 ? "FREE" : credits(item.price)}</Text>
              </View>
            ))}
            <View style={[styles.divider, { backgroundColor: c.border }]} />
            <View style={styles.receiptRow}>
              <Text style={[styles.receiptName, styles.strong, { color: c.foreground }]}>Paid</Text>
              <Text style={[styles.receiptPrice, styles.strong, { color: c.foreground }]}>
                {credits(bought.reduce((s, i) => s + i.price, 0))}
              </Text>
            </View>
          </LiquidGlass>
          {lookSaved ? (
            <>
              <Button
                label="Show the League"
                icon="share-variant"
                onPress={() =>
                  void shareViewOrText({
                    viewRef: showcaseRef,
                    kind: "purchase",
                    message: `New fit just dropped: ${bought.map((i) => i.name).join(", ")} — on On The House`,
                  })
                }
                style={styles.stretch}
              />
              <Button label="Back to Home" icon="home-variant-outline" variant="secondary" onPress={() => router.dismissTo("/(tabs)")} style={styles.stretch} />
            </>
          ) : null}
          <Button label={continueLabel} variant="secondary" onPress={continueShopping} style={styles.stretch} />
        </ScrollView>
      ) : count === 0 && phase !== "paying" ? (
        <View style={styles.empty}>
          <LiquidGlass variant="hero" radius={28} contentStyle={styles.emptyCard}>
            <GlassDomeSheen id="cart_empty" glowColor={c.primary} intensity={0.22} />
            <View style={[styles.emptyIcon, { backgroundColor: c.alpha(c.primary, 0.14), borderColor: c.alpha(c.primary, 0.3) }]}>
              <MaterialCommunityIcons name="cart-outline" size={34} color={c.primary} />
            </View>
            <Text style={[styles.doneTitle, { color: c.foreground }]}>Your Cart Is Empty</Text>
            <Text style={[styles.doneText, { color: c.mutedForeground }]}>
              Add items in the Drip Shop, or try one on in Customize. They land here, ready to buy.
            </Text>
            <Button label={continueLabel} icon="tshirt-crew-outline" onPress={continueShopping} style={styles.stretch} />
          </LiquidGlass>
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
                  buzz.tick();
                  cart.remove(item.id);
                }}
              />
            ))}
            {extras.map((x) => (
              <ExtraItem
                key={x.cartId}
                item={x}
                failed={failed.includes(x.cartId)}
                disabled={phase === "paying"}
                onRemove={() => {
                  buzz.tick();
                  cart.remove(x.cartId);
                }}
              />
            ))}

            <View style={styles.cartActions}>
              <ActionChip label={continueLabel} icon="arrow-left" chevron={false} tone="money" onPress={continueShopping} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear cart"
                hitSlop={8}
                disabled={phase === "paying"}
                onPress={() => setClearAsk(true)}
                style={({ pressed }) => [{ opacity: phase === "paying" ? 0.4 : pressed ? 0.6 : 1 }]}
              >
                <LiquidGlass variant="pill" borderColor={c.alpha(c.negative, 0.5)} tintColor={c.alpha(c.negative, 0.1)} contentStyle={styles.remove}>
                  <MaterialCommunityIcons name="cart-remove" size={15} color={c.negative} />
                  <Text style={[styles.removeText, { color: c.negative }]}>Clear Cart</Text>
                </LiquidGlass>
              </Pressable>
            </View>

            {/* 2026 Bento Order Summary */}
            <LiquidGlass variant="hero" radius={22} contentStyle={styles.summary}>
              <GlassDomeSheen id="order_summary" glowColor={short ? c.negative : c.primary} intensity={0.24} />
              <Text style={[styles.kicker, { color: short ? c.negative : c.primary }]}>ORDER SUMMARY</Text>
              <Line label={`Subtotal (${count} ${count === 1 ? "item" : "items"})`} value={credits(total)} />
              <Line label="Fees" value="Free" />
              <View style={[styles.divider, { backgroundColor: c.border }]} />
              <Line label="Total" value={total === 0 ? "FREE" : `${credits(total)} credits`} strong />
              <Line label="Your Balance" value={credits(balance)} />
              <Line label="Balance After" value={credits(after)} tone={short ? c.negative : c.positive} />
              {short ? (
                <Text style={[styles.note, { color: c.negative }]}>
                  You're {credits(Math.abs(after))} credits short. Remove something or win a few bets first.
                </Text>
              ) : null}
              {short ? <EarnCreditsButton variant="row" style={{ marginTop: 8 }} /> : null}
              {bought.length && failed.length ? (
                <Text style={[styles.note, { color: c.mutedForeground }]}>
                  Bought {bought.map((b) => b.name).join(", ")}. The rest are still in your cart.
                </Text>
              ) : null}
            </LiquidGlass>
          </ScrollView>

          {/* Liquid Glass sticky checkout footer */}
          <LiquidGlass
            variant="bar"
            borderWidth={0}
            style={{ borderTopWidth: 1, borderTopColor: c.isDark ? c.alpha("#FFFFFF", 0.14) : c.border }}
            contentStyle={[styles.footer, { paddingBottom: insets.bottom + 12 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.footLabel, { color: c.mutedForeground }]}>TOTAL</Text>
              <View style={styles.footTotal}>
                <MaterialCommunityIcons name="lightning-bolt" size={18} color={c.primary} />
                <Text style={[styles.footValue, { color: c.foreground }]}>{total === 0 ? "FREE" : credits(total)}</Text>
              </View>
            </View>
            <TourTarget id="checkout.pay">
              <Button
                label={phase === "paying" ? "Paying…" : "Checkout"}
                icon="lock-outline"
                size="lg"
                onPress={pay}
                loading={phase === "paying"}
                disabled={short || phase === "paying"}
                style={{ minWidth: 170 }}
              />
            </TourTarget>
          </LiquidGlass>
        </>
      )}
      <ConfirmDialog
        visible={clearAsk}
        title="Clear your cart?"
        body={`Removes ${count === 1 ? "the 1 item" : `all ${count} items`} from your cart. Anything you were trying on in Customize comes off too.`}
        confirmLabel="Clear Cart"
        destructive
        onConfirm={clearCart}
        onCancel={() => setClearAsk(false)}
      />
    </View>
  );
}

/** A dance move or scene in the cart: same card as clothing, with its icon instead of a garment. */
function ExtraItem({ item, failed, disabled, onRemove }: { item: CartExtra; failed: boolean; disabled: boolean; onRemove: () => void }) {
  const c = useColors();
  const rarity = c.rarity(item.rarity as never);
  return (
    <LiquidGlass variant="card" radius={20} borderColor={failed ? c.negative : undefined} contentStyle={styles.card}>
      <View style={[styles.image, { backgroundColor: c.alpha(c.secondary, 0.7), borderColor: c.alpha(rarity, 0.5), alignItems: "center", justifyContent: "center" }]}>
        <MaterialCommunityIcons name={item.icon as never} size={40} color={rarity} />
        <View style={[styles.rarityTag, { backgroundColor: rarity }]}>
          <Text style={styles.rarityText}>{item.rarity.toUpperCase()}</Text>
        </View>
      </View>
      <View style={styles.cardBody}>
        <Text style={[styles.name, { color: c.foreground }]} numberOfLines={2}>
          {item.name}
        </Text>
        <Text style={[styles.meta, { color: c.mutedForeground }]} numberOfLines={1}>
          {item.kind === "move" ? "Dance move" : "Scene"} · {cap(item.rarity)} · Qty 1
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
            <Text style={[styles.price, { color: c.foreground }]}>{item.price === 0 ? "FREE" : credits(item.price)}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.name} from cart`}
            hitSlop={8}
            disabled={disabled}
            onPress={onRemove}
            style={({ pressed }) => [{ opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}
          >
            <LiquidGlass variant="pill" contentStyle={styles.remove}>
              <MaterialCommunityIcons name="trash-can-outline" size={15} color={c.negative} />
              <Text style={[styles.removeText, { color: c.negative }]}>Remove</Text>
            </LiquidGlass>
          </Pressable>
        </View>
      </View>
    </LiquidGlass>
  );
}

/** One product in the cart: picture, name, details, price and Remove. */
function CartItem({ item, failed, disabled, onRemove }: { item: CatalogItem; failed: boolean; disabled: boolean; onRemove: () => void }) {
  const c = useColors();
  const rarity = RARITY_COLORS[item.rarity];
  return (
    <LiquidGlass variant="card" radius={20} borderColor={failed ? c.negative : undefined} contentStyle={styles.card}>
      <View style={[styles.image, { backgroundColor: c.alpha(c.secondary, 0.7), borderColor: c.alpha(rarity, 0.5) }]}>
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
            <Text style={[styles.price, { color: c.foreground }]}>{item.price === 0 ? "FREE" : credits(item.price)}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.name} from cart`}
            hitSlop={8}
            disabled={disabled}
            onPress={onRemove}
            style={({ pressed }) => [{ opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}
          >
            <LiquidGlass variant="pill" contentStyle={styles.remove}>
              <MaterialCommunityIcons name="trash-can-outline" size={15} color={c.negative} />
              <Text style={[styles.removeText, { color: c.negative }]}>Remove</Text>
            </LiquidGlass>
          </Pressable>
        </View>
      </View>
    </LiquidGlass>
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
  showcase: { alignSelf: "stretch" },
  showcaseInner: { height: 280, borderRadius: 24, overflow: "hidden" },
  fill: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingBottom: 10 },
  title: { fontSize: 20, fontFamily: "Inter_900Black" },
  subtitle: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 1 },
  body: { padding: 16, gap: 12, paddingBottom: 24 },

  card: { flexDirection: "row", gap: 12, padding: 12 },
  image: { width: 96, height: 108, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  rarityTag: { position: "absolute", left: 0, right: 0, bottom: 0, paddingVertical: 2, alignItems: "center" },
  rarityText: { color: "#fff", fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.6 },
  cardBody: { flex: 1, gap: 3 },
  name: { fontSize: 15, fontFamily: "Inter_700Bold" },
  meta: { fontSize: 12, fontFamily: "Inter_500Medium" },
  desc: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_400Regular" },
  cardFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: "auto", paddingTop: 6 },
  priceRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  price: { fontSize: 16, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  remove: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6 },
  removeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },

  cartActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },

  summary: { padding: 16, gap: 8 },
  kicker: { fontSize: 11, fontFamily: "Inter_900Black", letterSpacing: 1.4, marginBottom: 2 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  line: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  lineLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  lineValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  strong: { fontSize: 15, fontFamily: "Inter_700Bold" },
  note: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },

  footer: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 12 },
  footLabel: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.2 },
  footTotal: { flexDirection: "row", alignItems: "center", gap: 2 },
  footValue: { fontSize: 20, fontFamily: "Inter_800ExtraBold", fontVariant: ["tabular-nums"] },

  empty: { flex: 1, justifyContent: "center", padding: 20 },
  emptyCard: { alignItems: "center", padding: 24, gap: 10 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, borderWidth: 1, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  doneBody: { alignItems: "center", padding: 24, paddingTop: 32, gap: 10 },
  doneIcon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  doneTitle: { fontSize: 22, fontFamily: "Inter_800ExtraBold" },
  doneText: { fontSize: 14, lineHeight: 20, fontFamily: "Inter_400Regular", textAlign: "center", marginBottom: 6 },
  receipt: { padding: 16, gap: 8, marginBottom: 8 },
  receiptRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  receiptName: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  receiptPrice: { fontSize: 14, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  stretch: { alignSelf: "stretch" },
});
