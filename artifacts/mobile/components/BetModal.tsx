import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Amount, Button } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { formatPercent, impliedProbability } from "@/lib/odds";

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
}

const MIN_STAKE = 10;

/**
 * The bet slip.
 *
 * What it adds over the old sheet:
 *  - a wallet picker: credits, or any league you're in that allows this sport
 *    and is still running when the game starts. League betting existed in the
 *    data model but had no way in from the UI at all.
 *  - quick stakes as a share of the chosen wallet, because 50/100/250/500 is
 *    meaningless against a 25,000-token league stack
 *  - everything that matters before committing: implied chance, return,
 *    profit, and the balance it leaves — plus a plain note when the stake is
 *    more than half the wallet. No urgency, no nudging.
 *  - the server's rejection stays in the sheet instead of closing it.
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
}: Props) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [amount, setAmount] = useState("");
  const [walletId, setWalletId] = useState(defaultWallet ?? wallets[0]?.id ?? "credits");

  useEffect(() => {
    if (visible) {
      setAmount("");
      setWalletId(defaultWallet && wallets.some((w) => w.id === defaultWallet) ? defaultWallet : wallets[0]?.id ?? "credits");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, defaultWallet]);

  const wallet = wallets.find((w) => w.id === walletId) ?? wallets[0];
  const available = wallet?.balance ?? 0;
  const currency = wallet?.kind === "league" ? "league" : "credits";

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

  async function handleConfirm() {
    if (!canBet || !wallet) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    await onConfirm(stake, wallet.id);
  }

  function handleClose() {
    if (submitting) return;
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <Pressable style={[styles.overlay, { backgroundColor: c.overlay }]} onPress={handleClose} accessibilityLabel="Close bet slip" />
      <View style={[styles.sheet, { backgroundColor: c.elevated, borderColor: c.border, paddingBottom: insets.bottom + 18 }]}>
        <View style={[styles.handle, { backgroundColor: c.border }]} />
        <Text style={[styles.gameLabel, { color: c.mutedForeground }]}>{gameSummary}</Text>

        <View style={[styles.teamRow, { backgroundColor: c.alpha(teamColor, 0.14), borderColor: c.alpha(teamColor, 0.45) }]}>
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
        </View>

        {wallets.length > 1 && (
          <View style={{ gap: 6 }}>
            <Text style={[styles.label, { color: c.mutedForeground }]}>PAY WITH</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {wallets.map((w) => {
                const on = w.id === walletId;
                const tint = w.kind === "league" ? c.league : c.primary;
                return (
                  <Pressable
                    key={w.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${w.label}, ${w.balance.toLocaleString()} available`}
                    disabled={submitting}
                    onPress={() => {
                      Haptics.selectionAsync().catch(() => {});
                      setWalletId(w.id);
                    }}
                    style={[
                      styles.wallet,
                      { backgroundColor: on ? c.alpha(tint, 0.14) : c.secondary, borderColor: on ? tint : c.border },
                    ]}
                  >
                    <Text style={[styles.walletName, { color: on ? c.foreground : c.mutedForeground }]} numberOfLines={1}>
                      {w.label}
                    </Text>
                    <Amount value={w.balance} currency={w.kind === "league" ? "league" : "credits"} size="sm" />
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        <View style={[styles.inputWrap, { backgroundColor: c.secondary, borderColor: tooBig ? c.negative : c.border }]}>
          <MaterialCommunityIcons name={currency === "league" ? "shield-star" : "lightning-bolt"} size={20} color={currency === "league" ? c.league : c.primary} />
          <TextInput
            style={[styles.input, { color: c.foreground }]}
            value={amount}
            onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ""))}
            placeholder="Stake"
            placeholderTextColor={c.subtleForeground}
            keyboardType="number-pad"
            editable={!submitting}
            accessibilityLabel="Stake amount"
          />
          <Pressable accessibilityRole="button" onPress={() => setAmount(String(available))} disabled={submitting} hitSlop={8}>
            <Text style={[styles.maxBtn, { color: c.accent }]}>MAX</Text>
          </Pressable>
        </View>

        <View style={styles.quickRow}>
          {quick.map((q) => (
            <Pressable
              key={q}
              accessibilityRole="button"
              style={[styles.quickBtn, { backgroundColor: c.secondary, borderColor: stake === q ? c.foreground : c.border }]}
              onPress={() => setAmount(String(q))}
              disabled={submitting}
            >
              <Text style={[styles.quickText, { color: c.foreground }]}>{q.toLocaleString()}</Text>
            </Pressable>
          ))}
        </View>

        <View style={[styles.summary, { borderColor: c.border }]}>
          <SummaryRow label="Returns if it lands" value={payout.toLocaleString()} strong />
          <SummaryRow label="Profit" value={`+${Math.max(0, profit).toLocaleString()}`} color={c.positive} />
          <SummaryRow label="If it loses" value={stake ? `−${stake.toLocaleString()}` : "0"} color={stake ? c.negative : undefined} />
          <SummaryRow label="Balance after placing" value={Math.max(0, available - stake).toLocaleString()} />
        </View>

        {tooSmall && <Text style={[styles.note, { color: c.mutedForeground }]}>Minimum stake is {MIN_STAKE}.</Text>}
        {tooBig && <Text style={[styles.note, { color: c.negative }]}>That's more than this wallet holds.</Text>}
        {heavy && !tooBig && (
          <Text style={[styles.note, { color: c.warning }]}>That's over half of this wallet on one game.</Text>
        )}
        {error ? (
          <Text accessibilityRole="alert" style={[styles.note, { color: c.negative }]}>
            {error}
          </Text>
        ) : null}

        <Button
          label={stake >= MIN_STAKE ? `Place bet · ${stake.toLocaleString()}` : "Place bet"}
          size="lg"
          onPress={handleConfirm}
          disabled={!canBet}
          loading={submitting}
          variant={currency === "league" ? "league" : "primary"}
          haptic={false}
        />
      </View>
    </Modal>
  );
}

function SummaryRow({ label, value, color, strong }: { label: string; value: string; color?: string; strong?: boolean }) {
  const c = useColors();
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, { color: c.mutedForeground }]}>{label}</Text>
      <Text style={[strong ? styles.summaryStrong : styles.summaryValue, { color: color ?? c.foreground }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1 },
  sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, padding: 20, paddingTop: 12, gap: 12 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: 4 },
  gameLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  teamRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, borderWidth: 1 },
  teamCircle: { width: 46, height: 46, borderRadius: 23, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  teamAbbr: { fontSize: 13, fontFamily: "Inter_700Bold" },
  teamName: { fontSize: 16, fontFamily: "Inter_700Bold" },
  oddsLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  label: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  wallet: { borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, gap: 2, minWidth: 110, maxWidth: 180 },
  walletName: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  inputWrap: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 },
  input: { flex: 1, fontSize: 22, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  maxBtn: { fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.6 },
  quickRow: { flexDirection: "row", gap: 8 },
  quickBtn: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 9, alignItems: "center" },
  quickText: { fontSize: 13, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  summary: { gap: 6, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between" },
  summaryLabel: { fontSize: 13, fontFamily: "Inter_400Regular" },
  summaryValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", fontVariant: ["tabular-nums"] },
  summaryStrong: { fontSize: 15, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  note: { fontSize: 12, fontFamily: "Inter_500Medium" },
});
