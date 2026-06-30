// Determinism guard.
//
// Determinism is a v1 requirement, not a nice-to-have (replays depend on it), so
// it's checked continuously rather than trusted. `assertDeterministic` runs the
// same stage + seed + input stream through two fresh simulations and asserts their
// state hashes are bit-identical. Wired into dev boot, it trips on every reload the
// moment any nondeterminism creeps into the update path.
//
// It is deliberately pure (no DOM, no clock) so it can graduate into a headless
// test later with zero changes.

import { createStageSim } from "./sim";
import type { StageDef, CharacterDef } from "../api/game";
import type { RunConfig } from "../api/config";
import type { InputFrame } from "./input";

export interface DeterminismResult {
  readonly ok: boolean;
  readonly hashA: number;
  readonly hashB: number;
  readonly ticks: number;
}

/**
 * Run `inputs` through two fresh stage sims from `stageSeed` (driving the same
 * `stageDef` for the given `character`) and compare TRAJECTORY hashes. The stage +
 * character are passed in — not defaulted — so the guard exercises the real scene
 * the game runs, and the core stays content-agnostic.
 *
 * The fingerprint folds every tick's state hash, not just the final frame. The boss
 * clears bullets between phases, so a final-frame-only hash would only cover the
 * last phase alive — nondeterminism in an earlier phase (e.g. a stray `Math.random`
 * whose bullets are cleared before the end) would slip through. Folding the whole
 * trajectory closes that blind spot.
 */
export function checkDeterministic(
  stageDef: StageDef,
  stageSeed: number,
  inputs: readonly InputFrame[],
  dt: number,
  character: CharacterDef,
  runConfig: RunConfig,
): DeterminismResult {
  const run = (): number => {
    const sim = createStageSim(stageDef, stageSeed, character, runConfig, dt);
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
  stageDef: StageDef,
  stageSeed: number,
  inputs: readonly InputFrame[],
  dt: number,
  character: CharacterDef,
  runConfig: RunConfig,
): DeterminismResult {
  const result = checkDeterministic(stageDef, stageSeed, inputs, dt, character, runConfig);
  if (!result.ok) {
    throw new Error(
      `Determinism check FAILED: hash ${result.hashA} !== ${result.hashB} ` +
        `after ${result.ticks} ticks (stage ${stageDef.id}, seed ${stageSeed}).`,
    );
  }
  return result;
}
