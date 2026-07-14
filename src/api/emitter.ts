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
import { sin, cos, atan2 } from "../core/trig";
import { Shape } from "../render/shapes";
import type { LaserSystem } from "../touhou/laser";
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

/**
 * A straight beam laser fired from the emitter. Unlike a bullet, a laser persists
 * for its own telegraph→fire→fade lifecycle; the emitter fires it once and the
 * sim owns it from there. Spawned at the emitter position (or an explicit x/y).
 */
export interface LaserOpts {
  /** Beam origin; defaults to the emitter position (ctx.x, ctx.y). */
  x?: number;
  y?: number;
  /** Heading in radians (0 = +x). */
  angle: number;
  /** Beam length in sim units. */
  length: number;
  /** Fired beam width (full thickness) in sim units. Default 12. */
  width?: number;
  /** Linear RGB tint, 0..1. Defaults to white. */
  color?: readonly [number, number, number];
  /** Warning-line phase length in ticks before the beam fires. Default 36. */
  telegraph?: number;
  /** Fired phase length in ticks; the beam vanishes after it. Default 90. */
  duration?: number;
  /** Sweep rate in radians/second about the origin. Default 0 (static). */
  spin?: number;
}

/**
 * A handle to a wave of already-spawned bullets, so an emitter can reach back into
 * them and rewrite their course while they fly (a "slot-list controller", which the
 * per-bullet behaviour descriptors deliberately can't express). Safe because each
 * slot is tagged with a generation stamp at spawn: if a bullet was culled and its
 * slot recycled by an unrelated bullet, the stamp no longer matches and that slot
 * is skipped — so a retarget can never hijack the wrong bullet.
 */
export interface BulletGroup {
  /**
   * Re-aim every still-living original bullet toward `(tx, ty)` at `speed`,
   * rewriting velocity + draw heading. Culled or recycled slots are skipped.
   * Returns how many bullets were actually retargeted.
   */
  retarget(tx: number, ty: number, speed: number): number;
}

export interface EmitterContext {
  /** Current sim tick. */
  readonly tick: number;
  /** The sim's seeded RNG — the ONLY randomness source available to emitters. */
  readonly rng: Rng;
  /** The run's difficulty rank — a 0-based index into the game's difficulties (higher
   *  = harder). Construction input the content branches on to scale its own density/HP;
   *  NOT folded into the hash. Like the seed, it SHAPES the deterministic trajectory
   *  rather than being part of it, so each rank is independently reproducible. */
  readonly difficulty: number;
  /** Emitter position (mutable — an emitter may move itself between yields). */
  x: number;
  y: number;
  /** The shared aim/home target (the player stand-in; input-derived). */
  readonly target: Readonly<Vec2>;
  /** The phase/group this emitter belongs to; children spawned via `sub` inherit it. */
  readonly group: number;
  fire(o: FireOpts): void;
  ring(o: RingOpts): void;
  fan(o: FanOpts): void;
  aimed(o: AimedOpts): void;
  laser(o: LaserOpts): void;
  /**
   * Spawn a child emitter at this emitter's position, in the same group (so a phase
   * transition clears parent and children together). The child is appended in call
   * order and first resumes NEXT tick — no same-tick re-entrancy, which keeps the
   * mid-iteration ordering deterministic. This is what makes a boss an
   * emitter-of-emitters without breaking the dumb-data rule.
   */
  sub(script: EmitterScript): void;
  /**
   * Spawn a ring of bullets (like `ring`) and return a `BulletGroup` handle to them,
   * so a later call can `retarget` the survivors — the one safe way to redirect an
   * already-flying wave. Use it when a spell must reach back into bullets it fired.
   */
  spawnGroup(o: RingOpts): BulletGroup;
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

/**
 * The slice of a context the scheduler itself touches: it refreshes `tick` on each
 * resume, and the scene may reposition a root via `x`/`y`. Both `EmitterContext`
 * and the boss context (api/boss.ts) satisfy this, so the scheduler array can hold
 * either kind of root without importing the boss layer (no cycle).
 */
export interface SchedulableContext {
  x: number;
  y: number;
  tick: number;
}

/** A running emitter instance plus the bookkeeping the scheduler needs. */
export interface RunningEmitter {
  readonly ctx: SchedulableContext;
  gen: Generator<number, void, unknown>;
  /** The tick at which this emitter is next due to resume. */
  resumeTick: number;
  done: boolean;
  /** Phase/group tag; the emitters of one phase share it so a transition can clear
   *  them as a unit. 0 = ungrouped (the scene/boss root). */
  group: number;
}

export interface EmitterDeps {
  readonly system: BulletSystem;
  readonly lasers: LaserSystem;
  /** Shared target the scheduler keeps current; `aimed`/home read it. */
  readonly target: Readonly<Vec2>;
  /** The run's difficulty rank, surfaced to every emitter as `ctx.difficulty`. */
  readonly difficulty: number;
  /**
   * Append a child emitter to the scheduler, resuming next tick, tagged `group`,
   * running on `rng`. Provided by the sim (which owns the scheduler array). The
   * caller passes its OWN stream so a child inherits the parent's RNG stream (boss
   * children draw from the boss stream, enemy children from the enemy stream) — the
   * one randomness source is no longer global, it flows down the spawn tree.
   */
  spawnChild(script: EmitterScript, x: number, y: number, group: number, rng: Rng): void;
  /**
   * Presentation-only fire notice: called once per bullet-spawning call
   * (`fire`/`ring`/`fan`/`aimed`/`spawnGroup`), NOT per bullet, with the emitter's x for
   * stereo pan. The sim binds this to an "enemy shoot" SFX event; it consumes zero RNG and
   * touches no hashed state, so it can never perturb a replay (same discipline as the sim's
   * own `emit`). Optional so a deps-builder that wants no fire cue (headless/showcase) just
   * omits it. `laser` does NOT call this — the beam's cue is raised at its fire transition,
   * which only the sim (owning the laser lifecycle) can time.
   */
  notifyFire?: (x: number) => void;
}

/** Build a retargetable handle over the captured `(slot, gen)` pairs. */
function makeBulletGroup(system: BulletSystem, slots: number[], gens: number[]): BulletGroup {
  return {
    retarget(tx, ty, speed): number {
      const { x, y, vx, vy, angle, gen } = system.store;
      const alive = system.alive;
      let count = 0;
      for (let k = 0; k < slots.length; k++) {
        const s = slots[k]!;
        // Skip a slot that was culled (dead) or recycled by another bullet (its
        // generation stamp moved) — that is exactly what makes this safe.
        if (alive[s] === 0 || gen[s] !== gens[k]) continue;
        const a = atan2(ty - y[s]!, tx - x[s]!);
        vx[s] = cos(a) * speed;
        vy[s] = sin(a) * speed;
        angle[s] = a;
        count++;
      }
      return count;
    },
  };
}

function makeContext(deps: EmitterDeps, group: number, rng: Rng, pos?: Vec2): EmitterContext {
  const { system, lasers, target } = deps;

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
  ): number => {
    let bp0 = beh.bp0;
    let bp1 = beh.bp1;
    let vx = cos(angle) * speed;
    let vy = sin(angle) * speed;
    if (beh.behavior === Behavior.Accelerate) {
      bp0 = cos(angle) * beh.bp0;
      bp1 = sin(angle) * beh.bp0;
    } else if (beh.behavior === Behavior.Delay) {
      // Hold at the spawn point; stash the launch speed (bp1) for the system to
      // apply along `angle` once the delay elapses.
      vx = 0;
      vy = 0;
      bp1 = speed;
    } else if (beh.behavior === Behavior.Staged) {
      // Launch normally (vx/vy above = segment 0's launch motion); the per-bullet
      // state is which program (bp0) + which segment (bp1, starting at 0). The program
      // is interned so identical timelines share one id (deterministic, since bp0 is
      // hashed).
      bp0 = system.registerProgram(beh.program!);
      bp1 = 0;
    }
    return system.spawn(
      x,
      y,
      vx,
      vy,
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
    difficulty: deps.difficulty,
    x: 0,
    y: 0,
    target,
    group,
    sub(script) {
      // Inherit this emitter's stream: a child fires on the same RNG stream as its
      // parent, so a boss's sub-emitters stay on the protected boss stream.
      deps.spawnChild(script, ctx.x, ctx.y, ctx.group, rng);
    },
    spawnGroup(o) {
      deps.notifyFire?.(ctx.x);
      const x = o.x ?? ctx.x;
      const y = o.y ?? ctx.y;
      const radius = o.radius ?? DEFAULT_RADIUS;
      const color = o.color ?? WHITE;
      const sprite = o.sprite ?? Shape.Orb;
      const beh = o.behavior ?? linear;
      const base = o.angle ?? 0;
      const step = (Math.PI * 2) / o.count;
      const slots: number[] = [];
      const gens: number[] = [];
      for (let i = 0; i < o.count; i++) {
        const slot = emit(x, y, o.speed, base + i * step, radius, color, sprite, beh);
        if (slot >= 0) {
          slots.push(slot);
          gens.push(system.store.gen[slot]!);
        }
      }
      return makeBulletGroup(system, slots, gens);
    },
    fire(o) {
      deps.notifyFire?.(ctx.x);
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
      deps.notifyFire?.(ctx.x);
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
      deps.notifyFire?.(ctx.x);
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
      deps.notifyFire?.(ctx.x);
      const x = o.x ?? ctx.x;
      const y = o.y ?? ctx.y;
      const aim = atan2(target.y - y, target.x - x);
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
    laser(o) {
      const color = o.color ?? WHITE;
      lasers.spawn({
        x: o.x ?? ctx.x,
        y: o.y ?? ctx.y,
        angle: o.angle,
        length: o.length,
        width: o.width ?? 12,
        r: color[0],
        g: color[1],
        b: color[2],
        spin: o.spin ?? 0,
        telegraph: o.telegraph ?? 36,
        duration: o.duration ?? 90,
      });
    },
  };
  // Optional SHARED position: when `pos` is given, this emitter's x/y read and write
  // that Vec2 instead of owning their own — so its `fire/ring/aimed` (which default to
  // ctx.x/y) originate from, and its movement drives, the shared point. The one caller
  // is a boss PHASE BODY, which shares the boss position so a boss that moves while
  // firing has its danmaku track it (see the boss layer). Every other emitter (enemies,
  // the stage root, `sub`-spawned satellites, the showcase) passes no `pos` and keeps
  // its own x/y — unchanged behaviour.
  if (pos) {
    Object.defineProperty(ctx, "x", {
      get: () => pos.x,
      set: (v: number) => {
        pos.x = v;
      },
      enumerable: true,
      configurable: true,
    });
    Object.defineProperty(ctx, "y", {
      get: () => pos.y,
      set: (v: number) => {
        pos.y = v;
      },
      enumerable: true,
      configurable: true,
    });
  }
  return ctx;
}

/** Begin running `script` at (x, y), in `group`, on RNG stream `rng`. Resumes
 *  first at `startTick`. */
export function startEmitter(
  script: EmitterScript,
  x: number,
  y: number,
  startTick: number,
  deps: EmitterDeps,
  rng: Rng,
  group = 0,
  pos?: Vec2,
): RunningEmitter {
  const ctx = makeContext(deps, group, rng, pos);
  // With a shared `pos` these writes seed it (the setter writes through); without one
  // they set the emitter's own x/y. Either way the emitter starts at (x, y).
  ctx.x = x;
  ctx.y = y;
  return { ctx, gen: script(ctx), resumeTick: startTick, done: false, group };
}

/** Resume `em` if it is due at `tick`. Updates `resumeTick` / `done`. */
export function stepEmitter(em: RunningEmitter, tick: number): void {
  if (em.done || tick < em.resumeTick) return;
  // ctx.tick is part of the context surface; refresh it before resuming.
  em.ctx.tick = tick;
  const r = em.gen.next();
  if (r.done) {
    em.done = true;
    return;
  }
  // Clamp the yielded wait to >= 1 tick (guards against `yield 0` spinning).
  const wait = r.value;
  em.resumeTick = tick + (wait >= 1 ? Math.floor(wait) : 1);
}
