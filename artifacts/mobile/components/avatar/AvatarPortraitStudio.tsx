import { useThree } from "@react-three/fiber";
import React, { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import * as THREE from "three";
import { baseEntry } from "@/lib/avatar3d/assets";
import { addStudioLights, AvatarRig, fitDepthRange } from "@/lib/avatar3d/avatarRig";
import { Canvas } from "@/lib/avatar3d/canvas";
import { loadAsset } from "@/lib/avatar3d/loader";
import { registerPortraitWorker, type PortraitJob } from "@/lib/avatar3d/portraits";
import { captureCanvas } from "@/lib/avatar3d/snapshot";
import { CAMERA_FOV, PORTRAIT_FOCUS, PORTRAIT_SIZE } from "@/lib/avatar3d/spec";
import { loadGarments, loadParts } from "@/lib/avatar3d/useAvatarAssets";

/**
 * One hidden WebGL canvas that renders every small avatar and item icon in
 * the app. Mounted once in the root layout; render requests come through
 * lib/avatar3d/portraits.ts.
 */
export default function AvatarPortraitStudio() {
  return (
    <StudioBoundary>
      <StudioCanvas />
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

function StudioCanvas() {
  return (
    <View style={styles.offscreen} pointerEvents="none" importantForAccessibility="no-hide-descendants">
      <Canvas
        style={{ width: PORTRAIT_SIZE.width, height: PORTRAIT_SIZE.height }}
        frameloop="never"
        dpr={1}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
      >
        <Studio />
      </Canvas>
    </View>
  );
}

function Studio() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const rigs = useRef(new Map<string, AvatarRig>());

  useEffect(() => {
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, PORTRAIT_SIZE.width / PORTRAIT_SIZE.height, 0.05, 30);
    const lights = addStudioLights(scene, gl);
    gl.setClearColor(0x000000, 0);

    const rigFor = async (baseKey: string | undefined) => {
      const { key } = baseEntry(baseKey);
      let rig = rigs.current.get(key);
      if (!rig) {
        rig = new AvatarRig(await loadAsset({ key }));
        rigs.current.set(key, rig);
      }
      return rig;
    };

    const shoot = async () => {
      gl.setSize(PORTRAIT_SIZE.width, PORTRAIT_SIZE.height, false);
      gl.render(scene, camera);
      return captureCanvas(gl);
    };

    const unregister = registerPortraitWorker(async (job: PortraitJob) => {
      if (job.kind === "avatar") {
        const rig = await rigFor(job.avatar.base);
        const [garments, parts] = await Promise.all([loadGarments(job.outfit.pieces), loadParts(job.avatar)]);
        rig.setBaseVisible(true);
        rig.setAppearance(job.avatar, parts);
        rig.setOutfit(job.outfit, garments);
        rig.pose("idle", 0.6);
        rig.root.rotation.y = job.framing === "bust" ? 0.18 : 0.3;
        scene.add(rig.root);
        const f = PORTRAIT_FOCUS[job.framing];
        camera.position.set(f.target[0], f.target[1] + f.height, f.target[2] + f.distance);
        camera.lookAt(...f.target);
        fitDepthRange(camera, f.target);
        try {
          return await shoot();
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
        const size = box.getSize(new THREE.Vector3());
        const radius = Math.max(size.x, size.y / 1.25, size.z) * 0.62;
        const dist = radius / Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2));
        camera.position.set(centre.x + dist * 0.12, centre.y + dist * 0.18, centre.z + dist);
        camera.lookAt(centre);
        fitDepthRange(camera, centre);
        return await shoot();
      } finally {
        rig.root.removeFromParent();
        rig.setBaseVisible(true);
      }
    });

    return () => {
      unregister();
      lights.removeFromParent();
      for (const r of rigs.current.values()) r.dispose();
      rigs.current.clear();
    };
  }, [gl, scene]);

  return null;
}

const styles = StyleSheet.create({
  offscreen: {
    position: "absolute",
    left: -10000,
    top: 0,
    width: PORTRAIT_SIZE.width,
    height: PORTRAIT_SIZE.height,
    opacity: 0,
  },
});
