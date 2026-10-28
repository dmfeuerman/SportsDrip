import { useThree } from "@react-three/fiber";
import { GLView } from "expo-gl";
import React, { useEffect, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import * as THREE from "three";
import { baseEntry } from "@/lib/avatar3d/assets";
import { addStudioLights, AvatarRig, fitDepthRange } from "@/lib/avatar3d/avatarRig";
import { Canvas } from "@/lib/avatar3d/canvas";
import { loadAsset } from "@/lib/avatar3d/loader";
import { quietPixelStore } from "@/lib/avatar3d/nativeIO";
import { trace } from "@/lib/devtrace";
import { takeGlTurn } from "@/lib/avatar3d/glGate";
import { registerPortraitWorker, type PortraitJob } from "@/lib/avatar3d/portraits";
import { captureCanvas } from "@/lib/avatar3d/snapshot";
import { CAMERA_FOV, HERO_SIZE, PORTRAIT_FOCUS, PORTRAIT_SIZE } from "@/lib/avatar3d/spec";
import { loadGarments, loadParts } from "@/lib/avatar3d/useAvatarAssets";

/**
 * One offscreen renderer that draws every still avatar and item icon in the
 * app. Mounted once in the root layout; render requests come through
 * lib/avatar3d/portraits.ts.
 */
export default function AvatarPortraitStudio() {
  // Start after the first screen has settled, so its data gets the JS thread
  // first; portraits show silhouettes until then.
  const [on, setOn] = useState(Platform.OS === "web");
  useEffect(() => {
    if (on) return;
    const timer = setTimeout(() => setOn(true), 4000);
    return () => clearTimeout(timer);
  }, [on]);
  if (!on) return null;
  if (Platform.OS !== "web") return <NativeStudio />;
  return (
    <StudioBoundary>
      <WebStudioCanvas />
    </StudioBoundary>
  );
}

/** No WebGL → no studio; portraits stay as silhouettes instead of crashing the app shell. */
class StudioBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.warn("[avatar] portrait studio unavailable", e);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

type Shoot = (scene: THREE.Scene, camera: THREE.Camera, size: { width: number; height: number }) => Promise<string>;

const sizeFor = (job: PortraitJob) => (job.kind === "avatar" && job.framing === "hero" ? HERO_SIZE : PORTRAIT_SIZE);

/** Registers the portrait worker against a renderer. Returns the teardown. */
function startStudio(gl: THREE.WebGLRenderer, scene: THREE.Scene, shoot: Shoot) {
  const rigs = new Map<string, AvatarRig>();
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV, PORTRAIT_SIZE.width / PORTRAIT_SIZE.height, 0.05, 30);
  const lights = addStudioLights(scene, gl);
  gl.setClearColor(0x000000, 0);

  const rigFor = async (baseKey: string | undefined) => {
    const { key } = baseEntry(baseKey);
    let rig = rigs.get(key);
    if (!rig) {
      rig = new AvatarRig(await loadAsset({ key }));
      rigs.set(key, rig);
    }
    return rig;
  };

  const unregister = registerPortraitWorker(async (job: PortraitJob) => {
    const size = sizeFor(job);
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();

    if (job.kind === "avatar") {
      const rig = await rigFor(job.avatar.base);
      const [garments, parts] = await Promise.all([loadGarments(job.outfit.pieces), loadParts(job.avatar)]);
      rig.setBaseVisible(true);
      rig.setAppearance(job.avatar, parts);
      rig.setOutfit(job.outfit, garments);
      rig.pose("idle", 0.6);
      rig.root.rotation.y = job.framing === "bust" ? 0.18 : job.framing === "hero" ? 0.22 : 0.3;
      scene.add(rig.root);
      const f = PORTRAIT_FOCUS[job.framing];
      camera.position.set(f.target[0], f.target[1] + f.height, f.target[2] + f.distance);
      camera.lookAt(...f.target);
      fitDepthRange(camera, f.target);
      try {
        return await shoot(scene, camera, size);
      } finally {
        rig.root.removeFromParent();
      }
    }

    // Item icon: the garment on its own, at rest, framed to its bounds.
    const rig = await rigFor(undefined);
    const garments = await loadGarments([job.piece]);
    if (!garments.length) throw new Error(`no asset for ${job.piece.itemId}`);
    rig.setAppearance({ height: 0.5, bodyType: 0.5, skinTone: "#d8c3a5", hairStyle: "bald", hairColor: "#000000" }, { hair: null, facialHair: null });
    rig.setOutfit({ pieces: [job.piece], hairMode: null, missing: [] }, garments);
    rig.restPose();
    rig.setBaseVisible(false);
    rig.root.rotation.y = 0.45;
    scene.add(rig.root);
    try {
      rig.root.updateMatrixWorld(true);
      const box = rig.garmentBounds();
      const centre = box.getCenter(new THREE.Vector3());
      const dims = box.getSize(new THREE.Vector3());
      const radius = Math.max(dims.x, dims.y / 1.25, dims.z) * 0.62;
      const dist = radius / Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2));
      camera.position.set(centre.x + dist * 0.12, centre.y + dist * 0.18, centre.z + dist);
      camera.lookAt(centre);
      fitDepthRange(camera, centre);
      return await shoot(scene, camera, size);
    } finally {
      rig.root.removeFromParent();
      rig.setBaseVisible(true);
    }
  });

  return () => {
    unregister();
    lights.removeFromParent();
    for (const r of rigs.values()) r.dispose();
    rigs.clear();
  };
}

/** Web: a hidden R3F canvas; each still is read back with toDataURL. */
function WebStudioCanvas() {
  return (
    <View style={styles.offscreen} pointerEvents="none" importantForAccessibility="no-hide-descendants">
      <Canvas
        style={{ width: PORTRAIT_SIZE.width, height: PORTRAIT_SIZE.height }}
        frameloop="never"
        dpr={1}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
      >
        <WebStudio />
      </Canvas>
    </View>
  );
}

function WebStudio() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(
    () =>
      startStudio(gl, scene, async (sc, camera, size) => {
        gl.setSize(size.width, size.height, false);
        gl.render(sc, camera);
        return captureCanvas(gl);
      }),
    [gl, scene]
  );
  return null;
}

/**
 * iOS / Android: a headless expo-gl context, no view at all. A hidden
 * GLView froze the app on iOS: resizing its drawable makes expo-gl's GL
 * thread wait on the main thread while the JS thread waits on the GL thread.
 * Each still is drawn into an offscreen render target and saved from there.
 */
function NativeStudio() {
  useEffect(() => {
    let stop: (() => void) | null = null;
    let ctx: unknown = null;
    let cancelled = false;
    // After the screen's live stage has its context (see glGate).
    const turn = takeGlTurn();
    (async () => {
      await turn.ready;
      if (cancelled) return turn.done();
      trace("avatar", "starting headless portrait studio");
      const gl = await GLView.createContextAsync();
      ctx = gl;
      if (cancelled) return turn.done();
      const canvas = {
        width: PORTRAIT_SIZE.width,
        height: PORTRAIT_SIZE.height,
        clientWidth: PORTRAIT_SIZE.width,
        clientHeight: PORTRAIT_SIZE.height,
        style: {},
        addEventListener() {},
        removeEventListener() {},
        getContext: () => gl,
      };
      // No `context:` — three (r163+) rejects any context that is
      // `instanceof WebGLRenderingContext`, and expo-gl's WebGL2 context
      // extends it. Getting it through the canvas skips that check.
      const renderer = new THREE.WebGLRenderer({ canvas: canvas as never, alpha: true, antialias: false });
      quietPixelStore(renderer);
      renderer.setPixelRatio(1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      const scene = new THREE.Scene();
      const targets = new Map<string, THREE.WebGLRenderTarget>();
      const targetFor = ({ width, height }: { width: number; height: number }) => {
        const id = `${width}x${height}`;
        let rt = targets.get(id);
        if (!rt) {
          // expo-gl has no renderbufferStorageMultisample, so no MSAA: the
          // still is drawn at 2x and the image view scales it down instead.
          rt = new THREE.WebGLRenderTarget(width, height, { samples: 0, depthBuffer: true });
          // Plain 8-bit storage, and have three tone-map and sRGB-encode in the
          // shader exactly as it does for the screen (it only does that for
          // the canvas or an XR target).
          rt.texture.colorSpace = THREE.SRGBColorSpace;
          rt.texture.internalFormat = "RGBA8";
          (rt as unknown as { isXRRenderTarget: boolean }).isXRRenderTarget = true;
          targets.set(id, rt);
        }
        return rt;
      };
      turn.done();
      trace("avatar", "portrait studio GL context ready");
      stop = startStudio(renderer, scene, async (sc, camera, base) => {
        const size = { width: base.width * 2, height: base.height * 2 };
        const rt = targetFor(size);
        renderer.setRenderTarget(rt);
        renderer.clear();
        renderer.render(sc, camera);
        renderer.setRenderTarget(null);
        const framebuffer = (renderer.properties.get(rt) as { __webglFramebuffer?: unknown }).__webglFramebuffer;
        const snap = await GLView.takeSnapshotAsync(gl, {
          framebuffer: framebuffer as never,
          rect: { x: 0, y: 0, width: size.width, height: size.height },
          format: "png",
        });
        return typeof snap.uri === "string" ? snap.uri : String(snap.uri);
      });
      const dispose = stop;
      stop = () => {
        dispose();
        for (const rt of targets.values()) rt.dispose();
        renderer.dispose();
      };
    })().catch((e) => {
      turn.done();
      console.warn("[avatar] portrait studio unavailable", e);
    });
    return () => {
      cancelled = true;
      stop?.();
      if (ctx) GLView.destroyContextAsync(ctx as never).catch(() => {});
    };
  }, []);
  return null;
}

const styles = StyleSheet.create({
  // Web only (native renders headless): off the page.
  offscreen: { position: "absolute", left: -10000, top: 0, width: PORTRAIT_SIZE.width, height: PORTRAIT_SIZE.height, opacity: 0 },
});
