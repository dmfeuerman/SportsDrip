import {
  DEFAULT_AVATAR,
  DEFAULT_BASE,
  EYE_COLORS,
  HAIR_COLORS,
  sanitizeAppearance,
  SKIN_TONES,
} from "@/lib/avatar3d/avatarRules";
import type { AvatarConfig } from "@/types/avatar";

/**
 * Labels for the character creator. The allowed values themselves live in
 * lib/avatar3d/avatarRules.ts (shared with the server); a test checks every
 * id here exists there and vice versa.
 */
export { DEFAULT_AVATAR, EYE_COLORS, HAIR_COLORS, SKIN_TONES };

export interface HairStyle {
  id: string;
  label: string;
}

export const HAIR_STYLES: HairStyle[] = [
  { id: "buzz", label: "Buzz" },
  { id: "short_crop", label: "Short crop" },
  { id: "fade", label: "Fade" },
  { id: "curls", label: "Curls" },
  { id: "afro", label: "Afro" },
  { id: "braids", label: "Braids" },
  { id: "long", label: "Long" },
  { id: "ponytail", label: "Ponytail" },
  { id: "bald", label: "Bald" },
];

export const FACE_SHAPES = [
  { id: "oval", label: "Oval" },
  { id: "round", label: "Round" },
  { id: "square", label: "Square" },
  { id: "heart", label: "Heart" },
];

export const EYEBROWS = [
  { id: "soft", label: "Soft" },
  { id: "arched", label: "Arched" },
  { id: "bold", label: "Bold" },
  { id: "none", label: "None" },
];

export const EYE_SHAPES = [
  { id: "round", label: "Round" },
  { id: "almond", label: "Almond" },
  { id: "sleepy", label: "Sleepy" },
];

export const NOSE_SHAPES = [
  { id: "button", label: "Button" },
  { id: "straight", label: "Straight" },
  { id: "broad", label: "Broad" },
];

export const MOUTH_SHAPES = [
  { id: "neutral", label: "Neutral" },
  { id: "full", label: "Full" },
  { id: "wide", label: "Wide" },
];

export const FACIAL_HAIR = [
  { id: "none", label: "None" },
  { id: "stubble", label: "Stubble" },
  { id: "goatee", label: "Goatee" },
  { id: "beard", label: "Beard" },
];

export const BASE_MODEL = DEFAULT_BASE;

/** Any stored avatar (older clients, partial docs) as a complete, valid one. */
export function normalizeAvatar(a: Partial<AvatarConfig> | null | undefined): AvatarConfig {
  return sanitizeAppearance(a);
}

/** Randomiser for the "surprise me" button — keeps onboarding fast (§8). */
export function randomAvatar(): AvatarConfig {
  const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;
  return {
    height: Math.random(),
    bodyType: Math.random(),
    skinTone: pick(SKIN_TONES),
    hairStyle: pick(HAIR_STYLES).id,
    hairColor: pick(HAIR_COLORS),
    faceShape: pick(FACE_SHAPES).id,
    eyeColor: pick(EYE_COLORS),
    eyebrows: pick(EYEBROWS).id,
    eyeShape: pick(EYE_SHAPES).id,
    noseShape: pick(NOSE_SHAPES).id,
    mouthShape: pick(MOUTH_SHAPES).id,
    // Mostly clean-shaven: a random look shouldn't usually come with a beard.
    facialHair: Math.random() < 0.7 ? "none" : pick(FACIAL_HAIR.slice(1)).id,
    faceStyle: "features",
    base: BASE_MODEL,
  };
}
