import {
  GoogleAuthProvider,
  OAuthProvider,
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  type Auth,
  type AuthProvider as FirebaseAuthProvider,
  signOut as firebaseSignOut,
} from "firebase/auth";
import React, { createContext, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";
import { firebaseConfigured, getFirebaseAuth } from "@/lib/firebase";
import { unregisterPush } from "@/lib/push";
import { appleCredential, googleCredential, SignInCancelled, signOutSocial } from "@/lib/socialAuth";

/** Web: popup, falling back to a full-page redirect when the browser blocks popups. */
async function webSignIn(auth: Auth, provider: FirebaseAuthProvider) {
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    const code = (e as { code?: string })?.code ?? "";
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") throw new SignInCancelled();
    if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") return signInWithRedirect(auth, provider);
    throw e;
  }
}
import { setPendingSignupMeta, type PendingSignupMeta } from "@/lib/settings";

interface AuthContextType {
  currentUser: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, meta?: PendingSignupMeta) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(firebaseConfigured);

  useEffect(() => {
    if (!firebaseConfigured) return;
    const auth = getFirebaseAuth();
    if (!auth) return;
    const unsub = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setLoading(false);
    });
    return unsub;
  }, []);

  async function signIn(email: string, password: string) {
    const auth = getFirebaseAuth();
    if (!auth) throw new Error("Firebase not configured");
    await signInWithEmailAndPassword(auth, email, password);
  }

  async function signUp(email: string, password: string, meta?: PendingSignupMeta) {
    const auth = getFirebaseAuth();
    if (!auth) throw new Error("Firebase not configured");
    if (meta) {
      setPendingSignupMeta(meta);
    }
    await createUserWithEmailAndPassword(auth, email, password);
  }

  async function signInWithGoogle() {
    const auth = getFirebaseAuth();
    if (!auth) throw new Error("Firebase not configured");
    const provider = new GoogleAuthProvider();
    provider.addScope("profile");
    provider.addScope("email");
    if (Platform.OS === "web" && typeof window !== "undefined") {
      await webSignIn(auth, provider);
      return;
    }
    await signInWithCredential(auth, await googleCredential());
  }

  async function signInWithApple() {
    const auth = getFirebaseAuth();
    if (!auth) throw new Error("Firebase not configured");
    const provider = new OAuthProvider("apple.com");
    provider.addScope("email");
    provider.addScope("name");
    if (Platform.OS === "web" && typeof window !== "undefined") {
      await webSignIn(auth, provider);
      return;
    }
    await signInWithCredential(auth, await appleCredential());
  }

  async function signOut() {
    const auth = getFirebaseAuth();
    if (!auth) return;
    // While still signed in: detach this phone so the next account on it
    // doesn't receive the previous account's pushes.
    await unregisterPush();
    await signOutSocial();
    await firebaseSignOut(auth);
  }

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        loading,
        signIn,
        signUp,
        signInWithGoogle,
        signInWithApple,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
