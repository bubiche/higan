// Staged motion — the dumb-data layer for a bullet that runs a *timeline* of moves.
//
// Most bullets have one behaviour for life (see system.ts). A staged bullet instead
// follows a `StagedProgram`: a list of timed segments, each with an optional one-shot
// entry edit (re-aim / re-speed) and a continuous motion that runs until the next
// segment begins. It is the SoA-faithful version of Danmakufu's `ObjMove_AddPattern`
// family — scheduled changes layered on an object that is already moving.
//
// The dumb-data rule (Hard Rule 1) is kept the same way the rest of the store is: the
// program is SHARED reference data (one per authored structure, interned in the bullet
// system), and the per-bullet state is just two integers already in the store — which
// program (`bp0`) and which segment (`bp1`). No per-bullet objects, no closures. This
// module owns the program shape, its construction from the authoring segments, and the
// single function that applies a segment's entry edit to a bullet slot.
//
// Layering: this is below `api`, so it must not import from `api`. The motion a segment
// carries is typed structurally (`StagedMotion`) rather than importing the api-layer
// `BulletBehavior`; a behaviour helper (linear/ramp/curve/home) satisfies it by shape.

import { Behavior } from "./system";
import type { BulletStore } from "./store";

// Entry-edit "kind" codes packed into the program. Speed and angle each have at most
// one source per segment (validated in `normalizeStaged`); these say which.
const SPEED_NONE = 0;
const SPEED_SET = 1;
const SPEED_ADD = 2;
const ANGLE_NONE = 0;
const ANGLE_SET = 1;
const ANGLE_ADD = 2;
const ANGLE_AIM = 3;

/** Largest cumulative start tick a program may schedule (the `startTick` lane is
 *  Uint16). ~65535 ticks ≈ 18 minutes before a segment begins — a non-issue. */
const MAX_START_TICK = 0xffff;

/**
 * The shape a segment's `motion` value must have — structurally a `BulletBehavior`
 * (the api-layer behaviour descriptor). Named here so the bullets layer needn't import
 * `api`; authors pass a behaviour helper (`linear`/`ramp`/`curve`/`home`) directly.
 */
export interface StagedMotion {
  readonly behavior: number;
  readonly bp0: number;
  readonly bp1: number;
}

/**
 * A one-shot edit applied the moment a segment begins. At most ONE speed source
 * (`speed` xor `addSpeed`) and at most ONE angle source (`angle` xor `addAngle` xor
 * `aimPlayer`) — enforced at authoring time.
 */
export interface StagedEdit {
  /** Set speed to this absolute value (sim units/s). */
  readonly speed?: number;
  /** Add this to the current speed. */
  readonly addSpeed?: number;
  /** Set heading to this absolute angle (radians). */
  readonly angle?: number;
  /** Turn the heading by this many radians. */
  readonly addAngle?: number;
  /** Set heading toward the shared target (the player) NOW — a one-shot aim, not
   *  continuous tracking (that is `home`). */
  readonly aimPlayer?: boolean;
}

/**
 * One segment of a staged timeline: how long it lasts, an optional entry edit, and the
 * continuous motion that runs during it.
 */
export interface StagedSegment {
  /** Ticks this segment lasts before the next begins. Required on every segment EXCEPT
   *  the last (which runs forever); must be an integer >= 1. `ticks: N` means the next
   *  segment's edit fires on the Nth update after spawn — the same convention as
   *  `delay(N)`. */
  readonly ticks?: number;
  /** Entry edit applied when this segment begins. NOT allowed on segment 0 — segment 0's
   *  motion is the launch; set its initial speed/heading via the spawn call. */
  readonly set?: StagedEdit;
  /** Continuous motion during this segment. Default `linear`. One of
   *  `linear`/`ramp`/`curve`/`home` (cartesian `accelerate` and the age-based
   *  `delay`/`wave` are rejected — they don't compose with absolute-tick segments). */
  readonly motion?: StagedMotion;
}

/**
 * A normalized staged program — shared, immutable reference data the update loop reads.
 * One per distinct authored structure (interned by `key` in the bullet system), pointed
 * at by any number of bullets via their `bp0`. Lanes are parallel arrays indexed by
 * segment; this is reference data, not the hot SoA, so the packing is for clarity and
 * cache-friendliness, not the 30k-bullet floor.
 */
export interface StagedProgram {
  /** Number of segments. */
  readonly count: number;
  /** Absolute start tick per segment. `[0] = 0`, strictly increasing. */
  readonly startTick: Uint16Array;
  /** Speed-edit kind per segment: 0 none | 1 set | 2 add. */
  readonly speedKind: Uint8Array;
  /** Speed-edit value (meaning depends on `speedKind`). */
  readonly editSpeed: Float32Array;
  /** Angle-edit kind per segment: 0 none | 1 set | 2 add | 3 aim-player. */
  readonly angleKind: Uint8Array;
  /** Angle-edit value (radians; unused for aim-player). */
  readonly editAngle: Float32Array;
  /** Continuous motion per segment: a `Behavior` id (Linear/Ramp/Home). */
  readonly motion: Uint8Array;
  /** Motion params per segment (Ramp: dSpeed/s, dAngle rad/s; Home: turnRate rad/s). */
  readonly motP0: Float32Array;
  readonly motP1: Float32Array;
  /** Structural interning key (cached). Two structurally-identical programs share it,
   *  so the system assigns them the same id — which is load-bearing, because the id is
   *  stored in `bp0` and `bp0` is folded into the determinism hash. */
  readonly key: string;
}

/**
 * Build the structural interning key: an explicit join of the numeric lanes (NOT
 * `JSON.stringify` over the typed arrays). The hashed `programId` depends on this being
 * a stable, intentional function of the structure, so we read the post-normalization
 * (float32-truncated) values back and join them with field + segment separators.
 */
function buildKey(prog: Omit<StagedProgram, "key">): string {
  const parts: string[] = [String(prog.count)];
  for (let s = 0; s < prog.count; s++) {
    parts.push(
      `${prog.startTick[s]}:${prog.speedKind[s]}:${prog.editSpeed[s]}:` +
        `${prog.angleKind[s]}:${prog.editAngle[s]}:` +
        `${prog.motion[s]}:${prog.motP0[s]}:${prog.motP1[s]}`,
    );
  }
  return parts.join("|");
}

/**
 * Validate and normalize an authored segment list into a `StagedProgram`. Throws on a
 * malformed program so authoring mistakes surface at hot-reload (fail-fast DX), never as
 * a silent wrong trajectory. See `StagedSegment` for the rules.
 */
export function normalizeStaged(segments: readonly StagedSegment[]): StagedProgram {
  if (!Array.isArray(segments) || segments.length < 1) {
    throw new Error("staged(): needs at least one segment.");
  }
  const count = segments.length;
  const startTick = new Uint16Array(count);
  const speedKind = new Uint8Array(count);
  const editSpeed = new Float32Array(count);
  const angleKind = new Uint8Array(count);
  const editAngle = new Float32Array(count);
  const motion = new Uint8Array(count);
  const motP0 = new Float32Array(count);
  const motP1 = new Float32Array(count);

  let acc = 0; // running cumulative start tick
  for (let s = 0; s < count; s++) {
    const seg = segments[s];
    const isLast = s === count - 1;

    // Absolute start tick. The first segment starts at spawn; each subsequent one
    // starts `ticks` after the previous (so the edit fires on the Nth update — the
    // delay convention).
    startTick[s] = acc;
    if (!isLast) {
      const t = seg.ticks;
      if (t === undefined || !Number.isInteger(t) || t < 1) {
        throw new Error(
          `staged(): segment ${s} needs an integer ticks >= 1 (only the last segment may omit ticks).`,
        );
      }
      acc += t;
      if (acc > MAX_START_TICK) {
        throw new Error(`staged(): cumulative ticks exceed ${MAX_START_TICK}.`);
      }
    }

    // Entry edit. Segment 0's "edit" is the launch itself, so it takes no `set`.
    if (s === 0) {
      if (seg.set !== undefined) {
        throw new Error(
          "staged(): segment 0 takes no `set` — set its initial speed/angle via the spawn call's speed/angle.",
        );
      }
    } else if (seg.set !== undefined) {
      const e = seg.set;
      const hasSpeed = e.speed !== undefined;
      const hasAddSpeed = e.addSpeed !== undefined;
      if (hasSpeed && hasAddSpeed) {
        throw new Error(`staged(): segment ${s} set has both speed and addSpeed (pick one).`);
      }
      if (hasSpeed) {
        speedKind[s] = SPEED_SET;
        editSpeed[s] = e.speed as number;
      } else if (hasAddSpeed) {
        speedKind[s] = SPEED_ADD;
        editSpeed[s] = e.addSpeed as number;
      }
      const angleSources =
        (e.angle !== undefined ? 1 : 0) + (e.addAngle !== undefined ? 1 : 0) + (e.aimPlayer ? 1 : 0);
      if (angleSources > 1) {
        throw new Error(
          `staged(): segment ${s} set has more than one angle source (pick one of angle / addAngle / aimPlayer).`,
        );
      }
      if (e.angle !== undefined) {
        angleKind[s] = ANGLE_SET;
        editAngle[s] = e.angle;
      } else if (e.addAngle !== undefined) {
        angleKind[s] = ANGLE_ADD;
        editAngle[s] = e.addAngle;
      } else if (e.aimPlayer) {
        angleKind[s] = ANGLE_AIM;
      }
    }

    // Continuous motion. Default linear; only the age-free polar behaviours compose
    // with absolute-tick segments (see the module note + the staged spec).
    const m = seg.motion;
    if (m === undefined || m.behavior === Behavior.Linear) {
      motion[s] = Behavior.Linear;
    } else if (m.behavior === Behavior.Ramp || m.behavior === Behavior.Home) {
      motion[s] = m.behavior;
      motP0[s] = m.bp0;
      motP1[s] = m.bp1;
    } else {
      throw new Error(
        `staged(): segment ${s} motion must be linear/ramp/curve/home — accelerate/delay/wave don't compose with staged segments.`,
      );
    }
  }

  const base = { count, startTick, speedKind, editSpeed, angleKind, editAngle, motion, motP0, motP1 };
  return { ...base, key: buildKey(base) };
}

/**
 * Apply a segment's one-shot entry edit to bullet slot `i` — the single source of truth
 * for staged edits, called by the update loop when a bullet advances into a segment.
 * Recomputes the bullet's polar state from `(vx, vy, angle)`, applies the speed edit then
 * the angle edit, and writes `(vx, vy, angle)` back. A segment with no edit (motion-only)
 * is a no-op, so continuous motion hands off untouched.
 */
export function applyStagedEdit(
  store: BulletStore,
  i: number,
  prog: StagedProgram,
  seg: number,
  targetX: number,
  targetY: number,
): void {
  const sk = prog.speedKind[seg];
  const ak = prog.angleKind[seg];
  if (sk === SPEED_NONE && ak === ANGLE_NONE) return; // motion-only segment: no entry edit

  const { vx, vy, angle, x, y } = store;
  let sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
  let an = angle[i];

  if (sk === SPEED_SET) sp = prog.editSpeed[seg];
  else if (sk === SPEED_ADD) sp = sp + prog.editSpeed[seg];

  if (ak === ANGLE_SET) an = prog.editAngle[seg];
  else if (ak === ANGLE_ADD) an = an + prog.editAngle[seg];
  else if (ak === ANGLE_AIM) an = Math.atan2(targetY - y[i], targetX - x[i]);

  vx[i] = Math.cos(an) * sp;
  vy[i] = Math.sin(an) * sp;
  angle[i] = an;
}
