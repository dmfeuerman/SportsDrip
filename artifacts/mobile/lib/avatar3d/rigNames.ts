import type { AnimationClip, Object3D } from "three";

/**
 * Blender's Mixamo armatures name bones "mixamorig:Hips" (GLTFLoader drops
 * the colon: "mixamorigHips"); some exports number the prefix. The rig uses
 * the bare Mixamo names, so either binds to it.
 */
export const rigName = (name: string) => name.replace(/^mixamorig\d*[:_]?/, "");

/** Bones and animation tracks under the rig's own names, so Mixamo-rigged files and clips bind like ours. */
export function normalizeRig(scene: Object3D, clips: AnimationClip[] = []) {
  scene.traverse((o) => {
    if (o.name) o.name = rigName(o.name);
  });
  for (const c of clips) for (const t of c.tracks) t.name = rigName(t.name);
}
