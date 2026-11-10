import { useSyncExternalStore } from "react";

/** Set once the live 3D avatar has drawn with its full look and every garment on. */
let avatarDrawn = false;
const listeners = new Set<() => void>();

export function markAvatarDrawn() {
  if (avatarDrawn) return;
  avatarDrawn = true;
  listeners.forEach((l) => l());
}

export function useAvatarDrawn(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => avatarDrawn
  );
}
