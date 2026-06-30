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
import type { BossScript } from "./boss";
import type { Rng } from "../core/prng";
import type { ItemDropTable } from "../touhou/item";

/**
 * An enemy's authored stats — the hittable-target content (like a character's
 * shot). Position + behaviour come from the spawn call and the enemy's emitter
 * script; this is just hp + the collision/draw shape.
 */
export interface EnemySpec {
  /** Starting (and max) hit points; player shots drain it, 0 = death. */
  readonly hp: number;
  /** Collision + draw radius, sim units. */
  readonly radius: number;
  /** Shape atlas layer (render-only). */
  readonly sprite: number;
  /** Linear RGB tint, 0..1 (render-only). */
  readonly color: readonly [number, number, number];
  /** Items dropped when the enemy is SHOT DOWN (not when it flies off or culls).
   *  Just counts per type; the per-type look is engine-owned (genre convention). */
  readonly drops?: ItemDropTable;
}

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
   * Spawn an enemy at (x, y) running `script` as its behaviour, on the (enemy)
   * stream. The enemy is a hittable target — player shots drain `spec.hp`, and it
   * dies at 0 — while its `script` is an ordinary emitter coroutine that moves the
   * enemy (via `ctx.x/y`) and fires its danmaku. It lives until the script returns,
   * its hp hits 0, or it leaves the field.
   *
   * Stage-surface ONLY (deliberately not on `EmitterContext`): an enemy can be
   * spawned only on the enemy stream, never accidentally onto the protected boss
   * stream. A wave is authored as this stage coroutine directing spawns over time.
   */
  spawnEnemy(script: EmitterScript, x: number, y: number, spec: EnemySpec): void;
  /**
   * Run a boss encounter: spawn it on the dedicated (protected) boss stream and yield
   * until it ends — beaten (its phases drain to 0) or its coroutine returns. `yield*`
   * it from the stage, so the stage PAUSES on the boss and resumes the next wave when
   * it falls. A midboss is just a boss the stage runs before the end; the stage script
   * decides the ordering, and the run's in-stage phase ends when the *stage* returns
   * (after its last `yield* ctx.boss()`), not when any single boss is beaten.
   *
   * With no `script`, runs the stage's headline `boss` (`StageDef.boss`) — kept a named
   * field so it can be hot-reloaded by name; pass a script for a midboss or any extra
   * encounter. Resolves immediately (a no-op) if no boss resolves.
   */
  boss(script?: BossScript): Generator<number, void, unknown>;
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
  /** Spawn an enemy bound to a struct slot on the enemy stream (sim-implemented). */
  spawnEnemy(script: EmitterScript, x: number, y: number, spec: EnemySpec): void;
  /** Spawn a boss on the boss stream and return its root (or null if none resolves —
   *  `script` omitted AND the `StageDef` has no boss). The sim tracks it for HP-drain /
   *  defeat; the stage awaits its `done` via `boss()`. */
  spawnBoss(script?: BossScript): RunningEmitter | null;
}

/** Run one boss encounter to its end: spawn it on the boss stream, then poll its root
 *  once per tick until the boss coroutine returns (beaten or out of phases). Makes no
 *  rng draws of its own, so awaiting a boss never perturbs the enemy stream. */
function* runBossEncounter(
  deps: StageDeps,
  script: BossScript | undefined,
): Generator<number, void, unknown> {
  const root = deps.spawnBoss(script);
  if (!root) return;
  while (!root.done) yield 1;
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
    spawnEnemy(script, ex, ey, spec) {
      deps.spawnEnemy(script, ex, ey, spec);
    },
    boss(script) {
      return runBossEncounter(deps, script);
    },
  };
  return { ctx, gen: script(ctx), resumeTick: startTick, done: false, group: 0 };
}
