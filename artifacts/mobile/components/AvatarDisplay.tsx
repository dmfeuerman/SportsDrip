import React, { forwardRef, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import AvatarPortrait from "@/components/avatar/AvatarPortrait";
import AvatarSilhouette from "@/components/avatar/AvatarSilhouette";
import AvatarStage, { type AvatarStageHandle } from "@/components/avatar/AvatarStage";
import type { SharedValue } from "react-native-reanimated";
import type { BackdropCam } from "@/components/avatar/AvatarBackdrop";
import { normalizeAvatar } from "@/constants/avatarOptions";
import type { ReactionKind } from "@/lib/avatar3d/reactions";
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
   * hero — large full-body still (top of Home)
   * lg — live, interactive 3D stage
   */
  size?: "xs" | "sm" | "hero" | "lg";
  /** lg only. Drag to spin + zoom buttons. Default on. */
  interactive?: boolean;
  /** lg only. Built-in zoom buttons; defaults to `interactive`. */
  controls?: boolean;
  /** lg only. True while a swipe / pinch owns the touch. */
  onGesture?: (active: boolean) => void;
  autoRotate?: boolean;
  focus?: Focus;
  /** lg only. Increment to play the celebrate animation. */
  cheerSignal?: number;
  /** lg only. Bet-result reaction, played once per new id. */
  reaction?: { kind: ReactionKind; id: number } | null;
  /** lg only. A loadout move (constants/moves.ts), played once per new `n`. */
  move?: { id: string; n: number } | null;
  /** lg only. False while the screen is hidden, so it stops drawing. */
  active?: boolean;
  /** lg only. Drives a ZoomingBackdrop with the camera. */
  backdropCam?: SharedValue<BackdropCam>;
  /** lg only. Tap on the character. */
  onTap?: () => void;
  /** lg only. Spinner while equipped clothes load. */
  loadingSpinner?: boolean;
}

/**
 * The one avatar component. Every size renders the same 3D character: `lg`
 * live, `xs`/`sm` as cached stills from the offscreen studio. A GL failure
 * falls back to a flat silhouette rather than taking the screen down.
 */
const AvatarDisplay = forwardRef<AvatarStageHandle, Props>(function AvatarDisplay(
  { avatar, equipped, catalog, size = "lg", interactive = true, controls, onGesture, autoRotate = false, focus, cheerSignal, reaction, move, active, backdropCam, onTap, loadingSpinner },
  ref
) {
  const look = useMemo(() => normalizeAvatar(avatar), [avatar]);
  const outfit = useResolvedOutfit(equipped ?? {}, catalog);

  if (size !== "lg") {
    return <AvatarPortrait avatar={look} outfit={outfit} framing={size === "xs" ? "bust" : size === "hero" ? "hero" : "full"} />;
  }

  const top = outfit.pieces.find((p) => p.slot === "outerwear" || p.slot === "top")?.primary;
  return (
    <GLBoundary fallback={<AvatarSilhouette skin={look.skinTone} top={top} bottom={outfit.pieces.find((p) => p.slot === "bottom")?.primary} />}>
      <View style={styles.fill}>
        <AvatarStage
          ref={ref}
          avatar={look}
          outfit={outfit}
          interactive={interactive}
          controls={controls}
          onGesture={onGesture}
          autoRotate={autoRotate}
          focus={focus}
          cheerSignal={cheerSignal}
          reaction={reaction}
          move={move}
          active={active}
          backdropCam={backdropCam}
          onTap={onTap}
          loadingSpinner={loadingSpinner}
        />
      </View>
    </GLBoundary>
  );
});

export default AvatarDisplay;

class GLBoundary extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode }, { failed: boolean; message: string | null }> {
  state = { failed: false, message: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown) {
    console.error("[avatar] 3D stage failed, showing silhouette", error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.fill}>
        {this.props.fallback}
        {__DEV__ && this.state.message ? (
          <Text style={styles.devError} numberOfLines={4}>
            3D error: {this.state.message}
          </Text>
        ) : null}
      </View>
    );
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignSelf: "stretch", minHeight: 180 },
  devError: { position: "absolute", left: 10, right: 10, bottom: 10, color: "#ff8a80", fontSize: 11, fontFamily: "Inter_500Medium" },
});
