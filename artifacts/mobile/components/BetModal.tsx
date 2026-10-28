import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { ZoomIn } from "react-native-reanimated";
import PressableScale from "@/components/fx/PressableScale";
import RollingNumber from "@/components/fx/RollingNumber";
import KeyboardSheet from "@/components/KeyboardSheet";
import NumericInput from "@/components/NumericInput";
import TeamEdge from "@/components/insights/TeamEdge";
import { ActionChip, Amount, Button } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { formatPercent, impliedProbability } from "@/lib/odds";
import type { Game, Side } from "@/types/game";

export interface BetWallet {
  /** "credits" or a league id. */
  id: string;
  label: string;
  balance: number;
  kind: "credits" | "league";
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onConfirm: (amount: number, walletId: string) => void | Promise<void>;
  teamName: string;
  teamAbbr: string;
  teamColor: string;
  odds: number;
  gameSummary: string;
  /** Where the stake can come from. Credits first, then eligible leagues. */
  wallets: BetWallet[];
  defaultWallet?: string;
  /** True while the callable is in flight. */
  submitting?: boolean;
  /** Server rejection, shown in the sheet so the user can fix and retry. */
  error?: string | null;
  /** The fixture and pick, for the pre-commit insights panel. */
  game?: Game;
  side?: Side;
}

const MIN_STAKE = 10;

function pickWallet(wallets: BetWallet[], preferred?: string): string {
  return preferred && wallets.some((w) => w.id === preferred) ? preferred : wallets[0]?.id ?? "credits";
}

/**
 * The bet slip.
 *
 *  - a wallet picker: credits, or any league you're in that allows this sport
 *    and is still running when the game starts.
 *  - quick stakes as a share of the chosen wallet, because 50/100/250/500 is
 *    meaningless against a 25,000-token league stack
 *  - everything that matters before committing: implied chance, return,
 *    profit, and the balance it leaves — plus a plain note when the stake is
 *    more than half the wallet. No urgency, no nudging.
 *  - the server's rejection stays in the sheet instead of closing it.
 *
 * Keyboard: the sheet body scrolls and the "Betting with" strip + Place bet
 * button are a fixed footer, so KeyboardSheet's avoiding view shrinks the body
 * and the action stays on screen above the keyboard.
 *
 * Wallet switching: every tap target in the sheet persists taps while the
 * keyboard is up (the old horizontal picker swallowed the first tap to dismiss
 * the keyboard), the stake is cleared because a number typed against one
 * wallet means nothing in another, and focus is handed back to the same input
 * instance so typing simply continues.
 */
export default function BetModal({
  visible,
  onClose,
  onConfirm,
  teamName,
  teamAbbr,
  teamColor,
  odds,
  gameSummary,
  wallets,
  defaultWallet,
  submitting = false,
  error,
  game,
  side,
}: Props) {
  const c = useColors();
  const [amount, setAmount] = useState("");
  const [walletId, setWalletId] = useState(() => pickWallet(wallets, defaultWallet));
  const [focused, setFocused] = useState(false);

  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const inputY = useRef(0);

  useEffect(() => {
    if (visible) {
      setAmount("");
      setWalletId(pickWallet(wallets, defaultWallet));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, defaultWallet]);

  // The wallet list is rebuilt from live league snapshots; if the selected one
  // drops out (league ended, membership changed) fall back instead of leaving
  // the slip pointing at a wallet that no longer renders.
  useEffect(() => {
    if (!wallets.some((w) => w.id === walletId)) {
      setWalletId(pickWallet(wallets));
      setAmount("");
    }
  }, [wallets, walletId]);

  const revealInput = useCallback(() => {
    scrollRef.current?.scrollTo({ y: Math.max(0, inputY.current - 12), animated: true });
  }, []);

  // Once the keyboard has finished resizing the sheet, bring the stake box
  // back into view; the Place bet footer is already pinned above the keyboard.
  useEffect(() => {
    if (!visible) return;
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      if (inputRef.current?.isFocused()) revealInput();
    });
    return () => sub.remove();
  }, [visible, revealInput]);

  const wallet = wallets.find((w) => w.id === walletId) ?? wallets[0];
  const available = wallet?.balance ?? 0;
  const isLeague = wallet?.kind === "league";
  const currency = isLeague ? "league" : "credits";
  const tint = isLeague ? c.league : c.primary;
  const unit = isLeague ? "tokens" : "credits";

  const stake = Number.parseInt(amount, 10) || 0;
  const payout = Math.round(stake * odds);
  const profit = payout - stake;
  const chance = impliedProbability(odds);

  const tooSmall = stake > 0 && stake < MIN_STAKE;
  const tooBig = stake > available;
  const canBet = stake >= MIN_STAKE && !tooBig && !submitting && !!wallet;
  const heavy = stake > 0 && !tooBig && stake > available * 0.5;

  const quick = useMemo(() => {
    const picks = [0.1, 0.25, 0.5].map((p) => Math.max(MIN_STAKE, Math.floor((available * p) / 10) * 10));
    return [...new Set(picks)].filter((x) => x <= available);
  }, [available]);

  function focusInput() {
    if (submitting) return;
    const input = inputRef.current;
    if (!input) return;
    if (input.isFocused()) revealInput();
    else input.focus();
  }

  function selectWallet(id: string) {
    if (id === walletId || submitting) return;
    Haptics.selectionAsync().catch(() => {});
    const keepTyping = inputRef.current?.isFocused() ?? false;
    setWalletId(id);
    setAmount("");
    // Re-assert focus after the re-render so the same input keeps the keyboard.
    if (keepTyping) requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function handleConfirm() {
    if (!canBet || !wallet) return;
    Keyboard.dismiss();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    await onConfirm(stake, wallet.id);
  }

  function handleClose() {
    if (submitting) return;
    Keyboard.dismiss();
    onClose();
  }

  return (
    <KeyboardSheet visible={visible} onClose={handleClose} dismissible={!submitting} style={styles.sheet}>
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="none"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.gameLabel, { color: c.mutedForeground }]}>{gameSummary}</Text>

        {/* The pick springs onto the slip. */}
        <Animated.View entering={ZoomIn.springify().damping(13).stiffness(220)} style={[styles.teamRow, { backgroundColor: c.alpha(teamColor, 0.14), borderColor: c.alpha(teamColor, 0.45) }]}>
          <View style={[styles.teamCircle, { backgroundColor: c.alpha(teamColor, 0.22), borderColor: teamColor }]}>
            <Text style={[styles.teamAbbr, { color: c.foreground }]}>{teamAbbr}</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[styles.teamName, { color: c.foreground }]} numberOfLines={1}>
              {teamName} to win
            </Text>
            <Text style={[styles.oddsLabel, { color: c.mutedForeground }]}>
              {odds.toFixed(2)}x · market gives it {formatPercent(chance)}
            </Text>
          </View>
        </Animated.View>

        {game && side ? <TeamEdge game={game} side={side} /> : null}

        {wallets.length > 1 && (
          <View style={{ gap: 6 }}>
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
          </View>
        )}

        {/* The whole box is the tap target, not just the text glyphs inside it. */}
        <Pressable
          onPress={focusInput}
          onLayout={(e) => {
            inputY.current = e.nativeEvent.layout.y;
          }}
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
            placeholder={`Stake (${unit})`}
            placeholderTextColor={c.subtleForeground}
            keyboardType="number-pad"
            editable={!submitting}
            accessibilityLabel={`Stake amount in ${wallet?.label ?? "credits"} ${unit}`}
          />
          <ActionChip label="MAX" accessibilityLabel="Bet maximum" chevron={false} onPress={() => setAmount(String(available))} disabled={submitting} />
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
              disabled={submitting}
            >
              <Text style={[styles.quickText, { color: c.foreground }]}>{q.toLocaleString()}</Text>
            </PressableScale>
          ))}
        </View>

        <View style={[styles.summary, { borderColor: c.border }]}>
          <View style={styles.summaryRow}>
            <Text style={[styles.summaryLabel, { color: c.mutedForeground }]} numberOfLines={1}>
              Returns if it lands
            </Text>
            <RollingNumber value={payout} style={[styles.summaryStrong, { color: c.foreground }]} duration={420} flash={false} />
          </View>
          <SummaryRow label="Profit" value={`+${Math.max(0, profit).toLocaleString()}`} color={c.positive} />
          <SummaryRow label="If it loses" value={stake ? `−${stake.toLocaleString()}` : "0"} color={stake ? c.negative : undefined} />
          <SummaryRow label={`${wallet?.label ?? "Balance"} after placing`} value={`${Math.max(0, available - stake).toLocaleString()} ${unit}`} />
        </View>

        {tooSmall && <Text style={[styles.note, { color: c.mutedForeground }]}>Minimum stake is {MIN_STAKE}.</Text>}
        {tooBig && <Text style={[styles.note, { color: c.negative }]}>That's more than {wallet?.label ?? "this wallet"} holds.</Text>}
        {heavy && !tooBig && <Text style={[styles.note, { color: c.warning }]}>That's over half of this wallet on one game.</Text>}
        {error ? (
          <Text accessibilityRole="alert" style={[styles.note, { color: c.negative }]}>
            {error}
          </Text>
        ) : null}
      </ScrollView>

      {/* Pinned footer: always visible, keyboard up or down. */}
      <View style={[styles.footer, { borderTopColor: c.border }]}>
        {wallet ? (
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
        <Button
          label={stake >= MIN_STAKE ? `Place bet · ${stake.toLocaleString()} ${unit}` : "Place bet"}
          size="lg"
          onPress={handleConfirm}
          disabled={!canBet}
          loading={submitting}
          variant={currency === "league" ? "league" : "primary"}
          haptic={false}
          shimmer={canBet}
          accessibilityHint={wallet ? `Stakes from ${wallet.label}` : undefined}
        />
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
  sheet: { gap: 0 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { gap: 12, paddingBottom: 12 },
  footer: { gap: 10, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  gameLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  teamRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, borderWidth: 1 },
  teamCircle: { width: 46, height: 46, borderRadius: 23, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  teamAbbr: { fontSize: 13, fontFamily: "Inter_700Bold" },
  teamName: { fontSize: 16, fontFamily: "Inter_700Bold" },
  oddsLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  label: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  wallet: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, gap: 2, minWidth: 110, maxWidth: 180 },
  walletHead: { flexDirection: "row", alignItems: "center", gap: 4 },
  walletName: { fontSize: 12, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  inputWrap: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14, minHeight: 56 },
  input: { flex: 1, alignSelf: "stretch", fontSize: 22, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  maxBtn: { fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.6 },
  quickRow: { flexDirection: "row", gap: 8 },
  quickBtn: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 9, alignItems: "center" },
  quickText: { fontSize: 13, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  summary: { gap: 6, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  summaryLabel: { flexShrink: 1, fontSize: 13, fontFamily: "Inter_400Regular" },
  summaryValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  summaryStrong: { fontSize: 15, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  note: { fontSize: 12, fontFamily: "Inter_500Medium" },
  payingWith: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  payingLabel: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  payingName: { fontSize: 14, fontFamily: "Inter_700Bold" },
  kindPill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  kindText: { fontSize: 9, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.6 },
});
