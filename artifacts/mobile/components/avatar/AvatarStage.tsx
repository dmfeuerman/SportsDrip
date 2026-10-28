import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFrame, useThree } from "@react-three/fiber";
import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type ViewStyle,
} from "react-native";
import * as THREE from "three";
import AvatarSilhouette from "@/components/avatar/AvatarSilhouette";
import { addStudioLights, AvatarRig, contactShadow, fitDepthRange, type AppearanceParts, type GarmentSource } from "@/lib/avatar3d/avatarRig";
import { Canvas } from "@/lib/avatar3d/canvas";
import type { ResolvedOutfit } from "@/lib/avatar3d/outfit";
import type { ReactionKind } from "@/lib/avatar3d/reactions";
import { CAMERA_FOV, FOCUS, focusToZoom, zoomFraming, type Focus } from "@/lib/avatar3d/spec";
import { lastLoadError } from "@/lib/avatar3d/loader";
import { quietPixelStore } from "@/lib/avatar3d/nativeIO";
import { trace } from "@/lib/devtrace";
import { takeGlTurn, type GlTurn } from "@/lib/avatar3d/glGate";
import { useAvatarAssets } from "@/lib/avatar3d/useAvatarAssets";
import type { AvatarConfig } from "@/types/avatar";

/** Pixels of the stage covered by overlays (toolbar, bottom sheet). Read every frame — no re-render needed. */
export interface StageInsets {
  top: number;
  bottom: number;
}

export interface AvatarStageHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  /** Back to the category's framing, facing forward. */
  resetView: () => void;
}

export interface AvatarStageProps {
  avatar: AvatarConfig;
  outfit: ResolvedOutfit;
  /** Camera framing; changes animate and clear any manual zoom. */
  focus?: Focus;
  /** Drag to turn, pinch / wheel to zoom. */
  interactive?: boolean;
  /** Built-in zoom buttons (bottom right). Off when the screen draws its own. */
  controls?: boolean;
  /** True while a turn / pinch owns the touch (e.g. to pause a parent ScrollView). */
  onGesture?: (active: boolean) => void;
  autoRotate?: boolean;
  /** Increment to play the celebrate animation once. */
  cheerSignal?: number;
  /** False while the screen is hidden (another tab): stops drawing, keeps the scene. */
  active?: boolean;
  /** Bet-result reaction: plays once per new `id` (win: hop + fist pumps; loss: hands to face, tears). */
  reaction?: { kind: ReactionKind; id: number } | null;
  /** Keeps the character centred and fully visible in the uncovered part of the stage. */
  insets?: React.MutableRefObject<StageInsets>;
  style?: ViewStyle;
}

interface ViewState {
  angle: number;
  velocity: number;
  dragging: boolean;
  lastDx: number;
  /** 0 full body → 1 torso → 2 face, when `manual`. */
  zoom: number;
  manual: boolean;
  /** Live two-finger gesture, in page pixels; the frame loop turns it into `free`. */
  pinch: Pinch | null;
  /** Camera left by a pinch: zoomed toward whatever was between the fingers. */
  free: { x: number; y: number; d: number } | null;
}

interface Pinch {
  /** Stage's top-left in page coordinates. */
  origin: [number, number];
  d0: number;
  d: number;
  mid: [number, number];
  /** World point under the fingers when the pinch began, and the distance then. */
  anchor: { x: number; y: number; d: number } | null;
}

/** Closest the camera gets (shoe / face detail). */
const MIN_DISTANCE = 0.6;
/** What a pinch may frame: the character plus a little floor and headroom. */
const BOUNDS = { x: 0.6, yMin: -0.15, yMax: 2.0 };

const clampZoom = (z: number) => Math.min(2, Math.max(0, z));
const touchDistance = (e: GestureResponderEvent) => {
  const t = e.nativeEvent.touches;
  if (!t || t.length < 2) return 0;
  return Math.hypot(t[0]!.pageX - t[1]!.pageX, t[0]!.pageY - t[1]!.pageY);
};
const touchMid = (e: GestureResponderEvent): [number, number] => {
  const t = e.nativeEvent.touches;
  return [(t[0]!.pageX + t[1]!.pageX) / 2, (t[0]!.pageY + t[1]!.pageY) / 2];
};

/**
 * The live, interactive character: drag to turn, pinch (or wheel / buttons)
 * to move between full body, torso and face, and it breathes. All gesture
 * state lives in refs, so turning the character never re-renders React.
 * One WebGL context — use it for the one big avatar on a screen; lists use
 * AvatarPortrait, which is rendered from the same rig offscreen.
 */
const AvatarStage = forwardRef<AvatarStageHandle, AvatarStageProps>(function AvatarStage(
  { avatar, outfit, focus = "full", interactive = true, controls, onGesture, autoRotate = false, cheerSignal = 0, reaction = null, active = true, insets, style },
  ref
) {
  const assets = useAvatarAssets(avatar, outfit);
  const glReady = useSettledLayout();
  useEffect(() => {
    trace("avatar", `stage mounted (${focus})`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (assets.status !== "loading") trace("avatar", `stage assets ${assets.status} (${assets.garments.length} garments)`);
  }, [assets.status, assets.garments.length]);
  const view = useRef<ViewState>({ angle: 0, velocity: 0, dragging: false, lastDx: 0, zoom: 0, manual: false, pinch: null, free: null });
  const focusRef = useRef(focus);
  focusRef.current = focus;
  useEffect(() => {
    view.current.manual = false;
    view.current.free = null;
  }, [focus]);

  const zoomBy = (dz: number, snap: boolean) => {
    const v = view.current;
    const base = v.manual ? v.zoom : focusToZoom(focusRef.current);
    v.zoom = clampZoom(snap ? Math.round(base) + dz : base + dz);
    v.manual = true;
    v.free = null;
  };

  useImperativeHandle(ref, () => ({
    zoomIn: () => zoomBy(1, true),
    zoomOut: () => zoomBy(-1, true),
    resetView: () => {
      view.current.manual = false;
      view.current.free = null;
      view.current.angle = 0;
      view.current.velocity = 0;
    },
  }));

  const gestureRef = useRef(onGesture);
  gestureRef.current = onGesture;
  const pan = useMemo(
    () =>
      PanResponder.create({
        // Claim only a sideways swipe or a pinch, so taps and vertical scrolls pass through.
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (e, g) =>
          interactive && (touchDistance(e) > 0 || (Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2)),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (_e, g) => {
          const v = view.current;
          v.dragging = true;
          v.velocity = 0;
          v.lastDx = g.dx;
          v.pinch = null;
          gestureRef.current?.(true);
        },
        onPanResponderMove: (e, g) => {
          const v = view.current;
          const d = touchDistance(e);
          if (d > 0) {
            const mid = touchMid(e);
            if (!v.pinch) {
              const { pageX, pageY, locationX, locationY } = e.nativeEvent;
              v.pinch = { origin: [pageX - locationX, pageY - locationY], d0: d, d, mid, anchor: null };
            } else {
              v.pinch.d = d;
              v.pinch.mid = mid;
            }
            v.velocity = 0;
            v.lastDx = g.dx;
            return;
          }
          if (v.pinch) {
            // Lifted one finger: carry on turning from here without a jump.
            v.pinch = null;
            v.lastDx = g.dx;
            return;
          }
          v.angle += (g.dx - v.lastDx) * 0.012;
          v.lastDx = g.dx;
          v.velocity = g.vx * (Platform.OS === "web" ? 0.25 : 0.6);
        },
        onPanResponderRelease: () => {
          view.current.dragging = false;
          view.current.pinch = null;
          gestureRef.current?.(false);
        },
        onPanResponderTerminate: () => {
          view.current.dragging = false;
          view.current.pinch = null;
          gestureRef.current?.(false);
        },
      }),
    [interactive]
  );

  const topColor = outfit.pieces.find((p) => p.slot === "outerwear" || p.slot === "top")?.primary;
  const bottomColor = outfit.pieces.find((p) => p.slot === "bottom")?.primary;
  const overlayInsets = insets ? { top: insets.current.top, bottom: insets.current.bottom } : null;
  const showControls = (controls ?? interactive) && !!assets.base;

  return (
    <View
      style={[styles.fill, style]}
      onLayout={glReady.onLayout}
      {...(interactive ? pan.panHandlers : {})}
      accessibilityLabel="Your avatar. Drag to turn, pinch to zoom."
    >
      {assets.status !== "ready" || !assets.base || !glReady.ready ? (
        <View style={[StyleSheet.absoluteFill, overlayInsets]} pointerEvents="none">
          <AvatarSilhouette skin={avatar.skinTone} top={topColor} bottom={bottomColor} />
          <View style={[StyleSheet.absoluteFill, styles.centre]}>
            {assets.status !== "error" ? (
              <ActivityIndicator />
            ) : (
              <>
                <Text style={styles.failText}>Couldn't load the 3D character</Text>
                {__DEV__ && lastLoadError ? (
                  <Text style={styles.devError} numberOfLines={4}>
                    {lastLoadError}
                  </Text>
                ) : null}
              </>
            )}
          </View>
        </View>
      ) : null}
      {assets.base && glReady.ready ? (
        <Canvas
          style={styles.fill}
          frameloop={active ? "always" : "never"}
          onCreated={({ gl }) => {
            glReady.done();
            trace("avatar", "stage GL context ready");
            quietPixelStore(gl);
          }}
          dpr={[1, 2]}
          // Shadow maps are web-only: on phones they cost a full extra pass per frame and some
          // GPUs' expo-gl contexts can't compile the soft-shadow shaders. The contact shadow stays.
          shadows={Platform.OS === "web" ? "soft" : false}
          gl={createStageRenderer}
          camera={{ fov: CAMERA_FOV, near: 0.05, far: 40, position: [0, 0.92, 4.4] }}
        >
          <StageScene
            base={assets.base}
            parts={assets.parts}
            garments={assets.garments}
            avatar={avatar}
            outfit={outfit}
            focus={focus}
            view={view}
            insets={insets}
            autoRotate={autoRotate}
            cheerSignal={cheerSignal}
            reaction={reaction}
            zoomBy={zoomBy}
          />
        </Canvas>
      ) : null}
      {showControls ? (
        <View style={styles.zoom} pointerEvents="box-none">
          <ZoomButton icon="plus" label="Zoom in" onPress={() => zoomBy(1, true)} />
          <ZoomButton icon="minus" label="Zoom out" onPress={() => zoomBy(-1, true)} />
        </View>
      ) : null}
    </View>
  );
});

export default AvatarStage;

/**
 * iOS: create the GL view only once its container has stopped moving.
 * expo-gl resizes a GLView's drawable on its GL thread with a synchronous hop
 * to the main thread; if that happens while three.js is initialising (the JS
 * thread waiting on the GL thread) and the main thread is waiting on JS, the
 * app deadlocks. That is what froze Home at launch: the first tab is laid out
 * before it is attached to the window, so the view is resized again (new
 * screen scale) mid-initialisation. A screen opened later (the Locker) was
 * already on screen, which is why it worked.
 */
const SETTLE_MS = 900;

/**
 * The renderer, created a beat after the GL context exists. The view's first
 * drawable allocation is queued on expo-gl's GL thread and needs the main
 * thread; three.js's setup makes blocking GL calls that wait behind it. If
 * the main thread is meanwhile waiting on JS (Fabric flushes some view
 * updates synchronously, constantly at launch), nothing can move. Yielding
 * here lets the allocation finish before the first blocking call.
 */
async function createStageRenderer(defaults: Record<string, unknown>) {
  if (Platform.OS !== "web") {
    trace("avatar", "stage GL context created; waiting for the drawable");
    await new Promise((r) => setTimeout(r, 400));
  }
  return new THREE.WebGLRenderer({ ...defaults, antialias: true, alpha: true, preserveDrawingBuffer: false } as THREE.WebGLRendererParameters);
}
function useSettledLayout() {
  const [ready, setReady] = useState(Platform.OS === "web");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turn = useRef<GlTurn | null>(null);
  const alive = useRef(true);
  const last = useRef("");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      turn.current?.done();
    };
  }, []);
  const onLayout = (e: LayoutChangeEvent) => {
    if (ready || turn.current) return;
    const { width, height } = e.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    const key = `${Math.round(width)}x${Math.round(height)}`;
    if (key === last.current && timer.current) return;
    last.current = key;
    // Restart the wait on every size change; once it has held still, queue
    // for a GL turn (after launch, one context at a time).
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      trace("avatar", "stage layout settled; waiting for a GL turn");
      const t = (turn.current = takeGlTurn());
      t.ready.then(() => {
        trace("avatar", "stage got its GL turn");
        if (alive.current) setReady(true);
        else t.done();
      });
    }, SETTLE_MS);
  };
  const done = () => turn.current?.done();
  return { ready, onLayout, done };
}


export function ZoomButton({ icon, label, onPress }: { icon: "plus" | "minus" | "fit-to-screen-outline"; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.zoomBtn, { opacity: pressed ? 0.7 : 1 }]}
    >
      <MaterialCommunityIcons name={icon} size={18} color="#fff" />
    </Pressable>
  );
}

function StageScene({
  base,
  parts,
  garments,
  avatar,
  outfit,
  focus,
  view,
  insets,
  autoRotate,
  cheerSignal,
  reaction,
  zoomBy,
}: {
  base: NonNullable<ReturnType<typeof useAvatarAssets>["base"]>;
  parts: AppearanceParts;
  garments: GarmentSource[];
  avatar: AvatarConfig;
  outfit: ResolvedOutfit;
  focus: Focus;
  view: React.MutableRefObject<ViewState>;
  insets?: React.MutableRefObject<StageInsets>;
  autoRotate: boolean;
  cheerSignal: number;
  reaction: { kind: ReactionKind; id: number } | null;
  zoomBy: (dz: number, snap: boolean) => void;
}) {
  const scene = useThree((s) => s.scene);
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const rig = useMemo(() => new AvatarRig(base), [base]);

  useEffect(() => {
    // One soft shadow map for the one live character (self-shadowing under the chin, arms, hems).
    const lights = addStudioLights(scene, gl, { shadows: Platform.OS === "web" });
    const shadow = contactShadow();
    scene.add(shadow);
    return () => {
      lights.removeFromParent();
      shadow.removeFromParent();
      shadow.geometry.dispose();
      (shadow.material as THREE.MeshBasicMaterial).map?.dispose();
      (shadow.material as THREE.Material).dispose();
    };
  }, [scene, gl]);

  useEffect(() => {
    scene.add(rig.root);
    rig.playIdle(Math.random() * 3);
    return () => rig.dispose();
  }, [rig, scene]);

  useEffect(() => rig.setAppearance(avatar, parts), [rig, avatar, parts]);
  useEffect(() => rig.setOutfit(outfit, garments), [rig, outfit, garments]);

  const reactionId = reaction?.id;
  useEffect(() => {
    if (reaction) rig.react(reaction.kind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rig, reactionId]);

  const firstCheer = useRef(cheerSignal);
  useEffect(() => {
    if (cheerSignal !== firstCheer.current) rig.cheer();
  }, [rig, cheerSignal]);

  // Mouse wheel / trackpad zoom on web.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const el = gl.domElement as HTMLCanvasElement | undefined;
    if (!el?.addEventListener) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomBy(-e.deltaY * 0.004, false);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [gl, zoomBy]);

  const cam = useRef({ target: new THREE.Vector3(...FOCUS[focus].target), distance: FOCUS[focus].distance, height: FOCUS[focus].height });
  const goalTarget = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, dt) => {
    rig.update(Math.min(dt, 0.05));

    const v = view.current;
    if (!v.dragging) {
      const d = Math.min(dt, 0.05);
      v.angle += v.velocity * d * 4;
      v.velocity *= Math.pow(0.04, d);
      if (autoRotate && Math.abs(v.velocity) < 0.05) v.angle += d * 0.35;
    }
    rig.root.rotation.y = v.angle;

    // Overlays cover part of the stage: frame the character inside what's
    // left, by shifting the projection and pulling back to fit.
    let fit = 1;
    const H = state.size.height;
    const W = state.size.width;
    if (insets && H > 0) {
      const { top, bottom } = insets.current;
      const visible = Math.max(H * 0.18, H - top - bottom);
      fit = H / visible;
      camera.setViewOffset(W, H, 0, (bottom - top) / 2, W, H);
    }

    // Pinch: zoom toward the point between the fingers (and follow them as they move),
    // keeping that bit of the character under them. Snaps, so it tracks the fingers 1:1.
    const p = v.pinch;
    if (p && W > 0 && H > 0) {
      const tanV = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV) / 2);
      const tanH = tanV * (W / H);
      const nx = ((p.mid[0] - p.origin[0]) / W) * 2 - 1;
      const ny = 1 - ((p.mid[1] - p.origin[1]) / H) * 2;
      if (!p.anchor) {
        const D = cam.current.distance * fit;
        p.anchor = { x: cam.current.target.x + nx * D * tanH, y: cam.current.target.y + ny * D * tanV, d: cam.current.distance };
      }
      const maxD = Math.max(FOCUS.full.distance, FOCUS[focus].distance);
      const d = THREE.MathUtils.clamp((p.anchor.d * p.d0) / p.d, MIN_DISTANCE, maxD);
      const D = d * fit;
      // Never pan past the character; zoomed all the way out this re-centres it.
      const halfH = D * tanV;
      const halfW = D * tanH;
      const lo = BOUNDS.yMin + halfH;
      const hi = BOUNDS.yMax - halfH;
      const y = lo > hi ? (BOUNDS.yMin + BOUNDS.yMax) / 2 : THREE.MathUtils.clamp(p.anchor.y - ny * D * tanV, lo, hi);
      const xr = Math.max(0, BOUNDS.x - halfW);
      const x = THREE.MathUtils.clamp(p.anchor.x - nx * D * tanH, -xr, xr);
      v.free = { x, y, d };
      cam.current.target.set(x, y, 0);
      cam.current.distance = d;
    }

    const goal = v.free
      ? { target: [v.free.x, v.free.y, 0] as const, distance: v.free.d, height: 0.03 }
      : v.manual
        ? zoomFraming(v.zoom)
        : FOCUS[focus];
    // Real elapsed time, so a slow device still lands on the new framing in
    // ~0.6s rather than crawling there frame by frame.
    const k = 1 - Math.pow(0.0005, Math.min(dt, 0.5));
    goalTarget.set(goal.target[0], goal.target[1], goal.target[2]);
    cam.current.target.lerp(goalTarget, k);
    cam.current.distance += (goal.distance - cam.current.distance) * k;
    cam.current.height += (goal.height - cam.current.height) * k;
    const t = cam.current.target;
    camera.position.set(t.x, t.y + cam.current.height, t.z + cam.current.distance * fit);
    camera.lookAt(t);
    fitDepthRange(camera, t);
  });

  return null;
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignSelf: "stretch", minHeight: 180 },
  centre: { alignItems: "center", justifyContent: "center" },
  failText: { color: "#c9d2cd", fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 120 },
  devError: { color: "#ff8a80", fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 6, paddingHorizontal: 16, textAlign: "center" },
  zoom: { position: "absolute", right: 10, bottom: 10, gap: 8 },
  zoomBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
});
