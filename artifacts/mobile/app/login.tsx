import { MaterialCommunityIcons } from "@expo/vector-icons";
import { haptic as buzz } from "@/lib/motion";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Pressable, TouchableOpacity } from "@/components/fx/Tap";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { ActionChip, CloseButton } from "@/components/ui";
import { setPendingSignupMeta } from "@/lib/settings";
import AgeMonthPickerModal from "@/components/AgeMonthPickerModal";
import TermsCheckbox from "@/components/TermsCheckbox";
import HouseLogo from "@/components/brand/HouseLogo";
import { AGE_LOCKED_MESSAGE, ageBlocked, passesAgeGate, useAgeGateLocked } from "@/lib/ageGate";


/** Format raw digits into (XXX) XXX-XXXX phone mask. */
export function formatPhoneMask(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}

export function extractPhoneDigits(formatted: string): string {
  return formatted.replace(/\D/g, "");
}

export default function LoginScreen() {
  const colors = useColors();
  const { signIn, signUp, signInWithGoogle, signInWithApple } = useAuth();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [age, setAge] = useState<number | null>(null);
  const [birthMonth, setBirthMonth] = useState<number | null>(null);
  const [ageLabel, setAgeLabel] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [phone, setPhone] = useState("");
  const [showAgePicker, setShowAgePicker] = useState(false);
  const ageLocked = useAgeGateLocked();
  const blocked = ageBlocked(ageLocked, age);

  const [loading, setLoading] = useState(false);
  const [ssoBusy, setSsoBusy] = useState<"google" | "apple" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function friendlyError(code: string, provider?: "google" | "apple"): string {
    // Developer detail goes to the console; users get plain language.
    if (__DEV__) console.warn("[auth]", provider ?? "email", code);
    const name = provider === "apple" ? "Apple" : provider === "google" ? "Google" : null;
    if (name && (code.includes("operation-not-allowed") || code.includes("admin-restricted-operation") || code.includes("invalid-credential") || code.includes("audience")))
      return `${name} sign-in isn't available right now. Try another way to sign in.`;
    if (code.includes("account-exists-with-different-credential"))
      return "That email already has an account with a different sign-in. Use the way you signed up first.";
    if (code.includes("unauthorized-domain")) return "This site isn't authorised for sign-in yet. Add it under Firebase → Authentication → Settings → Authorised domains.";
    if (code.includes("user-not-found") || code.includes("wrong-password") || code.includes("invalid-credential"))
      return "Invalid email or password.";
    if (code.includes("email-already-in-use")) return "An account with this email already exists.";
    if (code.includes("weak-password")) return "Password must be at least 6 characters.";
    if (code.includes("invalid-email")) return "Please enter a valid email address.";
    if (code.includes("too-many-requests")) return "Too many attempts. Try again later.";
    if (code.includes("operation-not-allowed") || code.includes("admin-restricted-operation"))
      return "Email sign-in isn't available right now. Try another way to sign in.";
    if (code.includes("network-request-failed")) return "Network error. Check your connection.";
    return "Something went wrong signing in. Please try again.";
  }

  function handlePhoneChange(val: string) {
    setPhone(formatPhoneMask(val));
  }

  async function handleSubmit() {
    setError(null);
    if (!email.trim() || !password) {
      setError("Please fill in your email and password.");
      return;
    }

    if (mode === "signup") {
      if (password !== confirmPassword) {
        setError("Passwords don't match.");
        return;
      }
      if (password.length < 6) {
        setError("Password must be at least 6 characters.");
        return;
      }
      if (blocked) {
        setError(AGE_LOCKED_MESSAGE);
        return;
      }
      if (age === null || birthMonth === null) {
        setError("Please select your age and birth month.");
        return;
      }
      if (!passesAgeGate(age)) {
        setError(AGE_LOCKED_MESSAGE);
        return;
      }
      if (!acceptedTerms) {
        setError("Please agree to the Terms of Service and Privacy Policy.");
        return;
      }
      const phoneDigits = extractPhoneDigits(phone);
      if (phoneDigits.length !== 10) {
        setError("Please enter a valid 10-digit phone number.");
        return;
      }
    }

    buzz.medium();
    setLoading(true);
    try {
      if (mode === "signin") {
        await signIn(email.trim(), password);
      } else {
        await signUp(email.trim(), password, {
          age: age ?? undefined,
          birthMonth: birthMonth ?? undefined,
          phoneNumber: phone,
          acceptedTerms,
        });
      }
      router.replace("/(tabs)");
    } catch (e: any) {
      const code: string = e?.code ?? e?.message ?? "";
      setError(friendlyError(code));
    } finally {
      setLoading(false);
    }
  }

  async function handleSSO(provider: "google" | "apple") {
    setError(null);
    if (mode === "signup") {
      if (blocked) {
        setError(AGE_LOCKED_MESSAGE);
        return;
      }
      if (age !== null && !passesAgeGate(age)) {
        setError(AGE_LOCKED_MESSAGE);
        return;
      }
      const phoneDigits = extractPhoneDigits(phone);
      // Whatever's filled in carries over; onboarding asks for the rest.
      setPendingSignupMeta({
        age: age ?? undefined,
        birthMonth: birthMonth ?? undefined,
        phoneNumber: phoneDigits.length === 10 ? phone : undefined,
        acceptedTerms,
      });
    }
    buzz.light();
    setSsoBusy(provider);
    try {
      if (provider === "google") await signInWithGoogle();
      else await signInWithApple();
      router.replace("/(tabs)");
    } catch (e: any) {
      const code: string = e?.code ?? e?.message ?? "";
      if (code === "auth/cancelled") return;
      setError(code === "auth/unavailable" ? String(e.message) : friendlyError(code, provider));
    } finally {
      setSsoBusy(null);
    }
  }

  function toggleMode() {
    setMode((m) => (m === "signin" ? "signup" : "signin"));
    setError(null);
    setPassword("");
    setConfirmPassword("");
    buzz.light();
  }

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={s.kav}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Logo */}
          <View style={s.logoWrap}>
            <HouseLogo size={96} tagline="Free sports bets with friends" />
          </View>

          {/* Card */}
          <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[s.cardTitle, { color: colors.foreground }]}>
              {mode === "signin" ? "Welcome back" : "Create account"}
            </Text>

            {/* Email */}
            <View style={[s.inputWrap, { borderColor: colors.border, backgroundColor: colors.secondary }]}>
              <MaterialCommunityIcons name="email-outline" size={18} color={colors.mutedForeground} />
              <TextInput
                style={[s.input, { color: colors.foreground }]}
                placeholder="Email address"
                placeholderTextColor={colors.mutedForeground}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                returnKeyType="next"
              />
            </View>

            {/* Password */}
            <View style={[s.inputWrap, { borderColor: colors.border, backgroundColor: colors.secondary }]}>
              <MaterialCommunityIcons name="lock-outline" size={18} color={colors.mutedForeground} />
              <TextInput
                style={[s.input, { color: colors.foreground }]}
                placeholder="Password"
                placeholderTextColor={colors.mutedForeground}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                returnKeyType={mode === "signup" ? "next" : "done"}
                onSubmitEditing={mode === "signin" ? handleSubmit : undefined}
              />
            </View>

            {/* Extended Sign-Up Fields */}
            {mode === "signup" && (
              <>
                <View style={[s.inputWrap, { borderColor: colors.border, backgroundColor: colors.secondary }]}>
                  <MaterialCommunityIcons name="lock-check-outline" size={18} color={colors.mutedForeground} />
                  <TextInput
                    style={[s.input, { color: colors.foreground }]}
                    placeholder="Confirm password"
                    placeholderTextColor={colors.mutedForeground}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry
                    autoComplete="new-password"
                    returnKeyType="next"
                  />
                </View>

                {/* Age + birth month (neutral: no default, no cutoff shown) */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Select your age and birth month"
                  onPress={() => setShowAgePicker(true)}
                  style={[s.inputWrap, { borderColor: colors.border, backgroundColor: colors.secondary }]}
                >
                  <MaterialCommunityIcons name="cake-variant-outline" size={18} color={colors.mutedForeground} />
                  <Text style={[s.input, { color: ageLabel ? colors.foreground : colors.mutedForeground }]} numberOfLines={1}>
                    {ageLabel ?? "Age & birth month"}
                  </Text>
                </Pressable>

                {/* Phone Number with Formatting Mask */}
                <View style={[s.inputWrap, { borderColor: colors.border, backgroundColor: colors.secondary }]}>
                  <MaterialCommunityIcons name="phone-outline" size={18} color={colors.mutedForeground} />
                  <TextInput
                    style={[s.input, { color: colors.foreground }]}
                    placeholder="Phone Number · (555) 123-4567"
                    placeholderTextColor={colors.mutedForeground}
                    value={phone}
                    onChangeText={handlePhoneChange}
                    keyboardType="phone-pad"
                    autoComplete="tel"
                    maxLength={14}
                    returnKeyType="done"
                    onSubmitEditing={handleSubmit}
                  />
                  {extractPhoneDigits(phone).length === 10 && (
                    <MaterialCommunityIcons name="check-circle" size={17} color={colors.positive} />
                  )}
                </View>
              </>
            )}

            {mode === "signup" && <TermsCheckbox checked={acceptedTerms} onChange={setAcceptedTerms} />}

            {/* Error */}
            {error && (
              <View style={[s.errorBox, { backgroundColor: "#FF444422", borderColor: "#FF444455" }]}>
                <MaterialCommunityIcons name="alert-circle-outline" size={15} color="#FF4444" />
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}

            {/* Submit */}
            <TouchableOpacity
              style={[s.btn, { backgroundColor: colors.primary }, (loading || !!ssoBusy || (mode === "signup" && blocked)) && s.btnDisabled]}
              onPress={handleSubmit}
              activeOpacity={0.85}
              disabled={loading || !!ssoBusy || (mode === "signup" && blocked)}
            >
              {loading ? (
                <ActivityIndicator color={colors.primaryForeground} size="small" />
              ) : (
                <Text style={[s.btnText, { color: colors.primaryForeground }]}>
                  {mode === "signin" ? "Sign In" : "Create Account"}
                </Text>
              )}
            </TouchableOpacity>

            {/* Toggle */}
            <View style={s.toggle}>
              <Text style={[s.toggleText, { color: colors.mutedForeground }]}>
                {mode === "signin" ? "Don't have an account?" : "Already have an account?"}
              </Text>
              <ActionChip label={mode === "signin" ? "Sign up" : "Sign in"} tone="money" onPress={toggleMode} />
            </View>

            {/* Divider */}
            <View style={s.dividerRow}>
              <View style={[s.dividerLine, { backgroundColor: colors.border }]} />
              <Text style={[s.dividerText, { color: colors.mutedForeground }]}>
                OR CONTINUE WITH
              </Text>
              <View style={[s.dividerLine, { backgroundColor: colors.border }]} />
            </View>

            {/* SSO Buttons */}
            <View style={s.ssoStack}>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Continue with Apple"
                style={[
                  s.ssoBtn,
                  {
                    backgroundColor: colors.isDark ? "#FFFFFF" : "#000000",
                    borderColor: colors.isDark ? "#FFFFFF" : "#000000",
                  },
                ]}
                activeOpacity={0.85}
                disabled={loading || !!ssoBusy}
                onPress={() => handleSSO("apple")}
              >
                {ssoBusy === "apple" ? (
                  <ActivityIndicator size="small" color={colors.isDark ? "#000000" : "#FFFFFF"} />
                ) : (
                  <>
                    <MaterialCommunityIcons
                      name="apple"
                      size={20}
                      color={colors.isDark ? "#000000" : "#FFFFFF"}
                    />
                    <Text style={[s.ssoBtnText, { color: colors.isDark ? "#000000" : "#FFFFFF" }]}>
                      Continue with Apple
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Continue with Google"
                style={[
                  s.ssoBtn,
                  {
                    backgroundColor: colors.secondary,
                    borderColor: colors.border,
                  },
                ]}
                activeOpacity={0.85}
                disabled={loading || !!ssoBusy}
                onPress={() => handleSSO("google")}
              >
                {ssoBusy === "google" ? (
                  <ActivityIndicator size="small" color={colors.foreground} />
                ) : (
                  <>
                    <MaterialCommunityIcons name="google" size={19} color="#EA4335" />
                    <Text style={[s.ssoBtnText, { color: colors.foreground }]}>
                      Continue with Google
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>

          <View style={s.legalRow}>
            <Text style={[s.legalLink, { color: colors.mutedForeground }]} onPress={() => router.push({ pathname: "/legal", params: { doc: "terms" } })}>
              Terms of Service
            </Text>
            <Text style={{ color: colors.mutedForeground }}>·</Text>
            <Text style={[s.legalLink, { color: colors.mutedForeground }]} onPress={() => router.push({ pathname: "/legal", params: { doc: "privacy" } })}>
              Privacy Policy
            </Text>
          </View>
          <Text style={[s.legalNote, { color: colors.subtleForeground }]}>Free to play. Virtual credits only — no cash value, no cash prizes.</Text>
        </ScrollView>
      </KeyboardAvoidingView>

      <AgeMonthPickerModal
        visible={showAgePicker}
        onClose={() => setShowAgePicker(false)}
        onConfirm={(v) => {
          setAge(v.age);
          setBirthMonth(v.birthMonth);
          setAgeLabel(v.label);
          setShowAgePicker(false);
          setError(passesAgeGate(v.age) ? null : AGE_LOCKED_MESSAGE);
        }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  kav: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: "center", padding: 24, gap: 24 },
  logoWrap: { alignItems: "center", gap: 8 },
  logoCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  appName: { fontSize: 34, fontFamily: "Inter_700Bold", letterSpacing: -1 },
  tagline: { fontSize: 15, fontFamily: "Inter_400Regular" },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 22,
    gap: 12,
  },
  cardTitle: { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 2 },
  ssoStack: { gap: 10 },
  ssoBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  ssoBtnText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 4 },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth },
  dividerText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  errorText: { color: "#FF4444", fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  btn: {
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 4,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { fontSize: 16, fontFamily: "Inter_700Bold" },
  toggle: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 4, flexWrap: "wrap" },
  toggleText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  legalRow: { flexDirection: "row", justifyContent: "center", gap: 8 },
  legalLink: { fontSize: 12, fontFamily: "Inter_600SemiBold", textDecorationLine: "underline" },
  legalNote: { fontSize: 11, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: -16 },
});
