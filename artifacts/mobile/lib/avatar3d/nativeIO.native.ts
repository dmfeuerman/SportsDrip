/**
 * Native (iOS / Android, incl. Expo Go) file and texture I/O for GLTFLoader.
 *
 * R3F's native polyfills route GLB loading through a base64 round trip and
 * embedded textures through Blob → object URL → XHR → FileReader.readAsText,
 * which corrupts binary image data on current React Native. Here the GLB is
 * read straight into an ArrayBuffer and each embedded image is written to the
 * cache as a file that expo-gl uploads itself (`{ localUri }`). If any image
 * still fails, the material renders without that map instead of the whole
 * character failing.
 */
import { Asset } from "expo-asset";
import { File, Paths } from "expo-file-system";
import * as THREE from "three";
import { trace } from "../devtrace";
import type { GLTFLoaderPlugin, GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";

/** Hermes may lack TextDecoder; GLTFLoader needs it for the GLB header and JSON chunk. */
export function ensureTextDecoder() {
  const g = globalThis as { TextDecoder?: unknown };
  if (typeof g.TextDecoder === "function") return;
  class Utf8Decoder {
    decode(input?: ArrayBuffer | ArrayBufferView) {
      if (!input) return "";
      const b = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      let out = "";
      for (let i = 0; i < b.length; ) {
        const c = b[i++]!;
        let cp = c;
        if (c >= 0xf0) cp = ((c & 0x07) << 18) | ((b[i++]! & 0x3f) << 12) | ((b[i++]! & 0x3f) << 6) | (b[i++]! & 0x3f);
        else if (c >= 0xe0) cp = ((c & 0x0f) << 12) | ((b[i++]! & 0x3f) << 6) | (b[i++]! & 0x3f);
        else if (c >= 0xc0) cp = ((c & 0x1f) << 6) | (b[i++]! & 0x3f);
        out += String.fromCodePoint(cp);
      }
      return out;
    }
  }
  g.TextDecoder = Utf8Decoder;
}

const exact = (u8: Uint8Array): ArrayBuffer =>
  (u8.byteOffset === 0 && u8.byteLength === u8.buffer.byteLength ? u8.buffer : u8.slice().buffer) as ArrayBuffer;

/**
 * Bytes of a bundled asset module or a remote URL.
 *
 * http(s) sources (every bundled asset in Expo Go is served by Metro; catalog
 * items live in Storage) are fetched directly. expo-asset's native
 * downloadAsync froze the JS thread on iOS when several ran at once (three
 * garments loading together after the catalog arrived). Files already on
 * disk — a release build's bundled assets — are read with expo-file-system.
 */
export async function readAssetBytes(src: { module: number } | { url: string }): Promise<ArrayBuffer> {
  const asset = "module" in src ? Asset.fromModule(src.module) : Asset.fromURI(src.url);
  const errors: string[] = [];
  const onDisk = asset.localUri ?? (asset.uri.startsWith("file:") ? asset.uri : null);
  if (onDisk) {
    try {
      return exact(await new File(onDisk).bytes());
    } catch (e) {
      errors.push(`file: ${String(e)}`);
    }
  }
  if (/^https?:/i.test(asset.uri)) {
    try {
      trace("avatar", `fetching ${asset.name || asset.uri}`);
      // A request that never answers must not hold up every later model.
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 20000);
      try {
        const res = await fetch(asset.uri, { signal: abort.signal });
        trace("avatar", `response ${res.status} for ${asset.name || asset.uri}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.arrayBuffer();
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      errors.push(`fetch: ${String(e)}`);
    }
  }
  // Anything else (Android resource ids in release builds): let expo-asset resolve it to a file.
  try {
    await asset.downloadAsync();
    const uri = asset.localUri ?? asset.uri;
    if (uri.startsWith("file:")) return exact(await new File(uri).bytes());
    const res = await fetch(uri);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.arrayBuffer();
  } catch (e) {
    errors.push(`asset: ${String(e)}`);
  }
  throw new Error(`[avatar] couldn't read ${asset.uri} (${errors.join("; ")})`);
}

/** Pixel size from a JPEG or PNG header. */
function imageSize(b: Uint8Array): { width: number; height: number } | null {
  if (b[0] === 0x89 && b[1] === 0x50) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1]!;
      const len = (b[i + 2]! << 8) | b[i + 3]!;
      // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (b[i + 5]! << 8) | b[i + 6]!, width: (b[i + 7]! << 8) | b[i + 8]! };
      }
      i += 2 + len;
    }
  }
  return null;
}

/** Short, stable name for an image's bytes (FNV-1a over size, head and tail). */
function bytesKey(b: Uint8Array) {
  let h = 0x811c9dc5 ^ b.length;
  const mixIn = (from: number, to: number) => {
    for (let i = from; i < to; i++) {
      h ^= b[i]!;
      h = Math.imul(h, 0x01000193);
    }
  };
  mixIn(0, Math.min(b.length, 4096));
  mixIn(Math.max(0, b.length - 4096), b.length);
  return `${(h >>> 0).toString(16)}-${b.length}`;
}

const WRAP: Record<number, THREE.Wrapping> = { 33071: THREE.ClampToEdgeWrapping, 33648: THREE.MirroredRepeatWrapping, 10497: THREE.RepeatWrapping };
const FILTER: Record<number, THREE.TextureFilter> = {
  9728: THREE.NearestFilter,
  9729: THREE.LinearFilter,
  9984: THREE.NearestMipmapNearestFilter,
  9985: THREE.LinearMipmapNearestFilter,
  9986: THREE.NearestMipmapLinearFilter,
  9987: THREE.LinearMipmapLinearFilter,
};

/** Embedded glTF images → cache files → expo-gl textures. */
export function nativeTexturePlugin(parser: GLTFParser): GLTFLoaderPlugin {
  return {
    name: "SD_native_textures",
    loadTexture(index: number) {
      const json = parser.json as {
        textures: Array<{ source?: number; sampler?: number; name?: string }>;
        images: Array<{ bufferView?: number; mimeType?: string }>;
        samplers?: Array<{ magFilter?: number; minFilter?: number; wrapS?: number; wrapT?: number }>;
      };
      const def = json.textures[index];
      const img = def?.source !== undefined ? json.images[def.source] : undefined;
      if (!img || img.bufferView === undefined) return null; // external URI: leave it to the default path
      return parser
        .getDependency("bufferView", img.bufferView)
        .then(async (view: ArrayBuffer) => {
          const bytes = new Uint8Array(view);
          const size = imageSize(bytes);
          if (!size) throw new Error("unknown image format");
          const ext = img.mimeType === "image/png" ? "png" : "jpg";
          const file = new File(Paths.cache, `sdav-${bytesKey(bytes)}.${ext}`);
          if (!file.exists || file.size !== bytes.length) {
            trace("avatar", `writing texture ${file.name} (${bytes.length} bytes)`);
            file.create({ overwrite: true });
            await file.write(bytes);
            trace("avatar", `wrote texture ${file.name}`);
          }
          const tex = new THREE.Texture();
          // expo-gl's texImage2D / texSubImage2D decode `{ localUri }` natively.
          tex.image = { data: { localUri: file.uri }, width: size.width, height: size.height } as never;
          (tex as unknown as { isDataTexture: boolean }).isDataTexture = true;
          tex.flipY = false;
          tex.name = def!.name ?? "";
          const s = json.samplers?.[def!.sampler ?? -1] ?? {};
          tex.magFilter = (FILTER[s.magFilter ?? 0] as THREE.MagnificationTextureFilter) ?? THREE.LinearFilter;
          tex.minFilter = (FILTER[s.minFilter ?? 0] as THREE.MinificationTextureFilter) ?? THREE.LinearMipmapLinearFilter;
          tex.wrapS = WRAP[s.wrapS ?? 0] ?? THREE.RepeatWrapping;
          tex.wrapT = WRAP[s.wrapT ?? 0] ?? THREE.RepeatWrapping;
          tex.generateMipmaps = tex.minFilter !== THREE.NearestFilter && tex.minFilter !== THREE.LinearFilter;
          tex.userData.mimeType = img.mimeType;
          tex.needsUpdate = true;
          parser.associations.set(tex, { textures: index });
          return tex;
        })
        .catch((e: unknown) => {
          console.warn(`[avatar] texture ${index} skipped on this device`, e);
          return null as unknown as THREE.Texture;
        });
    },
  };
}

/**
 * expo-gl implements gl.pixelStorei for UNPACK_FLIP_Y_WEBGL and
 * UNPACK_ALIGNMENT only, and logs "doesn't support this parameter yet" for
 * every other one. three sets five more (premultiply, colour-space
 * conversion, row length, skip pixels/rows) around every texture upload, and
 * skinned meshes re-upload their bone texture every frame: tens of thousands
 * of log lines a minute, each a JS→native round trip. Drop the ones expo-gl
 * ignores anyway, once per context.
 */
const UNPACK_FLIP_Y_WEBGL = 0x9240;
const UNPACK_ALIGNMENT = 0x0cf5;
export function quietPixelStore(renderer: { getContext(): unknown }) {
  try {
    const gl = renderer.getContext() as { pixelStorei: (p: number, v: number | boolean) => void; __sdQuiet?: boolean };
    if (!gl || gl.__sdQuiet || typeof gl.pixelStorei !== "function") return;
    const original = gl.pixelStorei.bind(gl);
    gl.pixelStorei = (pname, param) => {
      if (pname === UNPACK_FLIP_Y_WEBGL || pname === UNPACK_ALIGNMENT) original(pname, param);
    };
    gl.__sdQuiet = true;
  } catch {
    // Read-only context object on this device: keep the log noise rather than risk rendering.
  }
}
