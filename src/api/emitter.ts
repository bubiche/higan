// Emitter scripting API — the authoring surface creators write against.
//
// The model is generator/coroutine emitters: an `EmitterScript` is a `function*`
// that fires bullets and `yield`s the number of ticks to wait. This maps 1:1 onto
// the fixed-timestep loop and keeps the dumb-data rule intact at any bullet count:
//
//   - Emitters are O(hundreds): each is resumed at most once per tick.
//   - A small opts literal per `fire/ring/fan/aimed` call (O(hundreds/frame)) is
//     fine; the loop inside then calls `system.spawn` with primitives per bullet
//     (O(tens-of-thousands/frame)) with ZERO per-bullet allocation.
//   - Per-bullet "behaviour" is a fixed numeric descriptor (see controllers.ts),
//     never a closure.
//
// DETERMINISM INVARIANT (enforced, not aspirational): generators are not
// serialized — backward-scrub and hot-reload re-run them from the seed. That only
// reproduces if every emitter's control flow is a pure function of
// (ctx.rng, ctx.tick, ctx.target). The handed-in context deliberately exposes NO
// clock and NO global RNG, so the only randomness is `ctx.rng` and the only time
// is `ctx.tick`. Emitter code must NOT branch on `Date.now`/`performance.now`,
// `Math.random`, or unstable Set/Map iteration order. The determinism guard is
// the tripwire (it re-checks on every hot-reload).

import type { BulletSystem } from "../bullets/system";
import { Behavior } from "../bullets/system";
import type { Rng } from "../core/prng";
import { Shape } from "../render/shapes";
import type { BulletBehavior } from "./controllers";
import { linear } from "./controllers";

export type Vec2 = { x: number; y: number };

/** Options common to every spawn call. Authoring is polar (speed + angle). */
interface SpawnOpts {
  /** Spawn position; defaults to the emitter position (ctx.x, ctx.y). */
  x?: number;
  y?: number;
  /** Speed in sim units/second. */
  speed: number;
  /** Draw/collision radius (half-size) in sim units. */
  radius?: number;
  /** Linear RGB tint, 0..1. Defaults to white. */
  color?: readonly [number, number, number];
  /** Atlas shape. Defaults to `Shape.Orb`. */
  sprite?: number;
  /** Per-bullet behaviour descriptor. Defaults to `linear`. */
  behavior?: BulletBehavior;
}

/** One bullet at an explicit heading. */
export interface FireOpts extends SpawnOpts {
  /** Heading in radians (0 = +x, CW in screen space). */
  angle: number;
}

/** `count` bullets spread evenly over a full circle. */
export interface RingOpts extends SpawnOpts {
  count: number;
  /** Phase offset of the first bullet, radians. Default 0. */
  angle?: number;
}

/** `count` bullets across an arc centred on `angle`, total width `spread`. */
export interface FanOpts extends SpawnOpts {
  count: number;
  /** Centre heading, radians. */
  angle: number;
  /** Total arc width, radians. */
  spread: number;
}

/** Bullets aimed at `ctx.target`; optional `count`/`spread` for an aimed fan. */
export interface AimedOpts extends SpawnOpts {
  count?: number;
  spread?: number;
}

export interface EmitterContext {
  /** Current sim tick. */
  readonly tick: number;
  /** The sim's seeded RNG — the ONLY randomness source available to emitters. */
  readonly rng: Rng;
  /** Emitter position (mutable — an emitter may move itself between yields). */
  x: number;
  y: number;
  /** The shared aim/home target (the player stand-in; input-derived). */
  readonly target: Readonly<Vec2>;
  fire(o: FireOpts): void;
  ring(o: RingOpts): void;
  fan(o: FanOpts): void;
  aimed(o: AimedOpts): void;
}

/**
 * An emitter: `ctx => function*`. `yield n` waits `n` ticks (clamped to >= 1, so
 * a generator can never spin forever within one tick).
 */
export type EmitterScript = (ctx: EmitterContext) => Generator<number, void, unknown>;

/** A named emitter for a scene to schedule (e.g. the showcase cycle). */
export interface ScenePattern {
  readonly name: string;
  readonly script: EmitterScript;
}

const WHITE: readonly [number, number, number] = [1, 1, 1];
const DEFAULT_RADIUS = 4;

/** A running emitter instance plus the bookkeeping the scheduler needs. */
export interface RunningEmitter {
  readonly ctx: EmitterContext;
  gen: Generator<number, void, unknown>;
  /** The tick at which this emitter is next due to resume. */
  resumeTick: number;
  done: boolean;
}

export interface EmitterDeps {
  readonly system: BulletSystem;
  readonly rng: Rng;
  /** Shared target the scheduler keeps current; `aimed`/home read it. */
  readonly target: Readonly<Vec2>;
}

function makeContext(deps: EmitterDeps): EmitterContext {
  const { system, rng, target } = deps;

  // Spawn one bullet from already-resolved primitives. Accelerate is the one
  // behaviour whose stored params depend on the launch angle: its acceleration is
  // precomputed into cartesian (bp0,bp1) HERE (trig paid at spawn, O(bullets
  // spawned)) so the per-frame update loop stays trig-free for it.
  const emit = (
    x: number,
    y: number,
    speed: number,
    angle: number,
    radius: number,
    color: readonly [number, number, number],
    sprite: number,
    beh: BulletBehavior,
  ): void => {
    let bp0 = beh.bp0;
    let bp1 = beh.bp1;
    if (beh.behavior === Behavior.Accelerate) {
      bp0 = Math.cos(angle) * beh.bp0;
      bp1 = Math.sin(angle) * beh.bp0;
    }
    system.spawn(
      x,
      y,
      Math.cos(angle) * speed,
      Math.sin(angle) * speed,
      angle,
      radius,
      color[0],
      color[1],
      color[2],
      sprite,
      beh.behavior,
      bp0,
      bp1,
    );
  };

  const ctx: EmitterContext = {
    tick: 0,
    rng,
    x: 0,
    y: 0,
    target,
    fire(o) {
      emit(
        o.x ?? ctx.x,
        o.y ?? ctx.y,
        o.speed,
        o.angle,
        o.radius ?? DEFAULT_RADIUS,
        o.color ?? WHITE,
        o.sprite ?? Shape.Orb,
        o.behavior ?? linear,
      );
    },
    ring(o) {
      const x = o.x ?? ctx.x;
      const y = o.y ?? ctx.y;
      const radius = o.radius ?? DEFAULT_RADIUS;
      const color = o.color ?? WHITE;
      const sprite = o.sprite ?? Shape.Orb;
      const beh = o.behavior ?? linear;
      const base = o.angle ?? 0;
      const step = (Math.PI * 2) / o.count;
      for (let i = 0; i < o.count; i++) {
        emit(x, y, o.speed, base + i * step, radius, color, sprite, beh);
      }
    },
    fan(o) {
      const x = o.x ?? ctx.x;
      const y = o.y ?? ctx.y;
      const radius = o.radius ?? DEFAULT_RADIUS;
      const color = o.color ?? WHITE;
      const sprite = o.sprite ?? Shape.Orb;
      const beh = o.behavior ?? linear;
      if (o.count <= 1) {
        emit(x, y, o.speed, o.angle, radius, color, sprite, beh);
        return;
      }
      const start = o.angle - o.spread / 2;
      const step = o.spread / (o.count - 1);
      for (let i = 0; i < o.count; i++) {
        emit(x, y, o.speed, start + i * step, radius, color, sprite, beh);
      }
    },
    aimed(o) {
      const x = o.x ?? ctx.x;
      const y = o.y ?? ctx.y;
      const aim = Math.atan2(target.y - y, target.x - x);
      const count = o.count ?? 1;
      const radius = o.radius ?? DEFAULT_RADIUS;
      const color = o.color ?? WHITE;
      const sprite = o.sprite ?? Shape.Orb;
      const beh = o.behavior ?? linear;
      if (count <= 1) {
        emit(x, y, o.speed, aim, radius, color, sprite, beh);
        return;
      }
      const spread = o.spread ?? 0;
      const start = aim - spread / 2;
      const step = spread / (count - 1);
      for (let i = 0; i < count; i++) {
        emit(x, y, o.speed, start + i * step, radius, color, sprite, beh);
      }
    },
  };
  return ctx;
}

/** Begin running `script` at (x, y). Resumes for the first time at `startTick`. */
export function startEmitter(
  script: EmitterScript,
  x: number,
  y: number,
  startTick: number,
  deps: EmitterDeps,
): RunningEmitter {
  const ctx = makeContext(deps);
  ctx.x = x;
  ctx.y = y;
  return { ctx, gen: script(ctx), resumeTick: startTick, done: false };
}

/** Resume `em` if it is due at `tick`. Updates `resumeTick` / `done`. */
export function stepEmitter(em: RunningEmitter, tick: number): void {
  if (em.done || tick < em.resumeTick) return;
  // ctx.tick is part of the context surface; refresh it before resuming.
  (em.ctx as { tick: number }).tick = tick;
  const r = em.gen.next();
  if (r.done) {
    em.done = true;
    return;
  }
  // Clamp the yielded wait to >= 1 tick (guards against `yield 0` spinning).
  const wait = r.value;
  em.resumeTick = tick + (wait >= 1 ? Math.floor(wait) : 1);
}
