// Controllers — per-bullet behaviour descriptors.
//
// A "controller" here is NOT a script and NOT a handle to a list of bullets: it
// is a small fixed-size descriptor (`behavior` id + two numeric params) that the
// bullet system's update loop interprets (see bullets/system.ts). This keeps the
// dumb-data rule intact — no per-bullet closures, no slot-list controllers — and
// sidesteps the slot-reuse hazard entirely (nothing holds a slot index).
//
// `home` reads the sim's single shared target each frame, so it needs no per-bullet
// target and no group handle. Live-group-retarget (reaching into already-flying
// bullets of a past wave) is the one feature that would need slot-list controllers;
// it is deferred behind per-slot generation stamps and not built here.
//
// Authors pass these to a spawn call's `behavior` option:
//   ctx.ring({ count: 24, speed: 90, behavior: accelerate(120) })

import { Behavior } from "../bullets/system";

/**
 * A per-bullet behaviour: which update branch runs, plus its two params. The
 * meaning of `bp0`/`bp1` depends on `behavior` (see the helpers below). For
 * `accelerate`, `bp0` carries the scalar magnitude at authoring time and is
 * converted to a cartesian vector at spawn (trig paid once, off the hot loop).
 */
export interface BulletBehavior {
  readonly behavior: number;
  readonly bp0: number;
  readonly bp1: number;
}

/** Constant velocity — the default. */
export const linear: BulletBehavior = { behavior: Behavior.Linear, bp0: 0, bp1: 0 };

/**
 * Constant acceleration of `magnitude` (sim units/s²) along the launch heading.
 * Direction never changes, so the per-frame cost is a bare add (the cartesian
 * acceleration is precomputed at spawn).
 */
export function accelerate(magnitude: number): BulletBehavior {
  return { behavior: Behavior.Accelerate, bp0: magnitude, bp1: 0 };
}

/**
 * Ramp speed by `dSpeed` (units/s, per second) and turn the heading by `dAngle`
 * (radians/second). Either may be 0. This is the curving/accelerating-spiral feel.
 */
export function ramp(dSpeed: number, dAngle: number): BulletBehavior {
  return { behavior: Behavior.Ramp, bp0: dSpeed, bp1: dAngle };
}

/**
 * Steer toward the shared target, turning at up to `turnRate` (radians/second)
 * while keeping speed. A low rate gives a lazy curve; a high rate snaps to aim.
 */
export function home(turnRate: number): BulletBehavior {
  return { behavior: Behavior.Home, bp0: turnRate, bp1: 0 };
}

/**
 * Hang motionless at the spawn point for `ticks` fixed steps, then launch along
 * the spawn heading at the spawn call's `speed` — the classic "appear, pause,
 * snap". After launching it is an ordinary linear bullet. The launch speed is the
 * spawn `speed`, so don't pass it here; `bp1` is filled in at spawn.
 */
export function delay(ticks: number): BulletBehavior {
  return { behavior: Behavior.Delay, bp0: ticks, bp1: 0 };
}

/**
 * Snake: weave side to side by up to `amplitude` (sim units) perpendicular to the
 * heading, oscillating at `frequency` (radians/second), while still travelling
 * forward at the spawn `speed`. A tight, fast stream of these reads as a curvy
 * "fake laser".
 */
export function wave(amplitude: number, frequency: number): BulletBehavior {
  return { behavior: Behavior.Wave, bp0: amplitude, bp1: frequency };
}
