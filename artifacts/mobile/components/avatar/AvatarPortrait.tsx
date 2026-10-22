import { Image } from "expo-image";
import React, { memo, useEffect, useMemo, useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";
import AvatarSilhouette from "@/components/avatar/AvatarSilhouette";
import type { ResolvedOutfit } from "@/lib/avatar3d/outfit";
import {
  getPortrait,
  invalidatePortrait,
  requestPortrait,
  subscribePortrait,
  type PortraitJob,
} from "@/lib/avatar3d/portraits";
import type { Framing } from "@/lib/avatar3d/spec";
import { avatarJob } from "@/lib/avatar3d/portraits";
import type { AvatarConfig } from "@/types/avatar";

/** Subscribes to one cached render; requests it when first seen. */
export function usePortrait(job: PortraitJob | null): string | undefined {
  const key = job?.key ?? "";
  const uri = useSyncExternalStore(
    (fn) => (key ? subscribePortrait(key, fn) : () => {}),
    () => (key ? getPortrait(key) : undefined),
    () => undefined
  );
  useEffect(() => {
    if (job && !uri) requestPortrait(job);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, uri]);
  return uri;
}

/**
 * A still of the real 3D character, for anywhere an avatar is small: friend
 * rows, standings, headers. Fills its parent. Shows a matching flat
 * silhouette until the render lands (or forever, without WebGL).
 */
function AvatarPortrait({
  avatar,
  outfit,
  framing,
}: {
  avatar: AvatarConfig;
  outfit: ResolvedOutfit;
  framing: Framing;
}) {
  const job = useMemo(() => avatarJob(avatar, outfit, framing), [avatar, outfit, framing]);
  const uri = usePortrait(job);
  const top = outfit.pieces.find((p) => p.slot === "outerwear" || p.slot === "top")?.primary;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit={framing === "bust" ? "cover" : "contain"}
          contentPosition="top center"
          transition={120}
          onError={() => invalidatePortrait(job)}
          accessible={false}
        />
      ) : (
        <AvatarSilhouette skin={avatar.skinTone} top={top} bottom={outfit.pieces.find((p) => p.slot === "bottom")?.primary} framing={framing} />
      )}
    </View>
  );
}

export default memo(AvatarPortrait);
