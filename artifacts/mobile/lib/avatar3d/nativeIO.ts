/**
 * Web build: the browser loads GLBs and their images itself, so none of the
 * native I/O in nativeIO.native.ts is used. These stubs keep the imports
 * typed; Metro picks the .native file on iOS and Android.
 */
import type { GLTFLoaderPlugin, GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";

export function ensureTextDecoder() {}

export async function readAssetBytes(_src: { module: number } | { url: string }): Promise<ArrayBuffer> {
  throw new Error("readAssetBytes is native-only");
}

export function nativeTexturePlugin(_parser: GLTFParser): GLTFLoaderPlugin {
  return { name: "SD_native_textures" };
}

export function quietPixelStore(_renderer: { getContext(): unknown }) {}
