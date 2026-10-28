import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import {
  browserLocalPersistence,
  getAuth,
  getReactNativePersistence,
  indexedDBLocalPersistence,
  initializeAuth,
  type Auth,
} from "firebase/auth";
import { getFirestore, initializeFirestore, type Firestore } from "firebase/firestore";
import { getFunctions, httpsCallable, type Functions } from "firebase/functions";
import { Platform } from "react-native";

const apiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
const projectId = process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID;

import { DEMO } from "@/lib/demo";

/** Demo mode renders fixtures with Firebase fully off (lib/demo.ts). */
export const firebaseConfigured = Boolean(apiKey && projectId) && !DEMO;

let appRef: FirebaseApp | null = null;
let authRef: Auth | null = null;
let dbRef: Firestore | null = null;
let fnRef: Functions | null = null;

function getFirebaseApp(): FirebaseApp | null {
  if (!firebaseConfigured) return null;
  if (appRef) return appRef;

  appRef = getApps().length > 0
    ? getApp()
    : initializeApp({
        apiKey,
        authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId,
        // Guard against a malformed value in .replit — the bucket was
        // configured as `...firebasestorage.app"` with a trailing quote, which
        // makes every Storage request 404 (AUDIT S7).
        storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET?.replace(/["'\s]/g, ""),
        messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
      });

  return appRef;
}

/**
 * On React Native, `getAuth()` gives *in-memory* persistence — the session is
 * gone the moment the process dies, so every cold start bounced the user to
 * /login (AUDIT B2). `initializeAuth` with the AsyncStorage persister is the
 * required call. It must run exactly once per app, before any `getAuth`.
 */
export function getFirebaseAuth(): Auth | null {
  const app = getFirebaseApp();
  if (!app) return null;
  if (authRef) return authRef;

  if (Platform.OS === "web") {
    authRef = initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    });
  } else {
    try {
      authRef = initializeAuth(app, {
        persistence: getReactNativePersistence(AsyncStorage),
      });
    } catch {
      // initializeAuth throws if auth was already initialised (Fast Refresh).
      authRef = getAuth(app);
    }
  }

  return authRef;
}

export function getDb(): Firestore | null {
  const app = getFirebaseApp();
  if (!app) return null;
  if (!dbRef) {
    if (Platform.OS === "web") {
      dbRef = getFirestore(app);
    } else {
      // React Native's XHR can't stream, so WebChannel's streaming listen
      // channel can stall with no snapshot and no error. Long polling always
      // completes each response.
      try {
        dbRef = initializeFirestore(app, { experimentalForceLongPolling: true });
      } catch {
        dbRef = getFirestore(app); // already initialised (Fast Refresh)
      }
    }
  }
  return dbRef;
}

export function getFns(): Functions | null {
  const app = getFirebaseApp();
  if (!app) return null;
  if (!fnRef) fnRef = getFunctions(app, "us-central1");
  return fnRef;
}

/**
 * Typed wrapper around a callable. Every economy mutation goes through one of
 * these — the client no longer writes balances, bets, inventory or prize state
 * directly (AUDIT S2).
 */
export function callable<TReq, TRes>(name: string) {
  return async (data: TReq): Promise<TRes> => {
    const fns = getFns();
    if (!fns) throw new Error("Firebase is not configured.");
    const res = await httpsCallable<TReq, TRes>(fns, name)(data);
    return res.data;
  };
}
