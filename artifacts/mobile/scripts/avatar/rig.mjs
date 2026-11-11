/**
 * On the House avatar rig — `sd_rig_v3`.
 *
 * The single contract every avatar asset is authored against. The base
 * character and every garment carry this exact skeleton (same bone names, same
 * rest pose), which is what lets a garment authored once deform with any
 * avatar, whatever its height or build.
 *
 * v3 is the stylised game proportion: about 6.3 heads tall, a larger head on a
 * short, strong neck, broad shoulders tapering to a narrow waist, and arms
 * relaxed ~20° off the body. Bone names and hierarchy are unchanged from v2,
 * so code that addresses bones by name keeps working.
 *
 * Conventions
 *  - metres, +Y up, character faces +Z, character's left is +X
 *  - every bone's rest rotation is identity (world-aligned), so a bone's local
 *    offset is simply the difference of rest positions
 *  - bone names contain no "." (three's PropertyBinding splits on it)
 */

export const RIG_ID = "sd_rig_v3";

/**
 * [name, parent, world rest position] — parents always precede children.
 * Names follow Mixamo's humanoid convention (without the "mixamorig:" prefix),
 * so Mixamo-named clips and garments bind by name; a "mixamorig:" or
 * "mixamorig" prefix on incoming bone or track names is stripped at load.
 */
export const BONES = [
  ["Hips", null, [0, 0.94, 0]],
  ["Spine", "Hips", [0, 1.04, 0]],
  ["Spine1", "Spine", [0, 1.14, 0]],
  ["Spine2", "Spine1", [0, 1.26, 0]],
  ["Neck", "Spine2", [0, 1.445, -0.012]],
  ["Head", "Neck", [0, 1.535, -0.008]],
  ["LeftShoulder", "Spine2", [0.055, 1.425, -0.012]],
  ["LeftArm", "LeftShoulder", [0.188, 1.404, -0.012]],
  ["LeftForeArm", "LeftArm", [0.284, 1.134, -0.024]],
  ["LeftHand", "LeftForeArm", [0.354, 0.891, 0.012]],
  ["RightShoulder", "Spine2", [-0.055, 1.425, -0.012]],
  ["RightArm", "RightShoulder", [-0.188, 1.404, -0.012]],
  ["RightForeArm", "RightArm", [-0.284, 1.134, -0.024]],
  ["RightHand", "RightForeArm", [-0.354, 0.891, 0.012]],
  ["LeftUpLeg", "Hips", [0.092, 0.905, 0]],
  ["LeftLeg", "LeftUpLeg", [0.106, 0.5, 0.014]],
  ["LeftFoot", "LeftLeg", [0.114, 0.088, -0.012]],
  ["LeftToeBase", "LeftFoot", [0.118, 0.024, 0.112]],
  ["RightUpLeg", "Hips", [-0.092, 0.905, 0]],
  ["RightLeg", "RightUpLeg", [-0.106, 0.5, 0.014]],
  ["RightFoot", "RightLeg", [-0.114, 0.088, -0.012]],
  ["RightToeBase", "RightFoot", [-0.118, 0.024, 0.112]],
];

/** Bone name for a side ("L" / "R") and a Mixamo part ("Arm", "ForeArm", "Hand", "UpLeg", "Leg", "Foot", "ToeBase", "Shoulder"). */
export const sideBone = (part, side) => `${side === "L" ? "Left" : "Right"}${part}`;

export const BONE_NAMES = BONES.map((b) => b[0]);
export const REST = Object.fromEntries(BONES.map(([n, , p]) => [n, p]));

/**
 * Attachment sockets: named points on a bone that rigid wearables hang from.
 * They live in the base GLB as empty nodes under their bone (rest rotation
 * identity, like the bones), so an accessory's attachment transform is
 * relative to a fixed, meaningful point instead of an arbitrary joint.
 *
 *  - HeadTop : on the scalp at the crown — hats, helmets, crowns, headphones
 *  - Face    : between the eyes at the bridge of the nose — eyewear
 *  - Neck    : base of the neck, front — chains, necklaces
 *  - Wrist_L / Wrist_R : centre of the wrist, a little up the forearm — watches, bands
 */
function WRIST(side) {
  // 90% of the way from elbow to wrist joint, on the forearm's axis.
  const E = BONES.find((b) => b[0] === sideBone("ForeArm", side))[2];
  const W = BONES.find((b) => b[0] === sideBone("Hand", side))[2];
  return E.map((v, i) => +(v + (W[i] - v) * 0.9).toFixed(4));
}
export const SOCKETS = {
  HeadTop: { bone: "Head", position: [0, 1.776, 0.004] },
  Face: { bone: "Head", position: [0, 1.64, 0.121] },
  Neck: { bone: "Spine2", position: [0, 1.43, 0.035] },
  Wrist_L: { bone: "LeftForeArm", position: WRIST("L") },
  Wrist_R: { bone: "RightForeArm", position: WRIST("R") },
};

/**
 * Distance from the skin to each garment layer's surface, so stacked layers
 * never touch. Every overlay on a garment (bands, cuffs, prints, pockets,
 * zips) sits at least `trim` over the cloth beneath it — more than the mesh
 * decimation can move either surface. Tops hang `waist` further out over the
 * waist (y < 1.06 m), clear of the bottoms' waistband and belt.
 */
export const LAYER_OFFSET = {
  base: 0.004,
  bottom: 0.006,
  top: 0.015,
  outer: 0.03,
  shoes: 0.012,
  trim: 0.0035,
  waist: 0.006,
};

/**
 * Head cranium — shared by every face shape (face shapes only change the
 * face below the cheekbones), so hair, hats and eyewear fit all of them.
 */
export const HEAD = { center: [0, 1.648, 0.004], radii: [0.099, 0.127, 0.115] };

export const FACE_SHAPES = ["oval", "round", "square", "heart"];
export const EYE_SHAPES = ["round", "almond", "sleepy"];
export const EYEBROWS = ["soft", "arched", "bold", "none"];
export const HAIR_STYLES = ["buzz", "short_crop", "fade", "curls", "afro", "braids", "long", "ponytail", "bald"];
export const FACIAL_HAIR = ["none", "stubble", "goatee", "beard"];
/** How head items treat hair (fit.mjs defines the volumes); every hairstyle ships a variant per mode. */
export const HAIR_MODES = ["capped", "covered", "helmet", "banded"];

/**
 * Body regions. The base body ships as one mesh per region (Body_<region>);
 * a garment lists the regions it fully covers (`hides`) and the runtime
 * stops drawing them, so skin can never show through or clip into cloth.
 */
export const BODY_REGIONS = ["neck", "shoulders", "chest", "abdomen", "waist", "hips", "upperArms", "elbows", "forearms", "hands", "thighs", "knees", "shins", "ankles", "feet"];

export const NOSE_SHAPES = ["button", "straight", "broad"];
export const MOUTH_SHAPES = ["neutral", "full", "wide"];
/** Face expression blendshapes (ARKit names) every head, lid and lash mesh carries. */
export const EXPRESSIONS = ["eyeBlinkLeft", "eyeBlinkRight", "mouthSmileLeft", "mouthSmileRight", "jawOpen"];
/** Body build blendshapes on the body, the head's neck and every skinned garment. */
export const BUILD_MORPHS = ["buildSlim", "buildBroad"];
