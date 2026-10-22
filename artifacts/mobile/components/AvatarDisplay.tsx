import React, { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import AvatarPortrait from "@/components/avatar/AvatarPortrait";
import AvatarSilhouette from "@/components/avatar/AvatarSilhouette";
import AvatarStage from "@/components/avatar/AvatarStage";
import { normalizeAvatar } from "@/constants/avatarOptions";
import type { Focus } from "@/lib/avatar3d/spec";
import { useResolvedOutfit } from "@/lib/avatar3d/useAvatarAssets";
import type { AvatarConfig, Equipped } from "@/types/avatar";
import type { CatalogItem } from "@/types/catalog";

interface Props {
  avatar: Partial<AvatarConfig> | null | undefined;
  equipped: Equipped | null | undefined;
  catalog: Map<string, CatalogItem>;
  /**
   * xs — head-and-shoulders still (rows, chips, standings)
   * sm — full-body still (cards, sheets)
   * lg — live, interactive 3D stage
   */
  size?: "xs" | "sm" | "lg";
  /** lg only. Drag to spin + zoom buttons. Default on. */
  interactive?: boolean;
  autoRotate?: boolean;
  focus?: Focus;
  /** lg only. Increment to play the celebrate animation. */
  cheerSignal?: number;
}

/**
 * The one avatar component. Every size renders the same 3D character: `lg`
 * live, `xs`/`sm` as cached stills from the offscreen studio. A GL failure
 * falls back to a flat silhouette rather than taking the screen down.
 */
export default function AvatarDisplay({
  avatar,
  equipped,
  catalog,
  size = "lg",
  interactive = true,
  autoRotate = false,
  focus,
  cheerSignal,
}: Props) {
  const look = useMemo(() => normalizeAvatar(avatar), [avatar]);
  const outfit = useResolvedOutfit(equipped ?? {}, catalog);

  if (size !== "lg") {
    return <AvatarPortrait avatar={look} outfit={outfit} framing={size === "xs" ? "bust" : "full"} />;
  }

  const top = outfit.pieces.find((p) => p.slot === "outerwear" || p.slot === "top")?.primary;
  return (
    <GLBoundary fallback={<AvatarSilhouette skin={look.skinTone} top={top} bottom={outfit.pieces.find((p) => p.slot === "bottom")?.primary} />}>
      <View style={styles.fill}>
        <AvatarStage
          avatar={look}
          outfit={outfit}
          interactive={interactive}
          autoRotate={autoRotate}
          focus={focus}
          cheerSignal={cheerSignal}
        />
      </View>
    </GLBoundary>
  );
}

class GLBoundary extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn("[avatar] 3D stage failed, showing silhouette", error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const styles = StyleSheet.create({ fill: { flex: 1, alignSelf: "stretch", minHeight: 180 } });
