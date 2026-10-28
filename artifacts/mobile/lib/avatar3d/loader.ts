import { Asset } from "expo-asset";
import { Platform } from "react-native";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
// Native only: wires R3F's native entry (expo-gl context, touch events).
import "./canvas";
import { trace, withTimeout } from "../devtrace";
import { assetEntry } from "./assets";
import { ensureTextDecoder, nativeTexturePlugin, readAssetBytes } from "./nativeIO";
import { normalizeRig } from "./rigNames";

const NATIVE = Platform.OS !== "web";

if (NATIVE) {
  // RN defines `navigator` without `userAgent`; GLTFParser calls userAgent.match().
  if (typeof navigator !== "undefined" && typeof navigator.userAgent !== "string") {
    Object.defineProperty(navigator, "userAgent", { value: "ReactNative", configurable: true });
  }
  ensureTextDecoder();
}

/** A bundled asset by key, or a remote one by URL (+ the catalog's version, to bust caches). */
export type AssetRef = { key: string } | { url: string; version?: number | null };

const cache = new Map<string, Promise<GLTF>>();
const loaded = new Map<string, GLTF>();
const loader = new GLTFLoader();
// Native: embedded images become cache files expo-gl uploads itself (see nativeIO.native.ts).
if (NATIVE) loader.register(nativeTexturePlugin);

const versioned = (url: string, v?: number | null) => (v ? `${url}${url.includes("?") ? "&" : "?"}v=${v}` : url);
const idOf = (ref: AssetRef) => ("key" in ref ? `k:${ref.key}` : `u:${versioned(ref.url, ref.version)}`);

/** The most recent load failure, for the stage's fallback message (dev builds show it). */
export let lastLoadError: string | null = null;

/**
 * Web: the URL GLTFLoader fetches (the browser's HTTP cache does the caching).
 * Native: the file's bytes. Remote assets are downloaded once into the app's
 * cache directory by expo-asset (keyed by URL, so a new `version` is a new
 * download) and read from disk after that — including on the next launch.
 */
async function fetchGltf(ref: AssetRef): Promise<GLTF> {
  const id = idOf(ref);
  if ("url" in ref) {
    const url = versioned(ref.url, ref.version);
    if (!NATIVE) return loader.loadAsync(url);
    return parseNative(id, { url });
  }
  const entry = assetEntry(ref.key);
  if (!entry) throw new Error(`[avatar] unknown asset "${ref.key}"`);
  if (!NATIVE) return loader.loadAsync(Asset.fromModule(entry.module).uri);
  return parseNative(id, { module: entry.module });
}

/**
 * Native loads run one at a time: read, parse, write textures, then the next.
 * Overlapping native file and network calls are what locked up the JS thread
 * on iOS; a single queue also keeps launch from bursting.
 */
let nativeQueue: Promise<unknown> = Promise.resolve();

function parseNative(id: string, src: { module: number } | { url: string }): Promise<GLTF> {
  const run = nativeQueue.then(async () => {
    trace("avatar", `fetch ${id}`);
    const bytes = await readAssetBytes(src);
    trace("avatar", `read ${id} (${bytes.byteLength} bytes), parsing`);
    return loader.parseAsync(bytes, "");
  });
  nativeQueue = run.catch(() => {});
  return run;
}

/**
 * Loads (once) and caches a glTF. Failures are not cached, so a garment that
 * failed on a bad connection is retried next time it's needed.
 */
export function loadAsset(ref: AssetRef): Promise<GLTF> {
  const id = idOf(ref);
  let p = cache.get(id);
  if (!p) {
    const start = Date.now();
    // A read or parse that never settles would leave every avatar spinning; fail it instead.
    p = withTimeout(fetchGltf(ref), 30000, `loading ${id}`).then(
      (g) => {
        normalizeRig(g.scene, g.animations);
        loaded.set(id, g);
        trace("avatar", `loaded ${id} in ${Date.now() - start}ms`);
        return g;
      },
      (e) => {
        cache.delete(id);
        lastLoadError = `${id}: ${e instanceof Error ? e.message : String(e)}`;
        console.error(`[avatar] failed to load ${id}`, e);
        throw e;
      }
    );
    cache.set(id, p);
  }
  return p;
}

/** Synchronous peek, so a re-render with cached assets doesn't flash. */
export function peekAsset(ref: AssetRef): GLTF | undefined {
  return loaded.get(idOf(ref));
}

export function refId(ref: AssetRef) {
  return idOf(ref);
}
