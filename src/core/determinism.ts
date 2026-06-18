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
import type { InputFrame } from "./input";

export interface DeterminismResult {
  readonly ok: boolean;
  readonly hashA: number;
  readonly hashB: number;
  readonly ticks: number;
}

/** Run `inputs` through two fresh sims from `seed` and compare final hashes. */
export function checkDeterministic(
  seed: number,
  inputs: readonly InputFrame[],
  dt: number,
): DeterminismResult {
  const run = (): number => {
    const sim = createSimulation(seed, dt);
    for (let i = 0; i < inputs.length; i++) sim.step(inputs[i]!);
    return sim.hash();
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
): DeterminismResult {
  const result = checkDeterministic(seed, inputs, dt);
  if (!result.ok) {
    throw new Error(
      `Determinism check FAILED: hash ${result.hashA} !== ${result.hashB} ` +
        `after ${result.ticks} ticks (seed ${seed}).`,
    );
  }
  return result;
}
