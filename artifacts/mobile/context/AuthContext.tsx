import {
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from "firebase/auth";
import React, { createContext, useContext, useEffect, useState } from "react";
import { firebaseConfigured, getFirebaseAuth } from "@/lib/firebase";

interface AuthContextType {
  currentUser: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
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

  async function signUp(email: string, password: string) {
    const auth = getFirebaseAuth();
    if (!auth) throw new Error("Firebase not configured");
    await createUserWithEmailAndPassword(auth, email, password);
  }

  async function signOut() {
    const auth = getFirebaseAuth();
    if (!auth) return;
    await firebaseSignOut(auth);
  }

  return (
    <AuthContext.Provider value={{ currentUser, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
