import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { AvatarConfig } from "../../types/avatar";
import { mergeAttach, resolveAttach, type AttachSpec } from "./attach";
import { BODY_REGIONS, SLOT_LAYER, type BodyRegion } from "./avatarRules";
import { pieceLook, type OutfitPiece, type ResolvedOutfit } from "./outfit";
import { applyPattern, PATTERN_MATERIALS, withPatternSpace, type PatternUniforms } from "./patterns";
import { buildDanceClip, isDanceId, type DanceFace } from "./dances";
import { buildReactionClips, type ReactionKind } from "./reactions";
import type { HairMode } from "./spec";

/** Garment material names that take the item's colours; everything else keeps its authored look. */
const TINTS: Record<string, (p: THREE.Color, s: THREE.Color) => THREE.Color> = {
  primary: (p) => p.clone(),
  primary_dark: (p) => p.clone().multiplyScalar(0.72),
  secondary: (_p, s) => s.clone(),
  secondary_dark: (_p, s) => s.clone().multiplyScalar(0.72),
};

/** ARKit-named face blendshapes on the heads, lids, lashes and facial hair. */
export const EXPRESSIONS = ["eyeBlinkLeft", "eyeBlinkRight", "mouthSmileLeft", "mouthSmileRight", "jawOpen"] as const;
export type Expression = (typeof EXPRESSIONS)[number];

/**
 * Face-option blendshapes, per AvatarConfig field and value (the first value of each is the neutral head).
 * The heads are meshed once per nose shape, so only facial hair carries the nose blendshapes.
 */
const FACE_OPTIONS: Record<"noseShape" | "mouthShape", Record<string, string>> = {
  noseShape: { straight: "noseStraight", broad: "noseBroad" },
  mouthShape: { full: "lipsFull", wide: "mouthWide" },
};

/** Resting face: a hint of a smile. */
const NEUTRAL: Record<Expression, number> = { eyeBlinkLeft: 0, eyeBlinkRight: 0, mouthSmileLeft: 0.2, mouthSmileRight: 0.2, jawOpen: 0 };

export interface GarmentSource {
  piece: OutfitPiece;
  gltf: GLTF;
}

/** The appearance parts a look needs besides the base: one hairstyle and one facial-hair style (either may be none). */
export interface AppearanceParts {
  hair: GLTF | null;
  facialHair: GLTF | null;
}

interface RigidHolder {
  holder: THREE.Object3D;
  spec: AttachSpec | null;
}

interface BoundGarment {
  sig: string;
  piece: OutfitPiece;
  meshes: THREE.Object3D[];
  mats: THREE.Material[];
  /** Per-instance geometry copies (patterned meshes carry their rest-pose coordinates). */
  geos: THREE.BufferGeometry[];
  rigid: RigidHolder[];
  hides: BodyRegion[];
}

interface BoundPart {
  gltf: GLTF;
  meshes: THREE.Mesh[];
}

interface GarmentMeta {
  attach?: AttachSpec;
  hides?: string[];
  layer?: number;
}

const SOCKET_PREFIX = "Socket_";
const hasMorphs = (m: THREE.Mesh) => !!m.morphTargetDictionary && Object.keys(m.morphTargetDictionary).length > 0;

/** Small, cheap upgrades over the exported materials: glossy eyes, warm skin, combed hair. */
function upgradeMaterial(src: THREE.MeshStandardMaterial, opts: { strands?: boolean } = {}): THREE.MeshStandardMaterial {
  if (src.name === "eye_white" || src.name === "iris" || src.name === "pupil" || src.name === "lens") {
    const m = new THREE.MeshPhysicalMaterial();
    THREE.MeshStandardMaterial.prototype.copy.call(m, src);
    m.clearcoat = 1;
    m.clearcoatRoughness = src.name === "lens" ? 0.02 : 0.06;
    m.name = src.name;
    return m;
  }
  const m = src.clone();
  if (m.name === "skin") {
    // A little warm self-light stands in for subsurface scattering in the shadows.
    m.emissive = new THREE.Color("#3a1408");
    m.emissiveIntensity = 0.18;
  }
  if (m.name === "hair" && opts.strands && (m as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
    // The hair's TANGENT runs along the strands: a stretched highlight across them.
    (m as THREE.MeshPhysicalMaterial).anisotropy = 0.55;
  }
  if (m.name === "beard") {
    // A thin shell over the skin at its edges.
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    m.polygonOffsetUnits = -2;
  }
  if (m.name === "stubble") {
    // Stubble is a thin shell over the skin; keep it in front at a distance.
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    m.polygonOffsetUnits = -4;
  }
  return m;
}

/**
 * One character instance: the shared base skeleton, its body/face meshes,
 * the hair and facial-hair parts for the current look, and whatever garments
 * are bound to it. Geometry is shared with the loader cache; materials are
 * per-instance so two avatars on one screen can wear the same hoodie in
 * different colours.
 *
 * Skinned garments bind to the base skeleton by bone name (Mixamo names; a
 * "mixamorig" prefix is stripped on load). Rigid wearables hang from sockets
 * (named points on bones: HeadTop, Face, Neck, Wrist_L, Wrist_R) and are
 * placed by their attachment spec — the asset's own, merged with the catalog
 * item's override, resolved for the current hairstyle, face shape, build and
 * whatever else is worn (attach.ts).
 *
 * Body shape, nose and mouth are blendshapes, set from the appearance on the
 * body, head, facial hair and every skinned garment alike; the face also
 * blinks and smiles (ARKit blendshapes) on its own while the rig updates.
 * Body regions a worn garment covers completely are hidden (its `hides`).
 */
const WHITE = new THREE.Color("#ffffff");
/** Warm, reddish forward scatter for skin's sheen lobe, mixed into the skin's own colour. */
const SKIN_SHEEN = new THREE.Color("#ff9a7a");
const liftSheen = (c: THREE.Color, out: THREE.Color) => out.copy(c).lerp(WHITE, 0.3);

const _lifeEuler = new THREE.Euler();
const _lifeQuat = new THREE.Quaternion();

export class AvatarRig {
  readonly root = new THREE.Group();
  private model: THREE.Object3D;
  private bones = new Map<string, THREE.Bone>();
  private sockets = new Map<string, THREE.Object3D>();
  private baseMeshes: THREE.Mesh[] = [];
  /** Instance copies of the asset materials, by source material (each mesh may carry its own normal map). */
  private mats = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  private strandMats = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  private hair: BoundPart | null = null;
  private facialHair: BoundPart | null = null;
  private garments = new Map<string, BoundGarment>();
  private mixer: THREE.AnimationMixer;
  private clips: THREE.AnimationClip[];
  private idle?: THREE.AnimationAction;
  private appearance?: AvatarConfig;
  private hairMode: HairMode | null = null;
  private baseVisible = true;
  private rest = new Map<THREE.Bone, { p: THREE.Vector3; q: THREE.Quaternion }>();
  /** Blendshape weights set by the appearance (build, nose, mouth). */
  private shape: Record<string, number> = {};
  /** Live face. */
  private face: Record<Expression, number> = { ...NEUTRAL };
  private faceOverride: Partial<Record<Expression, number>> = {};
  private blink = { next: 1.5 + Math.random() * 3, t: -1, double: false };
  private reaction: { t: number; dur: number; kind: "cheer" | ReactionKind | "dance"; face?: DanceFace } | null = null;
  private reactionClips?: Record<ReactionKind, THREE.AnimationClip> | null;
  /** Dance clips, built on first use per move (null: this rig can't play it). */
  private danceClips = new Map<string, { clip: THREE.AnimationClip; face: DanceFace } | null>();
  /** The one-shot (cheer, reaction or dance) playing over the idle, if any. */
  private current: THREE.AnimationAction | null = null;
  private tears: THREE.Mesh[] = [];
  /** Procedural life on top of the idle clip: breathing, weight shifts, glances. */
  private life = {
    t: Math.random() * 30,
    amp: 1,
    applied: false,
    base: new Map<THREE.Bone, THREE.Quaternion>(),
    hips: new THREE.Vector3(),
    look: { yaw: 0, pitch: 0, toYaw: 0, toPitch: 0, next: 1.5 },
  };

  constructor(base: GLTF) {
    this.model = cloneSkinned(base.scene);
    this.root.add(this.model);
    this.model.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o as THREE.Bone);
      else if (o.name.startsWith(SOCKET_PREFIX)) this.sockets.set(o.name.slice(SOCKET_PREFIX.length), o);
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.material = this.material(m.material as THREE.MeshStandardMaterial);
        m.castShadow = true;
        m.receiveShadow = true;
        if ((m as THREE.SkinnedMesh).isSkinnedMesh) m.frustumCulled = false;
        this.baseMeshes.push(m);
      }
    });
    for (const b of this.bones.values()) this.rest.set(b, { p: b.position.clone(), q: b.quaternion.clone() });
    this.clips = base.animations;
    this.mixer = new THREE.AnimationMixer(this.model);
  }

  /** The instance's copy of an asset material (shared by every mesh of this instance using it). */
  private material(src: THREE.MeshStandardMaterial, opts: { strands?: boolean } = {}) {
    const cache = opts.strands ? this.strandMats : this.mats;
    let mat = cache.get(src);
    if (!mat) {
      mat = upgradeMaterial(src, opts);
      cache.set(src, mat);
    }
    return mat;
  }

  /**
   * Recolours every instance copy of a material. Sheen follows the new colour
   * (a fixed white or pink sheen turns dark hair silver and dark skin ashen at
   * grazing angles): by default the colour lifted a little toward white.
   */
  private tint(name: string, f: (c: THREE.Color) => void, sheen: (c: THREE.Color, out: THREE.Color) => void = liftSheen) {
    for (const cache of [this.mats, this.strandMats])
      for (const m of cache.values()) {
        if (m.name !== name) continue;
        f(m.color);
        const ph = m as THREE.MeshPhysicalMaterial;
        if (ph.isMeshPhysicalMaterial && ph.sheen > 0) sheen(ph.color, ph.sheenColor);
      }
  }

  setAppearance(a: AvatarConfig, parts?: AppearanceParts) {
    this.appearance = a;
    if (parts) {
      this.hair = this.bindPart(this.hair, parts.hair);
      this.facialHair = this.bindPart(this.facialHair, parts.facialHair);
    }
    const skin = new THREE.Color(a.skinTone);
    const hair = new THREE.Color(a.hairColor);
    this.tint("skin", (c) => c.copy(skin), (c, out) => out.copy(c).lerp(SKIN_SHEEN, 0.4));
    this.tint("hair", (c) => c.copy(hair));
    this.tint("brow", (c) => c.copy(hair).multiplyScalar(0.78));
    this.tint("lash", (c) => c.copy(hair).multiplyScalar(0.35));
    // Stubble reads as shadow on the skin, so it's a blend, not the hair colour.
    this.tint("stubble", (c) => c.copy(skin).lerp(hair, 0.55).multiplyScalar(0.85));
    // Facial hair a shade lighter than the head hair: it's finer and catches more light.
    this.tint("beard", (c) => c.copy(hair).lerp(skin, 0.12), (c, out) => out.copy(c));
    if (a.eyeColor) this.tint("iris", (c) => c.set(a.eyeColor!));

    // Build is a blendshape pair on everything skinned; height a uniform scale.
    const b = Math.max(-1, Math.min(1, (a.bodyType - 0.5) * 2));
    this.shape = { buildSlim: Math.max(0, -b), buildBroad: Math.max(0, b) };
    for (const [field, values] of Object.entries(FACE_OPTIONS)) {
      const chosen = a[field as keyof typeof FACE_OPTIONS];
      for (const [value, morph] of Object.entries(values)) this.shape[morph] = chosen === value ? 1 : 0;
    }
    this.root.scale.setScalar(0.93 + a.height * 0.14);
    this.applyShape();
    this.updateVisibility();
    this.placeRigid();
    this.applyFace();
  }

  /** Swaps a hair / facial-hair part: its meshes ride the Head bone like the face does. */
  private bindPart(current: BoundPart | null, gltf: GLTF | null): BoundPart | null {
    if (current?.gltf === gltf) return current;
    if (current) for (const m of current.meshes) m.removeFromParent();
    if (!gltf) return null;
    const meshes: THREE.Mesh[] = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => {
      const src = o as THREE.Mesh;
      if (!src.isMesh) return;
      const bone = src.parent && this.bones.get(src.parent.name);
      if (!bone) return;
      const m = src.clone() as THREE.Mesh;
      m.material = this.material(src.material as THREE.MeshStandardMaterial, { strands: !!src.geometry.attributes.tangent });
      m.castShadow = true;
      m.receiveShadow = true;
      bone.add(m);
      meshes.push(m);
    });
    return { gltf, meshes };
  }

  /**
   * Binds the given garments, removing ones no longer worn. A garment is
   * rebuilt only when its asset, colours or overrides change.
   */
  setOutfit(outfit: ResolvedOutfit, sources: GarmentSource[]) {
    const wanted = new Set(sources.map((s) => s.piece.slot));
    for (const slot of [...this.garments.keys()]) {
      if (!wanted.has(slot as OutfitPiece["slot"])) this.dropGarment(slot);
    }
    for (const { piece, gltf } of sources) {
      const sig = `${pieceLook(piece)}|${piece.attach ? JSON.stringify(piece.attach) : ""}|${piece.hides?.join("+") ?? "-"}|${piece.layer}`;
      if (this.garments.get(piece.slot)?.sig === sig) continue;
      this.dropGarment(piece.slot);
      this.garments.set(piece.slot, { sig, piece, ...this.bindGarment(gltf, piece) });
    }
    this.hairMode = outfit.hairMode;
    this.applyShape();
    this.updateVisibility();
    this.placeRigid();
  }

  private bindGarment(gltf: GLTF, piece: OutfitPiece) {
    const p = new THREE.Color(piece.primary);
    const s = new THREE.Color(piece.secondary ?? "#ffffff");
    if (!piece.secondary) s.copy(p).lerp(new THREE.Color("#ffffff"), 0.75);
    const meshes: THREE.Object3D[] = [];
    const mats: THREE.Material[] = [];
    const geos: THREE.BufferGeometry[] = [];
    const rigid: RigidHolder[] = [];
    const tinted = new Map<THREE.Material, THREE.Material>();
    const patterned = new Map<THREE.Material, PatternUniforms>();
    const pattern = piece.pattern ?? null;
    const metal = piece.metal ? new THREE.Color(piece.metal) : null;
    // Motif colours: the pattern's own, else the item's secondary; a third falls back to a darker ground.
    const pc1 = pattern?.color ? new THREE.Color(pattern.color) : s.clone();
    const pc2 = pattern?.color2 ? new THREE.Color(pattern.color2) : p.clone().lerp(pc1, 0.5).multiplyScalar(0.55);
    const meta = (gltf.scene.userData?.sdAvatar ?? {}) as GarmentMeta;
    const spec = mergeAttach(meta.attach ?? null, piece.attach ?? null);
    const hides = (piece.hides ?? meta.hides ?? []).filter((r): r is BodyRegion => BODY_REGIONS.includes(r as BodyRegion));
    const layer = piece.layer ?? meta.layer ?? SLOT_LAYER[piece.slot];
    const holders = new Map<THREE.Object3D, THREE.Object3D>();
    gltf.scene.updateMatrixWorld(true);
    const sourceMeshes: THREE.Mesh[] = [];
    gltf.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) sourceMeshes.push(o as THREE.Mesh);
    });
    for (const src of sourceMeshes) {
      const m = src.clone() as THREE.Mesh;
      const skinned = !!(src as THREE.SkinnedMesh).isSkinnedMesh;
      const srcMat = src.material as THREE.MeshStandardMaterial;
      let mat = tinted.get(srcMat);
      if (!mat) {
        const c = srcMat.clone();
        const tint = TINTS[srcMat.name];
        if (tint) {
          (c as THREE.MeshStandardMaterial).color.copy(tint(p, s));
          // Fabric sheen takes the cloth's own colour (a white sheen washes dark cloth out).
          const ph = c as THREE.MeshPhysicalMaterial;
          if (ph.isMeshPhysicalMaterial && ph.sheen > 0) ph.sheenColor.copy(ph.color).lerp(new THREE.Color("#ffffff"), 0.35);
        }
        if (metal && srcMat.name === "metal") (c as THREE.MeshStandardMaterial).color.copy(metal);
        const dark = PATTERN_MATERIALS[srcMat.name];
        if (pattern && dark !== undefined) {
          patterned.set(c, applyPattern(c, pattern, pc1.clone().multiplyScalar(dark), pc2.clone().multiplyScalar(dark)));
        }
        if (skinned) {
          // Outer layers win ties. Constant bias only: a slope-scaled factor pulls an inner layer's
          // edge-on faces (a waistband's top seen past a tee) millimetres forward, through the layer over it.
          c.polygonOffset = true;
          c.polygonOffsetFactor = 0;
          c.polygonOffsetUnits = -2 * layer;
        }
        tinted.set(srcMat, c);
        mats.push(c);
        mat = c;
      }
      m.material = mat;
      const pu = patterned.get(mat);
      if (pu) {
        // Rest-pose coordinates for the shader, through the mesh's transform in its own file.
        const { geometry, range } = withPatternSpace(src.geometry, src.matrixWorld);
        m.geometry = geometry;
        geos.push(geometry);
        const r = pu.uSdRange.value;
        r.set(Math.min(r.x, range.x), Math.max(r.y, range.y));
      }
      m.castShadow = true;
      m.receiveShadow = true;
      if (skinned) {
        const sm = m as THREE.SkinnedMesh;
        const srcSkel = (src as THREE.SkinnedMesh).skeleton;
        const bones = srcSkel.bones.map((b) => this.bones.get(b.name));
        if (bones.some((b) => !b)) continue; // not on our rig — skip rather than explode
        sm.frustumCulled = false;
        this.model.add(sm);
        sm.bind(new THREE.Skeleton(bones as THREE.Bone[], srcSkel.boneInverses), (src as THREE.SkinnedMesh).bindMatrix);
        meshes.push(sm);
        continue;
      }
      // Rigid: hangs from a socket (or straight from a bone, for older assets),
      // through a holder that carries the attachment transform.
      const anchorSrc = src.parent;
      if (!anchorSrc) continue;
      let holder = holders.get(anchorSrc);
      if (!holder) {
        const anchor = this.anchorFor(anchorSrc);
        if (!anchor) continue;
        holder = new THREE.Group();
        holder.name = `${piece.itemId}@${anchorSrc.name}`;
        anchor.add(holder);
        holders.set(anchorSrc, holder);
        rigid.push({ holder, spec: anchorSrc.name.startsWith(SOCKET_PREFIX) ? spec : null });
        meshes.push(holder);
      }
      holder.add(m);
    }
    return { meshes, mats, geos, rigid, hides };
  }

  /** The rig node a rigid part's parent in its own file corresponds to. */
  private anchorFor(src: THREE.Object3D): THREE.Object3D | null {
    if (src.name.startsWith(SOCKET_PREFIX)) {
      const name = src.name.slice(SOCKET_PREFIX.length);
      const own = this.sockets.get(name);
      if (own) return own;
      // A socket this base doesn't have: recreate it on the same bone, same offset.
      const bone = src.parent && this.bones.get(src.parent.name);
      if (!bone) return null;
      const s = new THREE.Object3D();
      s.name = src.name;
      s.position.copy(src.position);
      bone.add(s);
      this.sockets.set(name, s);
      return s;
    }
    return this.bones.get(src.name) ?? null;
  }

  /** Re-resolves every rigid wearable's placement for the current look. */
  private placeRigid() {
    const a = this.appearance;
    const build = (this.shape.buildBroad ?? 0) - (this.shape.buildSlim ?? 0);
    const worn = [...this.garments.values()].map((g) => ({ template: g.piece.template, slot: g.piece.slot as string }));
    for (const g of this.garments.values()) {
      for (const r of g.rigid) {
        const others = worn.filter((w) => w.slot !== g.piece.slot);
        const t = resolveAttach(r.spec, { hairStyle: a?.hairStyle, faceShape: a?.faceShape, build, worn: others });
        r.holder.position.set(...t.position);
        r.holder.rotation.set(...t.rotation);
        r.holder.scale.set(...t.scale);
        r.holder.visible = !t.hidden;
      }
    }
  }

  private dropGarment(slot: string) {
    const g = this.garments.get(slot);
    if (!g) return;
    for (const m of g.meshes) m.removeFromParent();
    for (const mat of g.mats) mat.dispose();
    for (const geo of g.geos) geo.dispose();
    this.garments.delete(slot);
  }

  /** Every mesh carrying blendshapes: base, hair parts, skinned garments. */
  private *morphMeshes(): Generator<THREE.Mesh> {
    for (const m of this.baseMeshes) if (hasMorphs(m)) yield m;
    for (const part of [this.hair, this.facialHair]) for (const m of part?.meshes ?? []) if (hasMorphs(m)) yield m;
    for (const g of this.garments.values()) for (const o of g.meshes) if ((o as THREE.Mesh).isMesh && hasMorphs(o as THREE.Mesh)) yield o as THREE.Mesh;
  }

  private applyShape() {
    for (const m of this.morphMeshes()) {
      const dict = m.morphTargetDictionary!;
      for (const [name, w] of Object.entries(this.shape)) {
        const i = dict[name];
        if (i !== undefined) m.morphTargetInfluences![i] = w;
      }
    }
  }

  /** Writes the live expression weights to the visible face meshes. */
  private applyFace() {
    const w = { ...this.face };
    for (const [k, v] of Object.entries(this.faceOverride)) w[k as Expression] = v!;
    const apply = (m: THREE.Mesh) => {
      if (!m.visible || !hasMorphs(m)) return;
      const dict = m.morphTargetDictionary!;
      for (const e of EXPRESSIONS) {
        const i = dict[e];
        if (i !== undefined) m.morphTargetInfluences![i] = w[e];
      }
    };
    for (const m of this.baseMeshes) apply(m);
    for (const m of this.facialHair?.meshes ?? []) apply(m);
  }

  private updateVisibility() {
    const a = this.appearance;
    if (!a) return;
    const face = a.faceShape ?? "oval";
    const eyes = a.eyeShape ?? "round";
    const nose = a.noseShape ?? "button";
    const hidden = new Set<BodyRegion>();
    for (const g of this.garments.values()) for (const r of g.hides) hidden.add(r);
    // One head mesh per face shape × nose shape (button is the plain `Head_<face>`); an older base
    // without that nose falls back to the button head below.
    const headName = nose === "button" ? `Head_${face}` : `Head_${face}_${nose}`;
    const head = this.baseMeshes.some((m) => m.name === headName) ? headName : `Head_${face}`;
    const show = new Set<string>([head, "Eyes", "Iris", "Pupils", "Teeth", `Lids_${eyes}`, `Lashes_${eyes}`]);
    // The base layer covers the hips (fitcheck.mjs checks it) until bottoms do.
    if (!hidden.has("hips")) {
      show.add("Underwear");
      hidden.add("hips");
    }
    for (const r of BODY_REGIONS) if (!hidden.has(r)) show.add(`Body_${r}`);
    if (a.eyebrows && a.eyebrows !== "none") show.add(`Brows_${a.eyebrows}`);
    let headShown = false;
    let lidsShown = false;
    for (const m of this.baseMeshes) {
      m.visible = this.baseVisible && show.has(m.name);
      if (m.visible && m.name.startsWith("Head_")) headShown = true;
      if (m.visible && m.name.startsWith("Lids_")) lidsShown = true;
    }
    // Unknown ids fall back to the defaults rather than a missing head or open eyes.
    if (!headShown && this.baseVisible) for (const m of this.baseMeshes) if (m.name === "Head_oval") m.visible = true;
    if (!lidsShown && this.baseVisible) for (const m of this.baseMeshes) if (m.name === "Lids_round" || m.name === "Lashes_round") m.visible = true;

    // Hair: the variant pressed for the worn headwear's mode, else the free one.
    if (this.hair) {
      const names = new Set(this.hair.meshes.map((m) => m.name));
      const mode = this.hairMode;
      const hairName = mode && names.has(`Hair_${mode}`) ? `Hair_${mode}` : "Hair";
      // A tie the headwear covers has no variant for that mode: none is drawn (the free one would sit on top of the hat).
      const tieName = mode && names.has(`Hair_${mode}`) ? `HairTie_${mode}` : "HairTie";
      for (const m of this.hair.meshes) m.visible = this.baseVisible && (m.name === hairName || m.name === tieName);
    }
    if (this.facialHair) {
      // The beard for this face shape (and the soft shadow round its edge), else the oval one.
      const f = this.facialHair.meshes.some((m) => m.name === `Beard_${face}`) ? face : "oval";
      for (const m of this.facialHair.meshes) m.visible = this.baseVisible && (m.name === `Beard_${f}` || m.name === `BeardShadow_${f}`);
    }
  }

  /** Starts the looping idle. `t` offsets it so a row of avatars doesn't breathe in sync. */
  playIdle(t = 0) {
    const clip = this.clips.find((c) => c.name === "idle");
    if (!clip) return;
    this.idle = this.mixer.clipAction(clip);
    this.idle.play();
    this.mixer.setTime(t);
  }

  /** One-shot celebration with a big grin, then back to idle. */
  cheer() {
    const clip = this.clips.find((c) => c.name === "cheer");
    if (!clip) return;
    this.startOneShot(this.mixer.clipAction(clip), 0.15);
    this.reaction = { t: 0, dur: clip.duration, kind: "cheer" };
  }

  /**
   * Plays a move from the player's loadout: "cheer" (the base clip),
   * "fist_pump" (the win reaction, without the result face) or a dance from
   * dances.ts. Unknown ids — a move added server-side that this build has no
   * animation for — fall back to the cheer rather than doing nothing.
   */
  playMove(id: string) {
    if (id === "fist_pump") return this.react("win");
    if (!isDanceId(id)) return this.cheer();
    let built = this.danceClips.get(id);
    if (built === undefined) {
      const { rest, parents } = this.restSkeleton();
      built = buildDanceClip(id, rest, parents);
      this.danceClips.set(id, built);
    }
    if (!built) return this.cheer();
    this.startOneShot(this.mixer.clipAction(built.clip), 0.25);
    this.reaction = { t: 0, dur: built.clip.duration, kind: "dance", face: built.face };
  }

  /** Rest pose as local positions and parents by bone name (what the clip builders solve against). */
  private restSkeleton() {
    const rest = new Map<string, THREE.Vector3>();
    const parents = new Map<string, string | null>();
    for (const [name, b] of this.bones) {
      rest.set(name, this.rest.get(b)!.p.clone());
      parents.set(name, b.parent && this.bones.has(b.parent.name) ? b.parent.name : null);
    }
    return { rest, parents };
  }

  /** Cross-fades a one-shot in over the idle (and over whatever one-shot was already playing). */
  private startOneShot(a: THREE.AnimationAction, fade: number) {
    const prev = this.current;
    if (prev && prev !== a) prev.fadeOut(fade);
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = false;
    a.fadeIn(fade).play();
    this.idle?.fadeOut(fade);
    this.current = a;
    this.playOnce(a);
  }

  /**
   * Reacts to a settled bet: a hop and fist pumps with a big grin for a win;
   * a slump, hands to the face and tears for a loss. Back to idle after.
   */
  react(kind: ReactionKind) {
    if (this.reactionClips === undefined) {
      const { rest, parents } = this.restSkeleton();
      this.reactionClips = buildReactionClips(rest, parents);
    }
    const clip = this.reactionClips?.[kind];
    if (!clip) return kind === "win" ? this.cheer() : undefined;
    // A new result interrupts whatever is playing; the idle keeps running underneath.
    this.startOneShot(this.mixer.clipAction(clip), 0.2);
    this.reaction = { t: 0, dur: clip.duration, kind };
  }

  /** Cuts a playing move or reaction short and eases back into the idle. */
  stopMove() {
    const a = this.current;
    if (!a) return;
    this.current = null;
    this.reaction = null;
    a.fadeOut(0.25);
    this.idle?.reset().fadeIn(0.25).play();
  }

  private playOnce(a: THREE.AnimationAction) {
    const done = (e: { action: THREE.AnimationAction }) => {
      if (e.action !== a) return;
      this.mixer.removeEventListener("finished", done as never);
      // Interrupted by a newer one-shot: that one owns the idle now.
      if (this.current !== a) return;
      this.current = null;
      a.fadeOut(0.25);
      this.idle?.reset().fadeIn(0.25).play();
    };
    this.mixer.addEventListener("finished", done as never);
  }

  /**
   * Holds a face blendshape at a weight (0…1) over the automatic blinking and
   * smiling — e.g. for an editor preview. Null releases it.
   */
  setExpression(name: Expression, weight: number | null) {
    if (weight === null) delete this.faceOverride[name];
    else this.faceOverride[name] = Math.max(0, Math.min(1, weight));
    this.applyFace();
  }

  /** Hides the body/head/hair (item icons show the garment alone). */
  setBaseVisible(v: boolean) {
    this.baseVisible = v;
    this.updateVisibility();
  }

  /** Back to the bind pose, animations stopped, resting face. */
  restPose() {
    this.life.applied = false;
    this.mixer.stopAllAction();
    for (const [b, r] of this.rest) {
      b.position.copy(r.p);
      b.quaternion.copy(r.q);
    }
    this.reaction = null;
    this.current = null;
    this.updateTears(-1, 0);
    this.face = { ...NEUTRAL };
    this.applyFace();
  }

  /** World-space bounds of the bound garments, as currently posed. */
  garmentBounds() {
    const box = new THREE.Box3();
    this.root.updateMatrixWorld(true);
    for (const g of this.garments.values()) {
      for (const o of g.meshes) {
        o.traverse((m) => {
          const mesh = m as THREE.Mesh;
          if (!mesh.isMesh || !mesh.visible) return;
          let b: THREE.Box3;
          if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
            // Skinned (and possibly quantized) geometry is only meaningful through its bones.
            const sm = mesh as THREE.SkinnedMesh;
            sm.computeBoundingBox();
            b = sm.boundingBox!.clone();
          } else {
            if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
            b = mesh.geometry.boundingBox!.clone();
          }
          box.union(b.applyMatrix4(mesh.matrixWorld));
        });
      }
    }
    return box;
  }

  /** Poses at a fixed time of a clip (for still portraits), with the face to match. */
  pose(name: string, t: number) {
    const clip = this.clips.find((c) => c.name === name);
    this.restPose();
    if (clip) {
      this.mixer.clipAction(clip).play();
      this.mixer.setTime(t);
      if (name === "cheer") this.reaction = { t, dur: clip.duration, kind: "cheer" };
      this.updateFace(0);
    }
  }

  /** Blinks every few seconds (now and then twice), and grins through a cheer. */
  private updateFace(dt: number) {
    const b = this.blink;
    let lid = 0;
    if (b.t < 0) {
      b.next -= dt;
      if (b.next <= 0) b.t = 0;
    }
    if (b.t >= 0) {
      b.t += dt;
      const CLOSE = 0.07, HOLD = 0.04, OPEN = 0.13;
      const u = b.t;
      lid = u < CLOSE ? u / CLOSE : u < CLOSE + HOLD ? 1 : Math.max(0, 1 - (u - CLOSE - HOLD) / OPEN);
      if (u >= CLOSE + HOLD + OPEN) {
        const again = !b.double && Math.random() < 0.18;
        b.double = again;
        b.t = -1;
        b.next = again ? 0.12 : 2 + Math.random() * 4;
      }
    }
    let grin = 0;
    let jaw = 0;
    let sad = 0;
    if (this.reaction) {
      const r = this.reaction;
      r.t += dt;
      const u = r.t / r.dur;
      const ease = (x: number, a: number, c: number) => {
        const k = Math.min(1, Math.max(0, (x - a) / (c - a)));
        return k * k * (3 - 2 * k);
      };
      const env = ease(u, 0.03, 0.2) * (1 - ease(u, 0.8, 1));
      if (r.kind === "loss") {
        sad = env;
        jaw = env * (0.12 + 0.1 * Math.max(0, Math.sin(r.t * Math.PI * 2 * 2.2)));
      } else if (r.kind === "dance") {
        // Grin: open, laughing; smile: closed-mouth; cool: a smirk, mouth shut.
        grin = env * (r.face === "grin" ? 0.9 : r.face === "smile" ? 0.6 : 0.3);
        jaw = r.face === "grin" ? env * (0.28 + 0.08 * Math.sin(r.t * 9)) : 0;
      } else {
        grin = env;
        jaw = env * (0.55 + 0.1 * Math.sin(r.t * 14));
      }
      this.updateTears(r.kind === "loss" ? r.t : -1, env);
      if (u >= 1) {
        this.reaction = null;
        this.updateTears(-1, 0);
      }
    }
    // Sad: eyes squeezed half shut, the resting smile gone.
    lid = Math.max(lid, 0.62 * sad);
    const smile = NEUTRAL.mouthSmileLeft * (1 - sad);
    this.face.eyeBlinkLeft = lid;
    this.face.eyeBlinkRight = lid;
    this.face.mouthSmileLeft = smile + (1 - smile) * grin;
    this.face.mouthSmileRight = smile + (1 - smile) * grin;
    this.face.jawOpen = jaw;
    this.applyFace();
  }

  /** Tears running down both cheeks during a loss reaction (`t` < 0 hides them). */
  private updateTears(t: number, strength: number) {
    const head = this.bones.get("Head");
    if (!head) return;
    if (t < 0) {
      for (const m of this.tears) m.visible = false;
      return;
    }
    if (!this.tears.length) {
      const geo = new THREE.SphereGeometry(0.0042, 10, 8);
      geo.scale(1, 1.5, 0.8);
      const mat = new THREE.MeshPhysicalMaterial({ color: "#bfe6ff", roughness: 0.05, clearcoat: 1, transparent: true, opacity: 0.85, transmission: 0 });
      // Two drops per eye, half a cycle apart. Positions are in the Head bone's frame.
      const headRest = this.rest.get(head)!.p;
      void headRest;
      for (let i = 0; i < 4; i++) {
        const m = new THREE.Mesh(geo, mat);
        m.userData.side = i % 2 ? -1 : 1;
        m.userData.phase = i < 2 ? 0 : 0.5;
        m.renderOrder = 2;
        head.add(m);
        this.tears.push(m);
      }
    }
    // Head bone origin is at the top of the neck (1.535 m); the lower lid's outer corner is ~0.1 m above.
    for (const m of this.tears) {
      const cycle = ((t - 0.9) / 1.1 + m.userData.phase) % 1;
      const on = t > 0.9 && strength > 0.2;
      m.visible = on;
      if (!on) continue;
      const k = Math.max(0, cycle);
      const sx = m.userData.side as number;
      m.position.set(sx * (0.047 + 0.006 * k), 0.093 - 0.05 * k, 0.112 + 0.006 * Math.sin(k * Math.PI) - 0.01 * k);
      const sc = (0.6 + 0.6 * Math.min(1, k * 4)) * (1 - Math.max(0, k - 0.85) / 0.15);
      m.scale.setScalar(Math.max(0.01, sc));
    }
  }

  update(dt: number) {
    this.undoLife();
    this.mixer.update(dt);
    this.updateFace(dt);
    this.applyLife(dt);
  }

  /** Puts back the bones as the mixer left them, so the life layer never accumulates. */
  private undoLife() {
    const L = this.life;
    if (!L.applied) return;
    for (const [b, q] of L.base) b.quaternion.copy(q);
    this.bones.get("Hips")?.position.copy(L.hips);
    L.applied = false;
  }

  /**
   * Small, continuous movement layered over the idle clip so a standing
   * character never reads as frozen: breathing through the chest and
   * shoulders, a slow shift of weight from foot to foot, a loose arm sway and
   * the occasional glance around. Damped right down while a reaction plays.
   */
  private applyLife(dt: number) {
    const L = this.life;
    L.t += dt;
    L.amp += ((this.reaction ? 0.2 : 1) - L.amp) * (1 - Math.exp(-4 * dt));

    const look = L.look;
    look.next -= dt;
    if (look.next <= 0) {
      const glance = Math.random() < 0.35;
      look.toYaw = glance ? (Math.random() * 2 - 1) * 0.32 : (Math.random() * 2 - 1) * 0.1;
      look.toPitch = (Math.random() * 2 - 1) * 0.06 + (glance ? 0.02 : 0);
      look.next = glance ? 1.2 + Math.random() * 1.2 : 2.5 + Math.random() * 3.5;
    }
    const k = 1 - Math.exp(-2.8 * dt);
    look.yaw += (look.toYaw - look.yaw) * k;
    look.pitch += (look.toPitch - look.pitch) * k;

    const a = L.amp;
    const t = L.t;
    const TAU = Math.PI * 2;
    const breath = Math.sin((t * TAU) / 4.4);
    const weight = Math.sin((t * TAU) / 9.5);
    const sway = Math.sin((t * TAU) / 6.1);
    const sway2 = Math.sin((t * TAU) / 5.3 + 1.7);

    const touched: Array<[string, number, number, number]> = [
      // bone, x (pitch), y (yaw), z (roll) in radians; rest axes are world axes.
      ["Hips", 0, 0.03 * weight, 0.022 * weight],
      ["Spine", 0.008 * breath, 0, -0.018 * weight],
      ["Spine1", -0.014 * breath, 0, -0.008 * weight],
      ["Spine2", -0.018 * breath, 0.02 * sway, 0],
      ["Neck", 0.4 * look.pitch, 0.4 * look.yaw, 0.012 * weight],
      ["Head", 0.6 * look.pitch - 0.01 * breath, 0.6 * look.yaw, 0.02 * sway2],
      ["LeftShoulder", 0, 0, 0.022 * breath],
      ["RightShoulder", 0, 0, -0.022 * breath],
      ["LeftArm", 0.05 * sway, 0, 0.03 * (0.5 + 0.5 * sway2)],
      ["RightArm", -0.05 * sway2, 0, -0.03 * (0.5 + 0.5 * sway)],
      ["LeftForeArm", -0.06 * (0.5 + 0.5 * sway), 0, 0],
      ["RightForeArm", -0.06 * (0.5 + 0.5 * sway2), 0, 0],
      ["LeftUpLeg", 0, 0, -0.022 * weight],
      ["RightUpLeg", 0, 0, -0.022 * weight],
    ];
    for (const [name, x, y, z] of touched) {
      const b = this.bones.get(name);
      if (!b) continue;
      let q = L.base.get(b);
      if (!q) L.base.set(b, (q = new THREE.Quaternion()));
      q.copy(b.quaternion);
      _lifeEuler.set(x * a, y * a, z * a);
      b.quaternion.multiply(_lifeQuat.setFromEuler(_lifeEuler));
    }
    const hips = this.bones.get("Hips");
    if (hips) {
      L.hips.copy(hips.position);
      // Weight onto one foot: the pelvis drifts over it and drops a touch with each breath out.
      hips.position.x += 0.009 * weight * a;
      hips.position.y += 0.002 * breath * a;
    }
    L.applied = true;
  }

  dispose() {
    this.mixer.stopAllAction();
    for (const m of this.tears) {
      m.removeFromParent();
      (m.material as THREE.Material).dispose();
      m.geometry.dispose();
    }
    this.tears = [];
    for (const slot of [...this.garments.keys()]) this.dropGarment(slot);
    this.bindPart(this.hair, null);
    this.bindPart(this.facialHair, null);
    for (const m of [...this.mats.values(), ...this.strandMats.values()]) m.dispose();
    this.root.removeFromParent();
  }
}

/**
 * Fits the camera's depth range to what it looks at. Cloth layers sit a few
 * millimetres apart; with the near plane at 5 cm, a 16-bit depth buffer (common
 * on Android, and in software GL) resolves only ~6 mm at 4 m, so the waistband
 * under a tee flickered through it. Near at a third of the viewing distance
 * keeps that under 0.2 mm.
 */
export function fitDepthRange(camera: THREE.PerspectiveCamera, target: THREE.Vector3 | [number, number, number]) {
  const t = Array.isArray(target) ? new THREE.Vector3(...target) : target;
  const d = camera.position.distanceTo(t);
  const near = Math.max(0.05, d * 0.35);
  const far = d + 6;
  if (Math.abs(camera.near - near) > 1e-4 || Math.abs(camera.far - far) > 1e-3) {
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  }
}

/** Soft radial contact shadow under the feet (cheap: one textured quad, no shadow maps). */
export function contactShadow() {
  const n = 64;
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const r = Math.hypot((x - n / 2 + 0.5) / (n / 2), ((y - n / 2 + 0.5) / (n / 2)) * 1.0);
      const a = Math.max(0, 1 - r);
      data[(y * n + x) * 4 + 3] = Math.round(255 * Math.pow(a, 1.6) * 0.9);
    }
  }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  tex.needsUpdate = true;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(0.95, 0.62),
    new THREE.MeshBasicMaterial({ map: tex, color: "#000000", transparent: true, depthWrite: false, opacity: 0.6 })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.002;
  m.renderOrder = -1;
  return m;
}

const envCache = new WeakMap<THREE.WebGLRenderer, THREE.Texture | null>();

/** A soft studio reflection map, made once per renderer. Null where the GPU can't build it. */
function studioEnvironment(gl: THREE.WebGLRenderer | undefined): THREE.Texture | null {
  if (!gl) return null;
  if (envCache.has(gl)) return envCache.get(gl)!;
  let tex: THREE.Texture | null = null;
  try {
    if (gl.capabilities.isWebGL2) {
      const pmrem = new THREE.PMREMGenerator(gl);
      const room = new RoomEnvironment();
      tex = pmrem.fromScene(room, 0.04).texture;
      room.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      });
      pmrem.dispose();
    }
  } catch (e) {
    console.warn("[avatar] no environment map on this GPU; lights only", e);
    tex = null;
  }
  envCache.set(gl, tex);
  return tex;
}

/**
 * Studio lighting shared by the live stage and the portrait studio: a warm
 * key, a cool fill, two rims (brand amber and a cool edge) to pull the
 * silhouette off the background, a soft sky/ground bounce, and a studio
 * reflection map so glossy eyes, metal and plastic have something to reflect.
 */
export function addStudioLights(scene: THREE.Scene | THREE.Object3D, gl?: THREE.WebGLRenderer, { shadows = false } = {}) {
  const g = new THREE.Group();
  g.add(new THREE.HemisphereLight("#f1f5f2", "#3b423e", 0.75));
  const key = new THREE.DirectionalLight("#fff3e6", 2.1);
  key.position.set(2.2, 4.2, 3.2);
  if (shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const c = key.shadow.camera;
    c.left = -0.8;
    c.right = 0.8;
    c.top = 1.1;
    c.bottom = -1.1;
    c.near = 1;
    c.far = 9;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.012;
    key.shadow.radius = 4;
    key.target.position.set(0, 0.9, 0);
    g.add(key.target);
  }
  const fill = new THREE.DirectionalLight("#dfe8ff", 0.55);
  fill.position.set(-2.6, 1.2, 3.2);
  const rim = new THREE.DirectionalLight("#ffb547", 1.25);
  rim.position.set(-3, 2.4, -2.6);
  const rim2 = new THREE.DirectionalLight("#a9d4ff", 0.8);
  rim2.position.set(3, 1.8, -3);
  g.add(key, fill, rim, rim2);
  scene.add(g);
  const env = studioEnvironment(gl);
  const s = scene as THREE.Scene;
  if (env && s.isScene) {
    s.environment = env;
    s.environmentIntensity = 0.42;
  }
  return g;
}
