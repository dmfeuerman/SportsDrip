import { GLView } from "expo-gl";
import type * as THREE from "three";

/** Grabs what was just rendered into a cache file. Call straight after gl.render(). */
export async function captureCanvas(gl: THREE.WebGLRenderer): Promise<string> {
  const ctx = gl.getContext() as WebGL2RenderingContext & { endFrameEXP?: () => void };
  ctx.endFrameEXP?.();
  const snap = await GLView.takeSnapshotAsync(ctx as never, { format: "png" });
  return typeof snap.uri === "string" ? snap.uri : String(snap.uri);
}
