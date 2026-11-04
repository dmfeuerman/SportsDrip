import {
  GoogleAuthProvider,
  OAuthProvider,
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInAnonymously,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
} from "firebase/auth";
import React, { createContext, useContext, useEffect, useState } from "react";
import { Platform } from "react-native";
import { firebaseConfigured, getFirebaseAuth } from "@/lib/firebase";
import { unregisterPush } from "@/lib/push";
import { appleCredential, googleCredential, signOutSocial } from "@/lib/socialAuth";
import { setPendingSignupMeta, type PendingSignupMeta } from "@/lib/settings";

interface AuthContextType {
  currentUser: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, meta?: PendingSignupMeta) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signInWithSSO: (provider: "google" | "apple" | "guest") => Promise<void>;
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
      await signInWithPopup(auth, provider);
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
      await signInWithPopup(auth, provider);
      return;
    }
    await signInWithCredential(auth, await appleCredential());
  }

  async function signInWithSSO(provider: "google" | "apple" | "guest") {
    if (provider === "google") return signInWithGoogle();
    if (provider === "apple") return signInWithApple();
    const auth = getFirebaseAuth();
    if (!auth) throw new Error("Firebase not configured");
    await signInAnonymously(auth);
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
        signInWithSSO,
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
