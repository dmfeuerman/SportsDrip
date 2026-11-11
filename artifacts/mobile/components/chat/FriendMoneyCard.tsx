import { MaterialCommunityIcons } from "@expo/vector-icons";
import { doc, onSnapshot } from "firebase/firestore";
import React, { useEffect, useMemo, useState } from "react";
import { Modal, StyleSheet, Text, TextInput, View } from "react-native";
import ItemIcon from "@/components/avatar/ItemIcon";
import ReactionRow from "@/components/chat/ReactionRow";
import type { ReplyQuote } from "@/components/chat/ReplyThread";
import { Pressable } from "@/components/fx/Tap";
import NumericInput from "@/components/NumericInput";
import { Amount, Button, CloseButton, Pill, SegmentedControl } from "@/components/ui";
import { PEER_LOAN_MAX_PCT, type League, type LeagueLoan } from "@/constants/leagueTypes";
import { useApp } from "@/context/AppContext";
import type { DirectMessage } from "@/context/ChatContext";
import { useLeague } from "@/context/LeagueContext";
import { useToast } from "@/context/ToastContext";
import { useCatalog } from "@/hooks/useCatalog";
import { useColors } from "@/hooks/useColors";
import * as api from "@/lib/api";
import { DEMO } from "@/lib/demo";
import { getDb } from "@/lib/firebase";
import { flatInterest, loanSnapshot } from "@/lib/loanMath";
import { haptic } from "@/lib/motion";

const QUICK_RATES = [0, 5, 10, 15, 20] as const;
const LEAGUE_QUICK_RATES = [3, 5, 8, 10, 15] as const;

/** Demo / local optimistic fallback store for friendLoans when testing or before snapshots arrive. */
const localFriendLoans = new Map<string, api.FriendLoan>();
const localFriendListeners = new Set<() => void>();
function setLocalFriendLoan(loan: api.FriendLoan) {
  localFriendLoans.set(loan.id, loan);
  localFriendListeners.forEach((fn) => fn());
}

/** Live state of a friend loan, for the card's buttons. */
function useFriendLoan(m: DirectMessage) {
  const loanId = m.loanId;
  const fallback = useMemo<api.FriendLoan | null>(() => {
    if (!loanId) return null;
    const existing = localFriendLoans.get(loanId);
    if (existing) return existing;
    const amt = m.amount ?? 500;
    const pct = 10;
    return {
      id: loanId,
      lenderUid: m.recipientUid,
      borrowerUid: m.senderUid,
      lenderName: m.recipientName,
      borrowerName: m.senderName,
      amount: amt,
      interestPct: pct,
      owed: api.loanOwed(amt, pct),
      repaid: 0,
      note: null,
      status: "requested",
      createdBy: m.senderUid,
      lastTurnBy: m.senderUid,
      lastTurnName: m.senderName,
      createdAt: m.at,
    };
  }, [loanId, m.amount, m.recipientUid, m.senderUid, m.recipientName, m.senderName, m.at]);

  const [serverLoan, setServerLoan] = useState<api.FriendLoan | null>(null);
  const [, bump] = useState(0);

  useEffect(() => {
    const l = () => bump((x) => x + 1);
    localFriendListeners.add(l);
    return () => {
      localFriendListeners.delete(l);
    };
  }, []);

  useEffect(() => {
    const db = getDb();
    if (!db || !loanId || DEMO) return;
    return onSnapshot(
      doc(db, "friendLoans", loanId),
      (s) => {
        if (s.exists()) {
          const data = { ...(s.data() as api.FriendLoan), id: s.id };
          localFriendLoans.delete(loanId);
          setServerLoan(data);
        }
      },
      () => {}
    );
  }, [loanId]);

  return (loanId ? localFriendLoans.get(loanId) : null) ?? serverLoan ?? fallback;
}

/**
 * Popup Modal Window for larger loan updates & negotiations (editing principal
 * amount, custom interest rate %, and note/terms, or creating a new loan in chat).
 */
export function LoanNegotiateModal({
  visible,
  mode,
  title,
  subtitle,
  currency = "league",
  currencyLabel,
  maxAmount,
  minAmount = 10,
  initialAmount,
  initialRate,
  initialNote = "",
  counterpartyName,
  isBorrower = true,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  mode: "counter" | "edit" | "create";
  title: string;
  subtitle?: string;
  currency?: "credits" | "league";
  currencyLabel?: string;
  maxAmount: number;
  minAmount?: number;
  initialAmount: number;
  initialRate: number;
  initialNote?: string | null;
  counterpartyName?: string;
  isBorrower?: boolean;
  onClose: () => void;
  onSubmit: (values: { amount: number; rate: number; note: string; direction?: "request" | "offer" }) => Promise<void | string | null>;
}) {
  const c = useColors();
  const [amountStr, setAmountStr] = useState(String(initialAmount || ""));
  const [rateStr, setRateStr] = useState(String(initialRate ?? 10));
  const [note, setNote] = useState(initialNote ?? "");
  const [direction, setDirection] = useState<"request" | "offer">(isBorrower ? "request" : "offer");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setAmountStr(initialAmount > 0 ? String(initialAmount) : "");
    setRateStr(String(initialRate ?? 10));
    setNote(initialNote ?? "");
    setDirection(isBorrower ? "request" : "offer");
    setErr(null);
  }, [visible, initialAmount, initialRate, initialNote, isBorrower]);

  if (!visible) return null;

  const amt = Number.parseInt(amountStr, 10) || 0;
  const rate = Number.parseFloat(rateStr) || 0;
  const minRate = currency === "league" ? 0.5 : 0;
  const validAmt = amt >= minAmount && amt <= maxAmount;
  const validRate = rate >= minRate && rate <= 50;
  const fee = flatInterest(amt, rate);
  const totalRepay = amt + fee;
  const presets = currency === "league" ? LEAGUE_QUICK_RATES : QUICK_RATES;

  const handleSave = async () => {
    if (!validAmt) {
      setErr(`Enter an amount between ${minAmount.toLocaleString()} and ${maxAmount.toLocaleString()}.`);
      return;
    }
    if (!validRate) {
      setErr(`Interest rate must be between ${minRate}% and 50%.`);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await onSubmit({ amount: amt, rate: Math.round(rate * 10) / 10, note: note.trim(), direction });
      if (typeof res === "string" && res) {
        setErr(res);
        return;
      }
      onClose();
    } catch (e) {
      setErr(api.friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={[styles.modalScrim, { backgroundColor: c.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Dismiss loan editor" />
        <View style={[styles.modalCard, { backgroundColor: c.elevated, borderColor: c.border }]}>
          <View style={styles.modalHeader}>
            <View style={[styles.modalIconWrap, { backgroundColor: currency === "league" ? c.leagueSoft : c.alpha(c.primary, 0.15) }]}>
              <MaterialCommunityIcons
                name="handshake-outline"
                size={20}
                color={currency === "league" ? c.league : c.primary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.modalTitle, { color: c.foreground }]}>{title}</Text>
              <Text style={[styles.modalSub, { color: c.mutedForeground }]}>
                {subtitle ??
                  (mode === "counter"
                    ? `Propose new terms${counterpartyName ? ` to ${counterpartyName}` : ""}`
                    : mode === "edit"
                      ? "Update principal, flat interest rate, or note"
                      : `Set loan amount (${currencyLabel ?? (currency === "league" ? "tokens" : "credits")}), flat interest rate, and note`)}
              </Text>
            </View>
            <CloseButton onPress={onClose} />
          </View>

          {mode === "create" && currency === "credits" && counterpartyName ? (
            <SegmentedControl
              value={direction}
              onChange={setDirection}
              options={[
                { value: "request", label: `Borrow from ${counterpartyName}` },
                { value: "offer", label: `Lend to ${counterpartyName}` },
              ]}
            />
          ) : null}

          <View style={{ gap: 6 }}>
            <View style={styles.fieldHeaderRow}>
              <Text style={[styles.fieldLabel, { color: c.subtleForeground }]}>PRINCIPAL AMOUNT</Text>
              <Text style={[styles.fieldHint, { color: c.mutedForeground }]}>
                Max {maxAmount.toLocaleString()} {currency === "league" ? "tokens" : "credits"}
              </Text>
            </View>
            <View
              style={[
                styles.inputBox,
                {
                  backgroundColor: c.secondary,
                  borderColor: amt > 0 && !validAmt ? c.negative : c.border,
                },
              ]}
            >
              <MaterialCommunityIcons
                name={currency === "league" ? "shield-star" : "lightning-bolt"}
                size={18}
                color={currency === "league" ? c.league : c.primary}
              />
              <NumericInput
                style={[styles.inputBoxText, { color: c.foreground }]}
                value={amountStr}
                onChangeText={(t) => setAmountStr(t.replace(/[^0-9]/g, ""))}
                keyboardType="number-pad"
                placeholder={`${minAmount}–${maxAmount.toLocaleString()}`}
                placeholderTextColor={c.subtleForeground}
                accessibilityLabel="Loan principal amount"
              />
            </View>
          </View>

          <View style={{ gap: 6 }}>
            <View style={styles.fieldHeaderRow}>
              <Text style={[styles.fieldLabel, { color: c.subtleForeground }]}>FLAT INTEREST RATE (%)</Text>
              <Text style={[styles.fieldHint, { color: c.mutedForeground }]}>One-time flat fee</Text>
            </View>
            <View style={styles.presetRow}>
              {presets.map((r) => {
                const selected = Math.abs(rate - r) < 0.01 && rateStr !== "";
                return (
                  <Pressable
                    key={r}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      haptic.tick();
                      setRateStr(String(r));
                    }}
                    style={[
                      styles.presetChip,
                      {
                        backgroundColor: selected ? (currency === "league" ? c.leagueSoft : c.alpha(c.primary, 0.18)) : c.secondary,
                        borderColor: selected ? (currency === "league" ? c.league : c.primary) : c.border,
                      },
                    ]}
                  >
                    <Text style={[styles.presetChipText, { color: c.foreground }]}>{r}%</Text>
                  </Pressable>
                );
              })}
            </View>
            <View
              style={[
                styles.inputBox,
                {
                  backgroundColor: c.secondary,
                  borderColor: rateStr !== "" && !validRate ? c.negative : c.border,
                },
              ]}
            >
              <MaterialCommunityIcons name="percent-outline" size={18} color={c.mutedForeground} />
              <NumericInput
                style={[styles.inputBoxText, { color: c.foreground }]}
                value={rateStr}
                onChangeText={setRateStr}
                keyboardType="decimal-pad"
                placeholder={`Custom rate (${minRate}–50%)`}
                placeholderTextColor={c.subtleForeground}
                accessibilityLabel="Custom interest rate percent"
              />
            </View>
          </View>

          <View style={{ gap: 6 }}>
            <Text style={[styles.fieldLabel, { color: c.subtleForeground }]}>NOTE / TERMS (OPTIONAL)</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              maxLength={80}
              placeholder="Add context or repayment note…"
              placeholderTextColor={c.subtleForeground}
              style={[styles.noteInput, { backgroundColor: c.secondary, borderColor: c.border, color: c.foreground }]}
            />
          </View>

          {amt > 0 ? (
            <View style={[styles.summaryBox, { backgroundColor: c.card, borderColor: c.border }]}>
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: c.mutedForeground }]}>Principal</Text>
                <Amount value={amt} currency={currency} size="sm" />
              </View>
              <View style={styles.summaryRow}>
                <Text style={[styles.summaryLabel, { color: c.mutedForeground }]}>Flat Interest ({rate}%)</Text>
                <Amount value={fee} currency={currency} size="sm" signed tone="positive" />
              </View>
              <View style={[styles.summaryRow, styles.summaryTotalRow, { borderTopColor: c.border }]}>
                <Text style={[styles.summaryTotalLabel, { color: c.foreground }]}>Total Repayment</Text>
                <Amount value={totalRepay} currency={currency} size="md" />
              </View>
            </View>
          ) : null}

          {err ? <Text style={[styles.errText, { color: c.negative }]}>{err}</Text> : null}

          <View style={styles.modalActions}>
            <Button label="Cancel" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
            <Button
              label={
                mode === "counter"
                  ? "Send Counter"
                  : mode === "edit"
                    ? "Save Update"
                    : direction === "offer"
                      ? "Offer Loan"
                      : "Send Request"
              }
              variant={currency === "league" ? "league" : "primary"}
              icon="send"
              loading={busy}
              disabled={!validAmt || !validRate}
              onPress={handleSave}
              style={{ flex: 1.4 }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Gift, credits and loan cards inside a DM bubble. */
export default function FriendMoneyCard({
  m,
  myUid,
  onReplyLoan,
}: {
  m: DirectMessage;
  myUid: string;
  onReplyLoan?: (quote: ReplyQuote) => void;
}) {
  const c = useColors();
  const { byId } = useCatalog();
  if (m.kind === "gift") {
    const item = m.itemId ? byId.get(m.itemId) : undefined;
    return (
      <View style={[styles.card, { backgroundColor: c.secondary, borderColor: c.border }]}>
        {item ? <ItemIcon item={item} size={64} /> : <MaterialCommunityIcons name="gift-outline" size={40} color={c.primary} />}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.kicker, { color: c.primary }]}>GIFT</Text>
          <Text style={[styles.title, { color: c.foreground }]} numberOfLines={2}>
            {m.itemName ?? item?.name ?? "A new item"}
          </Text>
          {m.recipientUid === myUid ? <Text style={[styles.sub, { color: c.mutedForeground }]}>In your wardrobe now</Text> : null}
        </View>
      </View>
    );
  }
  if (m.kind === "money") {
    return (
      <View style={[styles.card, { backgroundColor: c.secondary, borderColor: c.border }]}>
        <View style={[styles.disc, { backgroundColor: c.alpha(c.positive, 0.16) }]}>
          <MaterialCommunityIcons name="cash-fast" size={26} color={c.positive} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.kicker, { color: c.positive }]}>CREDITS</Text>
          <Text style={[styles.big, { color: c.foreground }]}>{(m.amount ?? 0).toLocaleString()}</Text>
        </View>
      </View>
    );
  }
  if (m.kind === "loan") return <FriendLoanCard m={m} myUid={myUid} onReplyLoan={onReplyLoan} />;
  return null;
}

function FriendLoanCard({
  m,
  myUid,
  onReplyLoan,
}: {
  m: DirectMessage;
  myUid: string;
  onReplyLoan?: (quote: ReplyQuote) => void;
}) {
  const c = useColors();
  const { show } = useToast();
  const loan = useFriendLoan(m);
  const { progress } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [quickCounterOpen, setQuickCounterOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"counter" | "edit" | null>(null);

  // Only the opening card (loan_<id>) carries the interactive controls; later turn receipts show a compact summary badge.
  const opener = m.id === `loan_${m.loanId}`;

  const act = async (key: string, fn: () => Promise<unknown>, done: string, optimisticPatch?: Partial<api.FriendLoan>) => {
    setBusy(key);
    try {
      if (DEMO && loan && optimisticPatch) {
        setLocalFriendLoan({ ...loan, ...optimisticPatch });
      } else {
        await fn();
        if (loan && optimisticPatch) setLocalFriendLoan({ ...loan, ...optimisticPatch });
      }
      haptic.success();
      show({ kind: "win", title: done });
      setQuickCounterOpen(false);
    } catch (e) {
      haptic.error();
      show({ kind: "warning", title: "Couldn't do that", body: api.friendlyError(e) });
    } finally {
      setBusy(null);
    }
  };

  const status = loan?.status;
  const left = loan ? loan.owed - loan.repaid : 0;
  const iAmBorrower = loan?.borrowerUid === myUid;
  const lastTurnBy = loan?.lastTurnBy ?? loan?.createdBy;
  const isOpenProposal = status === "requested" || status === "offered" || status === "countered";
  const canAnswer = !!loan && isOpenProposal && lastTurnBy !== myUid;
  const canEditOrCancel = !!loan && isOpenProposal && lastTurnBy === myUid;
  const counterpartyName = loan ? (iAmBorrower ? loan.lenderName : loan.borrowerName) : "Friend";

  const tone =
    status === "active"
      ? c.primary
      : status === "repaid"
        ? c.positive
        : status === "declined" || status === "cancelled"
          ? c.mutedForeground
          : c.accent;

  const label =
    status === "requested"
      ? "LOAN REQUEST"
      : status === "offered"
        ? "LOAN OFFER"
        : status === "countered"
          ? "COUNTER OFFER"
          : status === "active"
            ? "LOAN · ACTIVE"
            : status === "repaid"
              ? "LOAN · PAID OFF"
              : status
                ? `LOAN · ${status.toUpperCase()}`
                : "LOAN";

  if (!opener) {
    return (
      <View style={styles.line}>
        <MaterialCommunityIcons name="handshake-outline" size={15} color={tone} />
        <Text style={[styles.kicker, { color: tone }]}>{label}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.loan, { backgroundColor: c.card, borderColor: c.alpha(tone, 0.55) }]}>
      <View style={styles.row}>
        <MaterialCommunityIcons name="hand-coin-outline" size={20} color={tone} />
        <Text style={[styles.kicker, { color: tone, flex: 1 }]}>{label}</Text>
        {loan ? <Pill label={`${loan.interestPct}% flat`} tone="accent" /> : null}
      </View>

      {loan ? (
        <>
          <View style={styles.amountHeaderRow}>
            <Text style={[styles.big, { color: c.foreground }]}>{loan.amount.toLocaleString()}</Text>
            <Text style={[styles.currencySub, { color: c.mutedForeground }]}>credits</Text>
          </View>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>
            {loan.lenderName} → {loan.borrowerName} · pay back {loan.owed.toLocaleString()}
          </Text>
          {loan.note ? (
            <Text style={[styles.noteQuote, { color: c.foreground }]}>"{loan.note}"</Text>
          ) : null}
          {status === "countered" && loan.lastTurnName ? (
            <Text style={[styles.counterBanner, { color: c.accent }]}>
              ⚡ {loan.lastTurnBy === myUid ? "You" : loan.lastTurnName} proposed {loan.amount.toLocaleString()} at {loan.interestPct}% flat
            </Text>
          ) : null}

          {status === "active" ? (
            <>
              <View style={[styles.track, { backgroundColor: c.alpha(c.foreground, 0.08) }]}>
                <View style={[styles.fill, { backgroundColor: c.positive, width: `${Math.min(100, (loan.repaid / loan.owed) * 100)}%` }]} />
              </View>
              <Text style={[styles.sub, { color: c.mutedForeground }]}>
                {loan.repaid.toLocaleString()} repaid · {left.toLocaleString()} left
              </Text>
            </>
          ) : null}

          {canAnswer && !iAmBorrower && progress.level < api.FRIEND_SEND_LEVEL ? (
            <Text style={[styles.sub, { color: c.negative }]}>Lending unlocks at level {api.FRIEND_SEND_LEVEL}.</Text>
          ) : null}

          {canAnswer ? (
            <View style={{ gap: 8, marginTop: 4 }}>
              <View style={styles.row}>
                <Button
                  label={!iAmBorrower ? `Fund ${loan.amount.toLocaleString()}` : `Accept ${loan.amount.toLocaleString()}`}
                  size="sm"
                  style={{ flex: 1.3 }}
                  loading={busy === "yes"}
                  disabled={!!busy}
                  onPress={() =>
                    void act(
                      "yes",
                      () => api.respondFriendLoan({ loanId: loan.id, accept: true, action: "accept" }),
                      "Loan accepted & funded",
                      { status: "active" }
                    )
                  }
                />
                <Button
                  label={quickCounterOpen ? "Close" : "Counter"}
                  variant="secondary"
                  size="sm"
                  style={{ flex: 1 }}
                  disabled={!!busy}
                  onPress={() => {
                    haptic.tick();
                    setQuickCounterOpen((v) => !v);
                  }}
                />
                <Button
                  label="Decline"
                  variant="ghost"
                  size="sm"
                  loading={busy === "no"}
                  disabled={!!busy}
                  onPress={() =>
                    void act(
                      "no",
                      () => api.respondFriendLoan({ loanId: loan.id, accept: false, action: "decline" }),
                      "Loan declined",
                      { status: "declined" }
                    )
                  }
                />
              </View>

              {quickCounterOpen ? (
                <View style={[styles.quickCounterBox, { backgroundColor: c.secondary, borderColor: c.border }]}>
                  <View style={styles.fieldHeaderRow}>
                    <Text style={[styles.fieldLabel, { color: c.subtleForeground }]}>QUICK COUNTER RATE</Text>
                    <Pressable
                      onPress={() => {
                        haptic.tick();
                        setQuickCounterOpen(false);
                        setEditorMode("counter");
                      }}
                    >
                      <Text style={[styles.editPopupLink, { color: "#007AFF" }]}>Edit Amount / Terms ↗</Text>
                    </Pressable>
                  </View>
                  <View style={styles.presetRow}>
                    {QUICK_RATES.map((r) => (
                      <Pressable
                        key={r}
                        disabled={!!busy}
                        onPress={() =>
                          void act(
                            `rate_${r}`,
                            () => api.respondFriendLoan({ loanId: loan.id, action: "counter", interestPct: r }),
                            `Countered at ${r}% flat`,
                            {
                              interestPct: r,
                              owed: api.loanOwed(loan.amount, r),
                              status: "countered",
                              lastTurnBy: myUid,
                              lastTurnName: "You",
                            }
                          )
                        }
                        style={[
                          styles.presetChip,
                          {
                            backgroundColor: loan.interestPct === r ? c.alpha(c.primary, 0.18) : c.card,
                            borderColor: loan.interestPct === r ? c.primary : c.border,
                          },
                        ]}
                      >
                        <Text style={[styles.presetChipText, { color: c.foreground }]}>{r}%</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : (
                <View style={styles.secondaryActionRow}>
                  <Pressable
                    hitSlop={6}
                    onPress={() => {
                      haptic.tick();
                      setEditorMode("counter");
                    }}
                    style={styles.inlineLinkBtn}
                  >
                    <MaterialCommunityIcons name="tune-variant" size={13} color="#007AFF" />
                    <Text style={[styles.editPopupLink, { color: "#007AFF" }]}>Negotiate in Popup</Text>
                  </Pressable>
                  {onReplyLoan ? (
                    <Pressable
                      hitSlop={6}
                      onPress={() => {
                        haptic.tick();
                        onReplyLoan({
                          id: m.id,
                          kind: "message",
                          authorUid: m.senderUid,
                          authorName: m.senderName,
                          text: `Loan ${loan.amount.toLocaleString()} credits at ${loan.interestPct}% flat`,
                        });
                      }}
                      style={styles.inlineLinkBtn}
                    >
                      <MaterialCommunityIcons name="reply-outline" size={14} color="#007AFF" />
                      <Text style={[styles.editPopupLink, { color: "#007AFF" }]}>Reply in Chat</Text>
                    </Pressable>
                  ) : null}
                </View>
              )}
            </View>
          ) : null}

          {canEditOrCancel ? (
            <View style={styles.row}>
              <Button
                label="Edit Terms"
                icon="pencil-outline"
                variant="secondary"
                size="sm"
                style={{ flex: 1 }}
                disabled={!!busy}
                onPress={() => {
                  haptic.tick();
                  setEditorMode("edit");
                }}
              />
              <Button
                label="Withdraw"
                variant="ghost"
                size="sm"
                loading={busy === "cancel"}
                disabled={!!busy}
                onPress={() =>
                  void act(
                    "cancel",
                    () => api.respondFriendLoan({ loanId: loan.id, accept: false, action: "cancel" }),
                    "Loan cancelled",
                    { status: "cancelled" }
                  )
                }
              />
            </View>
          ) : null}

          {status === "active" && iAmBorrower && left > 0 ? (
            <View style={styles.row}>
              {left > 100 ? (
                <Button
                  label={`Pay ${Math.ceil(left / 2).toLocaleString()}`}
                  variant="secondary"
                  size="sm"
                  style={{ flex: 1 }}
                  loading={busy === "half"}
                  disabled={!!busy}
                  onPress={() =>
                    void act(
                      "half",
                      () => api.repayFriendLoan({ loanId: loan.id, amount: Math.ceil(left / 2), idempotencyKey: api.newIdempotencyKey() }),
                      "Payment sent",
                      { repaid: loan.repaid + Math.ceil(left / 2) }
                    )
                  }
                />
              ) : null}
              <Button
                label={`Pay all ${left.toLocaleString()}`}
                size="sm"
                style={{ flex: 1 }}
                loading={busy === "all"}
                disabled={!!busy}
                onPress={() =>
                  void act(
                    "all",
                    () => api.repayFriendLoan({ loanId: loan.id, amount: left, idempotencyKey: api.newIdempotencyKey() }),
                    "Loan paid off",
                    { repaid: loan.owed, status: "repaid" }
                  )
                }
              />
            </View>
          ) : null}

          <LoanNegotiateModal
            visible={editorMode !== null}
            mode={editorMode ?? "counter"}
            title={editorMode === "edit" ? "Edit Loan Terms" : "Negotiate Loan Terms"}
            currency="credits"
            minAmount={api.FRIEND_SEND_MIN}
            maxAmount={api.FRIEND_SEND_MAX}
            initialAmount={loan.amount}
            initialRate={loan.interestPct}
            initialNote={loan.note}
            counterpartyName={counterpartyName}
            isBorrower={iAmBorrower}
            onClose={() => setEditorMode(null)}
            onSubmit={async ({ amount, rate, note }) => {
              const action = editorMode === "edit" ? "edit" : "counter";
              if (DEMO) {
                setLocalFriendLoan({
                  ...loan,
                  amount,
                  interestPct: rate,
                  owed: api.loanOwed(amount, rate),
                  note: note || null,
                  status: action === "counter" ? "countered" : loan.status,
                  lastTurnBy: myUid,
                  lastTurnName: "You",
                });
              } else {
                await api.respondFriendLoan({
                  loanId: loan.id,
                  action,
                  amount,
                  interestPct: rate,
                  note: note || undefined,
                });
              }
              haptic.success();
              show({
                kind: "win",
                title: action === "counter" ? "Counter-offer sent" : "Loan terms updated",
                body: `${amount.toLocaleString()} credits at ${rate}% flat.`,
              });
            }}
          />
        </>
      ) : (
        <Text style={[styles.big, { color: c.foreground }]}>{(m.amount ?? 0).toLocaleString()}</Text>
      )}
    </View>
  );
}

/**
 * Interactive League Peer Loan Card inside League Chat (/messages and /league/[id]).
 * Supports:
 *  - Accepting / Funding a request or accepting a counter-offer right in chat
 *  - Inline quick-rate counter negotiation
 *  - Opening `LoanNegotiateModal` popup for larger updates (editing principal amount, custom rate, and note)
 *  - Repaying active loans right in chat
 *  - Emoji reactions & quoting/replying in chat
 */
export function LeagueLoanChatCard({
  league,
  loan,
  myUid,
  now,
  closed = false,
  onReply,
}: {
  league: League;
  loan: LeagueLoan;
  myUid: string | null;
  now: number;
  closed?: boolean;
  onReply?: (quote: ReplyQuote) => void;
}) {
  const c = useColors();
  const { show } = useToast();
  const { peerLoanAction, repayLoan, reactToItem } = useLeague();
  const [localOverride, setLocalOverride] = useState<Partial<LeagueLoan> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [quickCounterOpen, setQuickCounterOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"counter" | "edit" | null>(null);

  const merged = useMemo<LeagueLoan>(() => (localOverride ? { ...loan, ...localOverride } : loan), [loan, localOverride]);
  useEffect(() => {
    setLocalOverride(null);
  }, [loan.status, loan.principal, loan.proposedRate, loan.counterRate, loan.message]);

  const status = merged.status;
  const isBorrower = !!myUid && merged.borrowerId === myUid;
  const isLender = !!myUid && merged.lenderId === myUid;
  const myTokens = (myUid ? league.members?.[myUid]?.leagueTokens : 0) ?? 0;
  const maxLoanAmt = Math.floor(league.startingLeagueTokens * PEER_LOAN_MAX_PCT);
  const baseRate = merged.proposedRate ?? merged.ratePct ?? league.bankInterestRate ?? 5;
  const activeRate = status === "countered" && merged.counterRate != null ? merged.counterRate : baseRate;
  const interest = flatInterest(merged.principal, activeRate);
  const totalRepay = merged.principal + interest;
  const snap = loanSnapshot(merged, now);
  const declinedByMe = !!(myUid && merged.declinedBy?.includes(myUid));

  const tone =
    status === "active"
      ? c.league
      : status === "repaid"
        ? c.positive
        : status === "cancelled" || status === "rejected"
          ? c.mutedForeground
          : c.accent;

  const badgeText =
    status === "requested"
      ? "LOAN REQUEST"
      : status === "countered"
        ? "COUNTER OFFER"
        : status === "active"
          ? "ACTIVE LOAN"
          : status === "repaid"
            ? "PAID OFF"
            : `LOAN · ${status.toUpperCase()}`;

  const runAction = async (
    key: string,
    action: api.PeerLoanActionName,
    opts?: { rate?: number; amount?: number; message?: string; toastTitle?: string; patch?: Partial<LeagueLoan> }
  ) => {
    setBusy(key);
    try {
      if (opts?.patch) setLocalOverride((prev) => ({ ...(prev ?? {}), ...opts.patch }));
      const err = await peerLoanAction(league.id, merged.id, action, opts?.rate, opts?.amount, opts?.message);
      if (err) {
        setLocalOverride(null);
        haptic.error();
        show({ kind: "warning", title: "Couldn't update loan", body: err });
      } else {
        haptic.success();
        if (opts?.toastTitle) show({ kind: "win", title: opts.toastTitle });
        setQuickCounterOpen(false);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={[styles.loan, { backgroundColor: c.card, borderColor: c.alpha(tone, 0.55) }]}>
      <View style={styles.row}>
        <MaterialCommunityIcons name="handshake-outline" size={20} color={tone} />
        <Text style={[styles.kicker, { color: tone, flex: 1 }]}>{badgeText}</Text>
        <Pill label={`${activeRate}% flat`} tone="league" />
      </View>

      <View style={styles.amountHeaderRow}>
        <Text style={[styles.big, { color: c.foreground }]}>{merged.principal.toLocaleString()}</Text>
        <Text style={[styles.currencySub, { color: c.mutedForeground }]}>league tokens</Text>
      </View>

      <Text style={[styles.sub, { color: c.mutedForeground }]}>
        {status === "active" || status === "repaid"
          ? `${merged.lenderName ?? "The House"} → ${merged.borrowerName} · repays ${snap.totalRepayable.toLocaleString()}`
          : `${merged.borrowerName} wants to borrow · repays ${totalRepay.toLocaleString()} (+${interest.toLocaleString()})`}
      </Text>

      {merged.message ? (
        <Text style={[styles.noteQuote, { color: c.foreground }]}>"{merged.message}"</Text>
      ) : null}

      {status === "countered" && merged.counterRate != null ? (
        <Text style={[styles.counterBanner, { color: c.accent }]}>
          ⚡ {merged.counterBy === myUid ? "You" : merged.counterByName ?? "League-mate"} countered at {merged.counterRate}% flat (+{interest.toLocaleString()} interest)
        </Text>
      ) : null}

      {status === "active" ? (
        <>
          <View style={[styles.track, { backgroundColor: c.alpha(c.foreground, 0.08) }]}>
            <View
              style={[
                styles.fill,
                {
                  backgroundColor: c.positive,
                  width: `${Math.min(100, (snap.totalRepaid / Math.max(1, snap.totalRepayable)) * 100)}%`,
                },
              ]}
            />
          </View>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>
            {snap.totalRepaid.toLocaleString()} repaid · {snap.totalOwed.toLocaleString()} owed
          </Text>
        </>
      ) : null}

      {/* Actions for OTHER league members when loan is requested or countered */}
      {!closed && !isBorrower && (status === "requested" || status === "countered") && !declinedByMe ? (
        <View style={{ gap: 8, marginTop: 4 }}>
          <View style={styles.row}>
            <Button
              label={`Lend ${merged.principal.toLocaleString()}`}
              variant="league"
              size="sm"
              style={{ flex: 1.3 }}
              disabled={!!busy || myTokens < merged.principal}
              loading={busy === "fund"}
              onPress={() =>
                void runAction("fund", "fund", {
                  toastTitle: `Lent ${merged.principal.toLocaleString()} tokens to ${merged.borrowerName}`,
                  patch: { status: "active", lenderId: myUid, lenderName: "You" },
                })
              }
            />
            <Button
              label={quickCounterOpen ? "Close" : "Counter"}
              variant="secondary"
              size="sm"
              style={{ flex: 1 }}
              disabled={!!busy}
              onPress={() => {
                haptic.tick();
                setQuickCounterOpen((v) => !v);
              }}
            />
            <Button
              label="Pass"
              variant="ghost"
              size="sm"
              disabled={!!busy}
              loading={busy === "decline"}
              onPress={() =>
                void runAction("decline", "decline", {
                  patch: { declinedBy: [...(merged.declinedBy ?? []), myUid ?? ""] },
                })
              }
            />
          </View>

          {myTokens < merged.principal ? (
            <Text style={[styles.sub, { color: c.subtleForeground }]}>
              You have {myTokens.toLocaleString()} tokens (need {merged.principal.toLocaleString()} to fund, or negotiate a smaller amount).
            </Text>
          ) : null}

          {quickCounterOpen ? (
            <View style={[styles.quickCounterBox, { backgroundColor: c.secondary, borderColor: c.border }]}>
              <View style={styles.fieldHeaderRow}>
                <Text style={[styles.fieldLabel, { color: c.subtleForeground }]}>QUICK COUNTER RATE</Text>
                <Pressable
                  onPress={() => {
                    haptic.tick();
                    setQuickCounterOpen(false);
                    setEditorMode("counter");
                  }}
                >
                  <Text style={[styles.editPopupLink, { color: "#007AFF" }]}>Edit Amount / Terms ↗</Text>
                </Pressable>
              </View>
              <View style={styles.presetRow}>
                {LEAGUE_QUICK_RATES.map((r) => (
                  <Pressable
                    key={r}
                    disabled={!!busy}
                    onPress={() =>
                      void runAction(`rate_${r}`, "counter", {
                        rate: r,
                        toastTitle: `Countered at ${r}% flat`,
                        patch: { status: "countered", counterRate: r, counterBy: myUid, counterByName: "You" },
                      })
                    }
                    style={[
                      styles.presetChip,
                      {
                        backgroundColor: activeRate === r ? c.leagueSoft : c.card,
                        borderColor: activeRate === r ? c.league : c.border,
                      },
                    ]}
                  >
                    <Text style={[styles.presetChipText, { color: c.foreground }]}>{r}%</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Actions for BORROWER when loan is requested or countered */}
      {!closed && isBorrower && (status === "requested" || status === "countered") ? (
        <View style={{ gap: 8, marginTop: 4 }}>
          {status === "countered" && merged.counterRate != null ? (
            <View style={styles.row}>
              <Button
                label={`Accept ${merged.counterRate}%`}
                variant="league"
                size="sm"
                style={{ flex: 1.3 }}
                loading={busy === "acc"}
                disabled={!!busy}
                onPress={() =>
                  void runAction("acc", "accept_counter", {
                    toastTitle: `Accepted ${merged.counterRate}% loan`,
                    patch: { status: "active", ratePct: merged.counterRate ?? baseRate },
                  })
                }
              />
              <Button
                label="Counter / Edit"
                variant="secondary"
                size="sm"
                style={{ flex: 1 }}
                disabled={!!busy}
                onPress={() => {
                  haptic.tick();
                  setEditorMode("edit");
                }}
              />
              <Button
                label="Reject"
                variant="ghost"
                size="sm"
                loading={busy === "rj"}
                disabled={!!busy}
                onPress={() =>
                  void runAction("rj", "reject_counter", {
                    toastTitle: "Counter-offer rejected",
                    patch: { status: "requested", counterRate: null, counterBy: null, counterByName: null },
                  })
                }
              />
            </View>
          ) : (
            <View style={styles.row}>
              <Button
                label="Edit Terms"
                icon="pencil-outline"
                variant="secondary"
                size="sm"
                style={{ flex: 1 }}
                disabled={!!busy}
                onPress={() => {
                  haptic.tick();
                  setEditorMode("edit");
                }}
              />
              <Button
                label="Withdraw"
                variant="ghost"
                size="sm"
                loading={busy === "cancel"}
                disabled={!!busy}
                onPress={() =>
                  void runAction("cancel", "cancel", {
                    toastTitle: "Loan request withdrawn",
                    patch: { status: "cancelled" },
                  })
                }
              />
            </View>
          )}
        </View>
      ) : null}

      {/* Actions for BORROWER when loan is active */}
      {!closed && isBorrower && status === "active" && snap.totalOwed > 0 ? (
        <View style={styles.row}>
          {snap.totalOwed > 100 && myTokens >= Math.ceil(snap.totalOwed / 2) ? (
            <Button
              label={`Pay ${Math.ceil(snap.totalOwed / 2).toLocaleString()}`}
              variant="secondary"
              size="sm"
              style={{ flex: 1 }}
              loading={busy === "repay_half"}
              disabled={!!busy}
              onPress={async () => {
                setBusy("repay_half");
                const err = await repayLoan(league.id, merged.id, Math.ceil(snap.totalOwed / 2));
                setBusy(null);
                if (!err) {
                  haptic.success();
                  show({ kind: "win", title: "Repayment sent" });
                }
              }}
            />
          ) : null}
          <Button
            label={`Pay Off ${Math.min(snap.totalOwed, myTokens).toLocaleString()}`}
            variant="league"
            size="sm"
            style={{ flex: 1 }}
            loading={busy === "repay_all"}
            disabled={!!busy || myTokens <= 0}
            onPress={async () => {
              setBusy("repay_all");
              const err = await repayLoan(league.id, merged.id, Math.min(snap.totalOwed, myTokens));
              setBusy(null);
              if (!err) {
                haptic.success();
                show({ kind: "win", title: "Loan payment sent" });
              }
            }}
          />
        </View>
      ) : null}

      {/* Footer row: Open in Popup Editor, Reply in Chat, and Emoji Reactions */}
      <View style={[styles.cardFooterRow, { borderTopColor: c.border }]}>
        {!closed && (status === "requested" || status === "countered") ? (
          <Pressable
            hitSlop={6}
            onPress={() => {
              haptic.tick();
              setEditorMode(isBorrower ? "edit" : "counter");
            }}
            style={styles.inlineLinkBtn}
          >
            <MaterialCommunityIcons name="open-in-new" size={13} color="#007AFF" />
            <Text style={[styles.editPopupLink, { color: "#007AFF" }]}>
              {isBorrower ? "Edit in Popup" : "Negotiate in Popup"}
            </Text>
          </Pressable>
        ) : null}

        {onReply ? (
          <Pressable
            hitSlop={6}
            onPress={() => {
              haptic.tick();
              onReply({
                id: merged.id,
                kind: "message",
                authorUid: merged.borrowerId,
                authorName: merged.borrowerName,
                text: `Loan ${merged.principal.toLocaleString()} tokens at ${activeRate}% flat`,
              });
            }}
            style={styles.inlineLinkBtn}
          >
            <MaterialCommunityIcons name="reply-outline" size={14} color="#007AFF" />
            <Text style={[styles.editPopupLink, { color: "#007AFF" }]}>Reply</Text>
          </Pressable>
        ) : null}

        <View style={{ flex: 1 }} />
        <ReactionRow
          reactions={merged.reactions}
          reactors={merged.reactors}
          uid={myUid}
          canReact={!closed}
          onReact={(emoji) => reactToItem(league.id, "loan", merged.id, emoji as never)}
        />
      </View>

      <LoanNegotiateModal
        visible={editorMode !== null}
        mode={editorMode ?? "counter"}
        title={editorMode === "edit" ? "Edit League Loan Request" : `Negotiate with ${merged.borrowerName}`}
        currency="league"
        minAmount={10}
        maxAmount={maxLoanAmt}
        initialAmount={merged.principal}
        initialRate={activeRate}
        initialNote={merged.message}
        counterpartyName={merged.borrowerName}
        isBorrower={isBorrower || isLender}
        onClose={() => setEditorMode(null)}
        onSubmit={async ({ amount, rate, note }) => {
          const action: api.PeerLoanActionName = editorMode === "edit" ? "edit" : "counter";
          await runAction("modal_save", action, {
            rate,
            amount,
            message: note,
            toastTitle: action === "edit" ? "Loan request updated" : `Counter-offer sent (${rate}% flat)`,
            patch:
              action === "edit"
                ? { principal: amount, proposedRate: rate, ratePct: rate, message: note || null, status: "requested", counterRate: null }
                : { principal: amount, counterRate: rate, counterBy: myUid, counterByName: "You", message: note || null, status: "countered" },
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10, borderRadius: 14, borderWidth: 1, minWidth: 220, marginBottom: 4 },
  loan: { gap: 7, padding: 12, borderRadius: 16, borderWidth: 1.5, minWidth: 255, maxWidth: "100%", marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  amountHeaderRow: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  currencySub: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  line: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  disc: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  kicker: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.1 },
  title: { fontSize: 15, fontFamily: "Inter_700Bold" },
  big: { fontSize: 24, fontFamily: "Inter_900Black", fontVariant: ["tabular-nums"], letterSpacing: -0.5 },
  sub: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_500Medium" },
  noteQuote: { fontSize: 12, fontFamily: "Inter_600SemiBold", fontStyle: "italic" },
  counterBanner: { fontSize: 12, fontFamily: "Inter_700Bold" },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  quickCounterBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    gap: 8,
  },
  fieldHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  fieldLabel: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 1 },
  fieldHint: { fontSize: 11, fontFamily: "Inter_500Medium" },
  presetRow: { flexDirection: "row", gap: 6 },
  presetChip: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  presetChipText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  secondaryActionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 2 },
  cardFooterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    marginTop: 2,
    flexWrap: "wrap",
  },
  inlineLinkBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  editPopupLink: { fontSize: 11, fontFamily: "Inter_700Bold" },
  modalScrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  modalCard: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
    gap: 14,
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 20,
  },
  modalHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  modalIconWrap: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  modalTitle: { fontSize: 17, fontFamily: "Inter_800ExtraBold" },
  modalSub: { fontSize: 12, fontFamily: "Inter_500Medium" },
  inputBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 46,
  },
  inputBoxText: { flex: 1, fontSize: 17, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  noteInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  summaryBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  summaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  summaryLabel: { fontSize: 12, fontFamily: "Inter_500Medium" },
  summaryTotalRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6, marginTop: 2 },
  summaryTotalLabel: { fontSize: 13, fontFamily: "Inter_700Bold" },
  errText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 2 },
});
