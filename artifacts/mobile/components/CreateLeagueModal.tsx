import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  BUY_IN_OPTIONS,
  TOKEN_START_OPTIONS,
  LeagueDuration,
  PRIZE_PRESETS,
  PrizeDistribution,
  Sport,
  SPORT_ICONS,
} from "@/constants/leagueTypes";
import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  onClose: () => void;
  yourTokens: number;
  onConfirm: (
    name: string,
    startingLeagueTokens: number,
    duration: LeagueDuration,
    sports: Sport[],
    buyIn: number,
    prizeDistribution: PrizeDistribution,
    bankLoanEnabled: boolean,
    bankInterestRate: number,
    bankInterestIntervalHours: number,
  ) => Promise<string | null>;
}

// Must match functions/src/lib/leagueConfig.ts — the server rejects anything else.
const TOKEN_OPTIONS = TOKEN_START_OPTIONS;
const DURATION_OPTIONS: LeagueDuration[] = [
  "1 Week",
  "2 Weeks",
  "1 Month",
  "3 Months",
];
const SPORT_OPTIONS: Sport[] = ["NFL", "NBA", "MLB", "NHL", "Soccer"];
const INTERVAL_OPTIONS = [
  { label: "Hourly", hours: 1 },
  { label: "6 Hours", hours: 6 },
  { label: "Daily", hours: 24 },
  { label: "Weekly", hours: 168 },
];

export default function CreateLeagueModal({
  visible,
  onClose,
  yourTokens,
  onConfirm,
}: Props) {
  const colors = useColors();
  const [name, setName] = useState("");
  const [startingLeagueTokens, setStartingLeagueTokens] = useState(10_000);
  const [duration, setDuration] = useState<LeagueDuration>("1 Month");
  const [sports, setSports] = useState<Sport[]>([...SPORT_OPTIONS]);
  const [buyIn, setBuyIn] = useState(0);
  const [selectedPreset, setSelectedPreset] =
    useState<PrizeDistribution["preset"]>("winner-all");

  // Bank loan settings
  const [bankLoanEnabled, setBankLoanEnabled] = useState(false);
  const [bankInterestRate, setBankInterestRate] = useState("10");
  const [bankIntervalHours, setBankIntervalHours] = useState(24);

  const preset = PRIZE_PRESETS.find((p) => p.value === selectedPreset)!;
  const prizeDistribution: PrizeDistribution = {
    preset: selectedPreset,
    firstPct: preset.firstPct,
    secondPct: preset.secondPct,
    thirdPct: preset.thirdPct,
  };

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const rateNum = parseFloat(bankInterestRate);

  const canCreate =
    !submitting &&
    name.trim().length > 0 &&
    sports.length > 0 &&
    buyIn <= yourTokens &&
    (!bankLoanEnabled ||
      (rateNum >= 0.5 && rateNum <= 50));

  function toggleSport(sport: Sport) {
    setSports((prev) =>
      prev.includes(sport) ? prev.filter((s) => s !== sport) : [...prev, sport],
    );
  }

  async function handleConfirm() {
    if (!canCreate) return;
    const rate = parseFloat(bankInterestRate) || 10;
    setSubmitting(true);
    setSubmitError(null);
    const err = await onConfirm(
      name.trim(),
      startingLeagueTokens,
      duration,
      sports,
      buyIn,
      prizeDistribution,
      bankLoanEnabled,
      rate,
      bankIntervalHours,
    );
    setSubmitting(false);
    // Keep the form on failure so nothing the user typed is lost.
    if (err) {
      setSubmitError(err);
      return;
    }
    // Reset
    setName("");
    setStartingLeagueTokens(10_000);
    setDuration("1 Month");
    setSports([...SPORT_OPTIONS]);
    setBuyIn(0);
    setSelectedPreset("winner-all");
    setBankLoanEnabled(false);
    setBankInterestRate("10");
    setBankIntervalHours(24);
    onClose();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      />
      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: colors.border }]} />
        <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Create League
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Share the invite code with friends. Winners earn credits from
            the prize pot.
          </Text>

          {/* League name */}
          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            LEAGUE NAME
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.secondary,
              },
            ]}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Friday Night Degenz"
            placeholderTextColor={colors.mutedForeground}
            maxLength={32}
          />

          {/* Starting league tokens */}
          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            LEAGUE TOKENS (per player)
          </Text>
          <View
            style={[
              styles.infoBox,
              {
                backgroundColor: colors.secondary + "88",
                borderColor: colors.border,
              },
            ]}
          >
            <MaterialCommunityIcons
              name="information-outline"
              size={13}
              color={colors.mutedForeground}
            />
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
              Separate from your credits — only usable within this league
            </Text>
          </View>
          <View style={styles.optionRow}>
            {TOKEN_OPTIONS.map((t) => {
              const active = startingLeagueTokens === t;
              return (
                <TouchableOpacity
                  key={t}
                  style={[
                    styles.optionChip,
                    {
                      backgroundColor: active
                        ? colors.primary
                        : colors.secondary,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setStartingLeagueTokens(t)}
                  activeOpacity={0.8}
                >
                  <MaterialCommunityIcons
                    name="shield-star"
                    size={11}
                    color={
                      active ? colors.primaryForeground : colors.mutedForeground
                    }
                  />
                  <Text
                    style={[
                      styles.optionText,
                      {
                        color: active
                          ? colors.primaryForeground
                          : colors.mutedForeground,
                      },
                    ]}
                  >
                    {t >= 1000
                      ? `${(t / 1000).toFixed(0)}K`
                      : t.toLocaleString()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Buy-in */}
          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            BUY-IN (credits)
          </Text>
          <View
            style={[
              styles.infoBox,
              {
                backgroundColor: colors.accent + "11",
                borderColor: colors.accent + "44",
              },
            ]}
          >
            <MaterialCommunityIcons
              name="lightning-bolt"
              size={13}
              color={colors.accent}
            />
            <Text style={[styles.infoText, { color: colors.accent }]}>
              Credits paid into the pot — paid out to the top finishers when the season ends
            </Text>
          </View>
          <View style={styles.optionRow}>
            {BUY_IN_OPTIONS.map((b) => {
              const active = buyIn === b;
              const tooExpensive = b > yourTokens;
              return (
                <TouchableOpacity
                  key={b}
                  style={[
                    styles.optionChip,
                    {
                      backgroundColor: active
                        ? colors.accent
                        : colors.secondary,
                      borderColor: active
                        ? colors.accent
                        : tooExpensive
                          ? colors.destructive + "44"
                          : colors.border,
                      opacity: tooExpensive ? 0.5 : 1,
                    },
                  ]}
                  onPress={() => !tooExpensive && setBuyIn(b)}
                  activeOpacity={0.8}
                  disabled={tooExpensive}
                >
                  <Text
                    style={[
                      styles.optionText,
                      {
                        color: active
                          ? "#FFF"
                          : tooExpensive
                            ? colors.destructive
                            : colors.mutedForeground,
                      },
                    ]}
                  >
                    {b === 0
                      ? "Free"
                      : b >= 1000
                        ? `⚡${(b / 1000).toFixed(0)}K`
                        : `⚡${b}`}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Prize pot note */}
          {buyIn > 0 && (
            <View
              style={[
                styles.potPreview,
                {
                  backgroundColor: colors.accent + "11",
                  borderColor: colors.accent + "44",
                },
              ]}
            >
              <Text style={[styles.potLabel, { color: colors.accent }]}>
                PRIZE POT
              </Text>
              <Text style={[styles.potNote, { color: colors.mutedForeground }]}>
                Starts at ⚡{buyIn.toLocaleString()} — grows as members join
              </Text>
            </View>
          )}

          {/* Prize distribution */}
          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            PRIZE DISTRIBUTION
          </Text>
          <View style={styles.presetList}>
            {PRIZE_PRESETS.map((p) => {
              const active = selectedPreset === p.value;
              return (
                <TouchableOpacity
                  key={p.value}
                  style={[
                    styles.presetRow,
                    {
                      backgroundColor: active
                        ? colors.primary + "11"
                        : colors.secondary,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setSelectedPreset(p.value)}
                  activeOpacity={0.8}
                >
                  <View
                    style={[
                      styles.presetRadio,
                      { borderColor: active ? colors.primary : colors.border },
                    ]}
                  >
                    {active && (
                      <View
                        style={[
                          styles.presetRadioFill,
                          { backgroundColor: colors.primary },
                        ]}
                      />
                    )}
                  </View>
                  <View style={styles.presetInfo}>
                    <Text
                      style={[styles.presetLabel, { color: colors.foreground }]}
                    >
                      {p.label}
                    </Text>
                    <Text
                      style={[
                        styles.presetSplit,
                        { color: colors.mutedForeground },
                      ]}
                    >
                      {p.firstPct}%{p.secondPct > 0 ? ` / ${p.secondPct}%` : ""}
                      {p.thirdPct > 0 ? ` / ${p.thirdPct}%` : ""}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Duration */}
          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            LEAGUE DURATION
          </Text>
          <View style={styles.optionRow}>
            {DURATION_OPTIONS.map((d) => {
              const active = duration === d;
              return (
                <TouchableOpacity
                  key={d}
                  style={[
                    styles.optionChip,
                    {
                      backgroundColor: active
                        ? colors.primary
                        : colors.secondary,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setDuration(d)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.optionText,
                      {
                        color: active
                          ? colors.primaryForeground
                          : colors.mutedForeground,
                      },
                    ]}
                  >
                    {d}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Sports */}
          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            ALLOWED SPORTS
          </Text>
          <View style={styles.sportGrid}>
            {SPORT_OPTIONS.map((sport) => {
              const active = sports.includes(sport);
              return (
                <TouchableOpacity
                  key={sport}
                  style={[
                    styles.sportChip,
                    {
                      backgroundColor: active
                        ? colors.primary + "22"
                        : colors.secondary,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => toggleSport(sport)}
                  activeOpacity={0.8}
                >
                  <MaterialCommunityIcons
                    name={SPORT_ICONS[sport] as any}
                    size={16}
                    color={active ? colors.primary : colors.mutedForeground}
                  />
                  <Text
                    style={[
                      styles.sportText,
                      {
                        color: active ? colors.primary : colors.mutedForeground,
                      },
                    ]}
                  >
                    {sport}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Bank loan feature */}
          <View
            style={[
              styles.bankCard,
              { backgroundColor: colors.secondary, borderColor: colors.border },
            ]}
          >
            <View style={styles.bankToggleRow}>
              <View style={styles.bankToggleLeft}>
                <MaterialCommunityIcons
                  name="bank"
                  size={16}
                  color={bankLoanEnabled ? colors.accent : colors.mutedForeground}
                />
                <View>
                  <Text
                    style={[
                      styles.bankToggleTitle,
                      { color: colors.foreground },
                    ]}
                  >
                    League Bank Loans
                  </Text>
                  <Text
                    style={[
                      styles.bankToggleDesc,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    Let members borrow league tokens at interest
                  </Text>
                </View>
              </View>
              <Switch
                value={bankLoanEnabled}
                onValueChange={setBankLoanEnabled}
                trackColor={{ false: colors.border, true: colors.accent }}
                thumbColor={bankLoanEnabled ? colors.accentForeground : colors.mutedForeground}
              />
            </View>

            {bankLoanEnabled && (
              <View
                style={[styles.bankOptions, { borderTopColor: colors.border }]}
              >
                <Text
                  style={[
                    styles.label,
                    { color: colors.mutedForeground, marginTop: 12 },
                  ]}
                >
                  SIMPLE INTEREST (% of principal per period, 0.5–50)
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    {
                      color: colors.foreground,
                      borderColor: colors.border,
                      backgroundColor: colors.card,
                    },
                  ]}
                  value={bankInterestRate}
                  onChangeText={setBankInterestRate}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 10"
                  placeholderTextColor={colors.mutedForeground}
                  maxLength={5}
                />
                <Text
                  style={[
                    styles.label,
                    { color: colors.mutedForeground, marginTop: 8 },
                  ]}
                >
                  INTEREST PERIOD
                </Text>
                <View style={styles.optionRow}>
                  {INTERVAL_OPTIONS.map((opt) => {
                    const active = bankIntervalHours === opt.hours;
                    return (
                      <TouchableOpacity
                        key={opt.hours}
                        style={[
                          styles.optionChip,
                          {
                            backgroundColor: active ? colors.accent : colors.card,
                            borderColor: active ? colors.accent : colors.border,
                          },
                        ]}
                        onPress={() => setBankIntervalHours(opt.hours)}
                        activeOpacity={0.8}
                      >
                        <Text
                          style={[
                            styles.optionText,
                            { color: active ? colors.accentForeground : colors.mutedForeground },
                          ]}
                        >
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View
                  style={[
                    styles.bankSummary,
                    { backgroundColor: colors.accent + "14", borderColor: colors.accent + "44" },
                  ]}
                >
                  <MaterialCommunityIcons
                    name="information-outline"
                    size={12}
                    color={colors.accent}
                  />
                  <Text style={[styles.bankSummaryText, { color: colors.accent }]}>
                    Simple interest: borrowing 1,000 costs{" "}
                    {Math.round((1000 * (rateNum || 0)) / 100).toLocaleString()} per{" "}
                    {INTERVAL_OPTIONS.find(
                      (o) => o.hours === bankIntervalHours,
                    )?.label.toLowerCase() ?? "period"}
                    , charged on what's still borrowed — never on interest. Members can
                    borrow up to the starting stack. Rate changes only affect new loans.
                  </Text>
                </View>
              </View>
            )}
          </View>

          {/* Cost summary */}
          {buyIn > 0 && (
            <View
              style={[
                styles.costSummary,
                {
                  backgroundColor: colors.secondary,
                  borderColor: colors.border,
                },
              ]}
            >
              <View style={styles.costRow}>
                <Text
                  style={[styles.costLabel, { color: colors.mutedForeground }]}
                >
                  Your balance
                </Text>
                <View style={styles.costValueRow}>
                  <MaterialCommunityIcons
                    name="lightning-bolt"
                    size={12}
                    color={colors.foreground}
                  />
                  <Text
                    style={[styles.costValue, { color: colors.foreground }]}
                  >
                    {yourTokens.toLocaleString()}
                  </Text>
                </View>
              </View>
              <View style={styles.costRow}>
                <Text
                  style={[styles.costLabel, { color: colors.mutedForeground }]}
                >
                  Buy-in cost
                </Text>
                <View style={styles.costValueRow}>
                  <MaterialCommunityIcons
                    name="lightning-bolt"
                    size={12}
                    color={colors.destructive}
                  />
                  <Text
                    style={[styles.costValue, { color: colors.destructive }]}
                  >
                    -{buyIn.toLocaleString()}
                  </Text>
                </View>
              </View>
              <View
                style={[styles.costDivider, { backgroundColor: colors.border }]}
              />
              <View style={styles.costRow}>
                <Text
                  style={[styles.costLabel, { color: colors.mutedForeground }]}
                >
                  After joining
                </Text>
                <View style={styles.costValueRow}>
                  <MaterialCommunityIcons
                    name="lightning-bolt"
                    size={12}
                    color={colors.primary}
                  />
                  <Text style={[styles.costValue, { color: colors.primary }]}>
                    {(yourTokens - buyIn).toLocaleString()}
                  </Text>
                </View>
              </View>
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.createBtn,
              {
                backgroundColor: canCreate ? colors.primary : colors.secondary,
              },
            ]}
            onPress={handleConfirm}
            disabled={!canCreate}
            activeOpacity={0.8}
          >
            <MaterialCommunityIcons
              name="trophy"
              size={18}
              color={
                canCreate ? colors.primaryForeground : colors.mutedForeground
              }
            />
            <Text
              style={[
                styles.createBtnText,
                {
                  color: canCreate
                    ? colors.primaryForeground
                    : colors.mutedForeground,
                },
              ]}
            >
              {submitting ? "Creating…" : buyIn > yourTokens ? "Not enough credits" : "Create League"}
            </Text>
          </TouchableOpacity>
          {submitError ? (
            <Text
              accessibilityRole="alert"
              style={{ color: colors.destructive, fontFamily: "Inter_500Medium", fontSize: 13, marginTop: 10, textAlign: "center" }}
            >
              {submitError}
            </Text>
          ) : null}
          <View style={{ height: 32 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: {
    maxHeight: "92%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    padding: 24,
    paddingTop: 16,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  title: { fontSize: 22, fontFamily: "Inter_700Bold", marginBottom: 6 },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", marginBottom: 20 },
  label: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1,
    marginBottom: 8,
    marginTop: 18,
  },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontFamily: "Inter_500Medium",
  },
  infoBox: {
    flexDirection: "row",
    gap: 6,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 10,
    alignItems: "flex-start",
  },
  infoText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular" },
  optionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  optionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
  },
  optionText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  potPreview: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 10,
    gap: 4,
  },
  potLabel: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 1 },
  potNote: { fontSize: 12, fontFamily: "Inter_400Regular" },
  presetList: { gap: 8 },
  presetRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  presetRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  presetRadioFill: { width: 8, height: 8, borderRadius: 4 },
  presetInfo: { flex: 1, gap: 2 },
  presetLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  presetSplit: { fontSize: 12, fontFamily: "Inter_400Regular" },
  sportGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sportChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
  },
  sportText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  bankCard: { borderRadius: 14, borderWidth: 1, padding: 14, marginTop: 18 },
  bankToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  bankToggleLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
  },
  bankToggleTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  bankToggleDesc: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  bankOptions: { borderTopWidth: 1, paddingTop: 4 },
  bankSummary: {
    flexDirection: "row",
    gap: 6,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 10,
    alignItems: "flex-start",
  },
  bankSummaryText: { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular" },
  costSummary: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 16,
    gap: 8,
  },
  costRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  costLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  costValueRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  costValue: { fontSize: 14, fontFamily: "Inter_700Bold" },
  costDivider: { height: 1 },
  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: 14,
    marginTop: 20,
  },
  createBtnText: { fontSize: 16, fontFamily: "Inter_700Bold" },
});
