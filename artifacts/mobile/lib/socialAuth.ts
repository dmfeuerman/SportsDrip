/**
 * Native Apple / Google sign-in → Firebase credentials.
 *
 * The old native path called signInAnonymously() for both buttons, so "Apple"
 * and "Google" either made an anonymous account or failed outright when the
 * Anonymous provider was off. These are the real flows:
 *
 *  - Apple: expo-apple-authentication (bundled in Expo Go and dev builds).
 *    In Expo Go Apple signs the token for `host.exp.Exponent`, so Firebase only
 *    accepts it if that bundle ID is listed for the Apple provider (or under an
 *    iOS app) in the Firebase console. A dev build uses com.dmfeuerman.mobile.
 *  - Google: @react-native-google-signin/google-signin. It's a native module
 *    that Expo Go doesn't contain, so Google needs the dev build
 *    (`expo run:ios`) plus EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID and
 *    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID (see app.config.js).
 */
import Constants, { ExecutionEnvironment } from "expo-constants";
import { GoogleAuthProvider, OAuthProvider, type AuthCredential } from "firebase/auth";
import { Platform } from "react-native";

export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() || "";
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() || "";

/** Thrown when the user backs out of the provider's sheet: not an error to show. */
export class SignInCancelled extends Error {
  code = "auth/cancelled";
  constructor() {
    super("Sign-in cancelled");
  }
}

/** A sign-in that can't work in this build, with a message that says why. */
export class SignInUnavailable extends Error {
  code = "auth/unavailable";
}

export async function appleCredential(): Promise<AuthCredential> {
  if (Platform.OS !== "ios") throw new SignInUnavailable("Sign in with Apple is only available on iPhone.");
  const Apple = await import("expo-apple-authentication");
  const Crypto = await import("expo-crypto");
  if (!(await Apple.isAvailableAsync())) throw new SignInUnavailable("Sign in with Apple isn't available on this device.");

  // Apple gets the hash; Firebase gets the raw value and checks they match.
  const rawNonce = Crypto.randomUUID();
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  try {
    const res = await Apple.signInAsync({
      requestedScopes: [Apple.AppleAuthenticationScope.FULL_NAME, Apple.AppleAuthenticationScope.EMAIL],
      nonce: hashed,
    });
    if (!res.identityToken) throw new Error("Apple didn't return an identity token.");
    return new OAuthProvider("apple.com").credential({ idToken: res.identityToken, rawNonce });
  } catch (e) {
    if ((e as { code?: string })?.code === "ERR_REQUEST_CANCELED") throw new SignInCancelled();
    throw e;
  }
}

export async function googleCredential(): Promise<AuthCredential> {
  if (isExpoGo) {
    throw new SignInUnavailable(
      "Google sign-in needs the SportDrip dev build — Expo Go can't host Google's native sign-in. Run `npx expo run:ios`, or use Apple / email here."
    );
  }
  if (!GOOGLE_IOS_CLIENT_ID || !GOOGLE_WEB_CLIENT_ID) {
    throw new SignInUnavailable("Google sign-in isn't set up: add EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID and EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID, then rebuild.");
  }
  // Loaded lazily: the native module only exists in a dev / store build.
  const { GoogleSignin, isSuccessResponse, isErrorWithCode, statusCodes } = await import("@react-native-google-signin/google-signin");
  GoogleSignin.configure({ iosClientId: GOOGLE_IOS_CLIENT_ID, webClientId: GOOGLE_WEB_CLIENT_ID });
  try {
    const res = await GoogleSignin.signIn();
    if (!isSuccessResponse(res)) throw new SignInCancelled();
    const idToken = res.data.idToken;
    if (!idToken) throw new Error("Google didn't return an ID token. Check EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID.");
    return GoogleAuthProvider.credential(idToken);
  } catch (e) {
    if (isErrorWithCode(e) && (e.code === statusCodes.SIGN_IN_CANCELLED || e.code === statusCodes.IN_PROGRESS)) throw new SignInCancelled();
    throw e;
  }
}

/** Signs Google out too, so the next tap shows the account picker. */
export async function signOutSocial(): Promise<void> {
  if (isExpoGo || Platform.OS === "web" || !GOOGLE_IOS_CLIENT_ID) return;
  try {
    const { GoogleSignin } = await import("@react-native-google-signin/google-signin");
    await GoogleSignin.signOut();
  } catch {}
}
