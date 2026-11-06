/**
 * Dance moves ("Moves" in the store), built at runtime from the rig's rest
 * skeleton the same way the bet reactions are (see reactions.ts): no extra
 * GLB downloads, and every move plays on every base, body type, height and
 * outfit because it is solved against that character's own bones.
 *
 * What keeps them from looking robotic (except the one that should):
 *  - Feet are planted with leg IK, so the hips can drop, sway and twist over
 *    them without the shoes skating or sinking through the floor.
 *  - Everything rides one groove: the hips dip on the beat, the chest follows
 *    a moment later and the head a moment after that (overlap), arms trail the
 *    shoulders.
 *  - Weight shifts are real: the pelvis travels over the standing foot and
 *    tilts, the shoulders tilt back the other way.
 *  - Hands are placed in the chest's frame, so when the torso turns the arms
 *    come with it.
 *  - Every move eases in from and back out to the idle stance.
 */
import * as THREE from "three";
import { env, qe, Q, restHand, RELAXED_POLE, sample, Skeleton, smooth, V, type Parents, type Pose, type Rest } from "./reactions";

export type DanceId =
  | "two_step"
  | "hype_clap"
  | "shoulder_shimmy"
  | "raise_the_roof"
  | "the_dab"
  | "sprinkler"
  | "disco_point"
  | "the_robot"
  | "the_floss"
  | "champion_spin";

/** How the face plays the move: a big open grin, a closed-mouth smile, or deadpan. */
export type DanceFace = "grin" | "smile" | "cool";

type Side = "Left" | "Right";
const SIDE: Array<{ s: Side; g: 1 | -1 }> = [
  { s: "Left", g: 1 },
  { s: "Right", g: -1 },
];

const TAU = Math.PI * 2;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Fast-in, soft-landing step (for hits): reaches ~90% in the first third. */
const hit = (t: number, a: number, b: number) => {
  const x = clamp01((t - a) / (b - a));
  return 1 - Math.pow(1 - x, 3);
};
/** Downbeat dip: 1 on the beat, 0 on the "and", with a little dwell at the bottom. */
const dip = (b: number) => Math.pow(0.5 + 0.5 * Math.cos(TAU * b), 1.6);
/** Smooth side-to-side: +1 on even beats, −1 on odd ones. */
const sway = (b: number) => Math.cos(Math.PI * b);

/**
 * Blend between two hand offsets (relative to the shoulder) along an arc round
 * the shoulder rather than a straight line: arms swing, and a straight path
 * from "down by the thigh" to "up by the ear" would fold the arm through the
 * shoulder joint. Near-opposite directions route forward, in front of the body.
 */
function swing(a: THREE.Vector3, b: THREE.Vector3, k: number, fwd = V(0, 0, 1)): THREE.Vector3 {
  if (k <= 0) return a.clone();
  if (k >= 1) return b.clone();
  const la = a.length(), lb = b.length();
  if (la < 1e-4 || lb < 1e-4) return a.clone().lerp(b, k);
  const ua = a.clone().divideScalar(la), ub = b.clone().divideScalar(lb);
  const len = lerp(la, lb, k);
  const slerpDir = (x: THREE.Vector3, y: THREE.Vector3, u: number) => {
    const qa = Q().setFromUnitVectors(x, y);
    return x.clone().applyQuaternion(Q().slerp(qa, u));
  };
  let dir: THREE.Vector3;
  if (ua.dot(ub) < -0.3) {
    const mid = ua.clone().add(ub).add(fwd).normalize();
    dir = k < 0.5 ? slerpDir(ua, mid, k * 2) : slerpDir(mid, ub, k * 2 - 1);
  } else dir = slerpDir(ua, ub, k);
  return dir.multiplyScalar(len);
}

/** Per-skeleton helpers shared by every move. */
class Kit {
  readonly ankle: Record<Side, THREE.Vector3>;
  readonly floorY: number;
  constructor(
    readonly sk: Skeleton,
    readonly hips0: THREE.Vector3
  ) {
    this.ankle = { Left: sk.restWorld.get("LeftFoot")!.clone(), Right: sk.restWorld.get("RightFoot")!.clone() };
    this.floorY = this.ankle.Left.y;
  }

  pose(): Pose {
    return { local: new Map(), hips: this.hips0.clone(), hands: {}, feet: {} };
  }

  /** Local rotation (radians, XYZ) on a bone, composed onto whatever is already there. */
  rot(p: Pose, bone: string, x: number, y = 0, z = 0) {
    const q = p.local.get(bone) ?? Q();
    p.local.set(bone, q.multiply(qe(x, y, z)));
  }

  /**
   * Puts a foot on the floor at its rest spot plus `off` (metres, world), lifted
   * by `lift`, heading `yaw`, toe pitched by `pitch` (positive: toe down / heel up).
   */
  foot(p: Pose, s: Side, off = V(), { lift = 0, yaw = 0, pitch = 0 } = {}) {
    const g = s === "Left" ? 1 : -1;
    const target = this.ankle[s].clone().add(off);
    target.y += lift;
    // Heel up pivots round the ball of the foot: the ankle rises as the toe points.
    target.y += Math.max(0, pitch) * 0.075;
    target.z -= Math.max(0, pitch) * 0.03;
    const rot = qe(pitch, yaw, 0);
    p.feet![s] = { target, pole: V(0.18 * g, 0, 1).applyQuaternion(qe(0, yaw, 0)), rot };
  }

  chest(p: Pose) {
    return this.sk.world("Spine2", p.local, p.hips);
  }

  shoulder(p: Pose, s: Side) {
    return this.sk.world(`${s}Arm`, p.local, p.hips).p;
  }

  /**
   * Wrist target relative to the shoulder, in the chest's frame (so it turns
   * with the torso). x is mirrored per side: positive = outward. `w` blends
   * from the relaxed, hanging arm.
   */
  hand(p: Pose, s: Side, off: THREE.Vector3, pole: THREE.Vector3, w = 1, palm?: THREE.Vector3, via?: THREE.Vector3) {
    const g = s === "Left" ? 1 : -1;
    const c = this.chest(p);
    const m = (v: THREE.Vector3) => V(v.x * g, v.y, v.z).applyQuaternion(c.q);
    const target = this.shoulder(p, s).add(m(off));
    this.handAt(p, s, target, m(pole), w, palm && m(palm), via && m(via));
  }

  /**
   * Wrist target in world space (for moves that reach to a fixed point).
   * `palm`: which way the palm faces (world); blends from the resting, inward-facing palm.
   */
  handAt(p: Pose, s: Side, target: THREE.Vector3, pole: THREE.Vector3, w = 1, palm?: THREE.Vector3, via?: THREE.Vector3) {
    const relaxed = restHand(this.sk, s, p);
    const sh = this.shoulder(p, s);
    const fwd = via ?? V(0, 0, 1).applyQuaternion(this.chest(p).q);
    p.hands[s] = {
      target: sh.clone().add(swing(relaxed.sub(sh), target.clone().sub(sh), w, fwd)),
      pole: RELAXED_POLE.clone().lerp(pole, w).normalize(),
      palm,
      palmW: w,
    };
  }

  /** Point on the head (rest-space coordinates) as currently posed. */
  onHead(p: Pose, restPoint: THREE.Vector3) {
    const head = this.sk.world("Head", p.local, p.hips);
    return restPoint.clone().sub(this.sk.restWorld.get("Head")!).applyQuaternion(head.q).add(head.p);
  }

  /** Torso follow-through: spine segments then neck and head, each a touch later and smaller. */
  spineChain(p: Pose, at: (lag: number) => [number, number, number], weights = [0.35, 0.35, 0.3, 0.25, 0.35]) {
    const bones = ["Spine", "Spine1", "Spine2", "Neck", "Head"];
    bones.forEach((b, i) => {
      const [x, y, z] = at(i * 0.04);
      this.rot(p, b, x * weights[i]!, y * weights[i]!, z * weights[i]!);
    });
  }
}

interface MoveSpec {
  duration: number;
  face: DanceFace;
  build: (k: Kit, t: number) => Pose;
}

/** Soft envelope every move uses: in over ~0.3s, out over the last ~0.45s. */
const envelope = (t: number, dur: number) => env(t, 0.0, 0.32, dur - 0.5, dur - 0.04);

/* ─────────────────────────────────────────────────────────────────────────
 * Two-Step: step out, close, step out the other way, close. Weight travels
 * over the stepping foot, arms swing loose with bent elbows, head nods on 1.
 * ────────────────────────────────────────────────────────────────────── */
const TWO_STEP: MoveSpec = {
  duration: 6.0,
  face: "grin",
  build(k, t) {
    const BEAT = 0.52;
    const p = k.pose();
    const on = envelope(t, this.duration);
    const b = Math.max(0, (t - 0.25) / BEAT);
    // Absolute ankle x at each beat boundary: exactly one foot moves per beat.
    // Step out right, close left (touch), step out left, close right (touch), …
    const R = [-0.114, -0.24, -0.24, -0.24, 0.06, -0.24, -0.24, -0.24, 0.06, -0.114, -0.114, -0.114];
    const L = [0.114, 0.114, -0.06, 0.24, 0.24, 0.24, -0.06, 0.24, 0.24, 0.24, 0.114, 0.114];
    const TR = [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
    const TL = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0];
    const i = Math.min(R.length - 2, Math.floor(b));
    const f = Math.min(1, b - i);
    const stepK = smooth(f, 0.05, 0.8);
    const arc = (m: number[]) => (m[i] !== m[i + 1] ? Math.sin(Math.PI * clamp01(f / 0.8)) * 0.06 : 0);
    const at = (m: number[]) => lerp(m[i]!, m[i + 1]!, stepK);
    const rx = at(R), lx = at(L);
    const touchR = at(TR), touchL = at(TL);
    k.foot(p, "Right", V((rx - k.ankle.Right.x) * on, 0, 0.01 * on), { lift: arc(R) * on, pitch: 0.4 * touchR * on, yaw: -0.12 * on });
    k.foot(p, "Left", V((lx - k.ankle.Left.x) * on, 0, 0.01 * on), { lift: arc(L) * on, pitch: 0.4 * touchL * on, yaw: 0.12 * on });
    // Weight over the foot that isn't touching; between steps, travelling with them.
    const sup = (j: number) => (TR[j] ? L[j]! : TL[j] ? R[j]! : (R[j]! + L[j]!) / 2);
    const travel = lerp(sup(i), sup(i + 1), smooth(f, 0.1, 0.85)) * 0.85 * on;
    p.hips.x += travel;
    p.hips.y -= (0.015 + 0.022 * dip(b)) * on;
    const lean = THREE.MathUtils.clamp(travel / 0.12, -1, 1);
    k.rot(p, "Hips", 0, 0.08 * lean * on, -0.07 * lean * on);
    k.spineChain(p, (lag) => [0.05 * on + 0.05 * dip(b - lag * 3) * on, -0.12 * lean * on, 0.16 * lean * on]);
    k.rot(p, "Head", 0.08 * dip(b - 0.18) * on - 0.05 * on, 0, -0.06 * lean * on);
    // Arms: bent at the elbow, swinging toward the step, the outside arm a little higher.
    for (const { s, g } of SIDE) {
      const swing = -lean * g; // + when this arm is on the side we're moving to
      const lag = sway(b - 0.25);
      k.hand(
        p,
        s,
        V(-0.02 + 0.07 * swing, -0.3 + 0.05 * Math.max(0, swing) + 0.03 * dip(b - 0.2), 0.2 + 0.05 * lag * g),
        V(0.6, -1, -0.5),
        on,
        V(-0.5, -0.7, 0.3)
      );
    }
    return p;
  },
};

/* ─────────────────────────────────────────────────────────────────────────
 * Hype Clap: knees bouncing, four claps in front of the chest, then four
 * overhead with a rock of the shoulders.
 * ────────────────────────────────────────────────────────────────────── */
const HYPE_CLAP: MoveSpec = {
  duration: 5.0,
  face: "grin",
  build(k, t) {
    const BEAT = 0.5;
    const p = k.pose();
    const on = envelope(t, this.duration);
    const b = Math.max(0, (t - 0.3) / BEAT);
    const high = smooth(b, 3.5, 4.2) * (1 - smooth(b, 7.0, 7.7));
    k.foot(p, "Left", V(0.03, 0, 0.01), { yaw: 0.14 * on });
    k.foot(p, "Right", V(-0.03, 0, 0.01), { yaw: -0.14 * on });
    p.hips.y -= (0.012 + 0.025 * dip(b)) * on;
    const rock = Math.sin(Math.PI * b) * high;
    p.hips.x += 0.025 * rock * on;
    k.rot(p, "Hips", 0, 0, -0.05 * rock * on);
    k.spineChain(p, (lag) => [(0.07 * dip(b - lag * 3) - 0.05 * high) * on, 0.05 * rock * on, 0.1 * rock * on]);
    k.rot(p, "Head", (0.09 * dip(b - 0.15) - 0.1 * high) * on, 0, -0.05 * rock * on);
    // 0 = hands meeting (on the beat), 1 = apart (on the "and"). Quick close, softer open.
    const ph = ((b % 1) + 1) % 1;
    const apart = ph < 0.5 ? smooth(ph, 0.04, 0.45) : 1 - smooth(ph, 0.55, 0.98);
    for (const { s } of SIDE) {
      const lowMeet = V(-0.11, -0.21, 0.4);
      const lowOpen = V(0.06, -0.17, 0.33);
      const hiMeet = V(-0.12, 0.42, 0.2);
      const hiOpen = V(0.0, 0.4, 0.17);
      const meet = swing(lowMeet, hiMeet, high);
      const open = swing(lowOpen, hiOpen, high);
      const pole = V(0.9, -0.6, -0.2).lerp(V(1, -0.3, -0.3), high);
      k.hand(p, s, swing(meet, open, apart), pole, on * smooth(t, 0.05, 0.4), V(-1, 0, 0.15));
    }
    return p;
  },
};

/* ─────────────────────────────────────────────────────────────────────────
 * Shoulder Shimmy: wide stance, knees soft, fists up; shoulders pop
 * alternately on every half beat while the chest twists under a steady head.
 * ────────────────────────────────────────────────────────────────────── */
const SHOULDER_SHIMMY: MoveSpec = {
  duration: 4.6,
  face: "smile",
  build(k, t) {
    const BEAT = 0.5;
    const p = k.pose();
    const on = envelope(t, this.duration);
    const b = Math.max(0, (t - 0.3) / BEAT);
    k.foot(p, "Left", V(0.07 * on, 0, 0.02 * on), { yaw: 0.2 * on });
    k.foot(p, "Right", V(-0.07 * on, 0, 0.02 * on), { yaw: -0.2 * on });
    p.hips.y -= (0.03 + 0.015 * dip(b * 2)) * on;
    p.hips.z -= 0.02 * on;
    const pop = Math.sin(Math.PI * b * 2) * smooth(b, 0, 0.6); // L up when +, R up when −
    const twist = Math.sin(Math.PI * b * 2 - 0.5);
    k.rot(p, "Hips", 0.05 * on, -0.05 * twist * on, 0);
    k.rot(p, "Spine", 0.06 * on, 0.06 * twist * on, 0.03 * pop * on);
    k.rot(p, "Spine1", 0.06 * on, 0.08 * twist * on, 0.03 * pop * on);
    k.rot(p, "Spine2", 0.04 * on, 0.1 * twist * on, 0.05 * pop * on);
    // Head holds steady (counter-rotate), with a cool little nod.
    k.rot(p, "Neck", -0.06 * on, -0.12 * twist * on, -0.05 * pop * on);
    k.rot(p, "Head", (0.06 * dip(b - 0.15) - 0.04) * on, -0.08 * twist * on, -0.03 * pop * on);
    for (const { s, g } of SIDE) {
      const up = Math.max(0, pop * g);
      k.rot(p, `${s}Shoulder`, -0.14 * up * on, 0, g * 0.3 * up * on);
      k.hand(p, s, V(-0.07, -0.18 + 0.06 * up, 0.27 + 0.04 * up), V(0.7, -1, -0.3), on, V(-0.6, -0.8, 0));
    }
    return p;
  },
};

/* ─────────────────────────────────────────────────────────────────────────
 * Raise the Roof: palms push up past the head on every beat, a weight
 * shift every two, chin up on the push.
 * ────────────────────────────────────────────────────────────────────── */
const RAISE_THE_ROOF: MoveSpec = {
  duration: 4.8,
  face: "grin",
  build(k, t) {
    const BEAT = 0.52;
    const p = k.pose();
    const on = envelope(t, this.duration);
    const b = Math.max(0, (t - 0.3) / BEAT);
    const side = Math.sin((Math.PI * b) / 2); // weight drifts L/R over two beats
    k.foot(p, "Left", V(0.04 * on, 0, 0), { yaw: 0.12 * on, pitch: 0.25 * Math.max(0, -side) * on });
    k.foot(p, "Right", V(-0.04 * on, 0, 0), { yaw: -0.12 * on, pitch: 0.25 * Math.max(0, side) * on });
    p.hips.x += 0.05 * side * on;
    p.hips.y -= (0.015 + 0.025 * dip(b)) * on;
    k.rot(p, "Hips", 0, 0.06 * side * on, -0.06 * side * on);
    // push: 1 at full extension just after the beat.
    const ph = ((b % 1) + 1) % 1;
    const push = (ph < 0.4 ? hit(ph, 0, 0.36) : 1 - smooth(ph, 0.42, 0.98)) * smooth(t, 0.3, 0.55);
    k.spineChain(p, () => [-0.05 * push * on, 0.05 * side * on, 0.1 * side * on]);
    k.rot(p, "Head", (-0.12 * push + 0.06 * dip(b - 0.2)) * on, 0, -0.05 * side * on);
    for (const { s, g } of SIDE) {
      const low = V(0.13, 0.08, 0.14);
      const high = V(0.12, 0.43, 0.1);
      k.hand(p, s, swing(low, high, push), V(1, -0.4, -0.2), on, V(0, 0, 1));
      // Wrists flex back on the push, heels of the hands leading.
      k.rot(p, `${s}Hand`, 0, 0, g * 0.6 * push * on);
    }
    return p;
  },
};

/* ─────────────────────────────────────────────────────────────────────────
 * The Dab: two bounces, dab right, switch, dab left, back to standing.
 * ────────────────────────────────────────────────────────────────────── */
const THE_DAB: MoveSpec = {
  duration: 4.4,
  face: "cool",
  build(k, t) {
    const p = k.pose();
    const on = envelope(t, this.duration);
    // dir +1 = dab to the character's right (left arm tucked, right arm out).
    const d1 = hit(t, 0.98, 1.24) * (1 - smooth(t, 2.0, 2.25));
    const d2 = hit(t, 2.22, 2.48) * (1 - smooth(t, 3.45, 3.85));
    const dir = d1 > 0.001 ? 1 : -1;
    const w = Math.max(d1, d2);
    const settle = 0.015 * Math.sin((t - (dir > 0 ? 1.18 : 2.45)) * 18) * Math.exp(-6 * Math.max(0, t - (dir > 0 ? 1.18 : 2.45))) * w;
    const bounce = dip((t - 0.15) / 0.42) * (1 - smooth(t, 0.8, 1.0));
    k.foot(p, "Left", V(0.05 * on, 0, 0), { yaw: 0.15 * on });
    k.foot(p, "Right", V(-0.05 * on, 0, 0), { yaw: -0.15 * on });
    p.hips.y -= (0.012 + 0.025 * bounce + 0.03 * w) * on + settle;
    p.hips.x -= 0.03 * dir * w;
    k.rot(p, "Hips", 0, -0.08 * dir * w, 0.04 * dir * w);
    // Lean into it and turn the face into the tucked elbow.
    k.rot(p, "Spine", 0.06 * w, -0.05 * dir * w, 0.05 * dir * w);
    k.rot(p, "Spine1", 0.08 * w, -0.06 * dir * w, 0.06 * dir * w);
    k.rot(p, "Spine2", 0.08 * w, -0.06 * dir * w, 0.06 * dir * w);
    // Head dips toward the elbow but stays behind the forearm.
    k.rot(p, "Neck", 0.2 * w + 0.06 * bounce, 0.22 * dir * w, 0.1 * dir * w);
    k.rot(p, "Head", 0.26 * w + 0.06 * bounce, 0.26 * dir * w, 0.1 * dir * w);
    for (const { s } of SIDE) {
      const tucked = (dir > 0 && s === "Left") || (dir < 0 && s === "Right");
      const relaxedOff = V(-0.02, -0.3, 0.2);
      if (tucked) {
        // Elbow up in front of the face, forearm across it, hand past the far shoulder.
        // Hand stays well forward of the face so the forearm crosses in front, never through the head.
        k.hand(p, s, swing(relaxedOff, V(-0.34, 0.26, 0.36), w), V(0.35, 0.5, 1).lerp(V(0.6, -1, -0.5), 1 - w), on);
      } else {
        // Straight out and up to the side.
        k.hand(p, s, swing(relaxedOff, V(0.43, 0.3, 0.1), w), V(0, -0.3, -1).lerp(V(0.6, -1, -0.5), 1 - w), on);
      }
    }
    return p;
  },
};

/* ─────────────────────────────────────────────────────────────────────────
 * Sprinkler: hand behind the head, the other arm out front; the torso ticks
 * across in five staccato beats, then sweeps back in one smooth pass.
 * ────────────────────────────────────────────────────────────────────── */
const SPRINKLER: MoveSpec = {
  duration: 3.9,
  face: "grin",
  build(k, t) {
    const p = k.pose();
    const on = envelope(t, this.duration);
    const TICK = 0.27;
    const t0 = 0.55;
    const n = 6;
    let turn: number;
    if (t < t0) turn = -1;
    else if (t < t0 + n * TICK) {
      const i = Math.floor((t - t0) / TICK);
      const f = (t - t0) / TICK - i;
      turn = -1 + (2 * (i + hit(f, 0, 0.45))) / n;
    } else turn = 1 - 2 * smooth(t, t0 + n * TICK + 0.05, t0 + n * TICK + 0.85);
    const tickPh = t > t0 && t < t0 + n * TICK ? ((t - t0) / TICK) % 1 : 0.5;
    const tick = t > t0 && t < t0 + n * TICK ? dip(tickPh) : 0;
    const yaw = 0.55 * turn * on; // +: towards the character's left
    k.foot(p, "Left", V(0.05 * on, 0, 0), { yaw: 0.15 * on });
    k.foot(p, "Right", V(-0.05 * on, 0, 0), { yaw: -0.15 * on });
    p.hips.y -= (0.015 + 0.02 * tick) * on;
    p.hips.x += 0.02 * turn * on;
    k.rot(p, "Hips", 0, yaw * 0.3, 0);
    k.rot(p, "Spine", 0.03 * on, yaw * 0.22, 0);
    k.rot(p, "Spine1", 0.03 * on, yaw * 0.24, 0);
    k.rot(p, "Spine2", 0.0, yaw * 0.24, -0.03 * on);
    k.rot(p, "Neck", 0.04 * tick * on, yaw * 0.15, 0);
    k.rot(p, "Head", (0.05 * tick - 0.03) * on, yaw * 0.2, 0.05 * on);
    // Left hand behind the head, elbow high and out.
    k.hand(p, "Left", V(-0.1, 0.27, -0.08), V(0.85, -0.15, -0.5), on * smooth(t, 0, 0.6), undefined, V(1, 0, 0));
    // Right arm straight out in front, slightly down, with a little flick on each tick.
    k.hand(p, "Right", V(-0.05, -0.03 + 0.03 * tick, 0.5), V(0.2, -1, -0.2), on, V(-0.3, -1, 0));
    return p;
  },
};

/* ─────────────────────────────────────────────────────────────────────────
 * Disco Point: right hand points high across, then low to the left hip;
 * hips pop to the side on each point; left hand on the hip.
 * ────────────────────────────────────────────────────────────────────── */
const DISCO_POINT: MoveSpec = {
  duration: 5.0,
  face: "grin",
  build(k, t) {
    const BEAT = 0.55;
    const p = k.pose();
    const on = envelope(t, this.duration);
    const b = Math.max(0, (t - 0.35) / BEAT);
    // up: 1 pointing high (even beats), 0 pointing low (odd beats). Snappy.
    const ph = b % 2;
    const up = ph < 1 ? hit(ph, 0, 0.42) : 1 - hit(ph - 1, 0, 0.42);
    const upK = THREE.MathUtils.clamp(up, 0, 1);
    const pop = upK * 2 - 1; // +1 up beat: hips out to the right; −1: hips left
    k.foot(p, "Left", V(0.05 * on, 0, 0.01), { yaw: 0.12 * on });
    k.foot(p, "Right", V(-0.06 * on, 0, 0.03 * on), { yaw: -0.25 * on, pitch: 0.4 * Math.max(0, -pop) * on });
    p.hips.x -= 0.045 * pop * on;
    p.hips.y -= (0.015 + 0.02 * dip(b)) * on;
    k.rot(p, "Hips", 0, 0.06 * pop * on, 0.08 * pop * on);
    k.spineChain(p, (lag) => [0.02 * on, (-0.18 * upK + 0.08) * on, -0.18 * pop * on + 0.02 * lag]);
    // Head follows the finger up, glances down with it.
    k.rot(p, "Head", (-0.2 * upK + 0.12 * (1 - upK)) * on, -0.2 * on, 0);
    k.rot(p, "Neck", (-0.1 * upK + 0.05 * (1 - upK)) * on, -0.08 * on, 0);
    // Pointing arm (right): high up and out / low across to the left hip.
    k.hand(p, "Right", swing(V(0.2, 0.45, 0.18), V(-0.27, -0.42, 0.25), 1 - upK), V(0.4, -1, -0.5).lerp(V(1, 0.1, -0.4), 1 - upK), on);
    // Left fist on the hip, elbow out.
    k.hand(p, "Left", V(0.0, -0.37, -0.02), V(1, 0, -0.4), on);
    return p;
  },
};

/* ─────────────────────────────────────────────────────────────────────────
 * The Robot: everything moves in clipped, held ticks with a tiny mechanical
 * overshoot. Arms at right angles, torso and head turning on separate counts.
 * ────────────────────────────────────────────────────────────────────── */
const THE_ROBOT: MoveSpec = {
  duration: 4.8,
  face: "cool",
  build(k, t) {
    const p = k.pose();
    const on = envelope(t, this.duration);
    const TICK = 0.3;
    // Each value holds, then snaps to the next in ~0.13s with a little mechanical ring.
    const snap = (keys: number[], t0: number) => {
      const x = Math.max(0, (t - t0) / TICK);
      const i = Math.min(keys.length - 1, Math.floor(x));
      const prev = keys[Math.max(0, i - 1)]!;
      const cur = keys[i]!;
      const f = (x - i) * TICK;
      const k1 = hit(f, 0, 0.13);
      const ring = Math.sin(f * 60) * Math.exp(-f * 30) * 0.08;
      return i === 0 ? cur : lerp(prev, cur, k1) + (cur - prev) * ring;
    };
    const turn = snap([0, 0, 1, 1, 0, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0.4);
    const look = snap([0, 0, 0, 1, 1, 0, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 0.4);
    const bob = snap([0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0], 0.4);
    k.foot(p, "Left", V(0.03 * on, 0, 0));
    k.foot(p, "Right", V(-0.03 * on, 0, 0));
    p.hips.y -= (0.01 + 0.02 * bob) * on;
    k.rot(p, "Hips", 0, 0.12 * turn * on, 0);
    k.rot(p, "Spine1", 0, 0.12 * turn * on, 0);
    k.rot(p, "Spine2", 0, 0.12 * turn * on, 0);
    k.rot(p, "Neck", 0, 0.25 * look * on, 0);
    k.rot(p, "Head", 0.03 * bob * on, 0.3 * look * on, 0);
    // Arm states: 0 hanging, 1 elbow at 90° forearm forward, 2 "goalpost" (upper arm out, forearm up),
    // 3 forearm out to the side. Each change snaps from the previous state straight to the next.
    const A = [V(0.02, -0.48, 0.05), V(0.0, -0.28, 0.26), V(0.28, 0.25, 0.02), V(0.24, -0.28, 0.08)];
    const P = [V(0.15, -1, -0.6), V(0.15, -1, -0.6), V(1, -0.5, 0), V(0.3, -1, -0.5)];
    const arm = (keys: number[]) => {
      const x = Math.max(0, (t - 0.4) / TICK);
      const i = Math.min(keys.length - 1, Math.floor(x));
      const from = keys[Math.max(0, i - 1)]!, to = keys[i]!;
      const kk = i === 0 ? 1 : smooth((x - i) * TICK, 0, 0.17);
      return { off: swing(A[from]!, A[to]!, kk), pole: P[from]!.clone().lerp(P[to]!, kk) };
    };
    const lA = arm([0, 1, 1, 1, 2, 2, 1, 1, 1, 3, 1, 1, 0, 0, 0, 0]);
    const rA = arm([0, 1, 1, 2, 2, 1, 1, 1, 3, 1, 1, 1, 0, 0, 0, 0]);
    k.hand(p, "Left", lA.off, lA.pole, on);
    k.hand(p, "Right", rA.off, rA.pole, on);
    return p;
  },
};

/* ─────────────────────────────────────────────────────────────────────────
 * The Floss: straight arms swing across the body, one in front and one
 * behind, swapping at each side while the hips swing the other way.
 * ────────────────────────────────────────────────────────────────────── */
const THE_FLOSS: MoveSpec = {
  duration: 4.6,
  face: "grin",
  build(k, t) {
    const BEAT = 0.36;
    const p = k.pose();
    const on = envelope(t, this.duration);
    const b = Math.max(0, (t - 0.3) / BEAT);
    // x: −1 hands at the character's right, +1 at the left.
    const x = -Math.cos(Math.PI * b);
    // Which hand is in front alternates per crossing.
    const crossing = Math.floor(b);
    const frontIsLeft = crossing % 2 === 0;
    const hipsX = -x; // hips swing opposite
    k.foot(p, "Left", V(0.04 * on, 0, 0), { yaw: 0.1 * on });
    k.foot(p, "Right", V(-0.04 * on, 0, 0), { yaw: -0.1 * on });
    p.hips.x += 0.1 * hipsX * on;
    p.hips.y -= (0.015 + 0.012 * (1 - Math.abs(x))) * on;
    k.rot(p, "Hips", 0, 0.12 * hipsX * on, -0.14 * hipsX * on);
    k.rot(p, "Spine", 0.02 * on, -0.06 * hipsX * on, 0.12 * hipsX * on);
    k.rot(p, "Spine1", 0.02 * on, -0.04 * hipsX * on, 0.08 * hipsX * on);
    k.rot(p, "Spine2", 0.0, -0.03 * hipsX * on, 0.04 * hipsX * on);
    k.rot(p, "Head", 0.03 * on, 0.1 * x * on, -0.06 * hipsX * on);
    // The hands sit at hip height; swap front/back where they are outside the hips.
    const hip = k.sk.world("Hips", p.local, p.hips).p;
    const edge = 1 - Math.abs(x); // 0 at the sides, 1 crossing the middle
    const span = 0.45;
    for (const { s, g } of SIDE) {
      const isFront = (s === "Left") === frontIsLeft;
      // Clear the hips/torso front and back well before the hands reach the middle,
      // so the forearms pass in front of / behind the body instead of through it.
      const z = (isFront ? 0.4 : -0.38) * smooth(edge, 0, 0.35);
      const target = V(hip.x + span * x + 0.1 * g, hip.y - 0.14 + 0.04 * Math.abs(x), hip.z + z);
      k.handAt(p, s, target, isFront ? V(g * 0.5, 0.1, 1) : V(g * 0.8, 0.1, -1), on);
    }
    return p;
  },
};

/* ─────────────────────────────────────────────────────────────────────────
 * Champion Spin: crouch and wind up, jump into a full turn with the arms
 * tucked, land soft, finish pointing at the sky.
 * ────────────────────────────────────────────────────────────────────── */
const CHAMPION_SPIN: MoveSpec = {
  duration: 4.4,
  face: "grin",
  build(k, t) {
    const p = k.pose();
    const on = envelope(t, this.duration);
    const T_OFF = 0.62;
    const AIR = 0.46;
    const T_LAND = T_OFF + AIR;
    const crouch = smooth(t, 0.1, 0.55) * (1 - smooth(t, 0.55, T_OFF)) + env(t, T_LAND - 0.02, T_LAND + 0.12, T_LAND + 0.18, T_LAND + 0.55) * 0.9;
    const airK = clamp01((t - T_OFF) / AIR);
    const inAir = t > T_OFF && t < T_LAND;
    const height = inAir ? 4 * 0.2 * airK * (1 - airK) : 0;
    const spin = TAU * smooth(airK, 0, 1);
    const pose = smooth(t, T_LAND + 0.35, T_LAND + 0.65) * (1 - smooth(t, 3.4, 4.0));
    p.hips.y += height - 0.12 * crouch - 0.012 * on;
    const yaw = Q().setFromAxisAngle(V(0, 1, 0), spin);
    p.local.set("Hips", yaw.clone().multiply(qe(0.08 * crouch, -0.1 * pose, 0)));
    // Feet: planted before and after; tucked under the hips (and turning with them) in the air.
    const tuck = inAir ? Math.sin(Math.PI * airK) : 0;
    for (const { s, g } of SIDE) {
      const rest = k.ankle[s].clone();
      if (inAir) {
        // Rest ankle relative to the (airborne) hips, rotated with them, pulled up.
        const rel = rest.clone().sub(k.hips0).applyQuaternion(yaw);
        const target = p.hips.clone().add(rel).add(V(0, 0.1 * tuck, 0));
        p.feet![s] = { target, pole: V(0.15 * g, 0, 1).applyQuaternion(yaw), rot: yaw.clone().multiply(qe(0.3 * tuck, 0, 0)) };
      } else {
        k.foot(p, s, V(0.03 * g * on, 0, 0), { yaw: 0.12 * g * on });
      }
    }
    k.spineChain(p, () => [0.1 * crouch, 0, 0]);
    k.rot(p, "Head", -0.12 * crouch - 0.2 * pose, 0.15 * pose, 0);
    // Wind up: arms swing back; air: tucked to the chest; finish: right hand to the sky, left on the hip.
    const wind = smooth(t, 0.1, 0.5) * (1 - smooth(t, 0.5, T_OFF));
    const tucked = smooth(t, T_OFF - 0.08, T_OFF + 0.08) * (1 - smooth(t, T_LAND - 0.05, T_LAND + 0.2));
    for (const { s } of SIDE) {
      const relaxed = V(0.02, -0.48, 0.02);
      const back = V(0.06, -0.4, -0.22);
      const chest = V(-0.12, -0.15, 0.22);
      let off = swing(swing(relaxed, back, wind), chest, tucked);
      let pole = V(0.4, -1, -0.6);
      if (s === "Right") {
        off = swing(off, V(0.12, 0.5, 0.12), pose);
        pole = pole.lerp(V(1, -0.3, -0.4), pose);
      } else {
        off = swing(off, V(0.0, -0.37, -0.02), pose);
        pole = pole.lerp(V(1, 0, -0.4), pose);
      }
      k.hand(p, s, off, pole, on);
    }
    return p;
  },
};

export const DANCES: Record<DanceId, MoveSpec> = {
  two_step: TWO_STEP,
  hype_clap: HYPE_CLAP,
  shoulder_shimmy: SHOULDER_SHIMMY,
  raise_the_roof: RAISE_THE_ROOF,
  the_dab: THE_DAB,
  sprinkler: SPRINKLER,
  disco_point: DISCO_POINT,
  the_robot: THE_ROBOT,
  the_floss: THE_FLOSS,
  champion_spin: CHAMPION_SPIN,
};

export const isDanceId = (id: string): id is DanceId => id in DANCES;

/** Builds one move's clip for this skeleton, or null if the rig is missing a bone it needs. */
export function buildDanceClip(id: DanceId, rest: Rest, parents: Parents): { clip: THREE.AnimationClip; face: DanceFace } | null {
  const need = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head"];
  for (const s of ["Left", "Right"]) need.push(`${s}Shoulder`, `${s}Arm`, `${s}ForeArm`, `${s}Hand`, `${s}UpLeg`, `${s}Leg`, `${s}Foot`);
  for (const b of need) if (!rest.has(b)) return null;
  const sk = new Skeleton(rest, parents);
  const kit = new Kit(sk, rest.get("Hips")!.clone());
  const spec = DANCES[id];
  return { clip: sample(sk, `dance_${id}`, spec.duration, 30, (t) => spec.build(kit, t)), face: spec.face };
}
