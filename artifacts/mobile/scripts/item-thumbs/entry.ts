import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { AvatarRig, addStudioLights, fitDepthRange } from "../../lib/avatar3d/avatarRig";
import { pieceFor, hash } from "../../lib/avatar3d/outfit";
import { normalizeRig } from "../../lib/avatar3d/rigNames";
import { CAMERA_FOV, PORTRAIT_SIZE } from "../../lib/avatar3d/spec";
import { DEFAULT_BASE } from "../../lib/avatar3d/avatarRules";
// @ts-ignore
import { CATALOG } from "../../../../scripts/catalog-data.mjs";

const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();
const load = (key: string) => {
  let p = cache.get(key);
  if (!p) {
    p = loader.loadAsync(`/assets/avatar/${key}.glb`).then((g) => (normalizeRig(g.scene, g.animations), g));
    cache.set(key, p);
  }
  return p;
};

const W = PORTRAIT_SIZE.width * 2, H = PORTRAIT_SIZE.height * 2;
const canvas = document.createElement("canvas");
canvas.width = W; canvas.height = H;
document.body.appendChild(canvas);
const gl = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
gl.setPixelRatio(1);
gl.setSize(W, H, false);
gl.outputColorSpace = THREE.SRGBColorSpace;
gl.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CAMERA_FOV, W / H, 0.05, 30);
addStudioLights(scene, gl);
gl.setClearColor(0x000000, 0);
const out = document.createElement("canvas");
out.width = PORTRAIT_SIZE.width; out.height = PORTRAIT_SIZE.height;
const ctx = out.getContext("2d")!;
ctx.imageSmoothingQuality = "high";

let rig: AvatarRig | null = null;

async function renderItem(item: any) {
  const piece = pieceFor(item);
  if (!piece || !piece.template) return null;
  rig ??= new AvatarRig(await load(DEFAULT_BASE));
  const gltf = await load(piece.template);
  rig.setAppearance({ height: 0.5, bodyType: 0.5, skinTone: "#d8c3a5", hairStyle: "bald", hairColor: "#000000" } as any, { hair: null, facialHair: null });
  rig.setOutfit({ pieces: [piece], hairMode: null, missing: [] } as any, [{ piece, gltf }] as any);
  rig.restPose();
  rig.setBaseVisible(false);
  rig.root.rotation.y = 0.45;
  scene.add(rig.root);
  try {
    rig.root.updateMatrixWorld(true);
    const box = rig.garmentBounds();
    if (box.isEmpty()) throw new Error(`empty bounds ${item.id}`);
    const centre = box.getCenter(new THREE.Vector3());
    const dims = box.getSize(new THREE.Vector3());
    const radius = Math.max(dims.x, dims.y / 1.25, dims.z) * 0.62;
    const dist = radius / Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2));
    camera.position.set(centre.x + dist * 0.12, centre.y + dist * 0.18, centre.z + dist);
    camera.lookAt(centre);
    fitDepthRange(camera, centre);
    gl.render(scene, camera);
    ctx.clearRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0, out.width, out.height);
    const key = hash(`${piece.template ?? piece.url}@${piece.version ?? ""}|${piece.primary}|${piece.secondary ?? ""}`);
    return { id: item.id, key, data: out.toDataURL("image/webp", 0.92) };
  } finally {
    rig.root.removeFromParent();
    rig.setBaseVisible(true);
  }
}

(window as any).renderAll = async () => {
  const res: any[] = [];
  const errors: string[] = [];
  for (const item of CATALOG) {
    try {
      const r = await renderItem(item);
      if (r) res.push(r); else errors.push(`${item.id}: no template`);
    } catch (e) {
      errors.push(`${item.id}: ${e}`);
    }
  }
  return { res, errors };
};
(window as any).ready = true;
