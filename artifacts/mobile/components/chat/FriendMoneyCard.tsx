import { MaterialCommunityIcons } from "@expo/vector-icons";
import { doc, onSnapshot } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import ItemIcon from "@/components/avatar/ItemIcon";
import { Button } from "@/components/ui";
import type { DirectMessage } from "@/context/ChatContext";
import { useApp } from "@/context/AppContext";
import { useToast } from "@/context/ToastContext";
import { useCatalog } from "@/hooks/useCatalog";
import { useColors } from "@/hooks/useColors";
import * as api from "@/lib/api";
import { getDb } from "@/lib/firebase";
import { haptic } from "@/lib/motion";

/** Live state of a friend loan, for the card's buttons. */
function useFriendLoan(loanId: string | undefined) {
  const [loan, setLoan] = useState<api.FriendLoan | null>(null);
  useEffect(() => {
    const db = getDb();
    if (!db || !loanId) return;
    return onSnapshot(
      doc(db, "friendLoans", loanId),
      (s) => setLoan(s.exists() ? ({ ...(s.data() as api.FriendLoan), id: s.id }) : null),
      () => {}
    );
  }, [loanId]);
  return loan;
}

/** Gift, credits and loan cards inside a DM bubble. */
export default function FriendMoneyCard({ m, myUid }: { m: DirectMessage; myUid: string }) {
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
  if (m.kind === "loan") return <LoanCard m={m} myUid={myUid} />;
  return null;
}

function LoanCard({ m, myUid }: { m: DirectMessage; myUid: string }) {
  const c = useColors();
  const { show } = useToast();
  const loan = useFriendLoan(m.loanId);
  const { progress } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  // Only the opening card (loan_<id>) carries the buttons; later updates are plain lines.
  const opener = m.id === `loan_${m.loanId}`;

  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await fn();
      haptic.success();
      show({ kind: "win", title: done });
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
  const canAnswer = loan && (status === "requested" || status === "offered") && loan.createdBy !== myUid;
  const canCancel = loan && (status === "requested" || status === "offered") && loan.createdBy === myUid;
  const tone = status === "active" ? c.primary : status === "repaid" ? c.positive : status === "declined" || status === "cancelled" ? c.mutedForeground : c.accent;
  const label =
    status === "requested" ? "LOAN REQUEST" : status === "offered" ? "LOAN OFFER" : status === "active" ? "LOAN · OPEN" : status === "repaid" ? "LOAN · PAID OFF" : status ? `LOAN · ${status.toUpperCase()}` : "LOAN";

  if (!opener) {
    return (
      <View style={styles.line}>
        <MaterialCommunityIcons name="hand-coin-outline" size={16} color={c.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.loan, { backgroundColor: c.secondary, borderColor: c.alpha(tone, 0.5) }]}>
      <View style={styles.row}>
        <MaterialCommunityIcons name="hand-coin-outline" size={22} color={tone} />
        <Text style={[styles.kicker, { color: tone, flex: 1 }]}>{label}</Text>
        {loan ? <Text style={[styles.sub, { color: c.mutedForeground }]}>{loan.interestPct}% flat</Text> : null}
      </View>
      {loan ? (
        <>
          <Text style={[styles.big, { color: c.foreground }]}>{loan.amount.toLocaleString()}</Text>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>
            {loan.lenderName} → {loan.borrowerName} · pay back {loan.owed.toLocaleString()}
          </Text>
          {status === "active" ? (
            <View style={[styles.track, { backgroundColor: c.alpha(c.foreground, 0.08) }]}>
              <View style={[styles.fill, { backgroundColor: c.positive, width: `${Math.min(100, (loan.repaid / loan.owed) * 100)}%` }]} />
            </View>
          ) : null}
          {status === "active" ? (
            <Text style={[styles.sub, { color: c.mutedForeground }]}>
              {loan.repaid.toLocaleString()} repaid · {left.toLocaleString()} left
            </Text>
          ) : null}
          {canAnswer && status === "requested" && progress.level < api.FRIEND_SEND_LEVEL ? (
            <Text style={[styles.sub, { color: c.negative }]}>Lending unlocks at level {api.FRIEND_SEND_LEVEL}.</Text>
          ) : null}
          {canAnswer ? (
            <View style={styles.row}>
              <Button label="Decline" variant="secondary" size="sm" style={{ flex: 1 }} loading={busy === "no"} disabled={!!busy} onPress={() => void act("no", () => api.respondFriendLoan({ loanId: loan.id, accept: false }), "Loan declined")} />
              <Button
                label={status === "requested" ? `Lend ${loan.amount.toLocaleString()}` : "Accept"}
                size="sm"
                style={{ flex: 1 }}
                loading={busy === "yes"}
                disabled={!!busy}
                onPress={() => void act("yes", () => api.respondFriendLoan({ loanId: loan.id, accept: true }), "Loan funded")}
              />
            </View>
          ) : null}
          {canCancel ? (
            <Button label="Cancel" variant="ghost" size="sm" loading={busy === "cancel"} disabled={!!busy} onPress={() => void act("cancel", () => api.respondFriendLoan({ loanId: loan.id, accept: false }), "Loan cancelled")} />
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
                  onPress={() => void act("half", () => api.repayFriendLoan({ loanId: loan.id, amount: Math.ceil(left / 2), idempotencyKey: api.newIdempotencyKey() }), "Payment sent")}
                />
              ) : null}
              <Button
                label={`Pay all ${left.toLocaleString()}`}
                size="sm"
                style={{ flex: 1 }}
                loading={busy === "all"}
                disabled={!!busy}
                onPress={() => void act("all", () => api.repayFriendLoan({ loanId: loan.id, amount: left, idempotencyKey: api.newIdempotencyKey() }), "Loan paid off")}
              />
            </View>
          ) : null}
        </>
      ) : (
        <Text style={[styles.big, { color: c.foreground }]}>{(m.amount ?? 0).toLocaleString()}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", alignItems: "center", gap: 12, padding: 10, borderRadius: 14, borderWidth: 1, minWidth: 220, marginBottom: 6 },
  loan: { gap: 6, padding: 12, borderRadius: 14, borderWidth: 1.5, minWidth: 240, marginBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  line: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  disc: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  kicker: { fontSize: 11, fontFamily: "Inter_800ExtraBold", letterSpacing: 1.2 },
  title: { fontSize: 15, fontFamily: "Inter_700Bold" },
  big: { fontSize: 24, fontFamily: "Inter_900Black", fontVariant: ["tabular-nums"], letterSpacing: -0.5 },
  sub: { fontSize: 12, fontFamily: "Inter_500Medium" },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
});
