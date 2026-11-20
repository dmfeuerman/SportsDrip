import { MaterialCommunityIcons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { TourModalLayer } from "@/components/tour/TourHost";
import { TourTarget, useTourScroll } from "@/components/tour/TourTarget";
import { tourEvent, tourPractice, tourStake, useTourState } from "@/lib/tour/store";
import TeamCrest from "@/components/TeamCrest";
import { trackEvent } from "@/lib/analytics";
import { haptic as buzz } from "@/lib/motion";
import EarnCreditsButton from "@/components/ads/EarnCreditsButton";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Pressable, Switch } from "@/components/fx/Tap";
import Animated, { ZoomIn } from "react-native-reanimated";
import PressableScale from "@/components/fx/PressableScale";
import RollingNumber from "@/components/fx/RollingNumber";
import Shimmer from "@/components/fx/Shimmer";
import ScrollHint, { useScrollHint } from "@/components/ScrollHint";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import NumericInput from "@/components/NumericInput";
import { ChallengeSetup, ChallengeSummary, clampOdds } from "@/components/ChallengeComposer";
import TeamEdge from "@/components/insights/TeamEdge";
import { ActionChip, Amount, CloseButton, SegmentedControl } from "@/components/ui";
import { GlassModalSurface, LiquidGlass } from "@/components/ui/LiquidGlass";
import { useChallenges } from "@/context/ChallengeContext";
import { useColors } from "@/hooks/useColors";
import { useNow } from "@/hooks/useNow";
import { newIdempotencyKey } from "@/lib/api";
import { challengeTerms, type ChallengeMode } from "@/lib/challengeMath";
import { formatOdds, formatPercent, impliedProbability, NO_LINE, untilKickoff } from "@/lib/odds";
import { lastStakeFor, rememberStake, useOddsFormat } from "@/lib/settings";
import type { Game, Side } from "@/types/game";
import type { Market, Selection } from "@/lib/markets";

export interface BetWallet {
  /** "credits" or a league id. */
  id: string;
  label: string;
  balance: number;
  kind: "credits" | "league";
}

/** League-only options on a slip. */
export interface SlipExtras {
  /** Lock of the Week (one per member per week, per league). */
  lock: boolean;
  /** Keep it off chat and hidden from the league until kickoff. */
  hidden: boolean;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  /** No parlay running: offer "Add to Parlay" under Place bet (adds the pick and closes the slip). */
  onAddToParlay?: () => void;
  onConfirm: (amount: number, walletId: string, extras: SlipExtras) => void | Promise<void>;
  teamName: string;
  teamAbbr: string;
  teamColor: string;
  /** Bet type and side, shown as labelled chips so the pick is unmistakable. */
  market?: Market;
  selection?: Selection;
  /** The pick as a sentence ("Detroit Lions -3.5", "Over 45.5 total points"). Defaults to "<team> to win". */
  pickTitle?: string;
  /** Leagues where this week's Lock of the Week is already spent. */
  lockUsed?: Record<string, boolean>;
  /** Decimal price on this pick. Null when the book has no line: book bets are disabled, challenges still work. */
  odds: number | null;
  gameSummary: string;
  /** Where the stake can come from. Credits first, then eligible leagues. */
  wallets: BetWallet[];
  defaultWallet?: string;
  /** Prefilled stake (a tail copies the original stake), capped to the wallet. */
  defaultStake?: number;
  /**
   * A line above the pick explaining where the slip came from ("Tailing Jake
   * on DET"). Shown only while paying from `leagueId`, the league it refers to.
   */
  context?: { icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"]; text: string; leagueId: string };
  /** True while the callable is in flight. */
  submitting?: boolean;
  /** Server rejection, shown in the modal so the user can fix and retry. */
  error?: string | null;
  /** The fixture and pick, for the pre-commit insights panel. */
  game?: Game;
  side?: Side | null;
  /**
   * Lets the slip switch to a head-to-head with a friend on the same pick.
   * Challenges are credits-only and both stakes are escrowed by the server.
   */
  challenge?: {
    /** Open in friend mode with this friend already picked. */
    friendUid?: string;
    /** Open in friend mode. */
    initial?: boolean;
    /** The challenge was created; the host closes the slip and confirms it. */
    onSent: (sent: { friendName: string; teamAbbr: string; teamColor: string; stake: number; pot: number }) => void;
    /** Host navigates to the Friends tab (after closing the slip). */
    onFindFriends?: () => void;
  };
}

type Mode = "book" | "friend";

const MIN_STAKE = 10;

function pickWallet(wallets: BetWallet[], preferred?: string): string {
  return preferred && wallets.some((w) => w.id === preferred) ? preferred : wallets[0]?.id ?? "credits";
}

function prefillStakeFor(wallets: BetWallet[], walletId: string, explicitStake?: number): string {
  const room = wallets.find((w) => w.id === walletId)?.balance ?? 0;
  const candidate = explicitStake ?? lastStakeFor(walletId) ?? 0;
  const clamped = candidate > 0 ? Math.min(Math.floor(candidate), room) : 0;
  return clamped >= MIN_STAKE ? String(clamped) : "";
}

/**
 * 2026 Liquid Glass Bet Display Screen (Luminous Spotlight modal matching PrizeVaultModal).
 *
 * Replaces the legacy swipe-up bottom sheet with a centered frosted Liquid Glass card,
 * team-tinted directional radial dome glow, specular top rim, modern pick hero,
 * tactile glass stake controls, rolling payout readout, and split dual-action footer.
 */
export default function BetModal({
  visible,
  onClose,
  onConfirm,
  teamName,
  market = "ml",
  selection,
  teamAbbr,
  teamColor,
  pickTitle,
  lockUsed,
  odds,
  gameSummary,
  wallets,
  defaultWallet,
  defaultStake,
  context,
  submitting = false,
  error,
  game,
  side,
  challenge,
  onAddToParlay,
}: Props) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const hint = useScrollHint();
  const oddsFormat = useOddsFormat();
  const now = useNow(15_000);
  const [amount, setAmount] = useState("");
  const [blocked, setBlocked] = useState<string | null>(null);
  useEffect(() => setBlocked(null), [amount]);
  const [walletId, setWalletId] = useState(() => pickWallet(wallets, defaultWallet));
  const [focused, setFocused] = useState(false);
  const [lockPick, setLockPick] = useState(false);
  const [hidePick, setHidePick] = useState(false);

  // Friend mode
  const canChallenge = !!challenge && !!game && !!side;
  const { friends, friendsLoading, loadFriends, create } = useChallenges();
  const unpriced = !(typeof odds === "number" && Number.isFinite(odds) && odds > 1);
  const [mode, setMode] = useState<Mode>(canChallenge && (challenge?.initial || unpriced) ? "friend" : "book");
  const [friendUid, setFriendUid] = useState<string | null>(challenge?.friendUid ?? null);
  useEffect(() => setBlocked(null), [friendUid]);
  const [format, setFormat] = useState<ChallengeMode>("pot");
  const [chOdds, setChOdds] = useState(() => clampOdds(odds ?? 2));
  const [sending, setSending] = useState(false);
  const [chError, setChError] = useState<string | null>(null);
  const chKey = useRef(newIdempotencyKey());

  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const tourScroll = useTourScroll(scrollRef, hint.scrollProps.onScroll);
  const inputY = useRef(0);

  useEffect(() => {
    if (visible) {
      trackEvent("slip_opened", { game_id: game?.id });
      const initialWallet = pickWallet(wallets, defaultWallet);
      setWalletId(initialWallet);
      setAmount(tourPractice() || tourStake() != null ? "" : prefillStakeFor(wallets, initialWallet, defaultStake));
      setLockPick(false);
      setHidePick(false);
      setMode(canChallenge && (challenge?.initial || unpriced) ? "friend" : "book");
      setFriendUid(challenge?.friendUid ?? null);
      setFormat("pot");
      setChOdds(clampOdds(odds ?? 2));
      setChError(null);
      chKey.current = newIdempotencyKey();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, defaultWallet]);

  const friendMode = canChallenge && mode === "friend";
  useEffect(() => {
    if (visible && error) trackEvent("slip_error", { message: error });
  }, [visible, error]);

  const stakeTracked = useRef(false);
  const prefilled = useRef<string | null>(null);
  useEffect(() => {
    if (!visible) {
      stakeTracked.current = false;
      prefilled.current = null;
      return;
    }
    if (prefilled.current === null) {
      prefilled.current = amount;
      return;
    }
    if (!stakeTracked.current && amount !== prefilled.current) {
      stakeTracked.current = true;
      trackEvent("slip_stake_set", {});
    }
  }, [visible, amount]);

  useEffect(() => {
    if (visible && friendMode) void loadFriends();
  }, [visible, friendMode, loadFriends]);

  useEffect(() => {
    if (friendMode && !friendUid && friends.length === 1) setFriendUid(friends[0]!.uid);
  }, [friendMode, friendUid, friends]);

  useEffect(() => {
    if (!wallets.some((w) => w.id === walletId)) {
      const fallback = pickWallet(wallets);
      setWalletId(fallback);
      setAmount(prefillStakeFor(wallets, fallback));
    }
  }, [wallets, walletId]);

  const revealInput = useCallback(() => {
    scrollRef.current?.scrollTo({ y: Math.max(0, inputY.current - 12), animated: true });
  }, []);

  useEffect(() => {
    if (!visible) return;
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      if (inputRef.current?.isFocused()) revealInput();
    });
    return () => sub.remove();
  }, [visible, revealInput]);

  const selectedWallet = wallets.find((w) => w.id === walletId) ?? wallets[0];
  const wallet = friendMode ? wallets.find((w) => w.kind === "credits") ?? selectedWallet : selectedWallet;
  const available = wallet?.balance ?? 0;
  const isLeague = wallet?.kind === "league";
  const tint = isLeague ? c.league : c.primary;
  const unit = isLeague ? "tokens" : "credits";
  const lockAlreadyUsed = isLeague && !!wallet && !!lockUsed?.[wallet.id];

  const stake = Number.parseInt(amount, 10) || 0;
  const { tour: tourOn, step: tourStep } = useTourState();
  useEffect(() => {
    if (!visible || !tourOn) return;
    if (tourStake() != null && stake === tourStake()) Keyboard.dismiss();
    tourEvent(`slip:stake:${stake}`);
    if (stake >= MIN_STAKE) tourEvent("slip:stake");
  }, [visible, stake, tourOn, tourStep]);

  const priced = typeof odds === "number" && Number.isFinite(odds) && odds > 1;
  const payout = priced ? Math.round(stake * odds) : 0;
  const profit = payout - stake;
  const chance = impliedProbability(odds);

  const tooSmall = stake > 0 && stake < MIN_STAKE;
  const tooBig = stake > available;
  const canBet = priced && stake >= MIN_STAKE && !tooBig && !submitting && !!wallet;
  const heavy = stake > 0 && !tooBig && stake > available * 0.5;

  const other = game && side ? (side === "home" ? game.awayTeam : game.homeTeam) : null;
  const friend = friends.find((f) => f.uid === friendUid) ?? null;
  const friendName = friend?.displayName ?? "Friend";
  const quote = friendMode && stake > 0 ? challengeTerms(format, stake, format === "odds" ? chOdds : undefined) : null;
  const terms = quote?.ok ? quote.terms : null;
  const busy = submitting || sending;
  const canSend = friendMode && !!friendUid && !!terms && !tooBig && !busy;

  const minsToStart = game && game.status === "upcoming" && game.startsAt > now ? Math.ceil((game.startsAt - now) / 60_000) : null;
  const lockingSoon = minsToStart !== null && minsToStart <= 60;

  const quick = useMemo(() => {
    return [100, 500, 1000].filter((x) => x >= MIN_STAKE && x <= available);
  }, [available]);

  function focusInput() {
    if (busy) return;
    const input = inputRef.current;
    if (!input) return;
    if (input.isFocused()) revealInput();
    else input.focus();
  }

  function selectWallet(id: string) {
    if (id === walletId || busy) return;
    buzz.tick();
    const keepTyping = inputRef.current?.isFocused() ?? false;
    setWalletId(id);
    setLockPick(false);
    setAmount(prefillStakeFor(wallets, id));
    if (keepTyping) requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function handleConfirm() {
    if (!wallet || submitting) return;
    if (!canBet) {
      const why =
        stake <= 0
          ? `Enter how much to bet. The minimum is ${MIN_STAKE} ${unit}.`
          : tooSmall
            ? `That's below the minimum. Bets start at ${MIN_STAKE} ${unit}.`
            : tooBig
              ? `That's more than ${wallet.label} holds (${available.toLocaleString()} ${unit}).`
              : null;
      if (why) {
        buzz.warning();
        setBlocked(why);
      }
      return;
    }
    Keyboard.dismiss();
    buzz.medium();
    rememberStake(wallet.id, stake);
    trackEvent("slip_confirmed", { wallet: wallet.id === "credits" ? "credits" : "league" });
    await onConfirm(stake, wallet.id, {
      lock: isLeague && !lockAlreadyUsed ? lockPick : false,
      hidden: isLeague ? hidePick : false,
    });
  }

  function handleClose() {
    if (busy) return;
    Keyboard.dismiss();
    buzz.tick();
    onClose();
  }

  function switchMode(next: Mode) {
    if (next === mode || busy) return;
    buzz.tick();
    setMode(next);
    setChError(null);
  }

  async function sendChallenge() {
    if (busy) return;
    if (!canSend) {
      const why = !friendUid
        ? "Choose a friend to challenge first."
        : stake <= 0
          ? `Enter how much to put in. The minimum is ${MIN_STAKE} credits.`
          : tooBig
            ? `That's more than your ${available.toLocaleString()} credits.`
            : quote && !quote.ok
              ? quote.reason
              : null;
      if (why) {
        buzz.warning();
        setBlocked(why);
      }
      return;
    }
    if (!game || !side || !friendUid || !terms) return;
    Keyboard.dismiss();
    buzz.medium();
    setSending(true);
    setChError(null);
    const err = await create({
      gameId: game.id,
      opponentUid: friendUid,
      side,
      mode: format,
      stake: terms.creatorStake,
      odds: format === "odds" ? terms.odds : undefined,
      idempotencyKey: chKey.current,
      preview: {
        sport: game.sport,
        startsAt: game.startsAt,
        home: { name: game.homeTeam.name, abbreviation: game.homeTeam.abbreviation, color: game.homeTeam.color },
        away: { name: game.awayTeam.name, abbreviation: game.awayTeam.abbreviation, color: game.awayTeam.color },
        opponentName: friendName,
        opponentStake: terms.opponentStake,
        pot: terms.pot,
        odds: terms.odds,
      },
    });
    setSending(false);
    if (err) {
      buzz.error();
      setChError(err);
      return;
    }
    buzz.success();
    challenge?.onSent({ friendName, teamAbbr, teamColor, stake: terms.creatorStake, pot: terms.pot });
  }

  const cardWidth = Math.min(392, Math.max(300, winW - 28));
  const maxCardHeight = Math.max(420, winH - insets.top - insets.bottom - 36);
  const primaryColor = friendMode ? c.accent : tint;
  const primaryFg = friendMode ? c.accentForeground : isLeague ? c.accentForeground : c.primaryForeground;
  const primaryReady = friendMode ? canSend : canBet;
  const primaryLabel = friendMode
    ? terms
      ? `Challenge · ${terms.creatorStake.toLocaleString()}`
      : "Send Challenge"
    : !priced
      ? NO_LINE
      : tourPractice()
        ? "Place Test Bet"
        : stake >= MIN_STAKE
          ? `Place Bet · ${stake.toLocaleString()}`
          : "Place Bet";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.backdrop}
      >
        {Platform.OS !== "web" ? (
          <BlurView intensity={34} tint={c.isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close bet slip"
          onPress={handleClose}
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: c.isDark ? "rgba(5, 9, 16, 0.46)" : c.overlay },
          ]}
        />

        <GlassModalSurface
          id="betslip"
          glowColor={friendMode ? c.accent : teamColor}
          rimColor={c.alpha(friendMode ? c.accent : teamColor, 0.78)}
          style={[styles.card, { width: cardWidth, maxHeight: maxCardHeight }]}
        >
          {/* Top utility bar */}
          <View style={styles.topBar}>
            <View style={styles.metaPill}>
              <Text style={[styles.gameLabel, { color: c.mutedForeground }]} numberOfLines={1}>
                {gameSummary}
              </Text>
            </View>
            {lockingSoon && game ? (
              <View style={[styles.lockSoonChip, { backgroundColor: c.alpha(c.live, 0.16), borderColor: c.alpha(c.live, 0.45) }]}>
                <MaterialCommunityIcons name="timer-sand" size={11} color={c.live} />
                <Text style={[styles.lockSoonText, { color: c.live }]}>
                  {untilKickoff(game.startsAt, now)}
                </Text>
              </View>
            ) : null}
            <CloseButton onPress={handleClose} disabled={busy} />
          </View>

          {/* Scrollable spotlight body */}
          <View style={styles.scrollWrap}>
            <ScrollView
              ref={scrollRef}
              {...hint.scrollProps}
              onScroll={tourScroll.onScroll}
              style={styles.scroll}
              contentContainerStyle={styles.body}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="none"
              showsVerticalScrollIndicator={false}
            >
              <tourScroll.Provider>
                {context && !friendMode && walletId === context.leagueId ? (
                  <View style={[styles.context, { backgroundColor: c.leagueSoft, borderColor: c.alpha(c.league, 0.45) }]}>
                    <MaterialCommunityIcons name={context.icon} size={15} color={c.league} />
                    <Text style={[styles.contextText, { color: c.foreground }]} numberOfLines={2}>
                      {context.text}
                    </Text>
                  </View>
                ) : null}

                {/* Luminous Pick Hero Card */}
                <TourTarget id="slip.team">
                  <Animated.View entering={ZoomIn.springify().damping(14).stiffness(220)}>
                    <LiquidGlass
                      variant="hero"
                      radius={22}
                      tintColor={c.alpha(teamColor, c.isDark ? 0.22 : 0.14)}
                      borderColor={c.alpha(teamColor, 0.65)}
                      borderWidth={1.5}
                      contentStyle={styles.heroPick}
                    >
                      <TeamCrest abbr={teamAbbr} color={teamColor} size={48} sport={game?.sport} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <View style={styles.heroBadges}>
                          <View style={[styles.marketPill, { backgroundColor: c.alpha(teamColor, 0.28), borderColor: c.alpha(teamColor, 0.55) }]}>
                            <Text style={[styles.marketPillText, { color: c.foreground }]}>
                              {market === "spread" ? "SPREAD" : market === "total" ? "TOTAL" : "MONEYLINE"}
                            </Text>
                          </View>
                          {priced ? (
                            <View style={[styles.oddsBadge, { backgroundColor: c.alpha(c.primary, 0.18), borderColor: c.alpha(c.primary, 0.45) }]}>
                              <Text style={[styles.oddsBadgeText, { color: c.primary }]}>
                                {formatOdds(odds, oddsFormat)}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                        <Text
                          style={[styles.teamName, { color: c.foreground }]}
                          numberOfLines={2}
                          adjustsFontSizeToFit
                          minimumFontScale={0.72}
                        >
                          {pickTitle ?? `${teamName} to win`}
                        </Text>
                        <Text style={[styles.oddsLabel, { color: c.mutedForeground }]}>
                          {priced ? `Implied win chance ${formatPercent(chance)}` : NO_LINE}
                        </Text>
                      </View>
                    </LiquidGlass>
                  </Animated.View>
                </TourTarget>

                {canChallenge ? (
                  <TourTarget id="slip.mode">
                    <SegmentedControl<Mode>
                      value={mode}
                      onChange={switchMode}
                      options={[
                        { value: "book", label: "Bet the Book" },
                        { value: "friend", label: "Challenge Friend" },
                      ]}
                    />
                  </TourTarget>
                ) : null}

                {friendMode && other ? (
                  <ChallengeSetup
                    friends={friends}
                    loading={friendsLoading}
                    friendUid={friendUid}
                    onFriend={(uid) => {
                      setFriendUid(uid);
                      setChError(null);
                    }}
                    onFindFriends={() => challenge?.onFindFriends?.()}
                    format={format}
                    onFormat={(f) => {
                      setFormat(f);
                      setChError(null);
                    }}
                    odds={chOdds}
                    onOdds={(x) => {
                      setChOdds(clampOdds(x));
                      setChError(null);
                    }}
                    marketOdds={odds}
                    teamAbbr={teamAbbr}
                    otherAbbr={other.abbreviation}
                    disabled={busy}
                  />
                ) : game && side ? (
                  <TourTarget id="slip.edge">
                    <TeamEdge game={game} side={side} />
                  </TourTarget>
                ) : null}

                {/* Wallet Selector */}
                {!friendMode && wallets.length > 1 && (
                  <TourTarget id="slip.wallets" style={{ gap: 6 }}>
                    <Text style={[styles.label, { color: isLeague ? c.league : c.mutedForeground }]}>
                      PAY WITH{isLeague ? " · LEAGUE TOKENS" : ""}
                    </Text>
                    <View style={styles.walletWrap}>
                      {wallets.map((w) => {
                        const on = w.id === walletId;
                        const wTint = w.kind === "league" ? c.league : c.primary;
                        return (
                          <Pressable
                            key={w.id}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: on, disabled: submitting }}
                            accessibilityLabel={`${w.label}, ${w.balance.toLocaleString()} ${w.kind === "league" ? "league tokens" : "credits"} available`}
                            disabled={submitting}
                            onPress={() => selectWallet(w.id)}
                            style={styles.walletBtnWrap}
                          >
                            <LiquidGlass
                              variant="tile"
                              interactive
                              tintColor={on ? c.alpha(wTint, 0.2) : undefined}
                              borderColor={on ? wTint : undefined}
                              borderWidth={on ? 1.5 : 1}
                              contentStyle={styles.wallet}
                            >
                              <View style={styles.walletHead}>
                                <MaterialCommunityIcons
                                  name={w.kind === "league" ? "trophy-outline" : "lightning-bolt"}
                                  size={12}
                                  color={on ? wTint : c.mutedForeground}
                                />
                                <Text style={[styles.walletName, { color: on ? c.foreground : c.mutedForeground }]} numberOfLines={1}>
                                  {w.label}
                                </Text>
                              </View>
                              <Amount value={w.balance} currency={w.kind === "league" ? "league" : "credits"} size="sm" />
                            </LiquidGlass>
                          </Pressable>
                        );
                      })}
                    </View>
                  </TourTarget>
                )}

                {/* Modern Stake Input + Quick Glass Tiles */}
                <View onLayout={(e) => { inputY.current = e.nativeEvent.layout.y; }}>
                  <TourTarget id="slip.stake" style={{ gap: 10 }}>
                    <View style={styles.stakeHeader}>
                      <Text style={[styles.label, { color: c.mutedForeground }]}>
                        {friendMode ? "YOUR STAKE" : "WAGER AMOUNT"}
                      </Text>
                      <Text style={[styles.availText, { color: c.mutedForeground }]}>
                        Avail: <Text style={{ color: tint, fontFamily: "Inter_700Bold" }}>{available.toLocaleString()}</Text> {unit}
                      </Text>
                    </View>

                    <Pressable onPress={focusInput} accessible={false}>
                      <LiquidGlass
                        variant="tile"
                        radius={18}
                        tintColor={
                          tooBig
                            ? c.alpha(c.negative, 0.14)
                            : focused
                              ? c.alpha(tint, 0.14)
                              : undefined
                        }
                        borderColor={tooBig ? c.negative : focused ? tint : c.isDark ? "rgba(255,255,255,0.2)" : c.border}
                        borderWidth={focused || tooBig ? 1.5 : 1}
                        contentStyle={styles.inputWrap}
                      >
                        <MaterialCommunityIcons
                          name={isLeague ? "trophy-outline" : "lightning-bolt"}
                          size={22}
                          color={tint}
                        />
                        <NumericInput
                          ref={inputRef}
                          style={[styles.input, { color: c.foreground }]}
                          value={amount}
                          onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ""))}
                          onFocus={() => setFocused(true)}
                          onBlur={() => setFocused(false)}
                          placeholder={friendMode ? "0" : "0"}
                          placeholderTextColor={c.subtleForeground}
                          keyboardType="number-pad"
                          doneBar={false}
                          editable={!busy}
                          accessibilityLabel={`Stake amount in ${wallet?.label ?? "credits"} ${unit}`}
                        />
                        <ActionChip
                          label="MAX"
                          accessibilityLabel="Bet maximum"
                          chevron={false}
                          tone={isLeague ? "league" : "money"}
                          onPress={() => setAmount(String(available))}
                          disabled={busy}
                        />
                      </LiquidGlass>
                    </Pressable>

                    {quick.length > 0 ? (
                      <View style={styles.quickRow}>
                        {quick.map((q) => {
                          const active = stake === q;
                          return (
                            <PressableScale
                              key={q}
                              accessibilityRole="button"
                              style={{ flex: 1 }}
                              scaleTo={0.94}
                              haptic="tick"
                              onPress={() => setAmount(String(q))}
                              disabled={busy}
                            >
                              <LiquidGlass
                                variant="pill"
                                interactive
                                tintColor={active ? c.alpha(tint, 0.22) : undefined}
                                borderColor={active ? tint : undefined}
                                borderWidth={active ? 1.5 : 1}
                                contentStyle={styles.quickBtn}
                              >
                                <Text style={[styles.quickText, { color: active ? tint : c.foreground }]}>
                                  {q.toLocaleString()}
                                </Text>
                              </LiquidGlass>
                            </PressableScale>
                          );
                        })}
                      </View>
                    ) : null}
                  </TourTarget>
                </View>

                {/* League Extras */}
                {!friendMode && isLeague && (
                  <LiquidGlass variant="tile" radius={16} contentStyle={styles.extrasBox}>
                    <View style={styles.extraRow}>
                      <MaterialCommunityIcons name="lock-check-outline" size={16} color={lockPick ? c.league : c.mutedForeground} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.extraTitle, { color: c.foreground }]}>Lock of the Week</Text>
                        <Text style={[styles.extraSub, { color: c.mutedForeground }]}>
                          {lockAlreadyUsed ? "Already used this week" : "One per week · Lock leaderboard"}
                        </Text>
                      </View>
                      <Switch
                        value={lockPick && !lockAlreadyUsed}
                        onValueChange={setLockPick}
                        disabled={lockAlreadyUsed || busy}
                        trackColor={{ false: c.border, true: c.league }}
                      />
                    </View>
                    <View style={[styles.extraDivider, { backgroundColor: c.isDark ? "rgba(255,255,255,0.1)" : c.border }]} />
                    <View style={styles.extraRow}>
                      <MaterialCommunityIcons name="eye-off-outline" size={16} color={hidePick ? c.league : c.mutedForeground} />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.extraTitle, { color: c.foreground }]}>Hide Pick Until Kickoff</Text>
                        <Text style={[styles.extraSub, { color: c.mutedForeground }]}>
                          Keep off chat until game lock
                        </Text>
                      </View>
                      <Switch
                        value={hidePick}
                        onValueChange={setHidePick}
                        disabled={busy}
                        trackColor={{ false: c.border, true: c.league }}
                      />
                    </View>
                  </LiquidGlass>
                )}

                {/* Payout Summary Glass Card */}
                {friendMode && other ? (
                  <ChallengeSummary terms={terms} friendName={friendName} teamAbbr={teamAbbr} otherAbbr={other.abbreviation} />
                ) : (
                  <TourTarget id="slip.summary">
                    <LiquidGlass
                      variant="tile"
                      radius={18}
                      tintColor={c.isDark ? "rgba(255, 255, 255, 0.05)" : undefined}
                      borderColor={c.isDark ? "rgba(255, 255, 255, 0.14)" : c.border}
                      contentStyle={styles.summary}
                    >
                      <View style={styles.payoutHeroRow}>
                        <View>
                          <Text style={[styles.payoutKicker, { color: c.mutedForeground }]}>POTENTIAL PAYOUT</Text>
                          <Text style={[styles.payoutSub, { color: c.positive }]}>
                            +{Math.max(0, profit).toLocaleString()} profit
                          </Text>
                        </View>
                        <RollingNumber
                          value={payout}
                          style={[styles.payoutHeroVal, { color: c.foreground }]}
                          duration={380}
                          flash={false}
                        />
                      </View>
                      <View style={[styles.summaryDivider, { backgroundColor: c.isDark ? "rgba(255,255,255,0.1)" : c.border }]} />
                      <SummaryRow label="If it loses" value={stake ? `−${stake.toLocaleString()}` : "0"} color={stake ? c.negative : undefined} />
                      <SummaryRow label={`${wallet?.label ?? "Balance"} after`} value={`${Math.max(0, available - stake).toLocaleString()} ${unit}`} />
                    </LiquidGlass>
                  </TourTarget>
                )}

                {!priced && !friendMode ? (
                  <Text style={[styles.note, { color: c.warning }]}>
                    No sportsbook line yet.{canChallenge ? " You can still challenge a friend on it." : " Check back closer to kickoff."}
                  </Text>
                ) : null}
                {tooSmall && <Text style={[styles.note, { color: c.negative }]}>Minimum stake is {MIN_STAKE} {unit}.</Text>}
                {tooBig && <Text style={[styles.note, { color: c.negative }]}>That's more than {wallet?.label ?? "this wallet"} holds.</Text>}
                {tooBig && wallet?.kind === "credits" && !tourPractice() ? <EarnCreditsButton variant="row" /> : null}
                {heavy && !tooBig && <Text style={[styles.note, { color: c.warning }]}>Over half of this wallet on one game.</Text>}
                {friendMode && quote && !quote.ok && !tooSmall ? <Text style={[styles.note, { color: c.warning }]}>{quote.reason}</Text> : null}
                {friendMode && !friendUid && friends.length > 0 ? <Text style={[styles.note, { color: c.mutedForeground }]}>Pick who you're challenging.</Text> : null}
                {friendMode && chError ? <Text accessibilityRole="alert" style={[styles.note, { color: c.negative }]}>{chError}</Text> : null}
                {!friendMode && error ? <Text accessibilityRole="alert" style={[styles.note, { color: c.negative }]}>{error}</Text> : null}
              </tourScroll.Provider>
            </ScrollView>
            <ScrollHint visible={hint.visible} />
          </View>

          {/* Split Dual-Action Footer (matching PrizeVaultModal) */}
          <View style={[styles.footer, { borderTopColor: c.isDark ? "rgba(255,255,255,0.12)" : c.border }]}>
            {blocked ? (
              <View accessibilityRole="alert" style={[styles.blocked, { backgroundColor: c.alpha(c.negative, 0.14), borderColor: c.negative }]}>
                <MaterialCommunityIcons name="alert-circle-outline" size={15} color={c.negative} />
                <Text style={[styles.blockedText, { color: c.foreground }]}>{blocked}</Text>
              </View>
            ) : null}

            <View style={styles.footerRow}>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Close"
                scaleTo={0.96}
                onPress={handleClose}
                disabled={busy}
                style={[
                  styles.secondaryBtn,
                  {
                    backgroundColor: c.isDark ? "rgba(255, 255, 255, 0.09)" : c.secondary,
                    borderColor: c.isDark ? "rgba(255, 255, 255, 0.16)" : c.border,
                  },
                ]}
              >
                <Text style={[styles.secondaryBtnText, { color: c.foreground }]}>Close</Text>
              </PressableScale>

              <TourTarget id="slip.place" style={{ flex: 1.55 }}>
                <PressableScale
                  accessibilityRole="button"
                  accessibilityLabel={primaryLabel}
                  accessibilityState={{ disabled: (!priced && !friendMode) || busy || !wallet, busy }}
                  scaleTo={0.96}
                  onPress={friendMode ? sendChallenge : handleConfirm}
                  disabled={(!priced && !friendMode) || busy || !wallet}
                  style={[
                    styles.primaryBtn,
                    {
                      backgroundColor: primaryReady ? primaryColor : c.isDark ? "rgba(255,255,255,0.14)" : c.secondary,
                      opacity: (!priced && !friendMode) || busy ? 0.55 : 1,
                    },
                  ]}
                >
                  {primaryReady && !busy ? <Shimmer intensity={0.38} every={2200} /> : null}
                  {busy ? (
                    <ActivityIndicator size="small" color={primaryFg} />
                  ) : (
                    <Text
                      style={[
                        styles.primaryBtnText,
                        { color: primaryReady ? primaryFg : c.mutedForeground },
                      ]}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.82}
                    >
                      {primaryLabel}
                    </Text>
                  )}
                </PressableScale>
              </TourTarget>
            </View>

            {!friendMode && onAddToParlay && priced && !focused && !tourPractice() && tourStake() == null ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel="Add to Parlay"
                scaleTo={0.97}
                onPress={() => {
                  if (busy) return;
                  Keyboard.dismiss();
                  buzz.tick();
                  onAddToParlay();
                }}
                disabled={busy}
                style={[
                  styles.parlayBtn,
                  {
                    backgroundColor: c.isDark ? "rgba(255, 255, 255, 0.07)" : c.secondary,
                    borderColor: c.isDark ? "rgba(255, 255, 255, 0.14)" : c.border,
                  },
                ]}
              >
                <MaterialCommunityIcons name="link-variant" size={16} color={c.primary} />
                <Text style={[styles.parlayBtnText, { color: c.foreground }]}>Add to Parlay Instead</Text>
              </PressableScale>
            ) : null}
          </View>
        </GlassModalSurface>
      </KeyboardAvoidingView>
      <TourModalLayer />
    </Modal>
  );
}

function SummaryRow({ label, value, color }: { label: string; value: string; color?: string }) {
  const c = useColors();
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, { color: c.mutedForeground }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.summaryValue, { color: color ?? c.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  card: {
    paddingTop: 14,
    paddingBottom: 16,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  metaPill: {
    flex: 1,
  },
  gameLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  lockSoonChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  lockSoonText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },
  scrollWrap: {
    flexShrink: 1,
  },
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  body: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  context: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  contextText: {
    flex: 1,
    fontSize: 12.5,
    fontFamily: "Inter_600SemiBold",
  },
  heroPick: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
  },
  heroBadges: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  marketPill: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  marketPillText: {
    fontSize: 10,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.9,
  },
  oddsBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  oddsBadgeText: {
    fontSize: 11,
    fontFamily: "Inter_800ExtraBold",
    fontVariant: ["tabular-nums"],
  },
  teamName: {
    fontSize: 20,
    lineHeight: 24,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.4,
  },
  oddsLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  label: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.9,
  },
  stakeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  availText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    fontVariant: ["tabular-nums"],
  },
  walletWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  walletBtnWrap: {
    minWidth: 110,
    flexGrow: 1,
  },
  wallet: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 3,
  },
  walletHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  walletName: {
    fontSize: 12,
    fontFamily: "Inter_700Bold",
    flexShrink: 1,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    minHeight: 58,
  },
  input: {
    flex: 1,
    alignSelf: "stretch",
    fontSize: 26,
    fontFamily: "Inter_800ExtraBold",
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.5,
  },
  quickRow: {
    flexDirection: "row",
    gap: 8,
  },
  quickBtn: {
    paddingVertical: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  quickText: {
    fontSize: 13.5,
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
  },
  extrasBox: {
    padding: 12,
    gap: 10,
  },
  extraRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  extraTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  extraSub: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  extraDivider: {
    height: StyleSheet.hairlineWidth,
  },
  summary: {
    padding: 14,
    gap: 8,
  },
  payoutHeroRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  payoutKicker: {
    fontSize: 10.5,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: 0.9,
  },
  payoutSub: {
    fontSize: 12.5,
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
    marginTop: 2,
  },
  payoutHeroVal: {
    fontSize: 26,
    fontFamily: "Inter_900Black",
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.6,
  },
  summaryDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 2,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  summaryLabel: {
    flexShrink: 1,
    fontSize: 12.5,
    fontFamily: "Inter_500Medium",
  },
  summaryValue: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    fontVariant: ["tabular-nums"],
  },
  note: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  secondaryBtn: {
    flex: 0.85,
    height: 48,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: {
    fontSize: 15,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.1,
  },
  primaryBtn: {
    height: 48,
    borderRadius: 15,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  primaryBtnText: {
    fontSize: 15,
    fontFamily: "Inter_800ExtraBold",
    letterSpacing: -0.1,
  },
  parlayBtn: {
    height: 40,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  parlayBtnText: {
    fontSize: 13.5,
    fontFamily: "Inter_700Bold",
  },
  blocked: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  blockedText: {
    flex: 1,
    fontSize: 12.5,
    fontFamily: "Inter_600SemiBold",
  },
});
