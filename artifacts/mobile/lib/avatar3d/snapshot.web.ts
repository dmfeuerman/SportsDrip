import type * as THREE from "three";

/** Grabs what was just rendered. Call straight after gl.render(). */
export async function captureCanvas(gl: THREE.WebGLRenderer): Promise<string> {
  const canvas = gl.domElement;
  const webp = canvas.toDataURL("image/webp", 0.9);
  // Safari has no WebP encoder and silently returns PNG anyway.
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
}
