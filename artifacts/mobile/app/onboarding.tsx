import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AvatarDisplay from "@/components/AvatarDisplay";
import { Chips as EditChips, Stops, Swatches as EditSwatches } from "@/components/avatar/EditorControls";
import { Button, SegmentedControl } from "@/components/ui";
import { useCatalog } from "@/hooks/useCatalog";
import { DEMO } from "@/lib/demo";

import {
  EYE_COLORS,
  EYE_SHAPES,
  EYEBROWS,
  FACE_SHAPES,
  FACIAL_HAIR,
  HAIR_COLORS,
  HAIR_STYLES,
  MOUTH_SHAPES,
  NOSE_SHAPES,
  SKIN_TONES,
  SIGNUP_AVATAR,
} from "@/constants/avatarOptions";
import * as api from "@/lib/api";
import type { AvatarConfig } from "@/lib/api";
import { useColors } from "@/hooks/useColors";

/** Nothing is worn at signup (createProfile equips nothing; the starter kit goes to the inventory). */
const NO_OUTFIT = {} as const;

/**
 * The screen that did not exist. Signup previously dropped the user straight
 * onto the games tab with 1,000 credits, no profile document and no explanation
 * (AUDIT B4, U7).
 *
 * Three steps, deliberately short (§8, §28): identity, appearance, then a
 * one-screen explanation of how credits work. `createProfile` is the call that
 * claims the username, grants the opening balance and the starter outfit — all
 * server-side, in one transaction.
 */

type Step = "identity" | "appearance" | "welcome";
type EditTab = "body" | "face" | "hair";

export default function OnboardingScreen() {
  const colors = useColors();

  const [step, setStep] = useState<Step>("identity");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  // Everyone starts from the same plain base (bald, nothing worn) and builds from there.
  const [avatar, setAvatar] = useState<AvatarConfig>(SIGNUP_AVATAR);
  const [tab, setTab] = useState<EditTab>("body");
  const [cheer, setCheer] = useState(0);

  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = username.trim().toLowerCase();
  const usernameValid = /^[a-z0-9_]{3,20}$/.test(normalized);

  // Debounced availability check. Fires the callable rather than reading
  // usernames/* directly, because the rules deny list access on that
  // collection — otherwise anyone could enumerate the whole user base.
  useEffect(() => {
    if (!usernameValid) {
      setAvailable(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const t = setTimeout(async () => {
      try {
        // Demo mode has no backend: every well-formed name is free.
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

  const canContinue = usernameValid && available === true && displayName.trim().length > 0;

  const handleCreate = useCallback(async () => {
    setError(null);
    setSubmitting(true);
    try {
      if (!DEMO) {
        await api.createProfile({
          username: normalized,
          displayName: displayName.trim(),
          avatar,
        });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCheer((n) => n + 1);
      setStep("welcome");
    } catch (err) {
      setError(api.friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  }, [normalized, displayName, avatar, setStep]);

  // Item meshes for the preview (nothing is worn yet, but the catalog drives the renderer).
  const { byId: catalog } = useCatalog();

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.background }]}>
      <ProgressDots step={step} colors={colors} />

      {step === "identity" && (
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <Text style={[s.title, { color: colors.foreground }]}>Pick your name</Text>
          <Text style={[s.sub, { color: colors.mutedForeground }]}>
            Your username is how friends find you. It can't be changed later.
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

          <Field label="Display name" colors={colors}>
            <TextInput
              style={[s.input, { color: colors.foreground }]}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="Jordan"
              placeholderTextColor={colors.mutedForeground}
              maxLength={30}
            />
          </Field>

          <PrimaryButton
            label="Continue"
            disabled={!canContinue}
            onPress={() => setStep("appearance")}
            colors={colors}
          />
        </ScrollView>
      )}

      {step === "appearance" && (
        <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false} stickyHeaderIndices={[1]}>
          <Text style={[s.title, { color: colors.foreground }]}>Make it yours</Text>

          {/* Live preview — every control below updates it immediately (§8). Sticks while you scroll. */}
          <View style={{ backgroundColor: colors.background, paddingBottom: 12 }}>
            <View style={[s.preview, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
              <AvatarDisplay
                avatar={avatar}
                equipped={NO_OUTFIT}
                catalog={catalog}
                size="lg"
                focus={tab === "body" ? "full" : "head"}
                cheerSignal={cheer}
              />
            </View>
            <SegmentedControl<EditTab>
              style={{ marginTop: 12 }}
              options={[
                { value: "body", label: "Body" },
                { value: "face", label: "Face" },
                { value: "hair", label: "Hair" },
              ]}
              value={tab}
              onChange={setTab}
            />
          </View>

          {tab === "body" && (
            <>
              <EditSwatches label="Skin tone" options={SKIN_TONES} value={avatar.skinTone} onChange={(skinTone) => setAvatar((a) => ({ ...a, skinTone }))} />
              <Stops label="Height" value={avatar.height} onChange={(height) => setAvatar((a) => ({ ...a, height }))} ends={["Shorter", "Taller"]} />
              <Stops label="Build" value={avatar.bodyType} onChange={(bodyType) => setAvatar((a) => ({ ...a, bodyType }))} ends={["Slim", "Broad"]} />
            </>
          )}
          {tab === "face" && (
            <>
              <EditChips label="Face shape" options={FACE_SHAPES} value={avatar.faceShape ?? "oval"} onChange={(faceShape) => setAvatar((a) => ({ ...a, faceShape }))} />
              <EditChips label="Eye shape" options={EYE_SHAPES} value={avatar.eyeShape ?? "round"} onChange={(eyeShape) => setAvatar((a) => ({ ...a, eyeShape }))} />
              <EditSwatches label="Eyes" options={EYE_COLORS} value={avatar.eyeColor ?? EYE_COLORS[0]!} onChange={(eyeColor) => setAvatar((a) => ({ ...a, eyeColor }))} />
              <EditChips label="Brows" options={EYEBROWS} value={avatar.eyebrows ?? "soft"} onChange={(eyebrows) => setAvatar((a) => ({ ...a, eyebrows }))} />
              <EditChips label="Nose" options={NOSE_SHAPES} value={avatar.noseShape ?? "button"} onChange={(noseShape) => setAvatar((a) => ({ ...a, noseShape }))} />
              <EditChips label="Mouth" options={MOUTH_SHAPES} value={avatar.mouthShape ?? "neutral"} onChange={(mouthShape) => setAvatar((a) => ({ ...a, mouthShape }))} />
              <EditChips label="Facial hair" options={FACIAL_HAIR} value={avatar.facialHair ?? "none"} onChange={(facialHair) => setAvatar((a) => ({ ...a, facialHair }))} />
            </>
          )}
          {tab === "hair" && (
            <>
              <EditChips label="Style" options={HAIR_STYLES} value={avatar.hairStyle} onChange={(hairStyle) => setAvatar((a) => ({ ...a, hairStyle }))} />
              <EditSwatches label="Colour" options={HAIR_COLORS} value={avatar.hairColor} onChange={(hairColor) => setAvatar((a) => ({ ...a, hairColor }))} />
            </>
          )}

          {error && <Hint colors={colors} tone="error">{error}</Hint>}

          <PrimaryButton
            label={submitting ? "" : "Create my character"}
            loading={submitting}
            disabled={submitting}
            onPress={handleCreate}
            colors={colors}
          />
          <Button label="Back" icon="arrow-left" variant="ghost" onPress={() => setStep("identity")} />
        </ScrollView>
      )}

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
              { icon: "lightning-bolt", text: "You start with 1,000 credits and a basic fit." },
              { icon: "sportscourt", text: "Call games right and your credits grow. Results settle automatically." },
              { icon: "gift-outline", text: "Prize boxes hand out free credits on a timer." },
              { icon: "hanger", text: "Spend credits in the shop and your character wears it." },
              { icon: "account-group", text: "Add friends to see their fits and go head to head." },
            ].map(({ icon, text }, i) => (
              <View key={i} style={s.bulletRow}>
                <View style={[s.bulletIcon, { backgroundColor: colors.secondary }]}>
                  <MaterialCommunityIcons name={icon as never} size={16} color={colors.primary} />
                </View>
                <Text style={[s.bulletText, { color: colors.mutedForeground }]}>{text}</Text>
              </View>
            ))}
          </View>

          <PrimaryButton
            label="Make my first pick"
            onPress={() => router.replace("/(tabs)")}
            colors={colors}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

/* ── small local building blocks ─────────────────────────────────────────── */

type Colors = ReturnType<typeof useColors>;

function ProgressDots({ step, colors }: { step: Step; colors: Colors }) {
  const order: Step[] = ["identity", "appearance", "welcome"];
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
  fill: { flex: 1 },
  center: { textAlign: "center" },
  stickyFoot: { paddingHorizontal: 24, paddingTop: 10, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth },
  dots: { flexDirection: "row", gap: 6, justifyContent: "center", paddingVertical: 16 },
  dot: { height: 8, borderRadius: 4 },
  body: { padding: 24, gap: 18, paddingBottom: 48 },
  title: { fontSize: 30, fontFamily: "Inter_900Black", letterSpacing: -1 },
  sub: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: -10 },
  field: { gap: 8 },
  fieldLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.6 },
  fieldBox: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  at: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: -10 },
  preview: { height: 290, borderRadius: 20, borderWidth: 1, overflow: "hidden" },
  ghostBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 12,
    minHeight: 44,
  },
  ghostBtnText: { fontSize: 15, fontFamily: "Inter_800ExtraBold" },
  stopRow: { flexDirection: "row", gap: 8 },
  stop: { flex: 1, height: 34, borderRadius: 10, borderWidth: 1 },
  swatchRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  swatch: { width: 40, height: 40, borderRadius: 20 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  chipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  primaryBtn: { paddingVertical: 15, borderRadius: 14, alignItems: "center", marginTop: 8 },
  primaryBtnText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  backBtn: { alignItems: "center", paddingVertical: 8 },
  backText: { fontSize: 14, fontFamily: "Inter_500Medium" },
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
