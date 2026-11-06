import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, View } from "react-native";
import ItemIcon from "@/components/avatar/ItemIcon";
import { Pressable } from "@/components/fx/Tap";
import KeyboardSheet from "@/components/KeyboardSheet";
import NumericInput from "@/components/NumericInput";
import { Amount, Button, SegmentedControl } from "@/components/ui";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { useCatalog } from "@/hooks/useCatalog";
import { useColors } from "@/hooks/useColors";
import * as api from "@/lib/api";
import { haptic } from "@/lib/motion";

export type SendTab = "gift" | "credits" | "loan";

/**
 * Send a friend clothes, credits, or a loan, from a DM or their profile card.
 * The server checks friendship, account age, the daily send cap and prices.
 */
export default function FriendSendSheet({
  friend,
  initialTab = "gift",
  onClose,
}: {
  friend: { uid: string; name: string } | null;
  initialTab?: SendTab;
  onClose: () => void;
}) {
  const c = useColors();
  const { balance, progress } = useApp();
  const lockedOut = progress.level < api.FRIEND_SEND_LEVEL;
  const { items } = useCatalog();
  const { show } = useToast();
  const [tab, setTab] = useState<SendTab>(initialTab);
  const [itemId, setItemId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [loanMode, setLoanMode] = useState<"request" | "offer">("request");
  const [rate, setRate] = useState<number>(api.FRIEND_LOAN_RATES[2]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!friend) return;
    setTab(initialTab);
    setItemId(null);
    setAmount("");
    setNote("");
    setErr(null);
  }, [friend?.uid, initialTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const giftable = useMemo(
    () => items.filter((i) => i.available !== false && i.price > 0 && !i.levelReward).sort((a, b) => a.price - b.price),
    [items]
  );
  const item = giftable.find((i) => i.id === itemId) ?? null;
  const n = Number(amount) || 0;
  const amountOk = n >= api.FRIEND_SEND_MIN && n <= api.FRIEND_SEND_MAX;
  const needsFunds = tab === "gift" ? (item?.price ?? 0) : tab === "credits" || (tab === "loan" && loanMode === "offer") ? n : 0;
  const short = needsFunds > balance;

  const run = async (fn: () => Promise<unknown>, title: string, body: string) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      haptic.success();
      show({ kind: "win", title, body });
      onClose();
    } catch (e) {
      haptic.error();
      setErr(api.friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (!friend) return;
    const memo = note.trim() || undefined;
    if (tab === "gift" && item) {
      void run(() => api.giftItem({ itemId: item.id, toUid: friend.uid, idempotencyKey: api.newIdempotencyKey(), note: memo }), `Gift sent to ${friend.name} 🎁`, `${item.name} is in their wardrobe.`);
    } else if (tab === "credits" && amountOk) {
      void run(() => api.sendCredits({ toUid: friend.uid, amount: n, note: memo, idempotencyKey: api.newIdempotencyKey() }), `Sent ${n.toLocaleString()} credits`, `${friend.name} has them now.`);
    } else if (tab === "loan" && amountOk) {
      const call = loanMode === "request" ? api.requestFriendLoan : api.offerFriendLoan;
      void run(
        () => call({ toUid: friend.uid, amount: n, interestPct: rate, note: memo }),
        loanMode === "request" ? "Loan request sent" : "Loan offer sent",
        `${friend.name} can accept it in your chat.`
      );
    }
  };

  // Below the unlock level you can still send clothes and ask to borrow, but not send credits.
  const sendsCredits = tab === "credits" || (tab === "loan" && loanMode === "offer");
  const levelLock = lockedOut && sendsCredits;
  const ready = !busy && !short && !levelLock && (tab === "gift" ? !!item : amountOk);
  const cta =
    tab === "gift"
      ? item
        ? `Buy & send · ${item.price.toLocaleString()}`
        : "Pick an item"
      : tab === "credits"
        ? `Send ${n ? n.toLocaleString() : ""} credits`.replace("  ", " ")
        : loanMode === "request"
          ? "Ask to borrow"
          : "Offer loan";

  return (
    <KeyboardSheet visible={!!friend} onClose={onClose} maxHeight="88%">
      {friend ? (
        <View style={styles.body}>
          <Text style={[styles.title, { color: c.foreground }]}>Send to {friend.name}</Text>
          <View style={styles.balanceRow}>
            <Text style={[styles.sub, { color: c.mutedForeground }]}>Your balance</Text>
            <Amount value={balance} size="sm" />
          </View>
          <SegmentedControl
            value={tab}
            onChange={(v) => {
              setTab(v);
              setErr(null);
            }}
            options={[
              { value: "gift", label: "Clothes" },
              { value: "credits", label: "Credits" },
              { value: "loan", label: "Loan" },
            ]}
          />

          {tab === "gift" ? (
            <>
              <Text style={[styles.sub, { color: c.mutedForeground }]}>
                You buy it for them at full price, even if you already own it.
              </Text>
              <FlatList
                data={giftable}
                keyExtractor={(i) => i.id}
                numColumns={3}
                style={{ maxHeight: 300 }}
                columnWrapperStyle={{ gap: 8 }}
                contentContainerStyle={{ gap: 8 }}
                renderItem={({ item: i }) => {
                  const on = i.id === itemId;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`${i.name}, ${i.price} credits`}
                      onPress={() => setItemId(on ? null : i.id)}
                      style={[styles.itemTile, { backgroundColor: c.secondary, borderColor: on ? c.primary : c.border, borderWidth: on ? 2 : 1 }]}
                    >
                      <ItemIcon item={i} size={56} />
                      <Text style={[styles.itemName, { color: c.foreground }]} numberOfLines={1}>
                        {i.name}
                      </Text>
                      <Text style={[styles.itemPrice, { color: i.price > balance ? c.negative : c.mutedForeground }]}>{i.price.toLocaleString()}</Text>
                    </Pressable>
                  );
                }}
              />
            </>
          ) : (
            <>
              {tab === "loan" ? (
                <SegmentedControl
                  value={loanMode}
                  onChange={setLoanMode}
                  options={[
                    { value: "request", label: "Borrow from them" },
                    { value: "offer", label: "Lend to them" },
                  ]}
                />
              ) : null}
              <View style={[styles.input, { borderColor: n && !amountOk ? c.negative : c.border, backgroundColor: c.secondary }]}>
                <MaterialCommunityIcons name="lightning-bolt" size={18} color={c.primary} />
                <NumericInput
                  style={[styles.inputText, { color: c.foreground }]}
                  value={amount}
                  onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ""))}
                  keyboardType="number-pad"
                  placeholder={`${api.FRIEND_SEND_MIN}–${api.FRIEND_SEND_MAX.toLocaleString()} credits`}
                  placeholderTextColor={c.subtleForeground}
                  accessibilityLabel="Amount"
                />
              </View>
              {tab === "loan" ? (
                <>
                  <Text style={[styles.label, { color: c.subtleForeground }]}>FLAT INTEREST</Text>
                  <View style={styles.rates}>
                    {api.FRIEND_LOAN_RATES.map((r) => (
                      <Pressable
                        key={r}
                        accessibilityRole="button"
                        accessibilityState={{ selected: rate === r }}
                        onPress={() => setRate(r)}
                        style={[styles.rate, { backgroundColor: rate === r ? c.alpha(c.primary, 0.18) : c.secondary, borderColor: rate === r ? c.primary : c.border }]}
                      >
                        <Text style={[styles.rateText, { color: c.foreground }]}>{r}%</Text>
                      </Pressable>
                    ))}
                  </View>
                  {amountOk ? (
                    <Text style={[styles.sub, { color: c.mutedForeground }]}>
                      {loanMode === "request" ? "You'd pay back" : "They'd pay back"} {api.loanOwed(n, rate).toLocaleString()} credits. Nothing moves until{" "}
                      {loanMode === "request" ? "they accept" : "they accept"}.
                    </Text>
                  ) : null}
                </>
              ) : null}
              <Text style={[styles.sub, { color: c.subtleForeground }]}>
                Up to {api.FRIEND_DAILY_SEND_CAP.toLocaleString()} credits a day across sends and loans you fund.
              </Text>
            </>
          )}

          <TextInput
            value={note}
            onChangeText={setNote}
            maxLength={140}
            placeholder="Add a note (optional)"
            placeholderTextColor={c.subtleForeground}
            style={[styles.note, { backgroundColor: c.secondary, borderColor: c.border, color: c.foreground }]}
          />
          {levelLock ? (
            <Text style={[styles.sub, { color: c.negative }]}>
              Sending credits unlocks at level {api.FRIEND_SEND_LEVEL}. You're level {progress.level}.
            </Text>
          ) : null}
          {short ? <Text style={[styles.sub, { color: c.negative }]}>Not enough credits.</Text> : null}
          {err ? <Text style={[styles.sub, { color: c.negative }]}>{err}</Text> : null}
          <Button label={cta} icon={tab === "gift" ? "gift-outline" : tab === "credits" ? "cash-fast" : "hand-coin-outline"} onPress={submit} disabled={!ready} loading={busy} />
        </View>
      ) : null}
    </KeyboardSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 12, paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 20, fontFamily: "Inter_800ExtraBold" },
  balanceRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  label: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.2 },
  itemTile: { flex: 1 / 3, alignItems: "center", gap: 4, padding: 8, borderRadius: 14 },
  itemName: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  itemPrice: { fontSize: 11, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  input: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, height: 48 },
  inputText: { flex: 1, fontSize: 17, fontFamily: "Inter_700Bold" },
  rates: { flexDirection: "row", gap: 8 },
  rate: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  rateText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  note: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, height: 44, fontSize: 14, fontFamily: "Inter_400Regular" },
});
