import { router, usePathname } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { ChoiceDialog } from "@/components/ui";
import { useParlay } from "@/context/ParlayContext";
import { haptic } from "@/lib/motion";
import { useTourState } from "@/lib/tour/store";

/** Where a parlay is built: the Games board, a game's page and the parlay slip. */
const isBetScreen = (path: string) => path === "/games" || path === "/parlay" || path.startsWith("/game/");

/**
 * Leaving the bet screens with a parlay in progress asks whether to end it.
 * "Keep Building" goes straight back to the screen they left.
 */
export default function ParlayLeaveGuard() {
  const path = usePathname();
  const { legs, clear } = useParlay();
  const { tour, ended } = useTourState();
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const prev = useRef(path);
  const lastBet = useRef<string>("/games");
  const latest = useRef({ count: legs.length, touring: !!tour });
  latest.current = { count: legs.length, touring: !!tour };
  // A tutorial that just ended navigates back on its own; don't treat that as leaving.
  const endedAt = useRef(0);
  useEffect(() => {
    if (ended) endedAt.current = Date.now();
  }, [ended]);

  useEffect(() => {
    const from = prev.current;
    prev.current = path;
    if (isBetScreen(path)) {
      lastBet.current = path;
      return;
    }
    const { count, touring } = latest.current;
    if (!isBetScreen(from) || !count || touring || Date.now() - endedAt.current < 2000) return;
    haptic.warning();
    setReturnTo(lastBet.current);
  }, [path]);

  // Emptied elsewhere (placed, cancelled): nothing left to ask about.
  useEffect(() => {
    if (!legs.length) setReturnTo(null);
  }, [legs.length]);

  const keep = () => {
    const to = returnTo;
    setReturnTo(null);
    if (to) router.navigate(to as never);
  };

  return (
    <ChoiceDialog
      visible={!!returnTo && legs.length > 0}
      title="End your parlay?"
      body={`You have ${legs.length} ${legs.length === 1 ? "leg" : "legs"} on your parlay. Leaving the bet screen ends it.`}
      actions={[
        {
          label: "End Parlay",
          icon: "close",
          variant: "destructive",
          onPress: () => {
            setReturnTo(null);
            clear();
          },
        },
      ]}
      cancelLabel="Keep Building"
      onCancel={keep}
    />
  );
}
