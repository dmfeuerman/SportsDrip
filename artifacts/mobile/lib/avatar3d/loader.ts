import { Asset } from "expo-asset";
import { Platform } from "react-native";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
// Native only: importing R3F's native entry installs the FileLoader polyfill
// that lets GLTFLoader read bundled asset modules and file:// URIs.
import "./canvas";
import { assetEntry } from "./assets";
import { normalizeRig } from "./rigNames";

/** A bundled asset by key, or a remote one by URL (+ the catalog's version, to bust caches). */
export type AssetRef = { key: string } | { url: string; version?: number | null };

const cache = new Map<string, Promise<GLTF>>();
const loaded = new Map<string, GLTF>();
const loader = new GLTFLoader();

const versioned = (url: string, v?: number | null) => (v ? `${url}${url.includes("?") ? "&" : "?"}v=${v}` : url);
const idOf = (ref: AssetRef) => ("key" in ref ? `k:${ref.key}` : `u:${versioned(ref.url, ref.version)}`);

/**
 * Where to load from. Remote assets are downloaded once into the app's cache
 * directory (expo-asset keys the file by URL, so a new `version` is a new
 * download) and read from disk after that — including on the next launch.
 */
async function source(ref: AssetRef): Promise<string> {
  if ("url" in ref) {
    const url = versioned(ref.url, ref.version);
    if (Platform.OS === "web") return url; // the browser's HTTP cache does this job
    const a = await Asset.fromURI(url).downloadAsync();
    return a.localUri ?? url;
  }
  const entry = assetEntry(ref.key);
  if (!entry) throw new Error(`[avatar] unknown asset "${ref.key}"`);
  // Web: metro gives an asset module; GLTFLoader needs its URL.
  // Native: the polyfilled FileLoader resolves the module id itself.
  return Platform.OS === "web" ? Asset.fromModule(entry.module).uri : (entry.module as unknown as string);
}

/**
 * Loads (once) and caches a glTF. Failures are not cached, so a garment that
 * failed on a bad connection is retried next time it's needed.
 */
export function loadAsset(ref: AssetRef): Promise<GLTF> {
  const id = idOf(ref);
  let p = cache.get(id);
  if (!p) {
    p = source(ref)
      .then((src) => loader.loadAsync(src))
      .then(
        (g) => {
          normalizeRig(g.scene, g.animations);
          loaded.set(id, g);
          return g;
        },
        (e) => {
          cache.delete(id);
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
