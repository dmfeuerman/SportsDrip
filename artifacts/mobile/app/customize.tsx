import { MaterialCommunityIcons } from "@expo/vector-icons";
import { haptic as buzz } from "@/lib/motion";
import { router, useLocalSearchParams, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AvatarDisplay from "@/components/AvatarDisplay";
import MoveCard from "@/components/MoveCard";
import BackgroundCard from "@/components/BackgroundCard";
import StarterKitCard from "@/components/StarterKitCard";
import { TourTarget } from "@/components/tour/TourTarget";
import { MAX_LOADOUT } from "@/constants/moves";
import { useMoves, type StoreMove } from "@/hooks/useMoves";
import { useBackgrounds, type StoreBackground } from "@/hooks/useBackgrounds";
import { STARTER_ITEMS } from "@/lib/tour/tours";
import { Chips, Field, Stops, Swatches } from "@/components/avatar/EditorControls";
import ItemIcon from "@/components/avatar/ItemIcon";
import CartButton from "@/components/CartButton";
import CartExitDialog from "@/components/CartExitDialog";
import { Button, ChoiceDialog, ErrorBanner } from "@/components/ui";
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
import * as api from "@/lib/api";
import { useCart } from "@/context/CartContext";
import { useCartItems } from "@/hooks/useCartItems";
import { storeOrder, useCatalog } from "@/hooks/useCatalog";
import { useColors } from "@/hooks/useColors";
import { applyEquip } from "@/lib/avatar3d/avatarRules";
import type { Focus } from "@/lib/avatar3d/spec";
import type { AvatarConfig, Equipped, Slot } from "@/types/avatar";
import { RARITY_COLORS, SLOT_LABELS, type CatalogItem } from "@/types/catalog";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];
type CatId = "body" | "face" | "hair" | Slot | "moves" | "scenes";

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
  { id: "moves", label: "Moves", icon: "human-handsup", focus: "full" },
  { id: "scenes", label: "Scenes", icon: "image-filter-hdr", focus: "full" },
];
const isSlot = (c: CatId): c is Slot => !["body", "face", "hair", "moves", "scenes"].includes(c);
/** Old /shop?tab= values map onto these. */
const TAB_CAT: Record<string, CatId> = { moves: "moves", backgrounds: "scenes" };
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
  const params = useLocalSearchParams<{ category?: string; tab?: string }>();
  const navigation = useNavigation();
  const {
    profile,
    inventory,
    balance,
    saveLook,
    error,
    clearError,
    ownedMoves,
    loadout,
    purchaseMove,
    setLoadout,
    progress,
    ownedBackgrounds,
    background,
    purchaseBackground,
    setBackground,
  } = useApp();
  const { moves } = useMoves();
  const { backgrounds } = useBackgrounds();
  const { items, byId } = useCatalog();
  const cart = useCart();

  const saved = useMemo(
    () => ({ avatar: normalizeAvatar(profile?.avatar), equipped: canon(profile?.equipped ?? {}) }),
    [profile?.avatar, profile?.equipped]
  );
  // Back with a look still in the cart: pick up where you left off (minus anything removed at checkout since).
  const [resume] = useState(() => {
    const d = cart.draft;
    if (!d) return null;
    const own = new Set(inventory);
    const equipped = Object.fromEntries(Object.entries(d.equipped).filter(([, id]) => !!id && (own.has(id) || cart.has(id)))) as Equipped;
    const fresh = !!d.from && same(d.from, saved.avatar);
    return { avatar: fresh ? d.avatar : saved.avatar, equipped };
  });
  const [avatar, setAvatar] = useState<AvatarConfig>(resume?.avatar ?? saved.avatar);
  const [equipped, setEquipped] = useState<Equipped>(resume?.equipped ?? saved.equipped);
  const [cat, setCat] = useState<CatId>(() => {
    const want = params.category ?? (params.tab ? TAB_CAT[params.tab] : undefined);
    return CATS.some((x) => x.id === want) ? (want as CatId) : "hat";
  });
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [cheer, setCheer] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const catScroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const pendingNav = useRef<unknown>(null);

  // Follow the server copy until the user starts editing (first load, or a
  // save from another device).
  const touched = useRef(!!resume);
  useEffect(() => {
    if (touched.current) return;
    setAvatar(saved.avatar);
    setEquipped(saved.equipped);
  }, [saved]);

  const dirty = !same(avatar, saved.avatar) || !same(canon(equipped), saved.equipped);
  const owned = useMemo(() => new Set(inventory), [inventory]);
  const unowned = Object.values(equipped).filter((id): id is string => !!id && !owned.has(id));
  const unownedKey = unowned.join(",");
  const cartView = useCartItems();

  // ── cart ─────────────────────────────────────────────────────────────────
  // Trying on a store item puts it in the cart. Swapping it for another in the
  // same session swaps it in the cart too; everything else (shop picks, earlier
  // sessions) stays until it's bought or cleared at checkout.
  const wasInCart = useRef(new Set<string>(cart.ids));
  const triedOn = useRef(new Set<string>(resume ? Object.values(resume.equipped).filter((id): id is string => !!id && !owned.has(id)) : []));
  useEffect(() => {
    const now = new Set(unowned);
    for (const id of unowned) {
      if (!cart.has(id)) {
        cart.add(id);
        triedOn.current.add(id);
      }
    }
    for (const id of [...triedOn.current]) {
      if (!now.has(id)) {
        cart.remove(id);
        triedOn.current.delete(id);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unownedKey]);
  // Checkout gets the whole draft look, to save it once everything in it is bought.
  useEffect(() => {
    if (!touched.current) return;
    cart.setDraft(unowned.length ? { avatar, equipped: canon(equipped), from: saved.avatar } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatar, equipped, unownedKey]);
  // Removed (or cleared) at checkout → take it off here too (back to what's saved for that slot, if owned).
  const cartKey = cart.ids.join(",");
  useEffect(() => {
    for (const id of cart.ids) wasInCart.current.add(id);
    const gone = unowned.filter((id) => !cart.has(id) && wasInCart.current.has(id));
    if (!gone.length) return;
    for (const id of gone) {
      wasInCart.current.delete(id);
      triedOn.current.delete(id);
    }
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
    buzz.tick();
    const r = applyEquip(equipped, slot, itemId, (id) => byId.get(id));
    setEquipped(r.equipped);
    if (r.removed.length && itemId) {
      const name = byId.get(itemId)?.name ?? "That";
      showToast(`Took off ${r.removed.map((s) => SLOT_LABELS[s].toLowerCase()).join(" and ")} — ${name} can't be worn with ${r.removed.length > 1 ? "them" : "it"}.`);
    }
  };

  const reset = () => {
    buzz.tick();
    setAvatar(saved.avatar);
    setEquipped(saved.equipped);
    touched.current = false;
  };

  // Save with unbought items on: ask whether to buy them (saving everything
  // after checkout) or save just the character and the owned pieces.
  const [saveAsk, setSaveAsk] = useState(false);
  const ownedOnly = (): Equipped => {
    const out: Equipped = {};
    for (const [slot, id] of Object.entries(equipped) as [keyof Equipped, string | undefined][]) {
      if (!id) continue;
      if (owned.has(id)) out[slot] = id;
      else {
        const back = saved.equipped[slot];
        if (back && owned.has(back)) out[slot] = back;
      }
    }
    return canon(out);
  };
  const buyAndSave = () => {
    setSaveAsk(false);
    // Checkout saves this whole look (character changes included) once the items are bought.
    cart.setDraft({ avatar, equipped: canon(equipped), from: saved.avatar });
    checkout();
  };
  const saveCharacterOnly = () => {
    setSaveAsk(false);
    void save(ownedOnly());
  };

  const save = async (look?: Equipped) => {
    if (!dirty) return;
    if (!look && unowned.length) {
      buzz.tick();
      setSaveAsk(true);
      return;
    }
    setSaving(true);
    const ok = await saveLook(avatar, look ?? canon(equipped));
    setSaving(false);
    if (!ok) return;
    api.reportChallengeAction("avatarSaved");
    buzz.success();
    touched.current = false;
    setLeaving(true);
    allowLeave();
    setCheer((n) => n + 1);
    setTimeout(() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/avatar")), 1300);
  };

  // ── leaving with unsaved changes ─────────────────────────────────────────
  const allowLeave = usePreventRemove((dirty || cartView.count > 0) && !leaving, ({ data }) => {
    // Checkout just bought everything and is navigating away: don't stop it.
    if (cart.justCheckedOut()) {
      allowLeave();
      navigation.dispatch(data.action as never);
      return;
    }
    if (!dirty && !cart.peekCount()) {
      allowLeave();
      navigation.dispatch(data.action as never);
      return;
    }
    pendingNav.current = data.action;
    setConfirm(true);
  });

  const close = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)/avatar"));
  const checkout = () => {
    pendingNav.current = null;
    setConfirm(false);
    router.push({ pathname: "/checkout", params: { from: "customize" } });
  };
  /** Leave with the cart (and the look it was tried on for) kept for later. */
  const leaveForNow = () => {
    setConfirm(false);
    setLeaving(true);
    allowLeave();
    if (pendingNav.current) navigation.dispatch(pendingNav.current as never);
    else close();
  };
  /**
   * Leaving with character changes: save them first (the character and the
   * pieces already owned; anything unbought stays in the cart), then leave.
   * A failed save keeps the player here with the error showing.
   */
  const saveAndLeave = async () => {
    setConfirm(false);
    setSaving(true);
    const ok = await saveLook(avatar, ownedOnly());
    setSaving(false);
    if (!ok) {
      pendingNav.current = null;
      return;
    }
    api.reportChallengeAction("avatarSaved");
    buzz.success();
    touched.current = false;
    setLeaving(true);
    allowLeave();
    if (pendingNav.current) navigation.dispatch(pendingNav.current as never);
    else close();
  };
  const discard = () => {
    setConfirm(false);
    cart.setDraft(null);
    setLeaving(true);
    allowLeave();
    if (pendingNav.current) navigation.dispatch(pendingNav.current as never);
    else close();
  };

  // ── moves & scenes ───────────────────────────────────────────────────────
  const [busyId, setBusyId] = useState<string | null>(null);
  const [play, setPlay] = useState<{ id: string; n: number } | null>(null);
  const [moveNote, setMoveNote] = useState<string | null>(null);
  const moveList = useMemo(
    () => moves.filter((m) => m.forSale || ownedMoves.has(m.id)).sort((a, b) => a.price - b.price),
    [moves, ownedMoves]
  );
  const backgroundList = useMemo(
    () => backgrounds.filter((b) => b.forSale || b.levelReward || ownedBackgrounds.has(b.id)).sort((a, b) => a.price - b.price),
    [backgrounds, ownedBackgrounds]
  );
  const previewMove = (m: StoreMove) => setPlay((p) => ({ id: m.id, n: (p?.n ?? 0) + 1 }));
  const buyMove = async (m: StoreMove) => {
    setBusyId(m.id);
    const ok = await purchaseMove(m.id);
    setBusyId(null);
    if (ok) buzz.success();
  };
  const toggleMove = async (m: StoreMove) => {
    buzz.tick();
    if (loadout.includes(m.id)) {
      if (loadout.length === 1) return setMoveNote("Keep at least one move on your dance button.");
      setMoveNote(null);
      setBusyId(m.id);
      await setLoadout(loadout.filter((x) => x !== m.id));
    } else {
      if (loadout.length >= MAX_LOADOUT) return setMoveNote(`Your dance button holds ${MAX_LOADOUT} moves — remove one first.`);
      setMoveNote(null);
      setBusyId(m.id);
      await setLoadout([...loadout, m.id]);
    }
    setBusyId(null);
  };
  const buyBackground = async (b: StoreBackground) => {
    setBusyId(b.id);
    const ok = await purchaseBackground(b.id);
    setBusyId(null);
    if (ok) buzz.success();
  };
  const applyBackground = async (b: StoreBackground) => {
    buzz.light();
    setBusyId(b.id);
    await setBackground(b.id);
    setBusyId(null);
  };

  // Free starter kit: wearing it puts it in the cart (see the cart effect above).
  const starterMissing = useMemo(
    () => STARTER_ITEMS.filter((id) => !owned.has(id)).map((id) => byId.get(id)).filter((i): i is NonNullable<typeof i> => !!i),
    [owned, byId]
  );
  const addStarterKit = () => {
    buzz.medium();
    touched.current = true;
    setEquipped((e) => ({ ...e, ...Object.fromEntries(starterMissing.map((i) => [i.slot, i.id])) }));
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
          onPress={close}
          hitSlop={10}
          style={[styles.round, { backgroundColor: c.secondary, borderColor: c.border }]}
        >
          <MaterialCommunityIcons name="close" size={18} color={c.foreground} />
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>
          Drip Shop
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
          onPress={() => void save()}
          loading={saving}
          disabled={!dirty || saving}
          accessibilityHint={unowned.length ? "Asks whether to buy the new items or save just your character" : undefined}
        />
        <TourTarget id="shop.cart"><CartButton from="customize" /></TourTarget>
      </View>

      {/* stage */}
      <View style={[styles.stage, { height: stageH, backgroundColor: c.card, borderBottomColor: c.border }]}>
        <View style={[styles.floor, { backgroundColor: c.secondary }]} />
        <AvatarDisplay avatar={avatar} equipped={equipped} catalog={byId} size="lg" focus={focus} cheerSignal={cheer} move={play} loadingSpinner />
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
      <TourTarget id="shop.filters">
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
                buzz.tick();
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
      </TourTarget>

      <ErrorBanner message={error} onDismiss={clearError} />

      {/* panel */}
      <TourTarget id="shop.list" style={styles.fill}>
      <ScrollView style={styles.fill} contentContainerStyle={[styles.panel, { paddingBottom: insets.bottom + (unowned.length ? 96 : 28) }]} showsVerticalScrollIndicator={false}>
        {cat === "body" && (
          <>
            <Swatches label="Skin Tone" options={SKIN_TONES} value={avatar.skinTone} onChange={(skinTone) => edit({ skinTone })} />
            <Stops label="Height" value={avatar.height} onChange={(height) => edit({ height })} ends={["Shorter", "Taller"]} />
            <Stops label="Build" value={avatar.bodyType} onChange={(bodyType) => edit({ bodyType })} ends={["Slim", "Broad"]} />
          </>
        )}

        {cat === "face" && (
          <>
            <Chips label="Face Shape" options={FACE_SHAPES} value={avatar.faceShape ?? "oval"} onChange={(faceShape) => edit({ faceShape })} />
            <Chips label="Eye Shape" options={EYE_SHAPES} value={avatar.eyeShape ?? "round"} onChange={(eyeShape) => edit({ eyeShape })} />
            <Swatches label="Eyes" options={EYE_COLORS} value={avatar.eyeColor ?? EYE_COLORS[0]!} onChange={(eyeColor) => edit({ eyeColor })} />
            <Chips label="Brows" options={EYEBROWS} value={avatar.eyebrows ?? "soft"} onChange={(eyebrows) => edit({ eyebrows })} />
            <Chips label="Nose" options={NOSE_SHAPES} value={avatar.noseShape ?? "button"} onChange={(noseShape) => edit({ noseShape })} />
            <Chips label="Mouth" options={MOUTH_SHAPES} value={avatar.mouthShape ?? "neutral"} onChange={(mouthShape) => edit({ mouthShape })} />
            <Chips label="Facial Hair" options={FACIAL_HAIR} value={avatar.facialHair ?? "none"} onChange={(facialHair) => edit({ facialHair })} />
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

        {isSlot(cat) && starterMissing.length ? (
          <TourTarget id="shop.starterKit">
            <StarterKitCard items={starterMissing} inCart={starterMissing.every((i) => cart.has(i.id))} onAdd={addStarterKit} />
          </TourTarget>
        ) : null}

        {cat === "moves" && (
          <>
            <Text style={[styles.note, { color: moveNote ? c.warning : c.mutedForeground }]}>
              {moveNote ?? `${ownedMoves.size} moves owned · ${loadout.length} of ${MAX_LOADOUT} on your dance button`}
            </Text>
            {moveList.map((m) => (
              <MoveCard
                key={m.id}
                move={m}
                owned={ownedMoves.has(m.id)}
                equipped={loadout.includes(m.id)}
                canAfford={balance >= m.price}
                busy={busyId === m.id}
                onBuy={() => void buyMove(m)}
                onToggleEquip={() => void toggleMove(m)}
                onPreview={() => previewMove(m)}
              />
            ))}
          </>
        )}

        {cat === "scenes" && (
          <>
            <Text style={[styles.note, { color: c.mutedForeground }]}>
              {ownedBackgrounds.size} scenes owned · Level {progress.level}
            </Text>
            <View style={styles.sceneGrid}>
              {backgroundList.map((b) => (
                <View key={b.id} style={styles.sceneCell}>
                  <BackgroundCard
                    bg={b}
                    owned={ownedBackgrounds.has(b.id)}
                    inUse={background === b.id}
                    level={progress.level}
                    canAfford={balance >= b.price}
                    busy={busyId === b.id}
                    onBuy={() => void buyBackground(b)}
                    onUse={() => void applyBackground(b)}
                    onPreview={() => (ownedBackgrounds.has(b.id) ? void applyBackground(b) : undefined)}
                  />
                </View>
              ))}
            </View>
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
      </TourTarget>

      {cartView.count > 0 ? (
        <View style={[styles.cartBar, { backgroundColor: c.elevated, borderColor: c.alpha(c.primary, 0.5), bottom: insets.bottom + 12 }]}>
          <MaterialCommunityIcons name="cart" size={18} color={c.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.buyName, { color: c.foreground }]} numberOfLines={1}>
              {cartView.count} {cartView.count === 1 ? "item" : "items"} in your cart · {cartView.total.toLocaleString()}
            </Text>
            <Text style={[styles.buySub, { color: balance < cartView.total ? c.negative : c.mutedForeground }]} numberOfLines={1}>
              {balance < cartView.total ? `You have ${balance.toLocaleString()} credits` : unowned.length ? "Buy them to save this look" : "Ready when you are"}
            </Text>
          </View>
          <Button label="Checkout" size="sm" onPress={checkout} />
        </View>
      ) : null}

      <CartExitDialog
        visible={confirm && cartView.count > 0}
        onCheckout={checkout}
        onLeave={dirty ? () => void saveAndLeave() : leaveForNow}
        leaveLabel={dirty ? "Save Character and Leave" : "Leave for Now"}
        leaveIcon={dirty ? "content-save-outline" : undefined}
        onCancel={() => {
          pendingNav.current = null;
          setConfirm(false);
        }}
      />

      <ChoiceDialog
        visible={saveAsk}
        title="Save your look?"
        body={`You're wearing ${unowned.length} item${unowned.length === 1 ? "" : "s"} you don't own yet. Buy ${unowned.length === 1 ? "it" : "them"} and save everything, or save just your character changes (the new ${unowned.length === 1 ? "item stays" : "items stay"} in your cart).`}
        actions={[
          { label: `Buy ${unowned.length === 1 ? "Item" : `${unowned.length} Items`} & Save`, icon: "cart-check", onPress: buyAndSave },
          { label: "Save Character Changes", icon: "account-check-outline", variant: "secondary", onPress: saveCharacterOnly },
        ]}
        onCancel={() => setSaveAsk(false)}
      />

      <ChoiceDialog
        visible={confirm && cartView.count === 0}
        title="You've changed your character"
        body="Save the changes and leave, or discard them and your character goes back to how it was last saved."
        actions={[
          { label: "Save Character and Leave", icon: "content-save-outline", onPress: () => void saveAndLeave() },
          { label: "Discard Changes", icon: "undo-variant", variant: "secondary", onPress: discard },
        ]}
        cancelLabel="Keep Editing"
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
    return [...ownedHere.sort(storeOrder), ...store];
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
                ) : item.levelReward ? (
                  <View style={[styles.price, { backgroundColor: c.league }]}>
                    <Text style={[styles.priceText, { color: "#FFFFFF" }]}>{`LV ${item.levelReward}`}</Text>
                  </View>
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
  sceneGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  sceneCell: { width: "48%" },
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
  priceText: { fontSize: 11, fontFamily: "Inter_700Bold" },
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
