import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Amount, Button, Card, Pill } from "@/components/ui";
import type { LeagueLoan } from "@/constants/leagueTypes";
import { useColors } from "@/hooks/useColors";
import { applyRepayment, loanSnapshot } from "@/lib/loanMath";
import { untilKickoff } from "@/lib/odds";

function periodLabel(h: number) {
  return h === 1 ? "hour" : h === 24 ? "day" : h === 168 ? "week" : `${h}h`;
}

/**
 * One loan, fully itemised: original principal, what's been repaid, interest
 * charged and paid, and the total owed now — all simple interest, all computed
 * by the same loanMath the server settles with. The repay form previews the
 * split (interest first, then principal) before anything is sent.
 */
export default function LoanCard({
  loan,
  now,
  viewer,
  tokens,
  onRepay,
}: {
  loan: LeagueLoan;
  now: number;
  /** "borrower" can repay; "lender" sees a receivable. */
  viewer: "borrower" | "lender" | "observer";
  tokens: number;
  onRepay?: (amount: number) => Promise<string | null>;
}) {
  const c = useColors();
  const snap = loanSnapshot(loan, now);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pay = Math.min(Number.parseInt(amount, 10) || 0, tokens);
  const preview = useMemo(() => (pay > 0 ? applyRepayment(loan, pay, now) : null), [loan, pay, now]);
  const repaid = loan.status === "repaid";
  const counterparty = loan.kind === "bank" ? "League Bank" : viewer === "lender" ? loan.borrowerName : loan.lenderName ?? "—";

  async function submit() {
    if (!onRepay || pay <= 0) return;
    setBusy(true);
    setErr(null);
    const e = await onRepay(pay);
    setBusy(false);
    if (e) setErr(e);
    else {
      setAmount("");
      setOpen(false);
    }
  }

  return (
    <Card tone={repaid ? undefined : viewer === "lender" ? "league" : "debt"} style={styles.card}>
      <View style={styles.head}>
        <View style={[styles.icon, { backgroundColor: viewer === "lender" ? c.leagueSoft : c.debtSoft }]}>
          <MaterialCommunityIcons name={loan.kind === "bank" ? "bank-outline" : "handshake-outline"} size={18} color={viewer === "lender" ? c.league : c.debt} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: c.foreground }]} numberOfLines={1}>
            {viewer === "lender" ? `${loan.borrowerName} owes you` : `From ${counterparty}`}
          </Text>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>
            {loan.ratePct}% simple per {periodLabel(loan.intervalHours)} · on remaining principal
          </Text>
        </View>
        {repaid ? <Pill label="Paid off" tone="positive" icon="check" /> : null}
      </View>

      <View style={styles.owedRow}>
        <View>
          <Text style={[styles.k, { color: c.subtleForeground }]}>{repaid ? "SETTLED" : viewer === "lender" ? "OWED TO YOU" : "TOTAL OWED"}</Text>
          <Amount value={snap.totalOwed} currency="league" size="lg" tone={repaid ? "neutral" : viewer === "lender" ? "league" : "debt"} />
        </View>
        {!repaid && snap.nextAccrualAt ? (
          <View style={{ alignItems: "flex-end" }}>
            <Text style={[styles.k, { color: c.subtleForeground }]}>NEXT CHARGE</Text>
            <Text style={[styles.v, { color: c.foreground }]}>+{snap.nextPeriodInterest.toLocaleString()}</Text>
            <Text style={[styles.sub, { color: c.mutedForeground }]}>{untilKickoff(snap.nextAccrualAt, now)}</Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.grid, { borderTopColor: c.border }]}>
        <Cell label="Original principal" value={snap.principal} />
        <Cell label="Principal left" value={snap.principalOutstanding} />
        <Cell label="Interest charged" value={snap.interestCharged} />
        <Cell label="Interest paid" value={snap.interestPaid} />
      </View>

      {viewer === "borrower" && !repaid && onRepay && (
        <>
          {!open ? (
            <Button label="Repay" icon="cash-refund" variant="secondary" onPress={() => setOpen(true)} />
          ) : (
            <View style={{ gap: 8 }}>
              <View style={[styles.input, { borderColor: c.border, backgroundColor: c.secondary }]}>
                <MaterialCommunityIcons name="shield-star" size={18} color={c.league} />
                <TextInput
                  style={[styles.inputText, { color: c.foreground }]}
                  value={amount}
                  onChangeText={(t) => setAmount(t.replace(/[^0-9]/g, ""))}
                  keyboardType="number-pad"
                  placeholder={`Up to ${Math.min(snap.totalOwed, tokens).toLocaleString()}`}
                  placeholderTextColor={c.subtleForeground}
                  accessibilityLabel="Repayment amount"
                  autoFocus
                />
              </View>
              <View style={styles.quick}>
                {snap.interestOutstanding > 0 && (
                  <Button size="sm" variant="secondary" label="Interest only" onPress={() => setAmount(String(Math.min(snap.interestOutstanding, tokens)))} />
                )}
                <Button size="sm" variant="secondary" label="Pay it off" onPress={() => setAmount(String(Math.min(snap.totalOwed, tokens)))} />
              </View>
              {preview && (
                <Text style={[styles.sub, { color: c.mutedForeground }]}>
                  {preview.toInterest.toLocaleString()} to interest, {preview.toPrincipal.toLocaleString()} to principal.{" "}
                  {preview.settled ? "This closes the loan." : `You'll still owe ${loanSnapshot(preview.loan, now).totalOwed.toLocaleString()}.`}
                </Text>
              )}
              {pay > 0 && pay >= tokens && tokens < snap.totalOwed ? (
                <Text style={[styles.sub, { color: c.warning }]}>That's every league token you have.</Text>
              ) : null}
              {err ? <Text style={[styles.sub, { color: c.negative }]}>{err}</Text> : null}
              <View style={styles.quick}>
                <Button label="Cancel" variant="ghost" style={{ flex: 1 }} onPress={() => setOpen(false)} />
                <Button label={pay > 0 ? `Repay ${pay.toLocaleString()}` : "Repay"} style={{ flex: 1 }} variant="league" onPress={submit} loading={busy} disabled={pay <= 0} />
              </View>
            </View>
          )}
        </>
      )}
    </Card>
  );
}

function Cell({ label, value }: { label: string; value: number }) {
  const c = useColors();
  return (
    <View style={styles.cell}>
      <Text style={[styles.k, { color: c.subtleForeground }]}>{label.toUpperCase()}</Text>
      <Text style={[styles.v, { color: c.foreground }]}>{value.toLocaleString()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 15, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  owedRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  k: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  v: { fontSize: 15, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  grid: { flexDirection: "row", flexWrap: "wrap", borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, rowGap: 10 },
  cell: { width: "50%", gap: 2 },
  input: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  inputText: { flex: 1, fontSize: 18, fontFamily: "Inter_700Bold", fontVariant: ["tabular-nums"] },
  quick: { flexDirection: "row", gap: 8 },
});
