import { useEffect, useState } from "react";
import { normalizeAvatar } from "@/constants/avatarOptions";
import { loadGarments, loadParts } from "@/lib/avatar3d/useAvatarAssets";
import { loadAsset } from "@/lib/avatar3d/loader";
import { baseEntry } from "@/lib/avatar3d/assets";
import { resolveOutfit } from "@/lib/avatar3d/outfit";
import { useAvatarDrawn } from "@/lib/bootSignal";
import { bootTimeLeft } from "@/lib/bootGate";

export const AVATAR_LOAD_TIMEOUT_MS = 30_000;

/**
 * Holds the splash until the signed-in player's avatar (base body, hair and
 * every equipped garment) is downloaded and the live character has drawn with
 * that look, or until 30 seconds have passed.
 */
export function useAvatarGate(
  avatar: unknown,
  equipped: Record<string, string | null | undefined> | null | undefined,
  catalog: Map<string, any>,
  catalogLoading: boolean,
  profileLoaded: boolean
): boolean {
  const [timedOut, setTimedOut] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const drawn = useAvatarDrawn();

  useEffect(() => {
    // Never outlast the launch loading screen's 30s ceiling.
    const t = setTimeout(() => setTimedOut(true), Math.min(AVATAR_LOAD_TIMEOUT_MS, bootTimeLeft()));
    return () => clearTimeout(t);
  }, []);

  const hasAvatar = !!avatar;
  const key = JSON.stringify([avatar ?? null, equipped ?? {}]);

  useEffect(() => {
    if (!profileLoaded || loaded) return;
    if (!hasAvatar) {
      setLoaded(true);
      return;
    }
    if (catalogLoading) return;
    let alive = true;
    const look = normalizeAvatar(avatar as never);
    const outfit = resolveOutfit(equipped ?? {}, catalog);
    Promise.all([loadAsset({ key: baseEntry(look.base).key }), loadParts(look), loadGarments(outfit.pieces)])
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, profileLoaded, catalogLoading, loaded]);

  return timedOut || (loaded && (!hasAvatar || drawn));
}
