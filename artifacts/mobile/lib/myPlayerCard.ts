/** Opens the signed-in player's own card from anywhere (components/MyPlayerCardHost.tsx). */
type Listener = () => void;
const listeners = new Set<Listener>();

export function openMyPlayerCard() {
  listeners.forEach((l) => l());
}

export function onOpenMyPlayerCard(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
