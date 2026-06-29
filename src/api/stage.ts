// Stage authoring surface — the scene's top-level coroutine.
//
// A stage is the root of the scene: a single coroutine (O(1)) that orchestrates a
// whole stage over time — `sub`-spawning emitters, and (when its time comes) the
// boss — in exactly the boss/emitter idiom. It is NOT "an enemy pool beside the
// boss": the stage script IS the scene, and the boss is something the stage spawns
// partway through (after the waves + midboss, in a full stage). So the sim's scene
// dispatch is rooted here, and the boss becomes a mid-run child rather than the
// privileged whole-scene root it used to be.
//
// The coroutine-purity invariant extends unchanged (api/index.ts): a stage script
// must be a pure function of (its stream's rng, tick, target). It runs on the ENEMY
// stream — the play-dependent stream that enemy danmaku also rides — so wave timing
// can use rng without touching the protected boss stream. The boss, when spawned,
// branches onto its own dedicated stream (the sim injects it); the stage root does
// not hand its stream down to the boss.

import type { EmitterScript, RunningEmitter, Vec2 } from "./emitter";
import type { Rng } from "../core/prng";

export interface StageContext {
  /** Current sim tick. */
  readonly tick: number;
  /** The stage's seeded RNG (the enemy stream) — the only randomness source, same
   *  rule as emitters/boss. Used for wave timing/composition; never the boss stream. */
  readonly rng: Rng;
  /** Stage-root position; `sub`-spawned children start here. (Mostly irrelevant —
   *  enemies/the boss carry their own origins — but it satisfies the scheduler.) */
  x: number;
  y: number;
  /** The shared aim target (the player). */
  readonly target: Readonly<Vec2>;
  /**
   * Spawn an emitter child at the stage position, on the stage's (enemy) stream.
   * Resumes next tick (no same-tick re-entrancy), exactly like an emitter's `sub`.
   */
  sub(script: EmitterScript): void;
  /**
   * Spawn the stage's boss (the `boss` on its `StageDef`). The sim creates it on the
   * dedicated boss stream and tracks it for HP-drain / defeat detection. A no-op if
   * the stage defines no boss. Call it when the pre-boss content is done.
   */
  spawnBoss(): void;
}

/** A stage: `ctx => function*`. `yield n` waits n ticks; the stage drives the
 *  whole scene and ends when its content is done. */
export type StageScript = (ctx: StageContext) => Generator<number, void, unknown>;

/**
 * The hooks the sim provides so a stage coroutine can drive the scene against
 * sim-owned state (the scheduler array, the boss). The sim implements these; the
 * coroutine only calls them.
 */
export interface StageDeps {
  /** The stage's (enemy) stream. */
  readonly rng: Rng;
  readonly target: Readonly<Vec2>;
  /** Append an emitter child to the scheduler on `rng` (the stage's stream). */
  spawnChild(script: EmitterScript, x: number, y: number, group: number, rng: Rng): void;
  /** Spawn the stage's boss on the boss stream (sim-implemented). */
  spawnBoss(): void;
}

/** Begin running `script` at (x, y) as the scene's group-0 root. Resumes first at
 *  `startTick`. */
export function startStage(
  script: StageScript,
  x: number,
  y: number,
  startTick: number,
  deps: StageDeps,
): RunningEmitter {
  const ctx: StageContext = {
    tick: 0,
    rng: deps.rng,
    x,
    y,
    target: deps.target,
    sub(child) {
      deps.spawnChild(child, ctx.x, ctx.y, 0, deps.rng);
    },
    spawnBoss() {
      deps.spawnBoss();
    },
  };
  return { ctx, gen: script(ctx), resumeTick: startTick, done: false, group: 0 };
}
