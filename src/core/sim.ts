// Deterministic simulation core.
//
// This module is intentionally free of any browser surface — no DOM, no
// `performance.now`, no `Math.random`. Its entire output is a pure function of
// (seed, input stream, patterns): construct it, feed it a sequence of
// InputFrames, and the resulting state — and its hash — are bit-identical every
// time (Hard Rule 2). That purity is what lets the determinism check run
// headlessly and what makes backward-scrub (replay from seed) and replay work.
//
// The sim owns the bullet system, the emitter scheduler, and a tick-driven scene
// that cycles through a set of named patterns. The patterns are passed IN (the
// demo supplies them) so this core stays pattern-agnostic and the determinism
// boundary holds — core never imports the demo. Emitters run at the emitter layer
// (O(hundreds)); bullets stay dumb data updated by the flat numeric loop in the
// bullet system (Hard Rule 1). The single shared `target` (the keyboard player)
// drives aimed/home, so input flows into the spawn path and the determinism guard
// covers it.

import { Rng } from "./prng";
import { hashFloat32Arrays } from "./hash";
import { createBulletSystem, type BulletSystem } from "../bullets/system";
import { createLaserSystem, type LaserSystem } from "../touhou/laser";
import {
  startEmitter,
  stepEmitter,
  type RunningEmitter,
  type ScenePattern,
  type Vec2,
} from "../api/emitter";
import { PLAYFIELD_W, PLAYFIELD_H } from "./playfield";
import type { InputFrame } from "./input";
import {
  createPlayer,
  stepPlayerMovement,
  DEFAULT_PLAYER_CONFIG,
  type Player,
  type PlayerConfig,
} from "../touhou/player";
import { stepCollision } from "../touhou/collision";

const SIM_CAPACITY = 4096;
const LASER_CAPACITY = 64;
const CULL_MARGIN = 16;

/** Ticks each showcase pattern runs before the scene advances to the next. */
export const PATTERN_TICKS = 150;

export interface Simulation {
  /** Number of fixed steps executed so far. */
  readonly tick: number;
  /** The bullet system (store + alive + highWater) the renderer draws. */
  readonly system: BulletSystem;
  /** The laser system (the pool of straight beams) the renderer draws. */
  readonly lasers: LaserSystem;
  /** The player struct (position + game state). Read-only to consumers — only the
   *  sim mutates it, so the HUD/renderer can never become a second source of truth. */
  readonly player: Readonly<Player>;
  /** Name of the currently-running showcase pattern (for the HUD). */
  readonly patternName: string;
  /** Advance the simulation by exactly one fixed step, given this tick's input. */
  step(input: InputFrame): void;
  /** Bit-level fingerprint of the current state (live slots only). */
  hash(): number;
}

export function createSimulation(
  seed: number,
  dt: number,
  patterns: readonly ScenePattern[],
  config: PlayerConfig = DEFAULT_PLAYER_CONFIG,
): Simulation {
  const rng = new Rng(seed);
  const system = createBulletSystem(
    { width: PLAYFIELD_W, height: PLAYFIELD_H, margin: CULL_MARGIN },
    SIM_CAPACITY,
  );
  const lasers = createLaserSystem(LASER_CAPACITY);

  const player = createPlayer(config, PLAYFIELD_W / 2, PLAYFIELD_H * 0.8);
  // The shared aim/home target. A stable object that views the player position:
  // emitters and the bullet update loop read it each tick; we mutate its fields in
  // place rather than replacing it.
  const target: Vec2 = { x: player.x, y: player.y };

  let tick = 0;
  let patternIndex = -1;
  let running: RunningEmitter | null = null;
  const deps = { system, lasers, rng, target };

  // The boss (emitter origin) sways along the top, driven by `tick` — never the
  // wall-clock — so it stays deterministic.
  const bossX = (tk: number): number =>
    PLAYFIELD_W / 2 + Math.sin(tk * dt * 0.9) * PLAYFIELD_W * 0.28;
  const bossY = (): number => PLAYFIELD_H * 0.16;

  const startPattern = (idx: number, atTick: number): void => {
    patternIndex = idx;
    // Hard cut between patterns; in-flight bullets and beams clear (deterministic).
    system.clear();
    lasers.clear();
    if (patterns.length === 0) {
      running = null;
      return;
    }
    running = startEmitter(patterns[idx].script, bossX(atTick), bossY(), atTick, deps);
  };

  // Scratch for the live-slots-only hash; sized once, reused every call.
  const sx = new Float32Array(SIM_CAPACITY);
  const sy = new Float32Array(SIM_CAPACITY);
  const svx = new Float32Array(SIM_CAPACITY);
  const svy = new Float32Array(SIM_CAPACITY);
  const sang = new Float32Array(SIM_CAPACITY);
  const sbp0 = new Float32Array(SIM_CAPACITY);
  const sbp1 = new Float32Array(SIM_CAPACITY);
  const sbeh = new Float32Array(SIM_CAPACITY);
  const sage = new Float32Array(SIM_CAPACITY);
  const sgrazed = new Float32Array(SIM_CAPACITY);
  // Laser scratch (live beams, packed in pool order — deterministic).
  const lx = new Float32Array(LASER_CAPACITY);
  const ly = new Float32Array(LASER_CAPACITY);
  const lang = new Float32Array(LASER_CAPACITY);
  const llen = new Float32Array(LASER_CAPACITY);
  const lwid = new Float32Array(LASER_CAPACITY);
  const lspin = new Float32Array(LASER_CAPACITY);
  const lage = new Float32Array(LASER_CAPACITY);
  // Scalar block: sim/scene/laser state (0-7) + the full player struct (8-17).
  // Every player field is folded in so the hash layout is stable once the
  // bomb/death/collision steps start mutating these (sub-tasks ahead).
  const scalars = new Float32Array(18);

  const step = (input: InputFrame): void => {
    // 1. Player movement from input (focus-aware speed, clamped to the field).
    stepPlayerMovement(player, input, config, dt, PLAYFIELD_W, PLAYFIELD_H);

    // 2. Target tracks the player.
    target.x = player.x;
    target.y = player.y;

    // 3. Scene cycle: advance to the next pattern on a tick boundary.
    if (patterns.length > 0) {
      const idx = Math.floor(tick / PATTERN_TICKS) % patterns.length;
      if (idx !== patternIndex) startPattern(idx, tick);

      // 4. Move the boss, then step the current emitter. (Writing the boss
      // position into ctx each tick means the scene owns the boss path; a pattern
      // that moves itself between yields would be overridden — fine for the
      // showcase.)
      if (running) {
        running.ctx.x = bossX(tick);
        running.ctx.y = bossY();
        stepEmitter(running, tick);
      }
    }

    // 5. Advance bullets (homing reads the shared target), cull off-field.
    system.update(dt, target.x, target.y);
    // 6. Advance beams (age the telegraph→fire→fade lifecycle, sweep, despawn).
    lasers.update(dt);
    // 7. Player-vs-field pass (graze now; the hit/death response builds on it).
    //    Read-only over the bullet store; consumes no randomness.
    stepCollision(player, system, config);

    tick++;
  };

  const hash = (): number => {
    const { x, y, vx, vy, angle, bp0, bp1, behavior, age, grazed } = system.store;
    const alive = system.alive;
    const hw = system.highWater;
    // Compact live slots in slot order — deterministic because spawn/despawn
    // order is deterministic — so dead-slot garbage never enters the fingerprint.
    let n = 0;
    for (let i = 0; i < hw; i++) {
      if (alive[i] === 0) continue;
      sx[n] = x[i];
      sy[n] = y[i];
      svx[n] = vx[i];
      svy[n] = vy[i];
      sang[n] = angle[i];
      sbp0[n] = bp0[i];
      sbp1[n] = bp1[i];
      sbeh[n] = behavior[i];
      sage[n] = age[i];
      sgrazed[n] = grazed[i];
      n++;
    }
    // Compact live beams in pool order (same rationale as bullet slots above).
    const pool = lasers.lasers;
    let m = 0;
    for (let i = 0; i < pool.length; i++) {
      const l = pool[i];
      if (!l.alive) continue;
      lx[m] = l.x;
      ly[m] = l.y;
      lang[m] = l.angle;
      llen[m] = l.length;
      lwid[m] = l.width;
      lspin[m] = l.spin;
      lage[m] = l.age;
      m++;
    }
    scalars[0] = tick;
    scalars[1] = system.liveCount;
    scalars[2] = player.x;
    scalars[3] = player.y;
    scalars[4] = patternIndex;
    scalars[5] = running ? running.resumeTick : -1;
    scalars[6] = running ? (running.done ? 1 : 0) : -1;
    scalars[7] = lasers.liveCount;
    scalars[8] = player.focused ? 1 : 0;
    scalars[9] = player.lives;
    scalars[10] = player.bombs;
    scalars[11] = player.graze;
    scalars[12] = player.power;
    scalars[13] = player.invulnTicks;
    scalars[14] = player.deathbombTicks;
    scalars[15] = player.prevBomb ? 1 : 0;
    scalars[16] = player.spellCapturedNoMiss ? 1 : 0;
    scalars[17] = player.state;
    return hashFloat32Arrays([
      sx.subarray(0, n),
      sy.subarray(0, n),
      svx.subarray(0, n),
      svy.subarray(0, n),
      sang.subarray(0, n),
      sbp0.subarray(0, n),
      sbp1.subarray(0, n),
      sbeh.subarray(0, n),
      sage.subarray(0, n),
      sgrazed.subarray(0, n),
      lx.subarray(0, m),
      ly.subarray(0, m),
      lang.subarray(0, m),
      llen.subarray(0, m),
      lwid.subarray(0, m),
      lspin.subarray(0, m),
      lage.subarray(0, m),
      scalars,
    ]);
  };

  return {
    get tick() {
      return tick;
    },
    system,
    lasers,
    player,
    get patternName() {
      return patternIndex >= 0 && patternIndex < patterns.length
        ? patterns[patternIndex].name
        : "—";
    },
    step,
    hash,
  };
}
