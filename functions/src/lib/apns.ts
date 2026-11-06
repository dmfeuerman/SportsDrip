import { connect, constants } from "node:http2";
import { createSign } from "node:crypto";
import { defineSecret } from "firebase-functions/params";

/**
 * Direct APNs (HTTP/2 + .p8 token auth) for Live Activity updates — Expo's
 * push service doesn't send them. Secrets live in Secret Manager; nothing is
 * hard-coded. Bind them with `secrets: APNS_SECRETS` on any function that sends.
 */
export const APNS_KEY_P8 = defineSecret("APNS_KEY_P8");
export const APNS_KEY_ID = defineSecret("APNS_KEY_ID");
export const APNS_TEAM_ID = defineSecret("APNS_TEAM_ID");
export const APNS_SECRETS = [APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID];

export const APNS_TOPIC = "com.dmfeuerman.mobile.push-type.liveactivity";
const HOST = process.env.APNS_HOST || "https://api.push.apple.com";
/** ActivityKit caps payloads at 4 KB. */
export const MAX_PAYLOAD = 4096;

let jwtCache: { token: string; at: number } | null = null;

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** ES256 provider token, reused for 50 minutes (Apple allows up to 60). */
export function providerToken(now = Date.now(), creds?: { key: string; keyId: string; teamId: string }): string {
  if (!creds && jwtCache && now - jwtCache.at < 50 * 60_000) return jwtCache.token;
  const key = creds?.key ?? APNS_KEY_P8.value();
  const kid = creds?.keyId ?? APNS_KEY_ID.value();
  const iss = creds?.teamId ?? APNS_TEAM_ID.value();
  const header = b64url(JSON.stringify({ alg: "ES256", kid }));
  const claims = b64url(JSON.stringify({ iss, iat: Math.floor(now / 1000) }));
  const signer = createSign("SHA256");
  signer.update(`${header}.${claims}`);
  const sig = b64url(signer.sign({ key, dsaEncoding: "ieee-p1363" }));
  const token = `${header}.${claims}.${sig}`;
  if (!creds) jwtCache = { token, at: now };
  return token;
}

export interface ActivityContentState {
  homeScore: number;
  awayScore: number;
  clock: string;
  status: "live" | "final" | "delayed";
  coverMargin?: number | null;
  h2hDelta?: number | null;
}

export function activityPayload(state: ActivityContentState, event: "update" | "end", now = Date.now()): string {
  const body = JSON.stringify({
    aps: {
      timestamp: Math.floor(now / 1000),
      event,
      "content-state": state,
      ...(event === "end" ? { "dismissal-date": Math.floor(now / 1000) + 15 * 60 } : {}),
    },
  });
  if (Buffer.byteLength(body) > MAX_PAYLOAD) throw new Error("live activity payload over 4 KB");
  return body;
}

/** Sends one payload to many activity tokens. Returns tokens APNs says are dead (410 / BadDeviceToken). */
export async function sendLiveActivity(tokens: string[], payload: string): Promise<{ sent: number; dead: string[] }> {
  if (!tokens.length) return { sent: 0, dead: [] };
  const client = connect(HOST);
  const auth = `bearer ${providerToken()}`;
  const dead: string[] = [];
  let sent = 0;
  try {
    await Promise.all(
      tokens.map(
        (token) =>
          new Promise<void>((resolve) => {
            const req = client.request({
              [constants.HTTP2_HEADER_METHOD]: "POST",
              [constants.HTTP2_HEADER_PATH]: `/3/device/${token}`,
              authorization: auth,
              "apns-topic": APNS_TOPIC,
              "apns-push-type": "liveactivity",
              "apns-priority": "10",
            });
            let status = 0;
            let body = "";
            req.on("response", (h) => {
              status = Number(h[constants.HTTP2_HEADER_STATUS] ?? 0);
            });
            req.on("data", (d) => (body += d));
            req.on("end", () => {
              if (status === 200) sent++;
              else if (status === 410 || /BadDeviceToken|Unregistered/.test(body)) dead.push(token);
              resolve();
            });
            req.on("error", () => resolve());
            req.end(payload);
          })
      )
    );
  } finally {
    client.close();
  }
  return { sent, dead };
}
