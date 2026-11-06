import AsyncStorage from "@react-native-async-storage/async-storage";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { Platform, AppState } from "react-native";
import { DEMO } from "@/lib/demo";
import { firebaseConfigured, getDb, getFirebaseAuth } from "@/lib/firebase";

/**
 * Funnel analytics, from day one.
 *
 * Firebase Analytics' JS SDK needs a DOM and doesn't run in React Native, so
 * events go to Firestore instead: analyticsEvents/{eventId}, create-only,
 * stamped with the signed-in uid and a server timestamp (firestore.rules
 * enforces all three). That's enough to answer "how many people who captured
 * an invite ended up joining a league?" with a query or a BigQuery export,
 * and it costs one batched write every few seconds at most.
 *
 * Events fired before sign-in (an invite link opened on a fresh install) are
 * queued in AsyncStorage and flushed once someone is signed in. Tracking never
 * throws and never blocks the caller.
 */

export const FUNNEL_EVENTS = [
  "onboarding_completed",
  "invite_code_captured",
  "league_created",
  "league_joined",
  "bet_placed",
  "bet_tailed",
  "bet_faded",
  "share_card_tapped",
  "slip_opened",
  "slip_stake_set",
  "slip_confirmed",
  "slip_error",
  "share_completed",
  "reaction_sent",
  "prompt_shown",
  "prompt_accepted",
  "prompt_declined",
  "daily_pick_made",
  "quest_claimed",
  "feed_item_tapped",
  "tail_from_chat",
  "activation_reached",
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];
export type EventParams = Record<string, string | number | boolean | null | undefined>;

interface QueuedEvent {
  id: string;
  name: FunnelEvent;
  params: Record<string, string | number | boolean | null>;
  clientAt: number;
  sessionId: string;
}

const STORAGE_KEY = "sportdrip.analytics.queue.v1";
const BATCH_COLLECTION = "analyticsBatches";
/** Must match the rules: at most this many params, keys snake_case. */
const MAX_PARAMS = 12;
const MAX_STRING = 100;
const MAX_QUEUE = 200;
/** Firestore batches cap at 500 writes; stay well under. */
const BATCH_SIZE = 50;
/** Events gather for a while so a session flushes in a write or two. */
const FLUSH_DELAY_MS = 30_000;
const RETRY_DELAY_MS = 30_000;

const sessionId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

let queue: QueuedEvent[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;

const enabled = () => firebaseConfigured && !DEMO;

function eventId(at: number): string {
  return `${at.toString(36)}_${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;
}

function sanitize(params: EventParams | undefined): QueuedEvent["params"] {
  const out: QueuedEvent["params"] = {};
  if (!params) return out;
  for (const [k, v] of Object.entries(params)) {
    if (Object.keys(out).length >= MAX_PARAMS) break;
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(k) || v === undefined) continue;
    if (typeof v === "number") {
      if (Number.isFinite(v)) out[k] = v;
    } else if (typeof v === "string") {
      out[k] = v.slice(0, MAX_STRING);
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function load(): Promise<void> {
  if (loaded) return;
  if (!loading) {
    loading = (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const stored = raw ? (JSON.parse(raw) as QueuedEvent[]) : [];
        if (Array.isArray(stored)) {
          const seen = new Set(queue.map((e) => e.id));
          queue = [...stored.filter((e) => e && typeof e.id === "string" && !seen.has(e.id)), ...queue].slice(-MAX_QUEUE);
        }
      } catch {
        // Corrupt or unavailable storage: start clean rather than never tracking again.
      } finally {
        loaded = true;
      }
    })();
  }
  await loading;
}

async function persist(): Promise<void> {
  try {
    if (queue.length) await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    else await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best effort: the in-memory queue still flushes this session.
  }
}

function schedule(delay = FLUSH_DELAY_MS) {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flushAnalytics();
  }, delay);
}

function isPermissionDenied(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code ?? "";
  return code.includes("permission-denied");
}

/**
 * Records a funnel event. Fire and forget: safe to call from render paths,
 * success handlers and before sign-in.
 */
export function trackEvent(name: FunnelEvent, params?: EventParams): void {
  const clientAt = Date.now();
  const event: QueuedEvent = { id: eventId(clientAt), name, params: sanitize(params), clientAt, sessionId };
  // Monitor log off. Uncomment to see every analytics event in Metro.
  // if (__DEV__) console.log(`[analytics] ${name}`, event.params);
  if (!enabled()) return;
  queue = [...queue, event].slice(-MAX_QUEUE);
  void load().then(persist);
  schedule();
}

/**
 * Writes everything queued, if someone is signed in. Called on a short timer
 * after each event and once when a user signs in (AppShell), so events
 * captured while signed out land under the account that was created.
 */
export function flushAnalytics(): Promise<void> {
  if (!enabled()) return Promise.resolve();
  if (flushing) return flushing;
  flushing = (async () => {
    await load();
    const db = getDb();
    const uid = getFirebaseAuth()?.currentUser?.uid;
    if (!db || !uid || queue.length === 0) return;

    // One document per flush (analyticsBatches) instead of one per event:
    // a session's worth of events is a single write.
    const batchEvents = queue.slice(0, BATCH_SIZE);
    const done = new Set<string>();
    try {
      const id = `${uid.slice(0, 12)}_${batchEvents[0]!.id}`.slice(0, 64);
      await setDoc(doc(db, BATCH_COLLECTION, id), {
        uid,
        at: serverTimestamp(),
        platform: Platform.OS,
        sessionId,
        schema: 2,
        events: batchEvents.map((e) => ({ id: e.id, name: e.name, params: e.params, clientAt: e.clientAt, sessionId: e.sessionId })),
      });
      batchEvents.forEach((e) => done.add(e.id));
    } catch (err) {
      if (!isPermissionDenied(err)) {
        // Offline or transient: keep everything and try again later.
        schedule(RETRY_DELAY_MS);
        return;
      }
      // Refused (already written, or rules): drop this batch rather than retry forever.
      batchEvents.forEach((e) => done.add(e.id));
    } finally {
      if (done.size) {
        queue = queue.filter((e) => !done.has(e.id));
        await persist();
      }
    }
    if (queue.length) schedule();
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

// Send what's gathered when the app goes to the background.
AppState.addEventListener("change", (st) => {
  if (st === "background") void flushAnalytics();
});
