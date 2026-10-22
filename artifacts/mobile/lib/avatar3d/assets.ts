import { AVATAR_ASSETS } from "./assetRegistry.generated";
import { DEFAULT_BASE } from "./avatarRules";
import type { AvatarAssetEntry } from "./spec";

export function baseEntry(key: string | undefined): { key: string; entry: AvatarAssetEntry } {
  const k = key && AVATAR_ASSETS[key]?.kind === "base" ? key : DEFAULT_BASE;
  return { key: k, entry: AVATAR_ASSETS[k]! };
}

export function assetEntry(key: string): AvatarAssetEntry | undefined {
  return AVATAR_ASSETS[key];
}
