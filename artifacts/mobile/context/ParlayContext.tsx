import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Market, Selection } from "@/lib/markets";

/** One pick on the parlay slip. */
export interface SlipLeg {
  gameId: string;
  market: Market;
  selection: Selection;
  label: string;
  odds: number;
  sport: string;
  matchup: string;
  startsAt: number;
}

export const MAX_SLIP_LEGS = 10;
/** Must match functions/src/callable/slipParlays.ts. */
export const MAX_SLIP_ODDS = 250;

export const slipOdds = (legs: Pick<SlipLeg, "odds">[]) => Math.round(Math.min(MAX_SLIP_ODDS, legs.reduce((p, l) => p * l.odds, 1)) * 100) / 100;

interface Ctx {
  legs: SlipLeg[];
  /** Adds a pick (replacing any other pick on the same game: one leg per game). */
  add: (leg: SlipLeg) => void;
  remove: (gameId: string) => void;
  clear: () => void;
  has: (gameId: string, market?: Market, selection?: Selection) => boolean;
  open: boolean;
  setOpen: (v: boolean) => void;
}

const ParlayCtx = createContext<Ctx | null>(null);

/** The bet slip for parlays: picks from any game screen land here until placed. */
export function ParlayProvider({ children }: { children: React.ReactNode }) {
  const [legs, setLegs] = useState<SlipLeg[]>([]);
  const [open, setOpen] = useState(false);
  const add = useCallback((leg: SlipLeg) => {
    setLegs((ls) => {
      const rest = ls.filter((l) => l.gameId !== leg.gameId);
      return rest.length >= MAX_SLIP_LEGS ? ls : [...rest, leg];
    });
  }, []);
  const remove = useCallback((gameId: string) => setLegs((ls) => ls.filter((l) => l.gameId !== gameId)), []);
  const clear = useCallback(() => setLegs([]), []);
  const has = useCallback(
    (gameId: string, market?: Market, selection?: Selection) => legs.some((l) => l.gameId === gameId && (!market || (l.market === market && l.selection === selection))),
    [legs]
  );
  const value = useMemo(() => ({ legs, add, remove, clear, has, open, setOpen }), [legs, add, remove, clear, has, open]);
  return <ParlayCtx.Provider value={value}>{children}</ParlayCtx.Provider>;
}

export function useParlay() {
  const c = useContext(ParlayCtx);
  if (!c) throw new Error("useParlay must be used inside ParlayProvider");
  return c;
}
