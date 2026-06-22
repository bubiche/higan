// Determinism guard.
//
// Determinism is a v1 requirement, not a nice-to-have (replays depend on it), so
// it's checked continuously rather than trusted. `assertDeterministic` runs the
// same seed + input stream through two fresh simulations and asserts their state
// hashes are bit-identical. Wired into dev boot, it trips on every reload the
// moment any nondeterminism creeps into the update path.
//
// It is deliberately pure (no DOM, no clock) so it can graduate into a headless
// test later with zero changes.

import { createSimulation } from "./sim";
import type { ScenePattern } from "../api/emitter";
import type { BossScript } from "../api/boss";
import type { InputFrame } from "./input";

export interface DeterminismResult {
  readonly ok: boolean;
  readonly hashA: number;
  readonly hashB: number;
  readonly ticks: number;
}

/**
 * Run `inputs` through two fresh sims from `seed` (driving the same `patterns`)
 * and compare TRAJECTORY hashes. Patterns are passed in — not defaulted — so the
 * guard exercises the real scene the demo runs, and the core stays pattern-
 * agnostic.
 *
 * The fingerprint folds every tick's state hash, not just the final frame. The
 * scene clears bullets between patterns, so a final-frame-only hash would only
 * cover the last pattern alive — nondeterminism in an earlier pattern (e.g. a
 * stray `Math.random` whose bullets are cleared before the end) would slip
 * through. Folding the whole trajectory closes that blind spot.
 *
 * Pass `boss` to drive a boss scene instead of the pattern cycle, so the guard
 * exercises the multi-emitter scheduler + child-spawn + retarget (the new machinery).
 */
export function checkDeterministic(
  seed: number,
  inputs: readonly InputFrame[],
  dt: number,
  patterns: readonly ScenePattern[],
  boss?: BossScript,
): DeterminismResult {
  const run = (): number => {
    const sim = createSimulation(seed, dt, patterns, undefined, boss);
    let acc = 0x811c9dc5;
    for (let i = 0; i < inputs.length; i++) {
      sim.step(inputs[i]!);
      acc = Math.imul(acc ^ sim.hash(), 0x01000193) >>> 0;
    }
    return acc;
  };
  const hashA = run();
  const hashB = run();
  return { ok: hashA === hashB, hashA, hashB, ticks: inputs.length };
}

/** As `checkDeterministic`, but throws on divergence. */
export function assertDeterministic(
  seed: number,
  inputs: readonly InputFrame[],
  dt: number,
  patterns: readonly ScenePattern[],
  boss?: BossScript,
): DeterminismResult {
  const result = checkDeterministic(seed, inputs, dt, patterns, boss);
  if (!result.ok) {
    throw new Error(
      `Determinism check FAILED: hash ${result.hashA} !== ${result.hashB} ` +
        `after ${result.ticks} ticks (seed ${seed}).`,
    );
  }
  return result;
}
