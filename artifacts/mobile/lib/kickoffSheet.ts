/** Opens the "starting within the hour" game list (components/KickoffSheet.tsx). */
type Listener = () => void;
const listeners = new Set<Listener>();

export function openKickoffSheet() {
  listeners.forEach((l) => l());
}

export function onOpenKickoffSheet(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
