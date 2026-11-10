import { MaterialCommunityIcons } from "@expo/vector-icons";
import { markPromptResult } from "@/lib/promptGate";
import { haptic as buzz } from "@/lib/motion";
import { router } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Pressable } from "@/components/fx/Tap";
import { SafeAreaView } from "react-native-safe-area-context";
import CharacterDesigner from "@/components/avatar/CharacterDesigner";
import FavoriteTeamsSheet from "@/components/FavoriteTeamsSheet";
import AgeMonthPickerModal, { ageMonthLabel } from "@/components/AgeMonthPickerModal";
import TermsCheckbox from "@/components/TermsCheckbox";
import { AGE_LOCKED_MESSAGE, ageBlocked, passesAgeGate, useAgeGateLocked } from "@/lib/ageGate";
import InviteFriendsCard from "@/components/InviteFriendsCard";
import PushPrimer from "@/components/PushPrimer";
import { useNotifications } from "@/context/NotificationContext";
import { Button } from "@/components/ui";
import { useCatalog } from "@/hooks/useCatalog";
import { DEMO } from "@/lib/demo";
import { extractPhoneDigits, formatPhoneMask } from "@/app/login";
import { markPushPrimerShown, markWalkthroughSeen, pushPrimerDue, setFirstPick, setPendingSignupMeta, usePendingSignupMeta } from "@/lib/settings";
import { pickFeatured } from "@/components/FeaturedGameCard";
import { useGames } from "@/hooks/useGames";
import { formatOdds, kickoffLabel } from "@/lib/odds";

import { SIGNUP_AVATAR } from "@/constants/avatarOptions";
import { doc, getDoc } from "firebase/firestore";
import { useLeague } from "@/context/LeagueContext";
import { trackEvent } from "@/lib/analytics";
import * as api from "@/lib/api";
import { getDb } from "@/lib/firebase";
import { takePendingInvite } from "@/lib/invites";
import { clearPendingReferral, normalizeReferralCode, peekPendingReferral } from "@/lib/referrals";
import { REFERRAL } from "@/constants/progression";
import type { AvatarConfig } from "@/lib/api";
import { useColors } from "@/hooks/useColors";

/**
 * Order follows time-to-value: who you are → call tonight's game → a quick character → your teams →
 * your crew → the push primer → done. The free bet comes later, in the first-bet tutorial on Home. Anything skipped
 * can be finished later (Locker, Friends tab).
 */
type Step = "identity" | "pick" | "appearance" | "teams" | "crew" | "welcome";
const STEP_ORDER: Step[] = ["identity", "pick", "appearance", "teams", "crew", "welcome"];
const NO_SIDES = new Map<string, never[]>();
const NO_FAVS = new Set<string>();

export default function OnboardingScreen() {
  const colors = useColors();
  const pendingMeta = usePendingSignupMeta();

  const [step, setStep] = useState<Step>("identity");
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [teamsSet, setTeamsSet] = useState(false);
  const [primer, setPrimer] = useState(false);
  const { pushStatus, enablePush } = useNotifications();
  // Email sign-up already collected age / birth month, phone and terms: never ask twice.
  const ageFromSignup = !!pendingMeta?.age && !!pendingMeta?.birthMonth;
  const termsFromSignup = !!pendingMeta?.acceptedTerms;
  const phoneFromSignup = extractPhoneDigits(pendingMeta?.phoneNumber ?? "").length === 10;
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [age, setAge] = useState<number | null>(pendingMeta?.age ?? null);
  const [birthMonth, setBirthMonth] = useState<number | null>(pendingMeta?.birthMonth ?? null);
  const [agePickerOpen, setAgePickerOpen] = useState(false);
  const [termsChecked, setTermsChecked] = useState(false);
  const ageLocked = useAgeGateLocked();
  const [phone, setPhone] = useState(pendingMeta?.phoneNumber ?? "");
  // Everyone starts from the same plain base (bald, nothing worn) and builds from there.
  const [avatar, setAvatar] = useState<AvatarConfig>(SIGNUP_AVATAR);
  const [cheer, setCheer] = useState(0);

  // A friend's invite code: pre-filled from a sportdrip://ref link, checked as you type.
  const [refText, setRefText] = useState("");
  const [refCheck, setRefCheck] = useState<
    { state: "idle" | "checking" | "invalid" } | { state: "valid"; name: string; username: string | null }
  >({ state: "idle" });
  const [referred, setReferred] = useState<string | null>(null);
  const refCode = normalizeReferralCode(refText);

  useEffect(() => {
    void peekPendingReferral().then((code) => {
      if (code) setRefText((t) => t || code);
    });
  }, []);

  useEffect(() => {
    if (!refText.trim()) {
      setRefCheck({ state: "idle" });
      return;
    }
    if (!refCode) {
      setRefCheck({ state: "invalid" });
      return;
    }
    let cancelled = false;
    setRefCheck({ state: "checking" });
    const t = setTimeout(async () => {
      try {
        const res = DEMO ? ({ valid: true, displayName: "a friend", username: null } as const) : await api.checkReferralCode({ code: refCode });
        if (cancelled) return;
        setRefCheck(res.valid ? { state: "valid", name: res.displayName, username: res.username } : { state: "invalid" });
      } catch {
        if (!cancelled) setRefCheck({ state: "idle" });
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [refText, refCode]);

  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (pendingMeta?.age && age === null) setAge(pendingMeta.age);
    if (pendingMeta?.birthMonth && birthMonth === null) setBirthMonth(pendingMeta.birthMonth);
    if (pendingMeta?.phoneNumber && !phone) setPhone(pendingMeta.phoneNumber);
  }, [pendingMeta, age, birthMonth, phone]);

  // An invite link opened before signup: joined automatically once the profile exists.
  const { joinLeague } = useLeague();
  const [invite, setInvite] = useState<
    | { code: string; name: string | null; state: "joining" }
    | { code: string; name: string | null; state: "joined"; leagueId: string }
    | { code: string; name: string | null; state: "failed"; error: string }
    | null
  >(null);

  const normalized = username.trim().toLowerCase();
  const usernameValid = /^[a-z0-9_]{3,20}$/.test(normalized);
  const blocked = ageBlocked(ageLocked, age);
  const ageValid = !blocked && age !== null && birthMonth !== null && age >= 18;
  const termsValid = termsFromSignup || termsChecked;
  const phoneDigits = extractPhoneDigits(phone);
  const phoneValid = phoneFromSignup || phoneDigits.length === 10;

  // Debounced availability check.
  useEffect(() => {
    if (!usernameValid) {
      setAvailable(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        const res = DEMO ? { available: true } : await api.checkUsername({ username: normalized });
        if (!cancelled) setAvailable(res.available);
      } catch {
        if (!cancelled) setAvailable(null);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [normalized, usernameValid]);

  const canContinue =
    usernameValid &&
    available === true &&
    displayName.trim().length > 0 &&
    ageValid &&
    termsValid &&
    phoneValid &&
    refCheck.state !== "invalid" &&
    refCheck.state !== "checking";

  const handleCreate = useCallback(async () => {
    setError(null);
    setSubmitting(true);
    try {
      if (!DEMO) {
        await api.createProfile({
          username: normalized,
          displayName: displayName.trim(),
          avatar,
          age: age ?? 0,
          birthMonth: birthMonth ?? 0,
          acceptedTerms: true,
          phoneNumber: phone,
          ...(refCode && refCheck.state === "valid" ? { referralCode: refCode } : {}),
        });
      }
      if (refCheck.state === "valid") setReferred(refCheck.name);
      void clearPendingReferral();
      setPendingSignupMeta(null);
      const code = DEMO ? null : await takePendingInvite();
      trackEvent("onboarding_completed", { has_pending_invite: !!code });
      buzz.success();
      setCheer((n) => n + 1);
      setStep("teams");
      if (code) void joinFromInvite(code);
    } catch (err) {
      setError(api.friendlyError(err));
    } finally {
      setSubmitting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [normalized, displayName, avatar, age, birthMonth, phone, setStep, refCode, refCheck]);

  async function joinFromInvite(code: string) {
    setInvite({ code, name: null, state: "joining" });
    const db = getDb();
    const preview = db
      ? getDoc(doc(db, "leagueInvites", code))
          .then((s) => (s.exists() ? ((s.get("leagueName") as string) ?? null) : null))
          .catch(() => null)
      : Promise.resolve(null);
    const [res, name] = await Promise.all([joinLeague(code, "signup"), preview]);
    if ("error" in res) setInvite({ code, name, state: "failed", error: res.error });
    else {
      buzz.success();
      setInvite({ code, name, state: "joined", leagueId: res.leagueId });
    }
  }

  // After the crew step: soft push pre-prompt (never the system dialog cold), then done.
  function afterPick() {
    if (pushStatus === "undetermined" && pushPrimerDue()) {
      markPushPrimerShown();
      setPrimer(true);
      return;
    }
    setStep("welcome");
  }

  function finish() {
    // The walkthrough no longer auto-opens: onboarding already covered it (Help on Home replays it).
    markWalkthroughSeen();
    if (invite?.state === "joined") {
      router.replace({ pathname: "/league/[id]", params: { id: invite.leagueId } });
    } else if (invite?.state === "failed") {
      router.replace({ pathname: "/(tabs)/leagues", params: { join: "1", code: invite.code, via: "link", t: String(Date.now()) } });
    } else {
      router.replace("/(tabs)");
    }
  }

  const { byId: catalog } = useCatalog();

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.background }]}>
      <ProgressDots step={step} colors={colors} />

      {step === "identity" && (
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <Text style={[s.title, { color: colors.foreground }]}>Pick Your Name</Text>
          <Text style={[s.sub, { color: colors.mutedForeground }]}>
            Your username is how friends find you. Complete your profile details below.
          </Text>

          <Field label="Username" colors={colors}>
            <View style={s.inputRow}>
              <Text style={[s.at, { color: colors.mutedForeground }]}>@</Text>
              <TextInput
                style={[s.input, { color: colors.foreground }]}
                value={username}
                onChangeText={setUsername}
                placeholder="courtvision"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={20}
              />
              {checking && <ActivityIndicator size="small" color={colors.mutedForeground} />}
              {!checking && available === true && (
                <MaterialCommunityIcons name="check-circle" size={18} color={colors.primary} />
              )}
              {!checking && available === false && (
                <MaterialCommunityIcons name="close-circle" size={18} color={colors.destructive} />
              )}
            </View>
          </Field>

          {username.length > 0 && !usernameValid && (
            <Hint colors={colors} tone="muted">
              3–20 characters: lowercase letters, numbers and underscores.
            </Hint>
          )}
          {available === false && (
            <Hint colors={colors} tone="error">That username is taken.</Hint>
          )}

          <Field label="Display Name" colors={colors}>
            <TextInput
              style={[s.input, { color: colors.foreground }]}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Jordan"
              placeholderTextColor={colors.mutedForeground}
              maxLength={30}
            />
          </Field>

          {(!ageFromSignup || blocked) && (<>
          <Field label="Age & Birth Month" colors={colors}>
            <Pressable accessibilityRole="button" accessibilityLabel="Select your age and birth month" onPress={() => !blocked && setAgePickerOpen(true)} style={s.inputRow}>
              <MaterialCommunityIcons name="cake-variant-outline" size={18} color={colors.mutedForeground} />
              <Text style={[s.input, { color: age !== null ? colors.foreground : colors.mutedForeground }]}>
                {age !== null && birthMonth !== null ? ageMonthLabel(age, birthMonth) : "Select your age and birth month"}
              </Text>
              {ageValid && (
                <MaterialCommunityIcons name="check-circle" size={18} color={colors.primary} />
              )}
            </Pressable>
          </Field>
          {blocked && (
            <Hint colors={colors} tone="error">{AGE_LOCKED_MESSAGE}</Hint>
          )}
          <AgeMonthPickerModal
            visible={agePickerOpen}
            onClose={() => setAgePickerOpen(false)}
            onConfirm={(v) => {
              setAge(v.age);
              setBirthMonth(v.birthMonth);
              setAgePickerOpen(false);
              passesAgeGate(v.age);
            }}
          />
          </>)}

          {!phoneFromSignup && (<>
          <Field label="Phone Number" colors={colors}>
            <View style={s.inputRow}>
              <MaterialCommunityIcons name="phone-outline" size={18} color={colors.mutedForeground} />
              <TextInput
                style={[s.input, { color: colors.foreground }]}
                value={phone}
                onChangeText={(v) => setPhone(formatPhoneMask(v))}
                placeholder="(555) 123-4567"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="phone-pad"
                maxLength={14}
              />
              {phoneValid && (
                <MaterialCommunityIcons name="check-circle" size={18} color={colors.primary} />
              )}
            </View>
          </Field>
          {phone.length > 0 && !phoneValid && (
            <Hint colors={colors} tone="muted">Enter a 10-digit US phone number.</Hint>
          )}
          </>)}

          <Field label="Invite code (optional)" colors={colors}>
            <View style={s.inputRow}>
              <MaterialCommunityIcons name="ticket-percent-outline" size={18} color={colors.mutedForeground} />
              <TextInput
                style={[s.input, { color: colors.foreground, letterSpacing: refText ? 2 : 0 }]}
                value={refText}
                onChangeText={(v) => setRefText(v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))}
                placeholder="From a friend"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={10}
              />
              {refCheck.state === "checking" && <ActivityIndicator size="small" color={colors.mutedForeground} />}
              {refCheck.state === "valid" && <MaterialCommunityIcons name="check-circle" size={18} color={colors.primary} />}
              {refCheck.state === "invalid" && <MaterialCommunityIcons name="close-circle" size={18} color={colors.destructive} />}
            </View>
          </Field>
          {refCheck.state === "valid" && (
            <Hint colors={colors} tone="muted">
              Invited by {refCheck.name}
              {refCheck.username ? ` (@${refCheck.username})` : ""} — you'll start with +{REFERRAL.newUserCredits.toLocaleString()} bonus credits.
            </Hint>
          )}
          {refCheck.state === "invalid" && (
            <Hint colors={colors} tone="error">We couldn't find that code. Check it or leave it blank.</Hint>
          )}

          {!termsFromSignup && <TermsCheckbox checked={termsChecked} onChange={setTermsChecked} />}

          <PrimaryButton
            label="Continue"
            disabled={!canContinue}
            onPress={() => setStep("pick")}
            colors={colors}
          />
        </ScrollView>
      )}

      {step === "pick" && <FirstCall colors={colors} onDone={() => setStep("appearance")} onBack={() => setStep("identity")} />}

      {step === "appearance" && (
        <CharacterDesigner
          avatar={avatar}
          onChange={setAvatar}
          catalog={catalog}
          displayName={displayName.trim()}
          onExit={() => setStep("pick")}
          onDone={handleCreate}
          submitting={submitting}
          error={error}
          cheerSignal={cheer}
        />
      )}

      {step === "teams" && (
        <ScrollView contentContainerStyle={s.body}>
          <Text style={[s.title, { color: colors.foreground }]}>Who do you root for?</Text>
          <Text style={[s.sub, { color: colors.mutedForeground }]}>
            Pick up to five teams. We'll show them on your profile and can remind you before they play.
          </Text>
          <PrimaryButton
            label={teamsSet ? "Teams saved — next" : "Pick my teams"}
            onPress={() => (teamsSet ? setStep("crew") : setTeamsOpen(true))}
            colors={colors}
          />
          {!teamsSet ? <Button label="Skip for Now" variant="ghost" onPress={() => setStep("crew")} /> : null}
          <FavoriteTeamsSheet
            visible={teamsOpen}
            initial={[]}
            initialReminders
            saveLabel="Save teams"
            onSaved={() => {
              setTeamsSet(true);
              setStep("crew");
            }}
            onClose={() => setTeamsOpen(false)}
          />
        </ScrollView>
      )}

      {step === "crew" && (
        <ScrollView contentContainerStyle={s.body}>
          <Text style={[s.title, { color: colors.foreground }]}>Bring Your Crew</Text>
          <Text style={[s.sub, { color: colors.mutedForeground }]}>
            SportDrip is better with friends: leagues, head-to-heads and trash talk.
          </Text>
          {invite ? (
            <Hint colors={colors} tone={invite.state === "failed" ? "error" : "muted"}>
              {invite.state === "joining"
                ? `Joining ${invite.name ?? "your friend's league"}…`
                : invite.state === "joined"
                  ? `You're in ${invite.name ?? "your friend's league"}.`
                  : `Couldn't join ${invite.name ?? `league ${invite.code}`}: ${invite.error}`}
            </Hint>
          ) : null}
          <InviteFriendsCard />
          <PrimaryButton label="Next" onPress={afterPick} colors={colors} />
        </ScrollView>
      )}

      {primer ? (
        <PushPrimer
          onAccept={() => {
            setPrimer(false);
            void enablePush().then((st) => {
              markPromptResult("push", st === "granted");
              if (st === "granted") api.setAlertPrefs({ sweat: true }).catch(() => {});
            });
            setStep("welcome");
          }}
          onDecline={() => {
            markPromptResult("push", false);
            setPrimer(false);
            setStep("welcome");
          }}
        />
      ) : null}

      {step === "welcome" && (
        <View style={[s.body, s.welcome]}>
          <View style={[s.welcomeIcon, { backgroundColor: colors.primary + "22", borderColor: colors.primary + "55" }]}>
            <MaterialCommunityIcons name="lightning-bolt" size={44} color={colors.primary} />
          </View>
          <Text style={[s.title, { color: colors.foreground, textAlign: "center" }]}>
            You're in, {displayName.trim()}
          </Text>

          <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {[
              referred
                ? {
                    icon: "account-heart",
                    text: `You start with ${(1000 + REFERRAL.newUserCredits).toLocaleString()} credits — ${REFERRAL.newUserCredits.toLocaleString()} of them from ${referred}'s invite — and you're already friends.`,
                  }
                : { icon: "lightning-bolt", text: "You start with 1,000 credits — and a free starter kit waiting in the Drip Shop." },
              { icon: "star-circle-outline", text: "Win, buy and invite friends to level up. Every level pays credits and unlocks gear." },
              { icon: "sportscourt", text: "Call games right and your credits grow. Results settle automatically." },
              { icon: "gift-outline", text: "Prize boxes hand out free credits on a timer." },
              { icon: "hanger", text: "Spend credits in the shop and your character wears it." },
              { icon: "account-group", text: "Add friends to see their fits, chat, and go head to head." },
            ].map(({ icon, text }, i) => (
              <View key={i} style={s.bulletRow}>
                <View style={[s.bulletIcon, { backgroundColor: colors.secondary }]}>
                  <MaterialCommunityIcons name={icon as never} size={16} color={colors.primary} />
                </View>
                <Text style={[s.bulletText, { color: colors.mutedForeground }]}>{text}</Text>
              </View>
            ))}
          </View>

          {invite ? (
            <View style={[s.card, { backgroundColor: colors.card, borderColor: invite.state === "failed" ? colors.negative : colors.league }]}>
              <View style={s.bulletRow}>
                <View style={[s.bulletIcon, { backgroundColor: colors.secondary }]}>
                  <MaterialCommunityIcons
                    name={invite.state === "failed" ? "alert-circle-outline" : "trophy-outline"}
                    size={16}
                    color={invite.state === "failed" ? colors.negative : colors.league}
                  />
                </View>
                <Text style={[s.bulletText, { color: colors.foreground }]}>
                  {invite.state === "joining"
                    ? `Joining ${invite.name ?? "your friend's league"}…`
                    : invite.state === "joined"
                      ? `You're in ${invite.name ?? "your friend's league"}. Your league tokens are waiting.`
                      : `Couldn't join ${invite.name ?? `league ${invite.code}`}: ${invite.error}`}
                </Text>
              </View>
            </View>
          ) : null}

          <PrimaryButton
            label={
              invite?.state === "joined"
                ? `Go to ${invite.name ?? "the league"}`
                : invite?.state === "failed"
                  ? "Review the invite"
                  : "Let's go"
            }
            loading={invite?.state === "joining"}
            disabled={invite?.state === "joining"}
            onPress={finish}
            colors={colors}
          />
          {invite?.state === "failed" ? (
            <Button label="Skip for Now" variant="ghost" onPress={() => router.replace("/(tabs)")} />
          ) : null}
        </View>
      )}
    </SafeAreaView>
  );
}

/* ── small local building blocks ─────────────────────────────────────────── */

/**
 * The first thing a new player does is the thing the app is for: call a game.
 * Nothing is staked here. The call is remembered and placed as their first
 * bet, paid for by the tutorial prize box, once the starter kit is done.
 */
function FirstCall({ colors, onDone, onBack }: { colors: ReturnType<typeof useColors>; onDone: () => void; onBack: () => void }) {
  const { upcoming } = useGames(["upcoming"]);
  const game = React.useMemo(() => pickFeatured(upcoming.filter((g) => g.priced && !g.disrupted), NO_SIDES, NO_FAVS, Date.now()), [upcoming]);
  const [side, setSide] = useState<"home" | "away" | null>(null);
  const call = (sd: "home" | "away") => {
    buzz.medium();
    setSide(sd);
  };
  return (
    <ScrollView contentContainerStyle={s.body}>
      <Text style={[s.title, { color: colors.foreground }]}>Call Your First Game</Text>
      <Text style={[s.sub, { color: colors.mutedForeground }]}>
        {game ? "Who wins? Tap a side. It costs nothing now and becomes your first bet once you're set up." : "No games on the board right now. You'll make your first call from Games."}
      </Text>
      {game ? (
        <View style={{ gap: 10 }}>
          <Text style={{ fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.8, color: colors.subtleForeground }}>
            {game.sport.toUpperCase()} · {kickoffLabel(game.startsAt).toUpperCase()}
          </Text>
          {(["away", "home"] as const).map((sd) => {
            const t = sd === "home" ? game.homeTeam : game.awayTeam;
            const on = side === sd;
            return (
              <Pressable
                key={sd}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${t.name} to win`}
                onPress={() => call(sd)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  padding: 16,
                  borderRadius: 14,
                  borderWidth: on ? 2 : 1,
                  borderColor: on ? colors.primary : colors.border,
                  backgroundColor: on ? colors.primarySoft : colors.card,
                }}
              >
                <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: t.color }} />
                <Text style={{ flex: 1, fontSize: 17, fontFamily: "Inter_800ExtraBold", color: colors.foreground }} numberOfLines={1}>
                  {t.name}
                </Text>
                <Text style={{ fontSize: 17, fontFamily: "Inter_900Black", color: colors.primary, fontVariant: ["tabular-nums"] }}>
                  {t.odds ? formatOdds(t.odds, "decimal") : "—"}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <Button
        label={side ? "Lock In My Call" : "Skip for Now"}
        variant={side ? "primary" : "secondary"}
        onPress={() => {
          setFirstPick(game && side ? { gameId: game.id, side } : null);
          onDone();
        }}
      />
      <Button label="Back" variant="ghost" size="sm" onPress={onBack} />
    </ScrollView>
  );
}

type Colors = ReturnType<typeof useColors>;

function ProgressDots({ step, colors }: { step: Step; colors: Colors }) {
  const order = STEP_ORDER;
  const idx = order.indexOf(step);
  return (
    <View style={s.dots}>
      {order.map((_, i) => (
        <View
          key={i}
          style={[
            s.dot,
            {
              backgroundColor: i <= idx ? colors.primary : colors.border,
              width: i === idx ? 22 : 8,
            },
          ]}
        />
      ))}
    </View>
  );
}

function Field({
  label,
  colors,
  children,
}: {
  label: string;
  colors: Colors;
  children: React.ReactNode;
}) {
  return (
    <View style={s.field}>
      <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>{label.toUpperCase()}</Text>
      <View style={[s.fieldBox, { borderColor: colors.border, backgroundColor: colors.secondary }]}>
        {children}
      </View>
    </View>
  );
}

function Hint({
  colors,
  tone,
  children,
}: {
  colors: Colors;
  tone: "muted" | "error";
  children: React.ReactNode;
}) {
  return (
    <Text style={[s.hint, { color: tone === "error" ? colors.destructive : colors.mutedForeground }]}>
      {children}
    </Text>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled,
  loading,
  colors,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  colors: Colors;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        s.primaryBtn,
        {
          backgroundColor: colors.primary,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
        },
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      {loading ? (
        <ActivityIndicator color={colors.primaryForeground} size="small" />
      ) : (
        <Text style={[s.primaryBtnText, { color: colors.primaryForeground }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  dots: { flexDirection: "row", gap: 6, justifyContent: "center", paddingVertical: 16 },
  dot: { height: 8, borderRadius: 4 },
  body: { padding: 24, gap: 18, paddingBottom: 48 },
  title: { fontSize: 30, fontFamily: "Inter_900Black", letterSpacing: -1 },
  sub: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: -10 },
  field: { gap: 8 },
  fieldLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.6 },
  fieldBox: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  at: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: -10 },
  primaryBtn: { paddingVertical: 15, borderRadius: 14, alignItems: "center", marginTop: 8 },
  primaryBtnText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  welcome: { flex: 1, justifyContent: "center", alignItems: "stretch", gap: 20 },
  welcomeIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  card: { borderRadius: 18, borderWidth: 1, padding: 18, gap: 14 },
  bulletRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  bulletIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  bulletText: { flex: 1, fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
});
