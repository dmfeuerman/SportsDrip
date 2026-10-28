import { createPublicKey, verify, type KeyObject } from "node:crypto";

/**
 * AdMob rewarded-ad server-side verification (SSV).
 *
 * When a user finishes a rewarded video, Google calls our endpoint with a
 * signed query string. The signature is ECDSA/SHA-256 over everything before
 * `&signature=`, made with one of the keys published at ADMOB_KEYS_URL. A
 * request that does not verify never mints credits — the client's "I watched
 * it" event is display-only.
 */

export const ADMOB_KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json";

export interface SsvParams {
  adNetwork: string;
  adUnit: string;
  customData: string;
  rewardAmount: number;
  rewardItem: string;
  /** Milliseconds since epoch, as sent by AdMob. */
  timestamp: number;
  transactionId: string;
  userId: string;
  keyId: string;
}

export class SsvError extends Error {}

export type KeyFetcher = () => Promise<Array<{ keyId: string; pem: string }>>;

export const fetchGoogleKeys: KeyFetcher = async () => {
  const res = await fetch(ADMOB_KEYS_URL);
  if (!res.ok) throw new Error(`AdMob verifier keys: HTTP ${res.status}`);
  const body = (await res.json()) as { keys?: Array<{ keyId: number | string; pem: string }> };
  return (body.keys ?? []).map((k) => ({ keyId: String(k.keyId), pem: k.pem }));
};

const KEY_TTL_MS = 12 * 3_600_000;
let cache: { at: number; keys: Map<string, KeyObject> } | null = null;

export function resetKeyCache(): void {
  cache = null;
}

async function publicKey(keyId: string, fetchKeys: KeyFetcher, now: number): Promise<KeyObject | null> {
  // Refetch when stale, or when Google has rotated in a key we haven't seen.
  if (!cache || now - cache.at > KEY_TTL_MS || !cache.keys.has(keyId)) {
    const keys = await fetchKeys();
    cache = { at: now, keys: new Map(keys.map((k) => [k.keyId, createPublicKey(k.pem)])) };
  }
  return cache.keys.get(keyId) ?? null;
}

/** Splits the raw (still percent-encoded) query into the signed part and the signature. */
export function splitSignedQuery(rawQuery: string): { message: string; signature: string; keyId: string } | null {
  const at = rawQuery.indexOf("&signature=");
  if (at < 0) return null;
  const tail = new URLSearchParams(rawQuery.slice(at + 1));
  const signature = tail.get("signature");
  const keyId = tail.get("key_id");
  if (!signature || !keyId) return null;
  return { message: rawQuery.slice(0, at), signature, keyId };
}

export async function verifySsv(
  rawQuery: string,
  opts: { fetchKeys?: KeyFetcher; now?: number } = {}
): Promise<SsvParams> {
  const parts = splitSignedQuery(rawQuery);
  if (!parts) throw new SsvError("unsigned request");

  const key = await publicKey(parts.keyId, opts.fetchKeys ?? fetchGoogleKeys, opts.now ?? Date.now());
  if (!key) throw new SsvError(`unknown key_id ${parts.keyId}`);

  const ok = verify("sha256", Buffer.from(parts.message, "utf8"), key, Buffer.from(parts.signature, "base64url"));
  if (!ok) throw new SsvError("bad signature");

  const q = new URLSearchParams(parts.message);
  return {
    adNetwork: q.get("ad_network") ?? "",
    adUnit: q.get("ad_unit") ?? "",
    customData: q.get("custom_data") ?? "",
    rewardAmount: Number(q.get("reward_amount") ?? 0),
    rewardItem: q.get("reward_item") ?? "",
    timestamp: Number(q.get("timestamp") ?? 0),
    transactionId: q.get("transaction_id") ?? "",
    userId: q.get("user_id") ?? "",
    keyId: parts.keyId,
  };
}
