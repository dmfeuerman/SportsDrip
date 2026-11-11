import { MaterialCommunityIcons } from "@expo/vector-icons";
import { TourTarget, useTourScroll } from "@/components/tour/TourTarget";
import { tourEvent, tourPractice, tourStake, useTourState } from "@/lib/tour/store";
import TeamCrest from "@/components/TeamCrest";
import { trackEvent } from "@/lib/analytics";
import { haptic as buzz } from "@/lib/motion";
import EarnCreditsButton from "@/components/ads/EarnCreditsButton";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Pressable, Switch } from "@/components/fx/Tap";
import Animated, { ZoomIn } from "react-native-reanimated";
import PressableScale from "@/components/fx/PressableScale";
import RollingNumber from "@/components/fx/RollingNumber";
import KeyboardSheet from "@/components/KeyboardSheet";
import ScrollHint, { useScrollHint } from "@/components/ScrollHint";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import NumericInput from "@/components/NumericInput";
import { ChallengeSetup, ChallengeSummary, clampOdds } from "@/components/ChallengeComposer";
import TeamEdge from "@/components/insights/TeamEdge";
import { ActionChip, Amount, Button, SegmentedControl } from "@/components/ui";
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
  /** Server rejection, shown in the sheet so the user can fix and retry. */
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
  const hint = useScrollHint();
  const oddsFormat = useOddsFormat();
  const now = useNow(15_000);
  const [amount, setAmount] = useState("");
  // Why the last tap on Place Bet didn't go through; clears as the amount changes.
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
      // Tutorials start from an empty stake so the player types it.
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
  // One slip_stake_set per open: the first edit away from the prefilled stake.
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
  const currency = isLeague ? "league" : "credits";
  const tint = isLeague ? c.league : c.primary;
  const unit = isLeague ? "tokens" : "credits";
  const lockAlreadyUsed = isLeague && !!wallet && !!lockUsed?.[wallet.id];

  const stake = Number.parseInt(amount, 10) || 0;
  // Tutorials wait on the stake ("slip:stake" for any, "slip:stake:10" for exactly ten).
  const { tour: tourOn, step: tourStep } = useTourState();
  useEffect(() => {
    if (!visible || !tourOn) return;
    // The first-bet tutorial's exact stake is in: drop the keyboard so the
    // next steps (what you could win, Place bet) are on screen to spotlight.
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
    // Fixed quick stakes; ones the wallet can't cover (or under the minimum) are left out.
    return [10, 50, 100].filter((x) => x >= MIN_STAKE && x <= available);
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

  return (
    <KeyboardSheet visible={visible} onClose={handleClose} dismissible={!busy} style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={styles.scroll}>
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
        <View style={styles.topMetaRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to pick a team and bet type"
            onPress={handleClose}
            disabled={busy}
            hitSlop={8}
            style={({ pressed }) => [styles.backBtn, { backgroundColor: c.secondary, borderColor: c.border, opacity: busy ? 0.5 : pressed ? 0.7 : 1 }]}
          >
            <MaterialCommunityIcons name="chevron-left" size={18} color={c.foreground} />
            <Text style={[styles.backText, { color: c.foreground }]}>Back</Text>
          </Pressable>
          <Text style={[styles.gameLabel, { color: c.mutedForeground, flex: 1 }]} numberOfLines={1}>
            {gameSummary}
          </Text>
          {lockingSoon && game ? (
            <View style={[styles.lockSoonChip, { backgroundColor: c.alpha(c.live, 0.14), borderColor: c.alpha(c.live, 0.45) }]}>
              <MaterialCommunityIcons name="timer-sand" size={12} color={c.live} />
              <Text style={[styles.lockSoonText, { color: c.live }]}>
                Locks {untilKickoff(game.startsAt, now)}
              </Text>
            </View>
          ) : null}
        </View>

        {context && !friendMode && walletId === context.leagueId ? (
          <View style={[styles.context, { backgroundColor: c.leagueSoft, borderColor: c.alpha(c.league, 0.45) }]}>
            <MaterialCommunityIcons name={context.icon} size={16} color={c.league} />
            <Text style={[styles.contextText, { color: c.foreground }]} numberOfLines={2}>
              {context.text}
            </Text>
          </View>
        ) : null}

        <TourTarget id="slip.team">
        <Animated.View entering={ZoomIn.springify().damping(13).stiffness(220)} style={[styles.teamRow, { backgroundColor: c.alpha(teamColor, 0.24), borderColor: teamColor }]}>
          <TeamCrest abbr={teamAbbr} color={teamColor} size={44} sport={game?.sport} />
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={[styles.pickKicker, { color: c.foreground }]}>YOUR PICK</Text>
            <Text style={[styles.teamName, { color: c.foreground }]} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.7}>
              {pickTitle ?? `${teamName} to win`}
            </Text>
            <Text style={[styles.oddsLabel, { color: c.mutedForeground }]}>
              {priced ? `${formatOdds(odds, oddsFormat)} · market gives it ${formatPercent(chance)}` : NO_LINE}
            </Text>
          </View>
        </Animated.View>
        <View style={styles.pickChips}>
          <View style={[styles.pickChip, { backgroundColor: teamColor, borderColor: teamColor }]}>
            <Text style={styles.pickChipKey}>{market === "total" ? "SIDE" : "TEAM"}</Text>
            <Text style={styles.pickChipVal} numberOfLines={1}>
              {market === "total" ? (selection === "under" ? "Under" : "Over") : teamName}
            </Text>
          </View>
          <View style={[styles.pickChip, { backgroundColor: c.secondary, borderColor: c.border }]}>
            <Text style={[styles.pickChipKey, { color: c.mutedForeground }]}>BET TYPE</Text>
            <Text style={[styles.pickChipVal, { color: c.foreground }]} numberOfLines={1}>
              {market === "spread" ? "Spread" : market === "total" ? "Total Points" : "Moneyline (to win)"}
            </Text>
          </View>
        </View>
        </TourTarget>

        {canChallenge ? (
          <TourTarget id="slip.mode">
          <SegmentedControl<Mode>
            value={mode}
            onChange={switchMode}
            options={[
              { value: "book", label: "Bet the Book" },
              { value: "friend", label: "Challenge a Friend" },
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
          <TourTarget id="slip.edge"><TeamEdge game={game} side={side} /></TourTarget>
        ) : null}

        {!friendMode && wallets.length > 1 && (
          <TourTarget id="slip.wallets" style={{ gap: 6 }}>
            <Text style={[styles.label, { color: c.mutedForeground }]}>PAY WITH</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ gap: 8 }}
            >
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
                    style={[styles.wallet, { backgroundColor: on ? c.alpha(wTint, 0.14) : c.secondary, borderColor: on ? wTint : c.border }]}
                  >
                    <View style={styles.walletHead}>
                      <MaterialCommunityIcons name={w.kind === "league" ? "shield-star" : "lightning-bolt"} size={12} color={on ? wTint : c.mutedForeground} />
                      <Text style={[styles.walletName, { color: on ? c.foreground : c.mutedForeground }]} numberOfLines={1}>
                        {w.label}
                      </Text>
                    </View>
                    <Amount value={w.balance} currency={w.kind === "league" ? "league" : "credits"} size="sm" />
                  </Pressable>
                );
              })}
            </ScrollView>
          </TourTarget>
        )}

        <View onLayout={(e) => { inputY.current = e.nativeEvent.layout.y; }}>
        <TourTarget id="slip.stake" style={{ gap: 12 }}>
        <Pressable
          onPress={focusInput}
          accessible={false}
          style={[
            styles.inputWrap,
            { backgroundColor: c.secondary, borderColor: tooBig ? c.negative : focused ? tint : c.border },
          ]}
        >
          <MaterialCommunityIcons name={isLeague ? "shield-star" : "lightning-bolt"} size={20} color={tint} />
          <NumericInput
            ref={inputRef}
            style={[styles.input, { color: c.foreground }]}
            value={amount}
            onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ""))}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={friendMode ? "Your stake (credits)" : `Stake (${unit})`}
            placeholderTextColor={c.subtleForeground}
            keyboardType="number-pad"
            doneBar={false}
            editable={!busy}
            accessibilityLabel={`Stake amount in ${wallet?.label ?? "credits"} ${unit}`}
          />
          <ActionChip label="MAX" accessibilityLabel="Bet maximum" chevron={false} onPress={() => setAmount(String(available))} disabled={busy} />
        </Pressable>

        <View style={styles.quickRow}>
          {quick.map((q) => (
            <PressableScale
              key={q}
              accessibilityRole="button"
              style={[styles.quickBtn, { backgroundColor: stake === q ? c.alpha(tint, 0.14) : c.secondary, borderColor: stake === q ? tint : c.border }]}
              scaleTo={0.92}
              haptic="tick"
              onPress={() => setAmount(String(q))}
              disabled={busy}
            >
              <Text style={[styles.quickText, { color: c.foreground }]}>{q.toLocaleString()}</Text>
            </PressableScale>
          ))}
        </View>
        </TourTarget>
        </View>

        {!friendMode && isLeague && (
          <View style={[styles.extrasBox, { backgroundColor: c.secondary, borderColor: c.border }]}>
            <View style={styles.extraRow}>
              <MaterialCommunityIcons name="lock-check-outline" size={16} color={lockPick ? c.league : c.mutedForeground} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.extraTitle, { color: c.foreground }]}>Lock of the Week</Text>
                <Text style={[styles.extraSub, { color: c.mutedForeground }]}>
                  {lockAlreadyUsed ? "Already used this week in this league" : "One per week · counts on the Lock leaderboard"}
                </Text>
              </View>
              <Switch
                value={lockPick && !lockAlreadyUsed}
                onValueChange={setLockPick}
                disabled={lockAlreadyUsed || busy}
                trackColor={{ false: c.border, true: c.league }}
              />
            </View>
            <View style={[styles.extraDivider, { backgroundColor: c.border }]} />
            <View style={styles.extraRow}>
              <MaterialCommunityIcons name="eye-off-outline" size={16} color={hidePick ? c.league : c.mutedForeground} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.extraTitle, { color: c.foreground }]}>Hide Pick Until Kickoff</Text>
                <Text style={[styles.extraSub, { color: c.mutedForeground }]}>
                  Don't post a bet card in chat or show your side until lock
                </Text>
              </View>
              <Switch
                value={hidePick}
                onValueChange={setHidePick}
                disabled={busy}
                trackColor={{ false: c.border, true: c.league }}
              />
            </View>
          </View>
        )}

        {friendMode && other ? (
          <ChallengeSummary terms={terms} friendName={friendName} teamAbbr={teamAbbr} otherAbbr={other.abbreviation} />
        ) : (
        <TourTarget id="slip.summary">
        <View style={[styles.summary, { borderColor: c.border }]}>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: c.mutedForeground }]} numberOfLines={1}>
              Returns if it lands
            </Text>
            <RollingNumber value={payout} style={[styles.summaryStrong, { color: c.foreground }]} duration={420} flash={false} />
          </View>
          <SummaryRow label="Profit" value={`+${Math.max(0, profit).toLocaleString()}`} color={c.positive} />
          <SummaryRow label="If It Loses" value={stake ? `−${stake.toLocaleString()}` : "0"} color={stake ? c.negative : undefined} />
          <SummaryRow label={`${wallet?.label ?? "Balance"} after placing`} value={`${Math.max(0, available - stake).toLocaleString()} ${unit}`} />
        </View>
        </TourTarget>
        )}

        {!priced && !friendMode ? (
          <Text style={[styles.note, { color: c.warning }]}>
            The book hasn't posted a line on this game yet, so it can't take bets.{canChallenge ? " You can still challenge a friend on it." : " Check back closer to kickoff."}
          </Text>
        ) : null}
        {tooSmall && <Text style={[styles.note, { color: c.negative }]}>Minimum stake is {MIN_STAKE} {unit}.</Text>}
        {tooBig && <Text style={[styles.note, { color: c.negative }]}>That's more than {wallet?.label ?? "this wallet"} holds.</Text>}
        {tooBig && wallet?.kind === "credits" && !tourPractice() ? <EarnCreditsButton variant="row" /> : null}
        {heavy && !tooBig && <Text style={[styles.note, { color: c.warning }]}>That's over half of this wallet on one game.</Text>}
        {friendMode && quote && !quote.ok && !tooSmall ? <Text style={[styles.note, { color: c.warning }]}>{quote.reason}</Text> : null}
        {friendMode && !friendUid && friends.length > 0 ? <Text style={[styles.note, { color: c.mutedForeground }]}>Pick who you're challenging.</Text> : null}
        {friendMode ? (
          <Text style={[styles.note, { color: c.mutedForeground }]}>
            Your stake goes into the pot now. If {friend ? friend.displayName : "they"} don't accept before kickoff, it comes straight back. Once accepted, neither of you can pull out.
          </Text>
        ) : null}
        {friendMode && chError ? (
          <Text accessibilityRole="alert" style={[styles.note, { color: c.negative }]}>
            {chError}
          </Text>
        ) : null}
        {!friendMode && error ? (
          <Text accessibilityRole="alert" style={[styles.note, { color: c.negative }]}>
            {error}
          </Text>
        ) : null}
        </tourScroll.Provider>
      </ScrollView>
      <ScrollHint visible={hint.visible} />
      </View>

      <View style={[styles.footer, { borderTopColor: c.border }]}>
        {friendMode ? (
          <>
            <View
              accessible
              accessibilityLabel={friend ? `Challenging ${friend.displayName}, paid from credits` : "No friend picked yet"}
              style={[styles.payingWith, { backgroundColor: c.alpha(c.accent, 0.12), borderColor: c.alpha(c.accent, 0.5) }]}
            >
              <MaterialCommunityIcons name="sword-cross" size={18} color={c.accent} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.payingLabel, { color: c.mutedForeground }]}>CHALLENGING</Text>
                <Text style={[styles.payingName, { color: c.foreground }]} numberOfLines={1}>
                  {friend ? `${friend.displayName} · they get ${other?.abbreviation ?? ""}` : "Select Friend"}
                </Text>
              </View>
              <View style={[styles.kindPill, { backgroundColor: c.alpha(c.accent, 0.2) }]}>
                <Text style={[styles.kindText, { color: c.accent }]}>{format === "pot" ? "POT" : `${chOdds.toFixed(2)}X`}</Text>
              </View>
            </View>
            {blocked ? (
              <View accessibilityRole="alert" style={[styles.blocked, { backgroundColor: c.alpha(c.negative, 0.12), borderColor: c.negative }]}>
                <MaterialCommunityIcons name="alert-circle-outline" size={16} color={c.negative} />
                <Text style={[styles.blockedText, { color: c.foreground }]}>{blocked}</Text>
              </View>
            ) : null}
            <Button
              label={terms ? `Send challenge · ${terms.creatorStake.toLocaleString()} credits` : "Send challenge"}
              icon="sword-cross"
              size="lg"
              onPress={sendChallenge}
              disabled={busy}
              loading={sending}
              haptic={false}
              shimmer={canSend}
            />
          </>
        ) : (
        <>
        {wallet && !focused ? (
          <View
            accessible
            accessibilityLabel={`Betting with ${wallet.label}, ${isLeague ? "league tokens" : "credits"}`}
            style={[styles.payingWith, { backgroundColor: c.alpha(tint, 0.12), borderColor: c.alpha(tint, 0.5) }]}
          >
            <MaterialCommunityIcons name={isLeague ? "shield-star" : "lightning-bolt"} size={18} color={tint} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.payingLabel, { color: c.mutedForeground }]}>BETTING WITH</Text>
              <Text style={[styles.payingName, { color: c.foreground }]} numberOfLines={1}>
                {wallet.label}
              </Text>
            </View>
            <View style={[styles.kindPill, { backgroundColor: c.alpha(tint, 0.2) }]}>
              <Text style={[styles.kindText, { color: tint }]}>{isLeague ? "LEAGUE TOKENS" : "CREDITS"}</Text>
            </View>
          </View>
        ) : null}
        {blocked ? (
          <View accessibilityRole="alert" style={[styles.blocked, { backgroundColor: c.alpha(c.negative, 0.12), borderColor: c.negative }]}>
            <MaterialCommunityIcons name="alert-circle-outline" size={16} color={c.negative} />
            <Text style={[styles.blockedText, { color: c.foreground }]}>{blocked}</Text>
          </View>
        ) : null}
        <TourTarget id="slip.place">
        <Button
          label={!priced ? NO_LINE : tourPractice() ? "Place test bet" : stake >= MIN_STAKE ? `Place bet · ${stake.toLocaleString()} ${unit}` : "Place bet"}
          size="lg"
          onPress={handleConfirm}
          disabled={!priced || submitting || !wallet}
          loading={submitting}
          variant={currency === "league" ? "league" : "primary"}
          haptic={false}
          shimmer={canBet}
          accessibilityHint={wallet ? `Stakes from ${wallet.label}` : undefined}
        />
        </TourTarget>
        {onAddToParlay && priced && !focused && !tourPractice() && tourStake() == null ? (
          <Button
            label="Add to Parlay"
            icon="link-variant"
            size="md"
            variant="secondary"
            onPress={() => {
              if (busy) return;
              Keyboard.dismiss();
              buzz.tick();
              onAddToParlay();
            }}
            disabled={busy}
            haptic={false}
            accessibilityHint="Puts this pick on a parlay slip instead of betting it alone"
          />
        ) : null}
        </>
        )}
      </View>
    </KeyboardSheet>
  );
}

function SummaryRow({ label, value, color, strong }: { label: string; value: string; color?: string; strong?: boolean }) {
  const c = useColors();
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, { color: c.mutedForeground }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[strong ? styles.summaryStrong : styles.summaryValue, { color: color ?? c.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  blocked: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9 },
  blockedText: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  sheet: { gap: 0 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { gap: 12, paddingBottom: 12 },
  footer: { gap: 10, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  topMetaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  gameLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  lockSoonChip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  lockSoonText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  context: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  contextText: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  teamRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 16, borderWidth: 2, overflow: "hidden" },
  pickChips: { flexDirection: "row", gap: 8 },
  pickChip: { flex: 1, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, gap: 1 },
  pickChipKey: { fontSize: 10, letterSpacing: 1, fontFamily: "Inter_700Bold", color: "rgba(255,255,255,0.85)" },
  pickChipVal: { fontSize: 14, fontFamily: "Inter_800ExtraBold", color: "#fff" },
  pickKicker: { fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 1.2, opacity: 0.8 },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 2, borderWidth: 1, borderRadius: 999, paddingLeft: 6, paddingRight: 12, paddingVertical: 6 },
  backText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  teamCircle: { width: 46, height: 46, borderRadius: 23, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  teamAbbr: { fontSize: 13, fontFamily: "Inter_700Bold" },
  teamName: { fontSize: 20, lineHeight: 24, fontFamily: "Inter_700Bold" },
  oddsLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  label: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  wallet: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, gap: 2, minWidth: 110, maxWidth: 180 },
  walletHead: { flexDirection: "row", alignItems: "center", gap: 4 },
  walletName: { fontSize: 12, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  inputWrap: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, minHeight: 56 },
  input: { flex: 1, alignSelf: "stretch", fontSize: 22, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  maxBtn: { fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.6 },
  quickRow: { flexDirection: "row", gap: 8 },
  quickBtn: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 9, alignItems: "center" },
  quickText: { fontSize: 13, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  extrasBox: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 8 },
  extraRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  extraTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  extraSub: { fontSize: 11, fontFamily: "Inter_400Regular" },
  extraDivider: { height: StyleSheet.hairlineWidth },
  summary: { gap: 6, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  summaryLabel: { flexShrink: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  summaryValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  summaryStrong: { fontSize: 15, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  note: { fontSize: 12, fontFamily: "Inter_500Medium" },
  payingWith: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  payingLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  payingName: { fontSize: 14, fontFamily: "Inter_700Bold" },
  kindPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  kindText: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.6 },
});
