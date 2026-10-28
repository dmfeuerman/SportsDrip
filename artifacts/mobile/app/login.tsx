import { MaterialCommunityIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { ActionChip } from "@/components/ui";

export default function LoginScreen() {
  const colors = useColors();
  const { signIn, signUp } = useAuth();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function friendlyError(code: string): string {
    if (code.includes("user-not-found") || code.includes("wrong-password") || code.includes("invalid-credential"))
      return "Invalid email or password.";
    if (code.includes("email-already-in-use")) return "An account with this email already exists.";
    if (code.includes("weak-password")) return "Password must be at least 6 characters.";
    if (code.includes("invalid-email")) return "Please enter a valid email address.";
    if (code.includes("too-many-requests")) return "Too many attempts. Try again later.";
    if (code.includes("operation-not-allowed") || code.includes("admin-restricted-operation"))
      return "Email sign-in isn't enabled yet. Enable it in Firebase Console → Authentication → Sign-in method → Email/Password.";
    if (code.includes("network-request-failed")) return "Network error. Check your connection.";
    return `Auth error: ${code}`;
  }

  async function handleSubmit() {
    setError(null);
    if (!email.trim() || !password) {
      setError("Please fill in all fields.");
      return;
    }
    if (mode === "signup" && password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (mode === "signup" && password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    try {
      if (mode === "signin") {
        await signIn(email.trim(), password);
      } else {
        await signUp(email.trim(), password);
      }
      router.replace("/(tabs)");
    } catch (e: any) {
      const code: string = e?.code ?? e?.message ?? "";
      setError(friendlyError(code));
    } finally {
      setLoading(false);
    }
  }

  function toggleMode() {
    setMode((m) => (m === "signin" ? "signup" : "signin"));
    setError(null);
    setPassword("");
    setConfirmPassword("");
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={s.kav}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={s.inner}>
          {/* Logo */}
          <View style={s.logoWrap}>
            <View style={[s.logoCircle, { backgroundColor: colors.primary + "22", borderColor: colors.primary + "55" }]}>
              <MaterialCommunityIcons name="lightning-bolt" size={48} color={colors.primary} />
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

            {/* Email */}
            <View style={[s.inputWrap, { borderColor: colors.border, backgroundColor: colors.secondary }]}>
              <MaterialCommunityIcons name="email-outline" size={18} color={colors.mutedForeground} />
              <TextInput
                style={[s.input, { color: colors.foreground }]}
                placeholder="Email"
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

            {/* Confirm password */}
            {mode === "signup" && (
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
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
                />
              </View>
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
              style={[s.btn, { backgroundColor: colors.primary }, loading && s.btnDisabled]}
              onPress={handleSubmit}
              activeOpacity={0.85}
              disabled={loading}
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
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  kav: { flex: 1 },
  inner: { flex: 1, justifyContent: "center", padding: 24, gap: 32 },
  logoWrap: { alignItems: "center", gap: 10 },
  logoCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  appName: { fontSize: 36, fontFamily: "Inter_700Bold", letterSpacing: -1 },
  tagline: { fontSize: 15, fontFamily: "Inter_400Regular" },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    gap: 14,
  },
  cardTitle: { fontSize: 20, fontFamily: "Inter_700Bold", marginBottom: 4 },
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
  toggleLink: { fontFamily: "Inter_600SemiBold" },
});
