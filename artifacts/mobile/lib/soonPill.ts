/**
 * "Game starting soon" pill queue. Deliberately separate from the toast
 * system: no haptic, no banner, no tap target — a quiet pill near the bottom
 * that fades in and out.
 */
export interface SoonPill {
  id: string;
  icon: string;
  league: string;
  away: string;
  home: string;
  minutes: number;
}

type Listener = (p: SoonPill) => void;
const listeners = new Set<Listener>();
const seen = new Set<string>();

/** Shows a pill once per id for the session. */
export function showSoonPill(p: SoonPill) {
  if (seen.has(p.id)) return;
  seen.add(p.id);
  listeners.forEach((l) => l(p));
}

export function onSoonPill(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
