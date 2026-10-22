/**
 * The saved appearance — the compact, renderer-independent description of a
 * character that lives on users/{uid}.avatar. Clothing lives next to it in
 * users/{uid}.equipped (slot → catalog item id). Together they are all that
 * is stored; the 3D character is rebuilt from them on every device.
 *
 * Defined in lib/avatar3d/avatarRules.ts, which the server shares.
 */
export type { AvatarConfig, Equipped, FaceStyle, Slot } from "../lib/avatar3d/avatarRules";
