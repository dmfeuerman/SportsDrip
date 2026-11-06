"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_PAYLOAD = exports.APNS_TOPIC = exports.APNS_SECRETS = exports.APNS_TEAM_ID = exports.APNS_KEY_ID = exports.APNS_KEY_P8 = void 0;
exports.providerToken = providerToken;
exports.activityPayload = activityPayload;
exports.sendLiveActivity = sendLiveActivity;
const node_http2_1 = require("node:http2");
const node_crypto_1 = require("node:crypto");
const params_1 = require("firebase-functions/params");
/**
 * Direct APNs (HTTP/2 + .p8 token auth) for Live Activity updates — Expo's
 * push service doesn't send them. Secrets live in Secret Manager; nothing is
 * hard-coded. Bind them with `secrets: APNS_SECRETS` on any function that sends.
 */
exports.APNS_KEY_P8 = (0, params_1.defineSecret)("APNS_KEY_P8");
exports.APNS_KEY_ID = (0, params_1.defineSecret)("APNS_KEY_ID");
exports.APNS_TEAM_ID = (0, params_1.defineSecret)("APNS_TEAM_ID");
exports.APNS_SECRETS = [exports.APNS_KEY_P8, exports.APNS_KEY_ID, exports.APNS_TEAM_ID];
exports.APNS_TOPIC = "com.dmfeuerman.mobile.push-type.liveactivity";
const HOST = process.env.APNS_HOST || "https://api.push.apple.com";
/** ActivityKit caps payloads at 4 KB. */
exports.MAX_PAYLOAD = 4096;
let jwtCache = null;
const b64url = (b) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
/** ES256 provider token, reused for 50 minutes (Apple allows up to 60). */
function providerToken(now = Date.now(), creds) {
    if (!creds && jwtCache && now - jwtCache.at < 50 * 60_000)
        return jwtCache.token;
    const key = creds?.key ?? exports.APNS_KEY_P8.value();
    const kid = creds?.keyId ?? exports.APNS_KEY_ID.value();
    const iss = creds?.teamId ?? exports.APNS_TEAM_ID.value();
    const header = b64url(JSON.stringify({ alg: "ES256", kid }));
    const claims = b64url(JSON.stringify({ iss, iat: Math.floor(now / 1000) }));
    const signer = (0, node_crypto_1.createSign)("SHA256");
    signer.update(`${header}.${claims}`);
    const sig = b64url(signer.sign({ key, dsaEncoding: "ieee-p1363" }));
    const token = `${header}.${claims}.${sig}`;
    if (!creds)
        jwtCache = { token, at: now };
    return token;
}
function activityPayload(state, event, now = Date.now()) {
    const body = JSON.stringify({
        aps: {
            timestamp: Math.floor(now / 1000),
            event,
            "content-state": state,
            ...(event === "end" ? { "dismissal-date": Math.floor(now / 1000) + 15 * 60 } : {}),
        },
    });
    if (Buffer.byteLength(body) > exports.MAX_PAYLOAD)
        throw new Error("live activity payload over 4 KB");
    return body;
}
/** Sends one payload to many activity tokens. Returns tokens APNs says are dead (410 / BadDeviceToken). */
async function sendLiveActivity(tokens, payload) {
    if (!tokens.length)
        return { sent: 0, dead: [] };
    const client = (0, node_http2_1.connect)(HOST);
    const auth = `bearer ${providerToken()}`;
    const dead = [];
    let sent = 0;
    try {
        await Promise.all(tokens.map((token) => new Promise((resolve) => {
            const req = client.request({
                [node_http2_1.constants.HTTP2_HEADER_METHOD]: "POST",
                [node_http2_1.constants.HTTP2_HEADER_PATH]: `/3/device/${token}`,
                authorization: auth,
                "apns-topic": exports.APNS_TOPIC,
                "apns-push-type": "liveactivity",
                "apns-priority": "10",
            });
            let status = 0;
            let body = "";
            req.on("response", (h) => {
                status = Number(h[node_http2_1.constants.HTTP2_HEADER_STATUS] ?? 0);
            });
            req.on("data", (d) => (body += d));
            req.on("end", () => {
                if (status === 200)
                    sent++;
                else if (status === 410 || /BadDeviceToken|Unregistered/.test(body))
                    dead.push(token);
                resolve();
            });
            req.on("error", () => resolve());
            req.end(payload);
        })));
    }
    finally {
        client.close();
    }
    return { sent, dead };
}
//# sourceMappingURL=apns.js.map