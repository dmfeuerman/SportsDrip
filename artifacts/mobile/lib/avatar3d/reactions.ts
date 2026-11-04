/**
 * Bet-result reactions, built at runtime from the rig's own rest skeleton
 * (sd_rig_v3 / Mixamo names, rest rotations identity), so they play on every
 * base and outfit without re-exporting the GLB.
 *
 *  - win  : a hop with both arms thrown up in a V, then three fist pumps.
 *  - loss : shoulders slump, head drops, hands to the face, sobbing.
 *
 * Arms are posed by hand targets solved with two-bone IK, so they land on the
 * face / above the shoulders whatever the spine and head are doing.
 */
import * as THREE from "three";

export type ReactionKind = "win" | "loss";

export type Rest = Map<string, THREE.Vector3>; // bone → local rest position
export type Parents = Map<string, string | null>;

export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const Q = () => new THREE.Quaternion();
export const qe = (x: number, y = 0, z = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, "XYZ"));
export const smooth = (t: number, a: number, b: number) => {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
};
/** 0 → 1 over [a, b], held, then 1 → 0 over [c, d]. */
export const env = (t: number, a: number, b: number, c: number, d: number) => smooth(t, a, b) * (1 - smooth(t, c, d));

export const CHAIN = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head"] as const;
export const SIDES = [
  { s: "Left", g: 1 },
  { s: "Right", g: -1 },
] as const;

export interface Pose {
  local: Map<string, THREE.Quaternion>;
  hips: THREE.Vector3;
  /** World-space wrist targets (and elbow pole hints) per side. */
  /** `palm`: world direction the palm should face, applied by `palmW` (0…1). */
  hands: Partial<Record<"Left" | "Right", { target: THREE.Vector3; pole: THREE.Vector3; palm?: THREE.Vector3; palmW?: number }>>;
  /**
   * World-space ankle targets (knee pole hints, and the foot's world rotation —
   * flat when omitted) per side. Planted feet stay put however the hips move.
   */
  feet?: Partial<Record<"Left" | "Right", { target: THREE.Vector3; pole: THREE.Vector3; rot?: THREE.Quaternion }>>;
}

export class Skeleton {
  restWorld = new Map<string, THREE.Vector3>();
  /** Elbow direction solved on the previous frame, per side (see solveArm). Cleared per clip. */
  lastBend: Partial<Record<"Left" | "Right", THREE.Vector3>> = {};
  lastTwist: Partial<Record<"Left" | "Right", number>> = {};
  constructor(
    private rest: Rest,
    private parents: Parents
  ) {
    for (const name of rest.keys()) this.restWorld.set(name, this.worldRestOf(name));
  }
  private worldRestOf(name: string): THREE.Vector3 {
    const p = this.parents.get(name);
    const own = this.rest.get(name)!.clone();
    return p && this.rest.has(p) ? own.add(this.worldRestOf(p)) : own;
  }
  has(name: string) {
    return this.rest.has(name);
  }
  /** World rotation and position of `name` given local rotations (identity where unset). */
  world(name: string, local: Map<string, THREE.Quaternion>, hips: THREE.Vector3): { q: THREE.Quaternion; p: THREE.Vector3 } {
    const p = this.parents.get(name);
    const lq = local.get(name) ?? Q();
    if (!p || !this.rest.has(p)) return { q: lq.clone(), p: name === "Hips" ? hips.clone() : this.rest.get(name)!.clone() };
    const parent = this.world(p, local, hips);
    const offset = this.rest.get(name)!.clone().applyQuaternion(parent.q);
    return { q: parent.q.clone().multiply(lq), p: parent.p.clone().add(offset) };
  }
  /**
   * Sets Arm and ForeArm local rotations so the wrist reaches `target` (world), elbow toward `pole`.
   * With `palm` (world direction), the forearm also turns (pronation / supination, within a
   * human range) so the palm faces that way.
   */
  solveArm(side: "Left" | "Right", target: THREE.Vector3, pole: THREE.Vector3, pose: Pose, palm?: THREE.Vector3, palmW = 1) {
    const arm = `${side}Arm`, fore = `${side}ForeArm`, hand = `${side}Hand`;
    const S = this.world(arm, pose.local, pose.hips);
    const a = this.rest.get(fore)!.length();
    const b = this.rest.get(hand)!.length();
    const toT = target.clone().sub(S.p);
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
    const dir = toT.normalize();
    const along = (a * a - b * b + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, a * a - along * along));
    const bend = pole.clone().normalize().sub(dir.clone().multiplyScalar(pole.clone().normalize().dot(dir)));
    // Where the pole lines up with the reach, "which way the elbow points" is undefined and would
    // spin from one frame to the next: lean on the previous frame's elbow direction there.
    const prev = this.lastBend[side];
    if (prev) bend.add(prev.clone().sub(dir.clone().multiplyScalar(prev.dot(dir))).multiplyScalar(0.2));
    if (bend.lengthSq() < 1e-8) bend.set(0, -1, 0);
    bend.normalize();
    this.lastBend[side] = bend.clone();
    const E = S.p.clone().add(dir.clone().multiplyScalar(along)).add(bend.clone().multiplyScalar(h));
    const T = S.p.clone().add(dir.clone().multiplyScalar(d));
    // Rest segment directions (rest rotations are identity, so local = world at rest).
    const restArm = this.rest.get(fore)!.clone().normalize();
    const restFore = this.rest.get(hand)!.clone().normalize();
    const parentQ = this.world(`${side}Shoulder`, pose.local, pose.hips).q;
    // Each segment is oriented by its axis plus the way the elbow points (back, at rest), so the
    // elbow hinges in the arm's own plane and the twist never flips when an arm goes overhead
    // (a minimal rotation from the hanging rest direction is unstable near 180°).
    // The hinge normal (square to the plane of the arm) is well defined however far the elbow bends.
    const hinge0 = restArm.clone().cross(RELAXED_POLE).normalize();
    const hinge = dir.clone().cross(bend).normalize();
    const armW = alignFrame(restArm, hinge0, E.clone().sub(S.p).normalize(), hinge);
    pose.local.set(arm, parentQ.clone().invert().multiply(armW));
    const axis = T.clone().sub(E).normalize();
    const foreW = alignFrame(restFore, hinge0, axis, hinge);
    if (palm) {
      // At rest the palms face the thighs: inward, square to the forearm.
      const restPalm = V(side === "Left" ? -1 : 1, 0, 0);
      restPalm.sub(restFore.clone().multiplyScalar(restPalm.dot(restFore))).normalize();
      const now = restPalm.applyQuaternion(foreW);
      const p = palm.clone().normalize();
      const want = p.clone().sub(axis.clone().multiplyScalar(p.dot(axis)));
      // A palm direction along the forearm says nothing about the twist: fade it out there.
      const defined = THREE.MathUtils.smoothstep(want.length(), 0.15, 0.45);
      if (defined > 0) {
        want.normalize();
        let ang = Math.atan2(now.clone().cross(want).dot(axis), now.dot(want));
        // Stay on the same side of ±180° as last frame rather than flipping the forearm round.
        const last = this.lastTwist[side];
        if (last !== undefined) ang += Math.round((last - ang) / (Math.PI * 2)) * Math.PI * 2;
        ang = THREE.MathUtils.clamp(ang, -1.8, 1.8) * defined * palmW;
        this.lastTwist[side] = ang;
        foreW.premultiply(Q().setFromAxisAngle(axis, ang));
      }
    }
    pose.local.set(fore, armW.clone().invert().multiply(foreW));
  }
  /** Sets UpLeg, Leg and Foot so the ankle reaches `target` (world), knee toward `pole`, foot at world `rot`. */
  solveLeg(side: "Left" | "Right", target: THREE.Vector3, pole: THREE.Vector3, rot: THREE.Quaternion | undefined, pose: Pose) {
    const up = `${side}UpLeg`, leg = `${side}Leg`, foot = `${side}Foot`;
    const S = this.world(up, pose.local, pose.hips);
    const a = this.rest.get(leg)!.length();
    const b = this.rest.get(foot)!.length();
    const toT = target.clone().sub(S.p);
    const d = THREE.MathUtils.clamp(toT.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
    const dir = toT.normalize();
    const along = (a * a - b * b + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, a * a - along * along));
    const bend = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir)));
    if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1);
    bend.normalize();
    const K = S.p.clone().add(dir.clone().multiplyScalar(along)).add(bend.multiplyScalar(h));
    const T = S.p.clone().add(dir.clone().multiplyScalar(d));
    // The leg turns with the foot (knee over toes): rest directions are pre-turned by the foot's heading.
    const fwd = V(0, 0, 1).applyQuaternion(rot ?? Q());
    const heading = Q().setFromAxisAngle(V(0, 1, 0), Math.atan2(fwd.x, fwd.z));
    const turned = (v: THREE.Vector3) => v.clone().normalize().applyQuaternion(heading);
    const thighW = Q().setFromUnitVectors(turned(this.rest.get(leg)!), K.clone().sub(S.p).normalize()).multiply(heading);
    const parentQ = this.world(this.parents.get(up)!, pose.local, pose.hips).q;
    pose.local.set(up, parentQ.invert().multiply(thighW));
    const shinW = Q().setFromUnitVectors(turned(this.rest.get(foot)!), T.clone().sub(K).normalize()).multiply(heading);
    pose.local.set(leg, thighW.clone().invert().multiply(shinW));
    pose.local.set(foot, shinW.clone().invert().multiply(rot ?? Q()));
  }
}

/**
 * Rotation taking the frame (axis `a0`, reference `r0`) onto (axis `a1`, reference `r1`).
 * References are projected square to their axes, so only their direction round the axis counts.
 */
function alignFrame(a0: THREE.Vector3, r0: THREE.Vector3, a1: THREE.Vector3, r1: THREE.Vector3) {
  const basis = (a: THREE.Vector3, r: THREE.Vector3) => {
    const x = a.clone().normalize();
    let y = r.clone().sub(x.clone().multiplyScalar(r.dot(x)));
    if (y.lengthSq() < 1e-8) y = Math.abs(x.y) < 0.9 ? V(0, 1, 0) : V(0, 0, 1);
    y.normalize();
    const z = x.clone().cross(y);
    return Q().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  };
  return basis(a1, r1).multiply(basis(a0, r0).invert());
}

/** World position of a point given in the head's rest frame (world rest coordinates). */
export function onHead(sk: Skeleton, pose: Pose, restPoint: THREE.Vector3) {
  const head = sk.world("Head", pose.local, pose.hips);
  return restPoint.clone().sub(sk.restWorld.get("Head")!).applyQuaternion(head.q).add(head.p);
}

export function sample(sk: Skeleton, name: string, dur: number, fps: number, poseAt: (t: number) => Pose) {
  const times: number[] = [];
  const poses: Pose[] = [];
  const n = Math.round(dur * fps);
  sk.lastBend = {};
  sk.lastTwist = {};
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * dur;
    const pose = poseAt(t);
    for (const sd of ["Left", "Right"] as const) {
      const f = pose.feet?.[sd];
      if (f && sk.has(`${sd}UpLeg`)) sk.solveLeg(sd, f.target, f.pole, f.rot, pose);
    }
    for (const sd of ["Left", "Right"] as const) {
      const h = pose.hands[sd];
      if (h && sk.has(`${sd}Arm`)) sk.solveArm(sd, h.target, h.pole, pose, h.palm, h.palmW);
    }
    times.push(t);
    poses.push(pose);
  }
  const bones = new Set<string>();
  for (const p of poses) for (const k of p.local.keys()) bones.add(k);
  const tracks: THREE.KeyframeTrack[] = [];
  for (const b of bones) {
    const vals: number[] = [];
    let prev: THREE.Quaternion | null = null;
    for (const p of poses) {
      const q = (p.local.get(b) ?? Q()).clone();
      if (prev && prev.dot(q) < 0) q.set(-q.x, -q.y, -q.z, -q.w); // shortest path between keys
      vals.push(q.x, q.y, q.z, q.w);
      prev = q;
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, times, vals));
  }
  tracks.push(new THREE.VectorKeyframeTrack("Hips.position", times, poses.flatMap((p) => [p.hips.x, p.hips.y, p.hips.z])));
  return new THREE.AnimationClip(name, dur, tracks);
}

/**
 * Relaxed arm (close to the idle): hanging from the shoulder along its rest
 * line, almost straight, a touch forward. Pole: elbow back.
 */
export const RELAXED_POLE = V(0, 0.2, -1);
export function restHand(sk: Skeleton, side: "Left" | "Right", pose: Pose) {
  const sh = sk.world(`${side}Arm`, pose.local, pose.hips).p;
  const restSh = sk.restWorld.get(`${side}Arm`)!;
  const dir = sk.restWorld.get(`${side}Hand`)!.clone().sub(restSh).add(V(side === "Left" ? -0.03 : 0.03, 0, 0.04)).normalize();
  const reach = sk.restWorld.get(`${side}Hand`)!.distanceTo(sk.restWorld.get(`${side}ForeArm`)!) + sk.restWorld.get(`${side}ForeArm`)!.distanceTo(restSh);
  return sh.clone().add(dir.multiplyScalar(reach * 0.975));
}

export function buildReactionClips(rest: Rest, parents: Parents): Record<ReactionKind, THREE.AnimationClip> | null {
  for (const b of [...CHAIN, "LeftArm", "LeftForeArm", "LeftHand", "RightArm", "RightForeArm", "RightHand", "LeftShoulder", "RightShoulder"]) {
    if (!rest.has(b)) return null; // not on our rig
  }
  const sk = new Skeleton(rest, parents);
  const hips0 = rest.get("Hips")!.clone();

  /* ── win: hop + V, then fist pumps ─────────────────────────────────────── */
  const WIN = 2.7;
  const win = sample(sk, "react_win", WIN, 30, (t) => {
    const pose: Pose = { local: new Map(), hips: hips0.clone(), hands: {} };
    const on = env(t, 0.05, 0.25, 2.3, 2.65);
    const crouch = env(t, 0.0, 0.12, 0.14, 0.28) * 0.6 + env(t, 0.55, 0.65, 0.65, 0.8) * 0.5;
    const hop = Math.max(0, Math.sin(Math.PI * THREE.MathUtils.clamp((t - 0.22) / 0.36, 0, 1)));
    pose.hips.y += 0.075 * hop - 0.035 * crouch;
    for (const { s } of SIDES) {
      pose.local.set(`${s}UpLeg`, qe(-0.35 * crouch));
      pose.local.set(`${s}Leg`, qe(0.7 * crouch));
      pose.local.set(`${s}Foot`, qe(-0.35 * crouch + 0.25 * hop));
    }
    const pumpPhase = THREE.MathUtils.clamp((t - 0.9) / 1.35, 0, 1);
    const pump = 0.5 - 0.5 * Math.cos(pumpPhase * Math.PI * 2 * 3);
    pose.local.set("Spine", qe(-0.05 * on));
    pose.local.set("Spine1", qe(-0.05 * on, 0.1 * env(t, 0.8, 1.0, 2.1, 2.4)));
    pose.local.set("Spine2", qe(-0.04 * on + 0.05 * pump * env(t, 0.9, 1.0, 2.1, 2.3)));
    pose.local.set("Neck", qe(-0.08 * on));
    pose.local.set("Head", qe(-0.18 * on + 0.08 * pump * env(t, 0.9, 1.0, 2.1, 2.3), 0, 0.06 * Math.sin(t * 9) * env(t, 0.3, 0.5, 0.7, 0.9)));
    // Phase A: both arms thrown up in a V. Phase B: right fist pumps, left back to the side.
    const vUp = env(t, 0.1, 0.32, 0.72, 0.95);
    const pumping = env(t, 0.75, 0.95, 2.15, 2.5);
    for (const { s, g } of SIDES) {
      const sh = sk.world(`${s}Arm`, pose.local, pose.hips).p;
      const relaxed = restHand(sk, s, pose);
      const vTarget = sh.clone().add(V(0.24 * g, 0.47, 0.06));
      let target = relaxed.clone().lerp(vTarget, vUp);
      let pole = RELAXED_POLE.clone().lerp(V(g, -0.2, -0.6), vUp);
      if (s === "Right") {
        // Elbow down and out at chest height, forearm up: "yes!" — pumping down and back up.
        const high = sh.clone().add(V(-0.25, 0.17, 0.2));
        const low = sh.clone().add(V(-0.22, -0.07, 0.24));
        target = target.lerp(low.clone().lerp(high, 1 - pump), pumping);
        pole = pole.lerp(V(-0.7, -1, 0.1), pumping);
      } else {
        // Left hand settles on the hip while the right one pumps.
        const hip = sk.world("Hips", pose.local, pose.hips).p.clone().add(V(0.15, 0.06, 0.04));
        target = target.lerp(hip, pumping * 0.85);
        pole = pole.lerp(V(1, 0, -0.4), pumping * 0.85);
      }
      pose.hands[s] = { target, pole };
    }
    return pose;
  });

  /* ── loss: slump, head down, hands to the face, sobbing ────────────────── */
  const LOSS = 3.6;
  const faceRest = V(0, 1.615, 0.11);
  const loss = sample(sk, "react_loss", LOSS, 30, (t) => {
    const pose: Pose = { local: new Map(), hips: hips0.clone(), hands: {} };
    const slump = env(t, 0.05, 0.55, 3.0, 3.55);
    const hands = env(t, 0.35, 0.9, 2.85, 3.4);
    const sob = Math.max(0, Math.sin(t * Math.PI * 2 * 2.2)) * env(t, 0.9, 1.1, 2.7, 2.9);
    pose.hips.y -= 0.012 * slump;
    pose.local.set("Spine", qe(0.06 * slump));
    pose.local.set("Spine1", qe(0.1 * slump));
    pose.local.set("Spine2", qe(0.13 * slump + 0.035 * sob));
    pose.local.set("Neck", qe(0.2 * slump));
    pose.local.set("Head", qe(0.24 * slump + 0.04 * sob, 0.07 * Math.sin(t * 5) * hands, 0));
    for (const { s } of SIDES) pose.local.set(`${s}Shoulder`, qe(0.08 * slump, 0, (s === "Left" ? -1 : 1) * (0.06 * slump - 0.04 * sob)));
    for (const { s, g } of SIDES) {
      const face = onHead(sk, pose, faceRest.clone().add(V(0.04 * g, -0.06, 0.07)));
      const relaxed = restHand(sk, s, pose);
      pose.hands[s] = { target: relaxed.lerp(face, hands), pole: RELAXED_POLE.clone().lerp(V(g * 0.9, -1, -0.15), hands) };
    }
    return pose;
  });

  return { win, loss };
}
