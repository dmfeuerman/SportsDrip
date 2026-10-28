import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AvatarDisplay from "@/components/AvatarDisplay";
import { Chips, Field, Stops, Swatches } from "@/components/avatar/EditorControls";
import ItemIcon from "@/components/avatar/ItemIcon";
import CartButton from "@/components/CartButton";
import { Button, ChoiceDialog, ConfirmDialog, ErrorBanner } from "@/components/ui";
import {
  EYE_COLORS,
  EYE_SHAPES,
  EYEBROWS,
  FACE_SHAPES,
  FACIAL_HAIR,
  HAIR_COLORS,
  HAIR_STYLES,
  MOUTH_SHAPES,
  normalizeAvatar,
  NOSE_SHAPES,
  SKIN_TONES,
} from "@/constants/avatarOptions";
import { useApp } from "@/context/AppContext";
import { useCart } from "@/context/CartContext";
import { useCatalog } from "@/hooks/useCatalog";
import { useColors } from "@/hooks/useColors";
import { applyEquip } from "@/lib/avatar3d/avatarRules";
import type { Focus } from "@/lib/avatar3d/spec";
import type { AvatarConfig, Equipped, Slot } from "@/types/avatar";
import { RARITY_COLORS, SLOT_LABELS, type CatalogItem } from "@/types/catalog";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];
type CatId = "body" | "face" | "hair" | Slot;

const CATS: Array<{ id: CatId; label: string; icon: IconName; focus: Focus }> = [
  { id: "body", label: "Body", icon: "human", focus: "full" },
  { id: "face", label: "Face", icon: "emoticon-outline", focus: "head" },
  { id: "hair", label: "Hair", icon: "content-cut", focus: "head" },
  { id: "hat", label: "Hats", icon: "hat-fedora", focus: "head" },
  { id: "eyewear", label: "Glasses", icon: "sunglasses", focus: "head" },
  { id: "top", label: "Tops", icon: "tshirt-crew", focus: "torso" },
  { id: "outerwear", label: "Jackets", icon: "coat-rack", focus: "torso" },
  { id: "bottom", label: "Bottoms", icon: "human-male", focus: "legs" },
  { id: "shoes", label: "Shoes", icon: "shoe-sneaker", focus: "feet" },
  { id: "accessory", label: "Extras", icon: "watch-variant", focus: "torso" },
];
const isSlot = (c: CatId): c is Slot => !["body", "face", "hair"].includes(c);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const canon = (e: Equipped): Equipped => Object.fromEntries(Object.entries(e).filter(([, v]) => !!v).sort(([a], [b]) => a.localeCompare(b)));

/**
 * The character creator. A live, rotatable character on top; categories and
 * a visual item grid below. Nothing is written until Save, which commits
 * appearance and outfit together; Cancel and Reset never touch the server.
 */
export default function CustomizeScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { height: winH, width: winW } = useWindowDimensions();
  const params = useLocalSearchParams<{ category?: string }>();
  const navigation = useNavigation();
  const { profile, inventory, balance, saveLook, error, clearError } = useApp();
  const { items, byId } = useCatalog();
  const cart = useCart();

  const saved = useMemo(
    () => ({ avatar: normalizeAvatar(profile?.avatar), equipped: canon(profile?.equipped ?? {}) }),
    [profile?.avatar, profile?.equipped]
  );
  const [avatar, setAvatar] = useState<AvatarConfig>(saved.avatar);
  const [equipped, setEquipped] = useState<Equipped>(saved.equipped);
  const [cat, setCat] = useState<CatId>(() => (CATS.some((x) => x.id === params.category) ? (params.category as CatId) : "body"));
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [cheer, setCheer] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const catScroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const pendingNav = useRef<unknown>(null);

  // Follow the server copy until the user starts editing (first load, or a
  // save from another device).
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current) return;
    setAvatar(saved.avatar);
    setEquipped(saved.equipped);
  }, [saved]);

  const dirty = !same(avatar, saved.avatar) || !same(canon(equipped), saved.equipped);
  const owned = useMemo(() => new Set(inventory), [inventory]);
  const unowned = Object.values(equipped).filter((id): id is string => !!id && !owned.has(id));
  const unownedKey = unowned.join(",");
  const cartTotal = unowned.reduce((s, id) => s + (byId.get(id)?.price ?? 0), 0);

  // ── cart ─────────────────────────────────────────────────────────────────
  // The cart is exactly the store items being tried on (one per slot), so the
  // badge always matches what's on the character. Checkout gets the whole
  // draft look, to save it once everything in it is bought.
  useEffect(() => {
    cart.setIds(unowned);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unownedKey]);
  useEffect(() => {
    cart.setDraft(unowned.length ? { avatar, equipped: canon(equipped) } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatar, equipped, unownedKey]);
  // Removed at checkout → take it off here too (back to what's saved for that slot, if owned).
  const cartKey = cart.ids.join(",");
  useEffect(() => {
    const gone = unowned.filter((id) => !cart.has(id));
    if (!gone.length) return;
    setEquipped((e) => {
      const next = { ...e };
      for (const id of gone) {
        const slot = byId.get(id)?.slot;
        if (!slot || next[slot] !== id) continue;
        const back = saved.equipped[slot];
        next[slot] = back && owned.has(back) ? back : undefined;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartKey]);

  // ── edits ────────────────────────────────────────────────────────────────
  const edit = (patch: Partial<AvatarConfig>) => {
    touched.current = true;
    setAvatar((a) => ({ ...a, ...patch }));
  };

  const [toast, setToast] = useState<string | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const showToast = useCallback(
    (msg: string) => {
      setToast(msg);
      toastOpacity.stopAnimation();
      Animated.sequence([
        Animated.timing(toastOpacity, { toValue: 1, duration: 160, useNativeDriver: Platform.OS !== "web" }),
        Animated.delay(2600),
        Animated.timing(toastOpacity, { toValue: 0, duration: 260, useNativeDriver: Platform.OS !== "web" }),
      ]).start();
    },
    [toastOpacity]
  );

  const wear = (slot: Slot, itemId: string | null) => {
    touched.current = true;
    Haptics.selectionAsync().catch(() => {});
    const r = applyEquip(equipped, slot, itemId, (id) => byId.get(id));
    setEquipped(r.equipped);
    if (r.removed.length && itemId) {
      const name = byId.get(itemId)?.name ?? "That";
      showToast(`Took off ${r.removed.map((s) => SLOT_LABELS[s].toLowerCase()).join(" and ")} — ${name} can't be worn with ${r.removed.length > 1 ? "them" : "it"}.`);
    }
  };

  const reset = () => {
    Haptics.selectionAsync().catch(() => {});
    setAvatar(saved.avatar);
    setEquipped(saved.equipped);
    touched.current = false;
  };

  const save = async () => {
    if (!dirty || unowned.length) return;
    setSaving(true);
    const ok = await saveLook(avatar, canon(equipped));
    setSaving(false);
    if (!ok) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    touched.current = false;
    setLeaving(true);
    allowLeave();
    setCheer((n) => n + 1);
    setTimeout(() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/avatar")), 1300);
  };

  // ── leaving with unsaved changes ─────────────────────────────────────────
  const allowLeave = usePreventRemove(dirty && !leaving, ({ data }) => {
    pendingNav.current = data.action;
    setConfirm(true);
  });

  const close = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)/avatar"));
  const checkout = () => {
    pendingNav.current = null;
    setConfirm(false);
    router.push("/checkout");
  };
  const discard = () => {
    setConfirm(false);
    cart.clear();
    setLeaving(true);
    allowLeave();
    if (pendingNav.current) navigation.dispatch(pendingNav.current as never);
    else close();
  };

  const focus = CATS.find((x) => x.id === cat)!.focus;
  const stageH = Math.max(280, Math.min(winH * 0.46, 520));
  const cols = winW >= 700 ? 5 : winW >= 420 ? 4 : 3;

  if (!profile) {
    return (
      <View style={[styles.fill, styles.centre, { backgroundColor: c.background }]}>
        <ActivityIndicator color={c.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: c.background }]}>
      {/* header */}
      <View style={[styles.header, { paddingTop: (Platform.OS === "web" ? 12 : insets.top) + 6, borderBottomColor: c.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={() => (dirty ? setConfirm(true) : close())}
          hitSlop={10}
          style={[styles.round, { backgroundColor: c.secondary, borderColor: c.border }]}
        >
          <MaterialCommunityIcons name="close" size={18} color={c.foreground} />
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>
          Customize
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reset unsaved changes"
          disabled={!dirty}
          onPress={reset}
          hitSlop={10}
          style={[styles.round, { backgroundColor: c.secondary, borderColor: c.border, opacity: dirty ? 1 : 0.4 }]}
        >
          <MaterialCommunityIcons name="undo-variant" size={18} color={c.foreground} />
        </Pressable>
        <Button
          label={saving ? "Saving" : dirty ? "Save" : "Saved"}
          size="sm"
          onPress={save}
          loading={saving}
          disabled={!dirty || unowned.length > 0 || saving}
          accessibilityHint={unowned.length ? "Check out the items in your cart first" : undefined}
        />
        <CartButton />
      </View>

      {/* stage */}
      <View style={[styles.stage, { height: stageH, backgroundColor: c.card, borderBottomColor: c.border }]}>
        <View style={[styles.floor, { backgroundColor: c.secondary }]} />
        <AvatarDisplay avatar={avatar} equipped={equipped} catalog={byId} size="lg" focus={focus} cheerSignal={cheer} />
        {toast ? (
          <Animated.View
            pointerEvents="none"
            style={[styles.toast, { opacity: toastOpacity, backgroundColor: c.elevated, borderColor: c.border }]}
          >
            <MaterialCommunityIcons name="information-outline" size={15} color={c.accent} />
            <Text style={[styles.toastText, { color: c.foreground }]}>{toast}</Text>
          </Animated.View>
        ) : null}
        <Text style={[styles.hint, { color: c.subtleForeground }]} pointerEvents="none">
          Drag to turn
        </Text>
      </View>

      {/* categories */}
      <ScrollView
        ref={catScroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.catBar, { borderBottomColor: c.border }]}
        contentContainerStyle={styles.catRow}
        accessibilityRole="tablist"
      >
        {CATS.map((x) => {
          const on = x.id === cat;
          const worn = isSlot(x.id) && !!equipped[x.id];
          return (
            <Pressable
              key={x.id}
              onLayout={(e) => {
                // Deep-linked into a category off to the right: bring it into view.
                if (x.id === cat && e.nativeEvent.layout.x > winW * 0.6) {
                  catScroll.current?.scrollTo({ x: e.nativeEvent.layout.x - 16, animated: false });
                }
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={x.label}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                setCat(x.id);
              }}
              style={[styles.cat, { backgroundColor: on ? c.primarySoft : "transparent", borderColor: on ? c.primary : "transparent" }]}
            >
              <MaterialCommunityIcons name={x.icon} size={20} color={on ? c.primary : c.mutedForeground} />
              <Text style={[styles.catText, { color: on ? c.foreground : c.mutedForeground }]}>{x.label}</Text>
              {worn ? <View style={[styles.wornDot, { backgroundColor: c.positive }]} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <ErrorBanner message={error} onDismiss={clearError} />

      {/* panel */}
      <ScrollView style={styles.fill} contentContainerStyle={[styles.panel, { paddingBottom: insets.bottom + (unowned.length ? 96 : 28) }]} showsVerticalScrollIndicator={false}>
        {cat === "body" && (
          <>
            <Swatches label="Skin tone" options={SKIN_TONES} value={avatar.skinTone} onChange={(skinTone) => edit({ skinTone })} />
            <Stops label="Height" value={avatar.height} onChange={(height) => edit({ height })} ends={["Shorter", "Taller"]} />
            <Stops label="Build" value={avatar.bodyType} onChange={(bodyType) => edit({ bodyType })} ends={["Slim", "Broad"]} />
          </>
        )}

        {cat === "face" && (
          <>
            <Chips label="Face shape" options={FACE_SHAPES} value={avatar.faceShape ?? "oval"} onChange={(faceShape) => edit({ faceShape })} />
            <Chips label="Eye shape" options={EYE_SHAPES} value={avatar.eyeShape ?? "round"} onChange={(eyeShape) => edit({ eyeShape })} />
            <Swatches label="Eyes" options={EYE_COLORS} value={avatar.eyeColor ?? EYE_COLORS[0]!} onChange={(eyeColor) => edit({ eyeColor })} />
            <Chips label="Brows" options={EYEBROWS} value={avatar.eyebrows ?? "soft"} onChange={(eyebrows) => edit({ eyebrows })} />
            <Chips label="Nose" options={NOSE_SHAPES} value={avatar.noseShape ?? "button"} onChange={(noseShape) => edit({ noseShape })} />
            <Chips label="Mouth" options={MOUTH_SHAPES} value={avatar.mouthShape ?? "neutral"} onChange={(mouthShape) => edit({ mouthShape })} />
            <Chips label="Facial hair" options={FACIAL_HAIR} value={avatar.facialHair ?? "none"} onChange={(facialHair) => edit({ facialHair })} />
          </>
        )}

        {cat === "hair" && (
          <>
            <Chips label="Style" options={HAIR_STYLES} value={avatar.hairStyle} onChange={(hairStyle) => edit({ hairStyle })} />
            <Swatches label="Colour" options={HAIR_COLORS} value={avatar.hairColor} onChange={(hairColor) => edit({ hairColor })} />
            {equipped.hat ? (
              <Text style={[styles.note, { color: c.mutedForeground }]}>Your hat trims the hair to fit. Take it off to see the full style.</Text>
            ) : null}
          </>
        )}

        {isSlot(cat) && (
          <SlotGrid
            slot={cat}
            items={items}
            byId={byId}
            equipped={equipped}
            owned={owned}
            cols={cols}
            onWear={wear}
          />
        )}

      </ScrollView>

      {unowned.length > 0 ? (
        <View style={[styles.cartBar, { backgroundColor: c.elevated, borderColor: c.alpha(c.primary, 0.5), bottom: insets.bottom + 12 }]}>
          <MaterialCommunityIcons name="cart" size={18} color={c.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.buyName, { color: c.foreground }]} numberOfLines={1}>
              {unowned.length} {unowned.length === 1 ? "item" : "items"} in your cart · {cartTotal.toLocaleString()}
            </Text>
            <Text style={[styles.buySub, { color: balance < cartTotal ? c.negative : c.mutedForeground }]} numberOfLines={1}>
              {balance < cartTotal ? `You have ${balance.toLocaleString()} credits` : "Buy them to save this look"}
            </Text>
          </View>
          <Button label="Checkout" size="sm" onPress={() => router.push("/checkout")} />
        </View>
      ) : null}

      <ChoiceDialog
        visible={confirm && unowned.length > 0}
        title={`${unowned.length} ${unowned.length === 1 ? "item" : "items"} in your cart`}
        body={`You're trying on ${unowned.map((id) => byId.get(id)?.name ?? "an item").join(", ")}. Check out to keep ${unowned.length === 1 ? "it" : "them"}, or discard your changes.`}
        actions={[
          { label: `Checkout · ${cartTotal.toLocaleString()}`, icon: "cart", onPress: checkout },
          { label: "Discard", variant: "destructive", onPress: discard },
        ]}
        onCancel={() => {
          pendingNav.current = null;
          setConfirm(false);
        }}
      />

      <ConfirmDialog
        visible={confirm && unowned.length === 0}
        title="Discard changes?"
        body="Your character goes back to how it was last saved."
        confirmLabel="Discard"
        destructive
        onConfirm={discard}
        onCancel={() => {
          pendingNav.current = null;
          setConfirm(false);
        }}
      />
    </View>
  );
}

function SlotGrid({
  slot,
  items,
  byId,
  equipped,
  owned,
  cols,
  onWear,
}: {
  slot: Slot;
  items: CatalogItem[];
  byId: Map<string, CatalogItem>;
  equipped: Equipped;
  owned: Set<string>;
  cols: number;
  onWear: (slot: Slot, id: string | null) => void;
}) {
  const c = useColors();
  // Owned first, then the store by price; anything owned but retired from the
  // store still shows (it's in your wardrobe).
  const list = useMemo(() => {
    const ownedHere = [...owned].map((id) => byId.get(id)).filter((i): i is CatalogItem => !!i && i.slot === slot);
    const store = items.filter((i) => i.slot === slot && !owned.has(i.id));
    return [...ownedHere.sort((a, b) => a.price - b.price), ...store];
  }, [items, byId, owned, slot]);
  const current = equipped[slot] ?? null;
  const w = `${100 / cols}%` as const;

  return (
    <Field label={`${SLOT_LABELS[slot]} · ${list.filter((i) => owned.has(i.id)).length} owned`}>
      <View style={styles.grid}>
        <View style={{ width: w, padding: 4 }}>
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: current === null }}
            accessibilityLabel={`No ${SLOT_LABELS[slot].toLowerCase()}`}
            onPress={() => onWear(slot, null)}
            style={[styles.tile, { backgroundColor: c.card, borderColor: current === null ? c.primary : c.border, borderWidth: current === null ? 2 : 1 }]}
          >
            <View style={styles.tileArt}>
              <MaterialCommunityIcons name="cancel" size={26} color={c.subtleForeground} />
            </View>
            <Text style={[styles.tileName, { color: c.mutedForeground }]} numberOfLines={1}>
              None
            </Text>
          </Pressable>
        </View>
        {list.map((item) => {
          const on = current === item.id;
          const mine = owned.has(item.id);
          return (
            <View key={item.id} style={{ width: w, padding: 4 }}>
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${item.name}${mine ? "" : `, not owned, ${item.price} credits`}`}
                onPress={() => onWear(slot, on ? null : item.id)}
                style={({ pressed }) => [
                  styles.tile,
                  {
                    backgroundColor: c.card,
                    borderColor: on ? c.primary : c.border,
                    borderWidth: on ? 2 : 1,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <View style={[styles.rarity, { backgroundColor: RARITY_COLORS[item.rarity] }]} />
                <View style={[styles.tileArt, !mine && { opacity: 0.75 }]}>
                  <ItemIcon item={item} size={64} />
                </View>
                <Text style={[styles.tileName, { color: c.foreground }]} numberOfLines={1}>
                  {item.name}
                </Text>
                {mine ? (
                  on ? (
                    <View style={[styles.badge, { backgroundColor: c.primary }]}>
                      <MaterialCommunityIcons name="check" size={12} color={c.primaryForeground} />
                    </View>
                  ) : null
                ) : (
                  <View style={[styles.price, { backgroundColor: c.secondary }]}>
                    <MaterialCommunityIcons name="lock" size={10} color={c.mutedForeground} />
                    <Text style={[styles.priceText, { color: c.mutedForeground }]}>{item.price.toLocaleString()}</Text>
                  </View>
                )}
              </Pressable>
            </View>
          );
        })}
      </View>
    </Field>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centre: { alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { flex: 1, fontSize: 18, fontFamily: "Inter_700Bold" },
  round: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  stage: { borderBottomWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  floor: { position: "absolute", left: 0, right: 0, bottom: 0, height: "22%" },
  toast: {
    position: "absolute",
    top: 10,
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
  },
  toastText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  hint: { position: "absolute", left: 14, bottom: 12, fontSize: 11, fontFamily: "Inter_500Medium" },
  // Never squeezed: when the panel below fills up, it scrolls; the category row keeps its height.
  catBar: { flexGrow: 0, flexShrink: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  catRow: { paddingHorizontal: 10, paddingVertical: 8, gap: 4 },
  cat: { alignItems: "center", gap: 3, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 12, borderWidth: 1, minWidth: 62 },
  catText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  wornDot: { position: "absolute", top: 6, right: 12, width: 6, height: 6, borderRadius: 3 },
  panel: { padding: 16, gap: 18 },
  note: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -4 },
  tile: { borderRadius: 14, padding: 8, alignItems: "center", gap: 4, overflow: "hidden" },
  tileArt: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
  tileName: { fontSize: 11, fontFamily: "Inter_600SemiBold", alignSelf: "stretch", textAlign: "center" },
  rarity: { position: "absolute", top: 0, left: 0, right: 0, height: 3 },
  badge: { position: "absolute", top: 7, right: 7, width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  price: { position: "absolute", top: 7, right: 6, flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  priceText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  cartBar: {
    position: "absolute",
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 14,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  buyName: { fontSize: 14, fontFamily: "Inter_700Bold" },
  buySub: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
