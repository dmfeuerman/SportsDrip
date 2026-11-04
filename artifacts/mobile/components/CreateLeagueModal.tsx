import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Switch, TouchableOpacity } from "@/components/fx/Tap";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import NumericInput from "@/components/NumericInput";
import { CloseButton } from "@/components/ui";
import {
  BUY_IN_OPTIONS,
  DEFAULT_DURATION,
  DURATION_DAYS,
  DURATION_OPTIONS,
  LEAGUE_MODES,
  MATCHUP_CADENCES,
  type LeagueMode,
  type MatchupCadence,
  TOKEN_START_OPTIONS,
  LeagueDuration,
  PRIZE_PRESETS,
  PrizeDistribution,
  Sport,
  SPORT_ICONS,
} from "@/constants/leagueTypes";
import { useColors } from "@/hooks/useColors";
import { flatInterest } from "@/lib/loanMath";
import { fmtDate, fullSeasonPlan } from "@/constants/seasons";

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
    mode?: LeagueMode,
    matchupsEnabled?: boolean,
    matchupCadence?: MatchupCadence,
    stimulusEnabled?: boolean,
  ) => Promise<string | null>;
}

// Must match functions/src/lib/leagueConfig.ts — the server rejects anything else.
const TOKEN_OPTIONS = TOKEN_START_OPTIONS;
const SPORT_OPTIONS: Sport[] = ["NFL", "NBA", "MLB", "NHL", "NCAAF", "NCAAB", "Soccer"];

interface Template {
  id: string;
  label: string;
  icon: string;
  /** What you get, in a sentence or two — shown when the template is selected. */
  desc: string;
  mode: LeagueMode;
  tokens: number;
  buyIn: number;
  duration: LeagueDuration;
  bankLoanEnabled: boolean;
  matchupsEnabled: boolean;
  matchupCadence: MatchupCadence;
  stimulusEnabled: boolean;
}

const TEMPLATES: Template[] = [
  {
    id: "sweat",
    label: "Season Sweat",
    icon: "fire",
    desc: "A month-long bankroll league: everyone starts with 10K tokens, bets at real odds and can borrow from the bank, with a new head-to-head opponent every Monday. Highest net worth takes the 100-credit-a-head pot.",
    mode: "bankroll",
    tokens: 10_000,
    buyIn: 100,
    duration: "1 Month",
    bankLoanEnabled: true,
    matchupsEnabled: true,
    matchupCadence: "weekly",
    stimulusEnabled: false,
  },
  {
    id: "h2h",
    label: "H2H Showdown",
    icon: "sword-cross",
    desc: "Matchups only: twice a week you're paired with one league-mate, and whoever grows their stack more wins the round. The table goes by W-L record and the last round is a playoff. Free to join.",
    mode: "matchups",
    tokens: 10_000,
    buyIn: 0,
    duration: "1 Month",
    bankLoanEnabled: false,
    matchupsEnabled: true,
    matchupCadence: "twice-weekly",
    stimulusEnabled: false,
  },
  {
    id: "season",
    label: "Full Season",
    icon: "calendar-star",
    desc: "Runs until the last of your sports crowns a champion (see the end date below). 25K tokens, weekly matchups, and the bank can vote everyone a stimulus if stacks run dry over the long haul.",
    mode: "bankroll",
    tokens: 25_000,
    buyIn: 250,
    duration: "Full Season",
    bankLoanEnabled: true,
    matchupsEnabled: true,
    matchupCadence: "weekly",
    stimulusEnabled: true,
  },
  {
    id: "high",
    label: "High Rollers",
    icon: "diamond-stone",
    desc: "Three months, 50K-token stacks and a 1,000-credit buy-in. Bank loans and weekly matchups are on — for groups that want big swings and a big pot.",
    mode: "bankroll",
    tokens: 50_000,
    buyIn: 1_000,
    duration: "3 Months",
    bankLoanEnabled: true,
    matchupsEnabled: true,
    matchupCadence: "weekly",
    stimulusEnabled: false,
  },
  {
    id: "pickem",
    label: "Weekly Pick'em",
    icon: "checkbox-marked-circle-outline",
    desc: "No stakes to manage: pick straight-up winners each week, 1 point per correct pick. Most points after a month wins. Free to join.",
    mode: "pickem",
    tokens: 10_000,
    buyIn: 0,
    duration: "1 Month",
    bankLoanEnabled: false,
    matchupsEnabled: true,
    matchupCadence: "weekly",
    stimulusEnabled: false,
  },
  {
    id: "survivor",
    label: "Survivor Pool",
    icon: "skull-outline",
    desc: "Pick one team to win each week and never the same team twice. Lose — or miss a week — and you're out. Last one standing takes the 250-credit-a-head pot.",
    mode: "survivor",
    tokens: 10_000,
    buyIn: 250,
    duration: "3 Months",
    bankLoanEnabled: false,
    matchupsEnabled: false,
    matchupCadence: "weekly",
    stimulusEnabled: false,
  },
];

export default function CreateLeagueModal({
  visible,
  onClose,
  yourTokens,
  onConfirm,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<LeagueMode>("bankroll");
  const [matchupsEnabled, setMatchupsEnabled] = useState(true);
  const [matchupCadence, setMatchupCadence] = useState<MatchupCadence>("weekly");
  const [stimulusEnabled, setStimulusEnabled] = useState(false);
  const [startingLeagueTokens, setStartingLeagueTokens] = useState(10_000);
  const [duration, setDuration] = useState<LeagueDuration>(DEFAULT_DURATION);
  const [sports, setSports] = useState<Sport[]>([...SPORT_OPTIONS]);
  const [buyIn, setBuyIn] = useState(0);
  const [selectedPreset, setSelectedPreset] =
    useState<PrizeDistribution["preset"]>("winner-all");

  // Bank loan settings
  const [bankLoanEnabled, setBankLoanEnabled] = useState(true);
  const [bankInterestRate, setBankInterestRate] = useState("10");

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

  function applyTemplate(t: Template) {
    setMode(t.mode);
    setStartingLeagueTokens(t.tokens);
    setBuyIn(t.buyIn <= yourTokens ? t.buyIn : 0);
    setDuration(t.duration);
    setBankLoanEnabled(t.bankLoanEnabled);
    setMatchupsEnabled(t.matchupsEnabled);
    setMatchupCadence(t.matchupCadence);
    setStimulusEnabled(t.stimulusEnabled);
  }

  // A template stays selected only while the form still matches it; change a
  // setting and it's your own league again.
  const activeTemplate = TEMPLATES.find(
    (t) =>
      t.mode === mode &&
      t.tokens === startingLeagueTokens &&
      (t.buyIn <= yourTokens ? t.buyIn : 0) === buyIn &&
      t.duration === duration &&
      t.bankLoanEnabled === bankLoanEnabled &&
      (t.mode === "matchups" || t.matchupsEnabled === matchupsEnabled) &&
      (!t.matchupsEnabled || t.matchupCadence === matchupCadence) &&
      t.stimulusEnabled === stimulusEnabled
  );
  const h2hOn = mode === "matchups" || matchupsEnabled;
  const season = duration === "Full Season" ? fullSeasonPlan(sports, Date.now()) : null;

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
      24, // legacy interval; loans are flat-fee and don't accrue over time
      mode,
      mode === "matchups" || matchupsEnabled,
      matchupCadence,
      stimulusEnabled,
    );
    setSubmitting(false);
    // Keep the form on failure so nothing the user typed is lost.
    if (err) {
      setSubmitError(err);
      return;
    }
    // Reset
    setName("");
    setMode("bankroll");
    setMatchupsEnabled(true);
    setMatchupCadence("weekly");
    setStimulusEnabled(false);
    setStartingLeagueTokens(10_000);
    setDuration("1 Month");
    setSports([...SPORT_OPTIONS]);
    setBuyIn(0);
    setSelectedPreset("winner-all");
    setBankLoanEnabled(true);
    setBankInterestRate("10");
    onClose();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      {/* Keeps the name / custom-amount inputs above the keyboard (see KeyboardSheet). */}
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
      <TouchableOpacity
        style={styles.overlay}
        activeOpacity={1}
        onPress={onClose}
      />
      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: colors.border }]} />
        <ScrollView showsVerticalScrollIndicator={false} bounces={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
          <Text style={[styles.title, { color: colors.foreground }]}>
            Create League
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Share the invite code with friends. Winners earn credits from
            the prize pot.
          </Text>

          {/* Quick-start templates */}
          <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 4 }]}>
            QUICK-START TEMPLATES
          </Text>
          <View style={styles.optionRow}>
            {TEMPLATES.map((t) => {
              const on = activeTemplate?.id === t.id;
              const onFg = colors.isDark ? "#05200F" : "#FFFFFF";
              return (
                <TouchableOpacity
                  key={t.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={[
                    styles.optionChip,
                    on
                      ? { backgroundColor: colors.positive, borderColor: colors.positive }
                      : { backgroundColor: colors.secondary, borderColor: colors.border },
                  ]}
                  onPress={() => applyTemplate(t)}
                  activeOpacity={0.8}
                >
                  <MaterialCommunityIcons name={(on ? "check-circle" : t.icon) as any} size={13} color={on ? onFg : colors.primary} />
                  <Text style={[styles.optionText, { color: on ? onFg : colors.foreground }]}>{t.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {activeTemplate ? (
            <View style={[styles.templateInfo, { backgroundColor: colors.positive + "14", borderColor: colors.positive + "66" }]}>
              <MaterialCommunityIcons name={activeTemplate.icon as any} size={16} color={colors.positive} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={[styles.templateTitle, { color: colors.positive }]}>{activeTemplate.label} template</Text>
                <Text style={[styles.templateDesc, { color: colors.foreground }]}>{activeTemplate.desc}</Text>
                <Text style={[styles.templateDesc, { color: colors.mutedForeground }]}>
                  Everything below is filled in for you — change anything you like.
                </Text>
              </View>
            </View>
          ) : (
            <Text style={[styles.durationHint, { color: colors.subtleForeground, marginTop: 6 }]}>
              Tap a template to fill in the settings below in one go.
            </Text>
          )}

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

          {/* League Mode */}
          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            LEAGUE FORMAT
          </Text>
          <View style={styles.presetList}>
            {LEAGUE_MODES.map((m) => {
              const active = mode === m.value;
              return (
                <TouchableOpacity
                  key={m.value}
                  style={[
                    styles.presetRow,
                    {
                      backgroundColor: active ? colors.primary + "11" : colors.secondary,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setMode(m.value)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.presetRadio, { borderColor: active ? colors.primary : colors.border }]}>
                    {active && <View style={[styles.presetRadioFill, { backgroundColor: colors.primary }]} />}
                  </View>
                  <View style={styles.presetInfo}>
                    <Text style={[styles.presetLabel, { color: colors.foreground }]}>{m.label}</Text>
                    <Text style={[styles.presetSplit, { color: colors.mutedForeground }]}>{m.desc}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

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
          {season ? (
            <View style={[styles.seasonCard, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "55" }]}>
              <View style={styles.seasonHead}>
                <MaterialCommunityIcons name="calendar-range" size={16} color={colors.primary} />
                <Text style={[styles.seasonEnd, { color: colors.foreground }]}>
                  Ends {fmtDate(season.end)}
                </Text>
                <Text style={[styles.seasonLen, { color: colors.primary }]}>
                  {season.days >= 60 ? `~${Math.round(season.days / 30.4)} months` : `${Math.round(season.days / 7)} weeks`}
                </Text>
              </View>
              {sports.length === 0 ? (
                <Text style={[styles.templateDesc, { color: colors.mutedForeground }]}>Pick at least one sport above.</Text>
              ) : (
                <>
                  {season.seasons.map((x) => (
                    <View key={x.sport} style={styles.seasonRow}>
                      <MaterialCommunityIcons name={SPORT_ICONS[x.sport] as any} size={13} color={colors.mutedForeground} />
                      <Text style={[styles.seasonSport, { color: colors.foreground }]}>{x.sport} {x.label}</Text>
                      <Text style={[styles.templateDesc, { color: colors.mutedForeground, flex: 1, textAlign: "right" }]}>
                        {x.current ? "in progress" : `starts ${fmtDate(x.start, false)}`} · {x.finale} ~{fmtDate(x.end)}
                      </Text>
                    </View>
                  ))}
                  {season.decidedBy ? (
                    <Text style={[styles.templateDesc, { color: colors.foreground }]}>
                      The league runs until the last sport finishes — here the {season.decidedBy.sport} {season.decidedBy.finale}.
                      {season.seasons.some((x) => !x.current)
                        ? " Sports whose season is over half done (or not started) count from their next full season, so it can run well into next year."
                        : ""}
                    </Text>
                  ) : null}
                  {season.days > 200 ? (
                    <Text style={[styles.templateDesc, { color: colors.warning }]}>
                      That's a long season — make sure everyone's in for {Math.round(season.days / 30.4)} months. Drop a sport to end sooner.
                    </Text>
                  ) : null}
                </>
              )}
            </View>
          ) : (
            <Text style={[styles.durationHint, { color: colors.subtleForeground }]}>
              {DURATION_DAYS[duration as Exclude<LeagueDuration, "Full Season">] / 7} weeks · ends{" "}
              {fmtDate(Date.now() + DURATION_DAYS[duration as Exclude<LeagueDuration, "Full Season">] * 86_400_000, false)}
              . Leagues run at least a month so the table has time to mean something. Pick Full Season to follow your sports' calendars.
            </Text>
          )}

          {/* Weekly H2H Matchups toggle */}
          <View
            style={[
              styles.bankCard,
              { backgroundColor: colors.secondary, borderColor: colors.border },
            ]}
          >
            <View style={styles.bankToggleRow}>
              <View style={styles.bankToggleLeft}>
                <MaterialCommunityIcons
                  name="sword-cross"
                  size={16}
                  color={matchupsEnabled ? colors.primary : colors.mutedForeground}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.bankToggleTitle, { color: colors.foreground }]}>
                    Head-to-Head Matchups
                  </Text>
                  <Text style={[styles.bankToggleDesc, { color: colors.mutedForeground }]}>
                    {mode === "matchups"
                      ? "Always on in an H2H League — pick how often opponents change"
                      : "Pair members each round + a final playoff round"}
                  </Text>
                </View>
              </View>
              {mode !== "matchups" ? (
                <Switch
                  value={matchupsEnabled}
                  onValueChange={setMatchupsEnabled}
                  trackColor={{ false: colors.border, true: colors.primary }}
                  thumbColor={matchupsEnabled ? colors.primaryForeground : colors.mutedForeground}
                />
              ) : null}
            </View>
            {h2hOn ? (
              <View style={[styles.bankOptions, { borderTopColor: colors.border, marginTop: 12 }]}>
                <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 12 }]}>HOW OFTEN</Text>
                <View style={styles.optionRow}>
                  {MATCHUP_CADENCES.map((m) => {
                    const on = matchupCadence === m.value;
                    return (
                      <TouchableOpacity
                        key={m.value}
                        style={[
                          styles.optionChip,
                          { backgroundColor: on ? colors.primary : colors.card, borderColor: on ? colors.primary : colors.border },
                        ]}
                        onPress={() => setMatchupCadence(m.value)}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.optionText, { color: on ? colors.primaryForeground : colors.mutedForeground }]}>{m.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={[styles.durationHint, { color: colors.subtleForeground }]}>
                  {MATCHUP_CADENCES.find((m) => m.value === matchupCadence)?.desc}. Whoever grows their net worth more in a round wins it.
                </Text>
              </View>
            ) : null}
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
                  FLAT INTEREST (% of amount borrowed, charged once, 0.5–50)
                </Text>
                <NumericInput
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
                    Flat interest: borrow 1,000 and repay{" "}
                    {(1000 + flatInterest(1000, rateNum || 0)).toLocaleString()} — no more, however
                    long it takes. Members can borrow up to the starting stack. Rate changes
                    only affect new loans.
                  </Text>
                </View>
              </View>
            )}
          </View>

          {/* Bank stimulus votes */}
          <View style={[styles.bankCard, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
            <View style={styles.bankToggleRow}>
              <View style={styles.bankToggleLeft}>
                <MaterialCommunityIcons name="cash-plus" size={16} color={stimulusEnabled ? colors.positive : colors.mutedForeground} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.bankToggleTitle, { color: colors.foreground }]}>Stimulus Votes</Text>
                  <Text style={[styles.bankToggleDesc, { color: colors.mutedForeground }]}>
                    Anyone can ask the bank to give every member 10–50% of the starting stack. A majority yes pays everyone the same amount — free, not a loan. Once a week at most.
                  </Text>
                </View>
              </View>
              <Switch
                value={stimulusEnabled}
                onValueChange={setStimulusEnabled}
                trackColor={{ false: colors.border, true: colors.positive }}
                thumbColor={stimulusEnabled ? "#FFFFFF" : colors.mutedForeground}
                accessibilityLabel="Stimulus votes"
              />
            </View>
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
        <CloseButton onPress={onClose} style={styles.close} />
      </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  close: { position: "absolute", top: 12, right: 16 },
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
  title: { fontSize: 22, fontFamily: "Inter_900Black", marginBottom: 6 },
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
  durationHint: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 8 },
  templateInfo: { flexDirection: "row", gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, marginTop: 10, alignItems: "flex-start" },
  templateTitle: { fontSize: 13, fontFamily: "Inter_700Bold" },
  templateDesc: { fontSize: 12, lineHeight: 17, fontFamily: "Inter_400Regular" },
  seasonCard: { gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, marginTop: 10 },
  seasonHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  seasonEnd: { flex: 1, fontSize: 15, fontFamily: "Inter_700Bold" },
  seasonLen: { fontSize: 12, fontFamily: "Inter_700Bold" },
  seasonRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  seasonSport: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
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
