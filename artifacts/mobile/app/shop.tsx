import { MaterialCommunityIcons } from "@expo/vector-icons";
import { NO_CASH_VALUE } from "@/constants/legal";
import { haptic as buzz } from "@/lib/motion";
import { router, useIsFocused, useLocalSearchParams, useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AvatarDisplay from "@/components/AvatarDisplay";
import CartButton from "@/components/CartButton";
import { SLOT_FOCUS } from "@/lib/avatar3d/spec";
import ClothingCard from "@/components/ClothingCard";
import DripShopHighlights from "@/components/DripShopHighlights";
import StarterKitCard from "@/components/StarterKitCard";
import { TourTarget } from "@/components/tour/TourTarget";
import { STARTER_ITEMS } from "@/lib/tour/tours";
import GiftSheet from "@/components/GiftSheet";
import MoveCard from "@/components/MoveCard";
import BackgroundCard from "@/components/BackgroundCard";
import AvatarBackdrop from "@/components/avatar/AvatarBackdrop";
import TokenBalance from "@/components/TokenBalance";
import { DEFAULT_AVATAR } from "@/constants/avatarOptions";
import { MAX_LOADOUT } from "@/constants/moves";
import { useApp } from "@/context/AppContext";
import { useCatalog } from "@/hooks/useCatalog";
import CartExitDialog from "@/components/CartExitDialog";
import { BackButton, Button, CloseButton, FilterPills } from "@/components/ui";
import { useCartItems } from "@/hooks/useCartItems";
import { useCart } from "@/context/CartContext";
import { useColors } from "@/hooks/useColors";
import { useMoves, type StoreMove } from "@/hooks/useMoves";
import { useBackgrounds, type StoreBackground } from "@/hooks/useBackgrounds";
import type { Slot } from "@/lib/api";
import { RARITY_COLORS, SLOT_ICONS, SLOT_LABELS, SLOT_ORDER, type CatalogItem } from "@/types/catalog";

const ALL = "ALL";
/** Not a catalog slot: dance moves, sold here like clothes. `/shop?tab=moves` opens on it. */
const MOVES = "MOVES";
/** Not a catalog slot either: scenes behind the character. `/shop?tab=backgrounds`. */
const BACKDROPS = "BACKDROPS";
type Tab = Slot | typeof ALL | typeof MOVES | typeof BACKDROPS;

/**
 * Store rewritten against the database-driven catalog.
 *
 * Previously this imported a hardcoded 15-item array, so shipping a new hat
 * meant a code change and an app release (AUDIT A4, requirement §14). It now
 * subscribes to `catalog/*`.
 *
 * Preview (§18) shows the item on the user's actual character with their real
 * appearance and the rest of their current outfit, not a generic mannequin.
 */
export default function ShopScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const focused = useIsFocused();
  const params = useLocalSearchParams<{ tab?: string }>();
  const {
    balance,
    profile,
    inventory,
    equip,
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
  const { backgrounds } = useBackgrounds();
  const { items, featured, leavingSoon, byId, loading, error: catalogError } = useCatalog();
  const { moves } = useMoves();
  const cart = useCart();
  const navigation = useNavigation();

  const [slot, setSlot] = useState<Tab>(params.tab === "moves" ? MOVES : params.tab === "backgrounds" ? BACKDROPS : ALL);
  const [bgPreview, setBgPreview] = useState<StoreBackground | null>(null);
  const [preview, setPreview] = useState<CatalogItem | null>(null);
  const [gift, setGift] = useState<CatalogItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [movePreview, setMovePreview] = useState<StoreMove | null>(null);
  const [play, setPlay] = useState<{ id: string; n: number } | null>(null);
  const [moveNote, setMoveNote] = useState<string | null>(null);

  const topPad = Platform.OS === "web" ? 24 : insets.top;
  const bottomPad = Platform.OS === "web" ? 32 : insets.bottom + 24;

  const owned = useMemo(() => new Set(inventory), [inventory]);
  const equipped = profile?.equipped ?? {};
  const avatar = profile?.avatar ?? DEFAULT_AVATAR;

  const filtered = useMemo(
    () => (slot === ALL ? items : slot === MOVES || slot === BACKDROPS ? [] : items.filter((i) => i.slot === slot)),
    [items, slot]
  );
  // Everything for sale plus what you already own (free moves included), cheapest first.
  const moveList = useMemo(
    () => moves.filter((m) => m.forSale || ownedMoves.has(m.id)).sort((a, b) => a.price - b.price),
    [moves, ownedMoves]
  );

  const previewMove = useCallback((m: StoreMove) => {
    setMovePreview(m);
    setPlay((p) => ({ id: m.id, n: (p?.n ?? 0) + 1 }));
  }, []);

  const handleBuyMove = useCallback(
    async (m: StoreMove) => {
      setBusyId(m.id);
      const ok = await purchaseMove(m.id);
      setBusyId(null);
      if (ok) buzz.success();
      return ok;
    },
    [purchaseMove]
  );

  const handleToggleMove = useCallback(
    async (m: StoreMove) => {
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
    },
    [loadout, setLoadout]
  );

  // Everything you could own, cheapest first. Level-reward scenes are buyable now or free at their level.
  const backgroundList = useMemo(
    () =>
      backgrounds
        .filter((b) => b.forSale || b.levelReward || ownedBackgrounds.has(b.id))
        .sort((a, b) => a.price - b.price),
    [backgrounds, ownedBackgrounds]
  );
  const bgLocked = useCallback(
    (b: StoreBackground) =>
      !ownedBackgrounds.has(b.id) && ((!!b.levelRequired && b.levelRequired > progress.level) || !(b.price > 0)),
    [ownedBackgrounds, progress.level]
  );

  const handleBuyBackground = useCallback(
    async (b: StoreBackground) => {
      setBusyId(b.id);
      const ok = await purchaseBackground(b.id);
      setBusyId(null);
      if (ok) buzz.success();
      return ok;
    },
    [purchaseBackground]
  );

  const handleUseBackground = useCallback(
    async (b: StoreBackground) => {
      buzz.light();
      setBusyId(b.id);
      await setBackground(b.id);
      setBusyId(null);
    },
    [setBackground]
  );

  const itemLocked = useCallback(
    (item: CatalogItem) => !owned.has(item.id) && (!!item.levelReward || (!!item.levelRequired && item.levelRequired > progress.level)),
    [owned, progress.level]
  );

  const handleCart = useCallback(
    (item: CatalogItem) => {
      if (itemLocked(item)) {
        buzz.warning();
        return;
      }
      if (cart.toggle(item.id)) buzz.medium();
      else buzz.tick();
    },
    [cart, itemLocked]
  );

  // ── cart ─────────────────────────────────────────────────────────────────
  const { count: cartCount } = useCartItems();
  const [leaveAsk, setLeaveAsk] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const pendingNav = useRef<unknown>(null);
  // Back button, swipe-back and Android back all land here while the cart has something in it.
  const allowLeave = usePreventRemove(cartCount > 0 && !leaving, ({ data }) => {
    // Checkout just emptied the cart and is navigating away: don't stop it.
    if (!cart.peekCount() || cart.justCheckedOut()) {
      allowLeave();
      navigation.dispatch(data.action as never);
      return;
    }
    pendingNav.current = data.action;
    buzz.warning();
    setLeaveAsk(true);
  });
  const goCheckout = () => {
    pendingNav.current = null;
    setLeaveAsk(false);
    router.push({ pathname: "/checkout", params: { from: "shop" } });
  };
  const leaveAnyway = () => {
    setLeaveAsk(false);
    setLeaving(true);
    allowLeave();
    if (pendingNav.current) navigation.dispatch(pendingNav.current as never);
    else if (router.canGoBack()) router.back();
  };

  const handleToggleEquip = useCallback(
    async (item: CatalogItem) => {
      buzz.light();
      setBusyId(item.id);
      await equip(item.slot, equipped[item.slot] === item.id ? null : item.id);
      setBusyId(null);
    },
    [equip, equipped]
  );

  // What the avatar looks like with the previewed item on. Purely local — no
  // write happens until the user actually buys or equips.
  const previewEquipped = useMemo(
    () => (preview ? { ...equipped, [preview.slot]: preview.id } : equipped),
    [preview, equipped]
  );

  const slotTabs: Tab[] = [ALL, ...SLOT_ORDER, MOVES, BACKDROPS];

  // The free starter kit: offered at the top until it's all owned. Adding it also
  // sets the look checkout puts on, so buying it means wearing it.
  const starterMissing = useMemo(
    () => STARTER_ITEMS.filter((id) => !owned.has(id)).map((id) => byId.get(id)).filter((i): i is CatalogItem => !!i),
    [owned, byId]
  );
  const addStarterKit = useCallback(() => {
    buzz.medium();
    for (const it of starterMissing) if (!cart.has(it.id)) cart.add(it.id);
    const base = cart.draft ?? { avatar, equipped };
    cart.setDraft({ avatar: base.avatar, equipped: { ...base.equipped, ...Object.fromEntries(starterMissing.map((i) => [i.slot, i.id])) } });
  }, [starterMissing, cart, avatar, equipped]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          { backgroundColor: colors.background, borderBottomColor: colors.border, paddingTop: topPad + 12 },
        ]}
      >
        <View style={styles.headerRow}>
          <BackButton />
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.foreground }]}>Drip Shop</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
              {slot === MOVES
                ? `${ownedMoves.size} moves owned · ${loadout.length} of ${MAX_LOADOUT} on your dance button`
                : slot === BACKDROPS
                  ? `${ownedBackgrounds.size} scenes owned · Level ${progress.level}`
                  : `${owned.size} ${owned.size === 1 ? "item" : "items"} owned`}
            </Text>
            <Text style={[styles.subtitle, { color: colors.subtleForeground, fontSize: 11 }]}>Bought with {NO_CASH_VALUE.toLowerCase()}</Text>
          </View>
          <View style={styles.headerActions}>
            <TourTarget id="shop.cart"><CartButton from="shop" /></TourTarget>
            <TourTarget id="shop.balance"><TokenBalance tokens={balance} /></TourTarget>
          </View>
        </View>

        <TourTarget id="shop.filters">
        <FilterPills<Tab>
          value={slot}
          onChange={(t) => {
            setSlot(t);
            setMoveNote(null);
          }}
          options={slotTabs.map((t) => ({
            value: t,
            label: t === ALL ? "All" : t === MOVES ? "Moves" : t === BACKDROPS ? "Scenes" : SLOT_LABELS[t],
            icon: (t === ALL ? "hanger" : t === MOVES ? "human-handsup" : t === BACKDROPS ? "image-filter-hdr" : SLOT_ICONS[t]) as never,
          }))}
        />
        </TourTarget>

        <TourTarget id="shop.customize">
        <Button
          label="Customize Character"
          icon="account-edit-outline"
          variant="secondary"
          size="sm"
          onPress={() => router.push("/customize")}
          style={{ marginHorizontal: 16, marginTop: 10 }}
        />
        </TourTarget>
      </View>

      {(error || catalogError) && (
        <Pressable
          style={[styles.banner, { backgroundColor: colors.destructive + "22", borderColor: colors.destructive }]}
          onPress={clearError}
        >
          <MaterialCommunityIcons name="alert-circle-outline" size={15} color={colors.destructive} />
          <Text style={[styles.bannerText, { color: colors.destructive }]}>{error ?? catalogError}</Text>
        </Pressable>
      )}

      {slot === MOVES && moveNote ? (
        <Pressable
          style={[styles.banner, { backgroundColor: colors.alpha(colors.warning, 0.13), borderColor: colors.warning }]}
          onPress={() => setMoveNote(null)}
        >
          <MaterialCommunityIcons name="information-outline" size={15} color={colors.warning} />
          <Text style={[styles.bannerText, { color: colors.warning }]}>{moveNote}</Text>
        </Pressable>
      ) : null}

      {slot === BACKDROPS ? (
        <FlatList
          key="backdrops"
          data={backgroundList}
          keyExtractor={(b) => b.id}
          numColumns={2}
          columnWrapperStyle={{ gap: 10 }}
          contentContainerStyle={[styles.list, { paddingBottom: bottomPad, gap: 10 }]}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: b }) => (
            <BackgroundCard
              bg={b}
              owned={ownedBackgrounds.has(b.id)}
              inUse={background === b.id}
              level={progress.level}
              canAfford={balance >= b.price}
              busy={busyId === b.id}
              onBuy={() => void handleBuyBackground(b)}
              onUse={() => void handleUseBackground(b)}
              onPreview={() => setBgPreview(b)}
            />
          )}
        />
      ) : slot === MOVES ? (
        <FlatList
          key="moves"
          data={moveList}
          keyExtractor={(m) => m.id}
          contentContainerStyle={[styles.list, { paddingBottom: bottomPad }]}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: m }) => (
            <MoveCard
              move={m}
              owned={ownedMoves.has(m.id)}
              equipped={loadout.includes(m.id)}
              canAfford={balance >= m.price}
              busy={busyId === m.id}
              onBuy={() => void handleBuyMove(m)}
              onToggleEquip={() => void handleToggleMove(m)}
              onPreview={() => previewMove(m)}
            />
          )}
        />
      ) : loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <TourTarget id="shop.list" style={{ flex: 1 }}>
        <FlatList
          key="items"
          data={filtered}
          keyExtractor={(i) => i.id}
          contentContainerStyle={[styles.list, { paddingBottom: bottomPad }]}
          showsVerticalScrollIndicator={false}
          initialNumToRender={8}
          windowSize={7}
          removeClippedSubviews
          ListHeaderComponent={
            <>
              {starterMissing.length ? (
                <TourTarget id="shop.starterKit">
                  <StarterKitCard items={starterMissing} inCart={starterMissing.every((i) => cart.has(i.id))} onAdd={addStarterKit} />
                </TourTarget>
              ) : null}
              {slot === ALL ? (
                <DripShopHighlights featured={featured} leavingSoon={leavingSoon} owned={owned} onPress={setPreview} />
              ) : null}
            </>
          }
          renderItem={({ item }) => (
            <ClothingCard
              item={item}
              owned={owned.has(item.id)}
              equipped={equipped[item.slot] === item.id}
              canAfford={balance >= item.price}
              inCart={cart.has(item.id)}
              busy={busyId === item.id}
              level={progress.level}
              onCart={() => handleCart(item)}
              onToggleEquip={() => handleToggleEquip(item)}
              onPreview={() => setPreview(item)}
            />
          )}
          ListEmptyComponent={
            <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <MaterialCommunityIcons name="hanger" size={32} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Nothing Here Yet</Text>
              <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
                New drops land in this category soon.
              </Text>
            </View>
          }
        />
        </TourTarget>
      )}

      {/* Preview sheet (§18) */}
      <Modal visible={!!preview} transparent animationType="slide" onRequestClose={() => setPreview(null)}>
        <Pressable style={styles.overlay} onPress={() => setPreview(null)} />
        {preview && (
          <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />

            <View style={[styles.previewStage, { backgroundColor: colors.secondary }]}>
              <AvatarBackdrop id={background} />
              <AvatarDisplay
                avatar={avatar}
                equipped={previewEquipped}
                catalog={byId}
                size="lg"
                focus={SLOT_FOCUS[preview.slot]}
              />
            </View>

            <View style={styles.previewHead}>
              <Text style={[styles.previewName, { color: colors.foreground }]}>{preview.name}</Text>
              <View
                style={[
                  styles.rarity,
                  {
                    backgroundColor: RARITY_COLORS[preview.rarity] + "22",
                    borderColor: RARITY_COLORS[preview.rarity],
                  },
                ]}
              >
                <Text style={[styles.rarityText, { color: RARITY_COLORS[preview.rarity] }]}>
                  {preview.rarity.toUpperCase()}
                </Text>
              </View>
            </View>
            <Text style={[styles.previewDesc, { color: colors.mutedForeground }]}>
              {preview.description}
            </Text>

            <Pressable
              style={({ pressed }) => [
                styles.previewBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: busyId === preview.id || itemLocked(preview) ? 0.45 : pressed ? 0.85 : 1,
                },
              ]}
              disabled={busyId === preview.id || itemLocked(preview)}
              onPress={async () => {
                if (owned.has(preview.id)) await handleToggleEquip(preview);
                else handleCart(preview);
                setPreview(null);
              }}
            >
              {busyId === preview.id ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.previewBtnText, { color: colors.primaryForeground }]}>
                  {owned.has(preview.id)
                    ? equipped[preview.slot] === preview.id
                      ? "Take it off"
                      : "Wear it"
                    : preview.levelReward
                      ? `Unlocks free at level ${preview.levelReward}`
                      : itemLocked(preview)
                        ? `Reach level ${preview.levelRequired} to buy`
                        : cart.has(preview.id)
                      ? "Remove from cart"
                      : `Add to cart · ${preview.price === 0 ? "Free" : preview.price.toLocaleString()}`}
                </Text>
              )}
            </Pressable>
            {!preview.levelReward && items.some((i) => i.id === preview.id) ? (
              <Button
                label={`Gift to a friend · ${preview.price.toLocaleString()}`}
                icon="gift-outline"
                variant="secondary"
                size="sm"
                disabled={balance < preview.price}
                onPress={() => {
                  const it = preview;
                  setPreview(null);
                  setGift(it);
                }}
                style={{ marginTop: 8 }}
              />
            ) : null}
            <CloseButton onPress={() => setPreview(null)} style={styles.previewClose} />
          </View>
        )}
      </Modal>

      <GiftSheet item={gift} onClose={() => setGift(null)} />

      <CartExitDialog
        visible={leaveAsk}
        onCheckout={goCheckout}
        onLeave={leaveAnyway}
        onCancel={() => {
          pendingNav.current = null;
          setLeaveAsk(false);
        }}
      />

      {/* Background preview: your character, live, standing in the scene. */}
      <Modal visible={!!bgPreview} transparent animationType="slide" onRequestClose={() => setBgPreview(null)}>
        <Pressable style={styles.overlay} onPress={() => setBgPreview(null)} />
        {bgPreview && (
          <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <View style={[styles.previewStage, styles.bgStage, { backgroundColor: colors.secondary }]}>
              <AvatarBackdrop id={bgPreview.id} />
              <AvatarDisplay
                avatar={avatar}
                equipped={equipped}
                catalog={byId}
                size="lg"
                focus="hero"
                controls={false}
                active={focused && !!bgPreview}
              />
            </View>
            <View style={styles.previewHead}>
              <Text style={[styles.previewName, { color: colors.foreground }]}>{bgPreview.name}</Text>
              <View
                style={[
                  styles.rarity,
                  { backgroundColor: colors.alpha(colors.rarity(bgPreview.rarity), 0.14), borderColor: colors.rarity(bgPreview.rarity) },
                ]}
              >
                <Text style={[styles.rarityText, { color: colors.rarity(bgPreview.rarity) }]}>{bgPreview.rarity.toUpperCase()}</Text>
              </View>
            </View>
            <Text style={[styles.previewDesc, { color: colors.mutedForeground }]}>{bgPreview.description}</Text>
            {(() => {
              const mine = ownedBackgrounds.has(bgPreview.id);
              const on = background === bgPreview.id;
              const locked = bgLocked(bgPreview);
              const blocked = busyId === bgPreview.id || on || locked || (!mine && balance < bgPreview.price);
              return (
                <Pressable
                  style={({ pressed }) => [styles.previewBtn, { backgroundColor: colors.primary, opacity: blocked ? 0.45 : pressed ? 0.85 : 1 }]}
                  disabled={blocked}
                  onPress={async () => {
                    if (mine) await handleUseBackground(bgPreview);
                    else await handleBuyBackground(bgPreview);
                    setBgPreview(null);
                  }}
                >
                  {busyId === bgPreview.id ? (
                    <ActivityIndicator size="small" color={colors.primaryForeground} />
                  ) : (
                    <Text style={[styles.previewBtnText, { color: colors.primaryForeground }]}>
                      {on
                        ? "In Use"
                        : mine
                          ? "Use This Scene"
                          : locked
                            ? bgPreview.levelReward
                              ? `Unlocks Free at Level ${bgPreview.levelReward}`
                              : `Reach Level ${bgPreview.levelRequired} to Buy`
                            : `Buy for ${bgPreview.price.toLocaleString()}${bgPreview.levelReward ? ` · or Free at Lv ${bgPreview.levelReward}` : ""}`}
                    </Text>
                  )}
                </Pressable>
              );
            })()}
            <CloseButton onPress={() => setBgPreview(null)} style={styles.previewClose} />
          </View>
        )}
      </Modal>

      {/* Move preview: your character, in your outfit, doing the move. */}
      <Modal visible={!!movePreview} transparent animationType="slide" onRequestClose={() => setMovePreview(null)}>
        <Pressable style={styles.overlay} onPress={() => setMovePreview(null)} />
        {movePreview && (
          <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <View style={[styles.previewStage, { backgroundColor: colors.secondary }]}>
              <AvatarBackdrop id={background} />
              <AvatarDisplay
                avatar={avatar}
                equipped={equipped}
                catalog={byId}
                size="lg"
                focus="hero"
                controls={false}
                move={play}
                active={focused && !!movePreview}
              />
            </View>
            <View style={styles.previewHead}>
              <Text style={[styles.previewName, { color: colors.foreground }]}>{movePreview.name}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Play again"
                hitSlop={8}
                onPress={() => previewMove(movePreview)}
                style={[styles.replay, { backgroundColor: colors.secondary, borderColor: colors.border }]}
              >
                <MaterialCommunityIcons name="replay" size={16} color={colors.foreground} />
              </Pressable>
              <View
                style={[
                  styles.rarity,
                  { backgroundColor: colors.alpha(colors.rarity(movePreview.rarity), 0.14), borderColor: colors.rarity(movePreview.rarity) },
                ]}
              >
                <Text style={[styles.rarityText, { color: colors.rarity(movePreview.rarity) }]}>{movePreview.rarity.toUpperCase()}</Text>
              </View>
            </View>
            <Text style={[styles.previewDesc, { color: colors.mutedForeground }]}>
              {movePreview.description} · {movePreview.seconds.toFixed(0)}s
            </Text>
            {(() => {
              const mine = ownedMoves.has(movePreview.id);
              const on = loadout.includes(movePreview.id);
              const blocked = busyId === movePreview.id || (!mine && balance < movePreview.price);
              return (
                <Pressable
                  style={({ pressed }) => [
                    styles.previewBtn,
                    { backgroundColor: colors.primary, opacity: blocked ? 0.45 : pressed ? 0.85 : 1 },
                  ]}
                  disabled={blocked}
                  onPress={async () => {
                    if (mine) {
                      await handleToggleMove(movePreview);
                      setMovePreview(null);
                    } else if (await handleBuyMove(movePreview)) {
                      previewMove(movePreview);
                    }
                  }}
                >
                  {busyId === movePreview.id ? (
                    <ActivityIndicator size="small" color={colors.primaryForeground} />
                  ) : (
                    <Text style={[styles.previewBtnText, { color: colors.primaryForeground }]}>
                      {mine ? (on ? "Take off dance button" : "Put on dance button") : `Buy for ${movePreview.price.toLocaleString()}`}
                    </Text>
                  )}
                </Pressable>
              );
            })()}
            <CloseButton onPress={() => setMovePreview(null)} style={styles.previewClose} />
          </View>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  charRow: { gap: 6, marginTop: 10 },
  charLabel: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1 },
  charChips: { gap: 6, paddingRight: 16 },
  charChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  charChipText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  container: { flex: 1 },
  header: { borderBottomWidth: 1, paddingBottom: 12, gap: 10 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { fontSize: 24, fontFamily: "Inter_900Black" },
  subtitle: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 2 },
  tabList: { paddingHorizontal: 16, gap: 8 },
  tab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  movesTab: { flexDirection: "row", alignItems: "center", gap: 5 },
  tabText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  bannerText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { padding: 16 },
  empty: { alignItems: "center", gap: 8, padding: 32, borderRadius: 16, borderWidth: 1, marginTop: 24 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  emptyBody: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    padding: 24,
    paddingTop: 14,
    gap: 12,
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 6 },
  previewClose: { position: "absolute", top: 12, right: 14 },
  previewStage: { borderRadius: 18, height: 300, overflow: "hidden" },
  bgStage: { height: 380 },
  previewHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  previewName: { flex: 1, fontSize: 19, fontFamily: "Inter_700Bold" },
  replay: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  rarity: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  rarityText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  previewDesc: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: -6 },
  previewBtn: { paddingVertical: 15, borderRadius: 14, alignItems: "center", marginTop: 4 },
  previewBtnText: { fontSize: 16, fontFamily: "Inter_700Bold" },
});
