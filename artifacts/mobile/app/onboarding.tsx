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
import { useCatalog } from "@/hooks/useCatalog";

const STARTER_OUTFIT = { top: "tee_basic_white", bottom: "shorts_basic_navy", shoes: "shoes_basic_white" } as const;
import {
  DEFAULT_AVATAR,
  EYE_COLORS,
  HAIR_COLORS,
  HAIR_STYLES,
  SKIN_TONES,
  randomAvatar,
} from "@/constants/avatarOptions";
import * as api from "@/lib/api";
import type { AvatarConfig } from "@/lib/api";
import { useColors } from "@/hooks/useColors";

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

export default function OnboardingScreen() {
  const colors = useColors();

  const [step, setStep] = useState<Step>("identity");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatar, setAvatar] = useState<AvatarConfig>(DEFAULT_AVATAR);

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
        const res = await api.checkUsername({ username: normalized });
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
      await api.createProfile({
        username: normalized,
        displayName: displayName.trim(),
        avatar,
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStep("welcome");
    } catch (err) {
      setError(api.friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  }, [normalized, displayName, avatar, setStep]);

  // Preview in the starter kit createProfile hands out, not a bare mannequin.
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
        <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
          <Text style={[s.title, { color: colors.foreground }]}>Build your character</Text>

          {/* Live preview — every control below updates this immediately (§8). */}
          <View style={[s.preview, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
            <AvatarDisplay avatar={avatar} equipped={STARTER_OUTFIT} catalog={catalog} size="lg" autoRotate />
          </View>

          <Pressable
            style={[s.ghostBtn, { borderColor: colors.border }]}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setAvatar(randomAvatar());
            }}
          >
            <MaterialCommunityIcons name="dice-5-outline" size={16} color={colors.mutedForeground} />
            <Text style={[s.ghostBtnText, { color: colors.mutedForeground }]}>Surprise me</Text>
          </Pressable>

          <Slider
            label="Height"
            value={avatar.height}
            onChange={(height) => setAvatar((a) => ({ ...a, height }))}
            colors={colors}
          />
          <Slider
            label="Build"
            value={avatar.bodyType}
            onChange={(bodyType) => setAvatar((a) => ({ ...a, bodyType }))}
            colors={colors}
          />

          <Swatches
            label="Skin tone"
            options={SKIN_TONES}
            value={avatar.skinTone}
            onChange={(skinTone) => setAvatar((a) => ({ ...a, skinTone }))}
            colors={colors}
          />

          <Chips
            label="Hair"
            options={HAIR_STYLES.map((h) => ({ id: h.id, label: h.label }))}
            value={avatar.hairStyle}
            onChange={(hairStyle) => setAvatar((a) => ({ ...a, hairStyle }))}
            colors={colors}
          />

          <Swatches
            label="Hair colour"
            options={HAIR_COLORS}
            value={avatar.hairColor}
            onChange={(hairColor) => setAvatar((a) => ({ ...a, hairColor }))}
            colors={colors}
          />

          <Swatches
            label="Eyes"
            options={EYE_COLORS}
            value={avatar.eyeColor ?? EYE_COLORS[0]!}
            onChange={(eyeColor) => setAvatar((a) => ({ ...a, eyeColor }))}
            colors={colors}
          />

          {error && <Hint colors={colors} tone="error">{error}</Hint>}

          <PrimaryButton
            label={submitting ? "" : "Create my character"}
            loading={submitting}
            disabled={submitting}
            onPress={handleCreate}
            colors={colors}
          />
          <Pressable style={s.backBtn} onPress={() => setStep("identity")}>
            <Text style={[s.backText, { color: colors.mutedForeground }]}>Back</Text>
          </Pressable>
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

/**
 * Discrete 5-stop slider. A real gesture slider would need another dependency;
 * five stops is enough resolution for height and build, and it is far easier to
 * hit on a phone than a 1px thumb.
 */
function Slider({
  label,
  value,
  onChange,
  colors,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  colors: Colors;
}) {
  const stops = [0, 0.25, 0.5, 0.75, 1];
  const activeIdx = stops.reduce(
    (best, stop, i) => (Math.abs(stop - value) < Math.abs(stops[best]! - value) ? i : best),
    0
  );
  return (
    <View style={s.field}>
      <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>{label.toUpperCase()}</Text>
      <View style={s.stopRow}>
        {stops.map((stop, i) => (
          <Pressable
            key={stop}
            style={[
              s.stop,
              {
                backgroundColor: i === activeIdx ? colors.primary : colors.secondary,
                borderColor: i === activeIdx ? colors.primary : colors.border,
              },
            ]}
            onPress={() => {
              Haptics.selectionAsync();
              onChange(stop);
            }}
          />
        ))}
      </View>
    </View>
  );
}

function Swatches({
  label,
  options,
  value,
  onChange,
  colors,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  colors: Colors;
}) {
  return (
    <View style={s.field}>
      <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>{label.toUpperCase()}</Text>
      <View style={s.swatchRow}>
        {options.map((c) => (
          <Pressable
            key={c}
            onPress={() => {
              Haptics.selectionAsync();
              onChange(c);
            }}
            style={[
              s.swatch,
              {
                backgroundColor: c,
                borderColor: value === c ? colors.primary : colors.border,
                borderWidth: value === c ? 3 : 1,
              },
            ]}
          />
        ))}
      </View>
    </View>
  );
}

function Chips({
  label,
  options,
  value,
  onChange,
  colors,
}: {
  label: string;
  options: Array<{ id: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
  colors: Colors;
}) {
  return (
    <View style={s.field}>
      <Text style={[s.fieldLabel, { color: colors.mutedForeground }]}>{label.toUpperCase()}</Text>
      <View style={s.chipRow}>
        {options.map((o) => {
          const active = o.id === value;
          return (
            <Pressable
              key={o.id}
              onPress={() => {
                Haptics.selectionAsync();
                onChange(o.id);
              }}
              style={[
                s.chip,
                {
                  backgroundColor: active ? colors.primary : colors.secondary,
                  borderColor: active ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  s.chipText,
                  { color: active ? colors.primaryForeground : colors.mutedForeground },
                ]}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  dots: { flexDirection: "row", gap: 6, justifyContent: "center", paddingVertical: 16 },
  dot: { height: 8, borderRadius: 4 },
  body: { padding: 24, gap: 18, paddingBottom: 48 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold", letterSpacing: -0.5 },
  sub: { fontSize: 14, fontFamily: "Inter_400Regular", marginTop: -10 },
  field: { gap: 8 },
  fieldLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.6 },
  fieldBox: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  at: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  hint: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: -10 },
  preview: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 24,
    minHeight: 300,
  },
  ghostBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
  },
  ghostBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
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
