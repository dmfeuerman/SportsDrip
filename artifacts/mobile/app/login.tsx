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

export function calculateAgeFromDob(year: number, month: number, day: number): number {
  const now = new Date();
  let age = now.getFullYear() - year;
  const m = now.getMonth() + 1 - month;
  if (m < 0 || (m === 0 && now.getDate() < day)) {
    age--;
  }
  return age;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export default function LoginScreen() {
  const colors = useColors();
  const { signIn, signUp, signInWithGoogle, signInWithApple, signInWithSSO } = useAuth();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [ageText, setAgeText] = useState("");
  const [birthDateLabel, setBirthDateLabel] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [showDobPicker, setShowDobPicker] = useState(false);
  const [dobYear, setDobYear] = useState(2002);
  const [dobMonth, setDobMonth] = useState(6);
  const [dobDay, setDobDay] = useState(15);

  const [loading, setLoading] = useState(false);
  const [ssoBusy, setSsoBusy] = useState<"google" | "apple" | "guest" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const list: number[] = [];
    for (let y = currentYear - 13; y >= 1930; y--) list.push(y);
    return list;
  }, []);

  const daysInMonth = useMemo(() => {
    const count = new Date(dobYear, dobMonth, 0).getDate();
    return Array.from({ length: count }, (_, i) => i + 1);
  }, [dobYear, dobMonth]);

  function friendlyError(code: string, provider?: "google" | "apple" | "guest"): string {
    // Developer detail goes to the console; users get plain language.
    if (__DEV__) console.warn("[auth]", provider ?? "email", code);
    const name = provider === "guest" ? "Guest" : provider === "apple" ? "Apple" : provider === "google" ? "Google" : null;
    if (name && (code.includes("operation-not-allowed") || code.includes("admin-restricted-operation") || code.includes("invalid-credential") || code.includes("audience")))
      return `${name} sign-in isn't available right now. Try another way to sign in.`;
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

  function handleAgeChange(val: string) {
    const numeric = val.replace(/\D/g, "").slice(0, 3);
    setAgeText(numeric);
    setBirthDateLabel(null);
  }

  function handlePhoneChange(val: string) {
    setPhone(formatPhoneMask(val));
  }

  function applyDobSelection() {
    const computedAge = calculateAgeFromDob(dobYear, dobMonth, Math.min(dobDay, daysInMonth.length));
    const safeDay = Math.min(dobDay, daysInMonth.length);
    const formattedDob = `${dobYear}-${String(dobMonth).padStart(2, "0")}-${String(safeDay).padStart(2, "0")}`;
    setAgeText(String(Math.max(0, computedAge)));
    setBirthDateLabel(`${MONTHS[dobMonth - 1]} ${safeDay}, ${dobYear}`);
    setShowDobPicker(false);
    buzz.tick();
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
      const parsedAge = Number.parseInt(ageText, 10);
      if (!Number.isFinite(parsedAge) || parsedAge < 18 || parsedAge > 120) {
        setError("Please enter a valid age (must be 18 or older).");
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
        const parsedAge = Number.parseInt(ageText, 10);
        await signUp(email.trim(), password, {
          age: parsedAge,
          birthDate: birthDateLabel ?? undefined,
          phoneNumber: phone,
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

  async function handleSSO(provider: "google" | "apple" | "guest") {
    setError(null);
    if (mode === "signup") {
      const parsedAge = Number.parseInt(ageText, 10);
      const phoneDigits = extractPhoneDigits(phone);
      if (Number.isFinite(parsedAge) && parsedAge >= 18 && phoneDigits.length === 10) {
        setPendingSignupMeta({
          age: parsedAge,
          birthDate: birthDateLabel ?? undefined,
          phoneNumber: phone,
        });
      }
    }
    buzz.light();
    setSsoBusy(provider);
    try {
      if (provider === "google") await signInWithGoogle();
      else if (provider === "apple") await signInWithApple();
      else await signInWithSSO("guest");
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
            <View style={[s.logoCircle, { backgroundColor: colors.primary + "22", borderColor: colors.primary + "55" }]}>
              <MaterialCommunityIcons name="lightning-bolt" size={44} color={colors.primary} />
            </View>
            <Text style={[s.appName, { color: colors.foreground }]}>SportDrip</Text>
            <Text style={[s.tagline, { color: colors.mutedForeground }]}>
              Bet. Earn. Drip.
            </Text>
          </View>

          {/* Card */}
          <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[s.cardTitle, { color: colors.foreground }]}>
              {mode === "signin" ? "Welcome back" : "Create account"}
            </Text>

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

              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Continue with Quick Guest Pass"
                style={[
                  s.ssoBtn,
                  {
                    backgroundColor: "transparent",
                    borderColor: colors.border,
                  },
                ]}
                activeOpacity={0.85}
                disabled={loading || !!ssoBusy}
                onPress={() => handleSSO("guest")}
              >
                {ssoBusy === "guest" ? (
                  <ActivityIndicator size="small" color={colors.mutedForeground} />
                ) : (
                  <>
                    <MaterialCommunityIcons name="flash-outline" size={18} color={colors.accent} />
                    <Text style={[s.ssoBtnText, { color: colors.mutedForeground }]}>
                      Continue with Instant Pass
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            {/* Divider */}
            <View style={s.dividerRow}>
              <View style={[s.dividerLine, { backgroundColor: colors.border }]} />
              <Text style={[s.dividerText, { color: colors.mutedForeground }]}>
                OR {mode === "signin" ? "SIGN IN" : "SIGN UP"} WITH EMAIL
              </Text>
              <View style={[s.dividerLine, { backgroundColor: colors.border }]} />
            </View>

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

                {/* Age & Date of Birth Picker */}
                <View style={s.rowFields}>
                  <View style={[s.inputWrap, { flex: 1, borderColor: colors.border, backgroundColor: colors.secondary }]}>
                    <MaterialCommunityIcons name="calendar-account-outline" size={18} color={colors.mutedForeground} />
                    <TextInput
                      style={[s.input, { color: colors.foreground }]}
                      placeholder="Age (18+)"
                      placeholderTextColor={colors.mutedForeground}
                      value={ageText}
                      onChangeText={handleAgeChange}
                      keyboardType="number-pad"
                      maxLength={3}
                      returnKeyType="next"
                    />
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Pick date of birth"
                    onPress={() => setShowDobPicker(true)}
                    style={[s.dobBtn, { borderColor: colors.border, backgroundColor: colors.secondary }]}
                  >
                    <MaterialCommunityIcons name="calendar-month-outline" size={17} color={colors.primary} />
                    <Text style={[s.dobBtnText, { color: colors.foreground }]} numberOfLines={1}>
                      {birthDateLabel ?? "Pick DOB"}
                    </Text>
                  </Pressable>
                </View>

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

            {/* Error */}
            {error && (
              <View style={[s.errorBox, { backgroundColor: "#FF444422", borderColor: "#FF444455" }]}>
                <MaterialCommunityIcons name="alert-circle-outline" size={15} color="#FF4444" />
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}

            {/* Submit */}
            <TouchableOpacity
              style={[s.btn, { backgroundColor: colors.primary }, (loading || !!ssoBusy) && s.btnDisabled]}
              onPress={handleSubmit}
              activeOpacity={0.85}
              disabled={loading || !!ssoBusy}
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
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Date of Birth Picker Modal */}
      <Modal
        visible={showDobPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDobPicker(false)}
      >
        <View style={[s.modalScrim, { backgroundColor: colors.overlay }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowDobPicker(false)} />
          <View style={[s.dobModal, { backgroundColor: colors.elevated, borderColor: colors.border }]}>
            <View style={s.dobHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[s.dobTitle, { color: colors.foreground }]}>Select Date of Birth</Text>
                <Text style={[s.dobSubtitle, { color: colors.mutedForeground }]}>
                  Automatically calculates your verified age
                </Text>
              </View>
              <CloseButton onPress={() => setShowDobPicker(false)} />
            </View>

            <View style={s.dobColumns}>
              {/* Month */}
              <View style={s.dobCol}>
                <Text style={[s.dobColLabel, { color: colors.mutedForeground }]}>MONTH</Text>
                <ScrollView style={[s.dobScroll, { borderColor: colors.border, backgroundColor: colors.secondary }]} showsVerticalScrollIndicator={false}>
                  {MONTHS.map((m, idx) => {
                    const active = dobMonth === idx + 1;
                    return (
                      <Pressable
                        key={m}
                        onPress={() => setDobMonth(idx + 1)}
                        style={[s.dobOption, active && { backgroundColor: colors.primary }]}
                      >
                        <Text style={[s.dobOptionText, { color: active ? colors.primaryForeground : colors.foreground }]}>
                          {m}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Day */}
              <View style={s.dobCol}>
                <Text style={[s.dobColLabel, { color: colors.mutedForeground }]}>DAY</Text>
                <ScrollView style={[s.dobScroll, { borderColor: colors.border, backgroundColor: colors.secondary }]} showsVerticalScrollIndicator={false}>
                  {daysInMonth.map((d) => {
                    const active = dobDay === d;
                    return (
                      <Pressable
                        key={d}
                        onPress={() => setDobDay(d)}
                        style={[s.dobOption, active && { backgroundColor: colors.primary }]}
                      >
                        <Text style={[s.dobOptionText, { color: active ? colors.primaryForeground : colors.foreground }]}>
                          {d}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              {/* Year */}
              <View style={s.dobCol}>
                <Text style={[s.dobColLabel, { color: colors.mutedForeground }]}>YEAR</Text>
                <ScrollView style={[s.dobScroll, { borderColor: colors.border, backgroundColor: colors.secondary }]} showsVerticalScrollIndicator={false}>
                  {years.map((y) => {
                    const active = dobYear === y;
                    return (
                      <Pressable
                        key={y}
                        onPress={() => setDobYear(y)}
                        style={[s.dobOption, active && { backgroundColor: colors.primary }]}
                      >
                        <Text style={[s.dobOptionText, { color: active ? colors.primaryForeground : colors.foreground }]}>
                          {y}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            </View>

            <View style={[s.dobPreview, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
              <MaterialCommunityIcons name="information-outline" size={16} color={colors.primary} />
              <Text style={[s.dobPreviewText, { color: colors.foreground }]}>
                Calculated age: {calculateAgeFromDob(dobYear, dobMonth, Math.min(dobDay, daysInMonth.length))} years old
              </Text>
            </View>

            <TouchableOpacity
              style={[s.btn, { backgroundColor: colors.primary }]}
              onPress={applyDobSelection}
              activeOpacity={0.85}
            >
              <Text style={[s.btnText, { color: colors.primaryForeground }]}>Confirm Date of Birth</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  dividerText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
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
  rowFields: { flexDirection: "row", gap: 10 },
  dobBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  dobBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
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
  modalScrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: 20 },
  dobModal: { width: "100%", maxWidth: 400, borderRadius: 22, borderWidth: 1, padding: 20, gap: 14 },
  dobHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  dobTitle: { fontSize: 18, fontFamily: "Inter_800ExtraBold" },
  dobSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  dobColumns: { flexDirection: "row", gap: 8, height: 190 },
  dobCol: { flex: 1, gap: 6 },
  dobColLabel: { fontSize: 10, fontFamily: "Inter_800ExtraBold", letterSpacing: 0.8, textAlign: "center" },
  dobScroll: { flex: 1, borderWidth: 1, borderRadius: 12 },
  dobOption: { paddingVertical: 9, alignItems: "center", borderRadius: 8, marginHorizontal: 4, marginVertical: 2 },
  dobOptionText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  dobPreview: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
  dobPreviewText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
