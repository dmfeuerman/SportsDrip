import { useEffect, useRef } from "react";
import { normalizeAvatar } from "@/constants/avatarOptions";
import { useApp } from "@/context/AppContext";
import { useCatalog } from "@/hooks/useCatalog";
import { baseEntry } from "@/lib/avatar3d/assets";
import { loadAsset } from "@/lib/avatar3d/loader";
import { avatarJob, requestPortrait } from "@/lib/avatar3d/portraits";
import { resolveOutfit } from "@/lib/avatar3d/outfit";
import { loadGarments, loadParts } from "@/lib/avatar3d/useAvatarAssets";

/**
 * Starts loading the player's own character (body, hair, beard, everything
 * they're wearing) as soon as the profile and catalog arrive, instead of when
 * the 3D stage mounts and waits out its GL turn. By the time the stage gets a
 * context, the models are usually parsed and cached. Renders nothing.
 */
export default function AvatarPreloader() {
  const { profile } = useApp();
  const { byId } = useCatalog();
  const done = useRef("");
  const avatar = profile?.avatar;
  const equipped = profile?.equipped;
  const catalogReady = byId.size > 0;

  useEffect(() => {
    if (!avatar) return;
    const look = normalizeAvatar(avatar);
    // Body and hair don't need the catalog: start them right away.
    const sig = `${look.base ?? ""}|${look.hairStyle}|${look.facialHair ?? ""}|${catalogReady ? JSON.stringify(equipped ?? {}) : "-"}`;
    if (done.current === sig) return;
    // A beat after the render that delivered the profile, so the screen paints first.
    const task = setTimeout(() => {
      done.current = sig;
      void loadAsset({ key: baseEntry(look.base).key }).catch(() => {});
      void loadParts(look);
      if (catalogReady) {
        const outfit = resolveOutfit(equipped ?? {}, byId);
        void loadGarments(outfit.pieces);
        // The bet-result popup shows your character as a large still: have it drawn before a result
        // arrives, so it never opens on the flat stand-in.
        requestPortrait(avatarJob(look, outfit, "hero"));
      }
    }, 50);
    return () => clearTimeout(task);
  }, [avatar, equipped, byId, catalogReady]);

  return null;
}
