import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

/**
 * Neutral age screen (FTC guidance): the picker starts blank and doesn't hint
 * at the cutoff, and once someone enters an age under 18 this device stays
 * locked out of sign-up, so they can't just go back and pick another age.
 */
export const MIN_AGE = 18;
const KEY = "sportdrip.ageGate.v1";

let locked = false;
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

function hydrate() {
  if (loaded) return;
  loaded = true;
  AsyncStorage.getItem(KEY)
    .then((raw) => {
      if (raw && !locked) {
        locked = true;
        emit();
      }
    })
    .catch(() => {});
}

/** Records an under-age attempt. Permanent on this install. */
export function lockAgeGate(): void {
  locked = true;
  emit();
  AsyncStorage.setItem(KEY, String(Date.now())).catch(() => {});
}

/** Checks an entered age; locks the device if it's under the minimum. */
export function passesAgeGate(age: number): boolean {
  if (!Number.isFinite(age) || age < MIN_AGE) {
    lockAgeGate();
    return false;
  }
  return true;
}

/** Blocked only while the device is locked AND the selected age isn't 18+. */
export function ageBlocked(isLocked: boolean, age: number | null): boolean {
  return isLocked && !(age !== null && age >= MIN_AGE);
}

export function useAgeGateLocked(): boolean {
  hydrate();
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => locked,
    () => false
  );
}

export const AGE_LOCKED_MESSAGE = "Sorry, you're not eligible to create an On The House account.";
