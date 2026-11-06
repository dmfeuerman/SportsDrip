#!/usr/bin/env node
/**
 * Wires Google + Apple sign-in config from the Firebase project into the app.
 *
 *   node scripts/setup-social-signin.mjs            # report + write .env
 *   node scripts/setup-social-signin.mjs --dry-run  # report only
 *
 * Uses ../service-account.json. It:
 *  - checks Google and Apple are enabled under Firebase Authentication,
 *  - reads the Google web client ID (the Firebase Google provider's client),
 *  - reads the iOS OAuth client ID from the iOS app's GoogleService-Info.plist,
 *  - writes EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID / EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
 *    to artifacts/mobile/.env.
 * Rebuild the iOS app afterwards (`npx expo run:ios`): the Google URL scheme
 * is baked in at build time.
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "functions/package.json"));
const { GoogleAuth } = require("google-auth-library");

const keyFile = resolve(root, "service-account.json");
const envFile = resolve(root, "artifacts/mobile/.env");
const BUNDLE_ID = "com.dmfeuerman.mobile";
const dry = process.argv.includes("--dry-run");

const project = JSON.parse(readFileSync(keyFile, "utf8")).project_id;
const client = await new GoogleAuth({ keyFile, scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getClient();
const get = async (url) => {
  try {
    return (await client.request({ url })).data;
  } catch (e) {
    return { error: e.response?.status ?? e.message, detail: e.response?.data?.error?.message };
  }
};

const idp = (p) => get(`https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/defaultSupportedIdpConfigs/${p}`);
const google = await idp("google.com");
const apple = await idp("apple.com");
const say = (ok, msg) => console.log(`${ok ? "✓" : "✗"} ${msg}`);

say(google.enabled, google.enabled ? "Google provider enabled" : `Google provider not enabled (${google.detail ?? google.error ?? "off"}) — Firebase console → Authentication → Sign-in method → Google`);
say(apple.enabled, apple.enabled ? "Apple provider enabled" : `Apple provider not enabled (${apple.detail ?? apple.error ?? "off"}) — Firebase console → Authentication → Sign-in method → Apple`);

const webClientId = google.clientId ?? null;
let iosClientId = null;
const ios = await get(`https://firebase.googleapis.com/v1beta1/projects/${project}/iosApps`);
const app = (ios.apps ?? []).find((a) => a.bundleId === BUNDLE_ID) ?? (ios.apps ?? [])[0];
if (!app) say(false, `No iOS app in Firebase for ${BUNDLE_ID} — Project settings → Add app → iOS`);
else {
  const cfg = await get(`https://firebase.googleapis.com/v1beta1/${app.name}/config`);
  const plist = cfg.configFileContents ? Buffer.from(cfg.configFileContents, "base64").toString() : "";
  iosClientId = (plist.match(/<key>CLIENT_ID<\/key>\s*<string>([^<]+)<\/string>/) ?? [])[1] ?? null;
  say(!!iosClientId, iosClientId ? `iOS client ID found (${app.bundleId})` : "iOS app has no CLIENT_ID yet — enable Google sign-in, then re-download GoogleService-Info.plist");
}
say(!!webClientId, webClientId ? "Web client ID found" : "Web client ID missing (enable the Google provider first)");

if (dry || (!webClientId && !iosClientId)) process.exit(webClientId && iosClientId ? 0 : 1);

let env = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
const put = (k, v) => {
  if (!v) return;
  const line = `${k}=${v}`;
  env = new RegExp(`^${k}=.*$`, "m").test(env) ? env.replace(new RegExp(`^${k}=.*$`, "m"), line) : `${env.replace(/\n?$/, "\n")}${line}\n`;
};
put("EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID", webClientId);
put("EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID", iosClientId);
writeFileSync(envFile, env);
console.log(`Wrote ${envFile}. Now rebuild: cd artifacts/mobile && npx expo run:ios`);
