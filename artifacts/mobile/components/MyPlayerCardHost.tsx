import React, { useEffect, useState } from "react";
import PlayerProfileSheet from "@/components/PlayerProfileSheet";
import { useApp } from "@/context/AppContext";
import { onOpenMyPlayerCard } from "@/lib/myPlayerCard";

/** Your own player card, opened from the credit balance pill on any screen. */
export default function MyPlayerCardHost() {
  const { profile } = useApp();
  const [open, setOpen] = useState(false);
  useEffect(() => onOpenMyPlayerCard(() => setOpen(true)), []);
  return (
    <PlayerProfileSheet
      uid={open ? (profile?.uid ?? null) : null}
      onClose={() => setOpen(false)}
      seed={
        profile
          ? {
              displayName: profile.displayName,
              username: profile.username,
              avatar: profile.avatar,
              equipped: profile.equipped,
              moves: profile.moves,
              favoriteTeams: profile.favoriteTeams,
            }
          : undefined
      }
    />
  );
}
