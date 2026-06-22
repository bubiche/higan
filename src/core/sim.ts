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
  type EmitterDeps,
  type RunningEmitter,
  type ScenePattern,
  type Vec2,
} from "../api/emitter";
import { startBoss, type BossScript, type BossDeps, type PhaseSpec } from "../api/boss";
import { PLAYFIELD_W, PLAYFIELD_H } from "./playfield";
import type { InputFrame } from "./input";
import {
  createPlayer,
  stepPlayerMovement,
  stepPlayerLifecycle,
  DEFAULT_PLAYER_CONFIG,
  PlayerState,
  type Player,
  type PlayerConfig,
} from "../touhou/player";
import { stepCollision } from "../touhou/collision";

const SIM_CAPACITY = 4096;
const LASER_CAPACITY = 64;
const CULL_MARGIN = 16;

/** Ticks each showcase pattern runs before the scene advances to the next. */
export const PATTERN_TICKS = 150;

/**
 * Boss / spell-card runtime state. Deterministic — HP drains from `input.shoot`,
 * the timer from ticks — and folded into the hash. Exposed read-only for the HUD,
 * which keeps no counters of its own (the sim is the single source of truth).
 */
export interface BossState {
  /** A phase is running (false during gaps, before the first phase, after defeat). */
  active: boolean;
  /** Current phase name (a spell-card title for spell phases). */
  name: string;
  /** HP remaining and the phase's starting HP (for a gauge ratio). */
  hp: number;
  hpMax: number;
  /** Ticks remaining and the phase's limit (for a timer gauge). */
  timeLeft: number;
  timeLimit: number;
  /** This phase is a spell card (vs an ordinary phase). */
  isSpell: boolean;
  /** The boss coroutine has run out of phases — the boss is beaten. */
  defeated: boolean;
}

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
  /** Name of the currently-running scene element (boss phase or showcase pattern). */
  readonly patternName: string;
  /** Boss/spell-card state, or null when no boss scene is running. Read-only — the
   *  HUD displays it and keeps no counters of its own. */
  readonly boss: Readonly<BossState> | null;
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
  boss?: BossScript,
): Simulation {
  const rng = new Rng(seed);
  const system = createBulletSystem(
    { width: PLAYFIELD_W, height: PLAYFIELD_H, margin: CULL_MARGIN },
    SIM_CAPACITY,
  );
  const lasers = createLaserSystem(LASER_CAPACITY);

  // Spawn / respawn position — the bottom-centre start. A constant (not hashed),
  // passed to the lifecycle step so a respawn returns the player here.
  const START_X = PLAYFIELD_W / 2;
  const START_Y = PLAYFIELD_H * 0.8;
  const player = createPlayer(config, START_X, START_Y);
  // The shared aim/home target. A stable object that views the player position:
  // emitters and the bullet update loop read it each tick; we mutate its fields in
  // place rather than replacing it.
  const target: Vec2 = { x: player.x, y: player.y };

  let tick = 0;
  let patternIndex = -1;
  // The scheduler runs an ordered array of emitters (a boss is an emitter-of-
  // emitters: a root coroutine that spawns child emitters). Stepped in array order
  // each tick; stable order + the clamped-yield rule keep it deterministic.
  // `patternRoot` is the scene-cycle's single root (the showcase), tracked
  // separately because the scene repositions ONLY that root each tick — a blanket
  // position write across the whole array would teleport every child emitter.
  let running: RunningEmitter[] = [];
  let patternRoot: RunningEmitter | null = null;
  const deps: EmitterDeps = {
    system,
    lasers,
    rng,
    target,
    // A child spawned this tick is appended and first resumes NEXT tick (tick + 1):
    // no same-tick re-entry, and `stepRunning` captures the length before iterating
    // so the new entry is not visited until then.
    spawnChild(script, cx, cy, group) {
      running.push(startEmitter(script, cx, cy, tick + 1, deps, group));
    },
  };

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
    running = [];
    if (patterns.length === 0) {
      patternRoot = null;
      return;
    }
    patternRoot = startEmitter(patterns[idx].script, bossX(atTick), bossY(), atTick, deps);
    running.push(patternRoot);
  };

  // Step every emitter due this tick, then drop the finished ones. The length is
  // captured BEFORE the loop so a child spawned this tick (appended past the end)
  // is not stepped until next tick — the no-same-tick-re-entrancy rule. The
  // compaction preserves relative order, so the schedule stays deterministic.
  const stepRunning = (): void => {
    const n = running.length;
    for (let i = 0; i < n; i++) {
      const em = running[i]!;
      if (!em.done && tick >= em.resumeTick) stepEmitter(em, tick);
    }
    if (running.some((em) => em.done)) running = running.filter((em) => !em.done);
  };

  // Boss/spell-card state. The boss hooks below + the per-tick damage/timer step
  // mutate it; it is exposed read-only and folded into the hash. `nextGroupId`
  // hands each phase a fresh group so a transition clears exactly its emitters.
  const bossState: BossState = {
    active: false,
    name: "",
    hp: 0,
    hpMax: 0,
    timeLeft: 0,
    timeLimit: 0,
    isSpell: false,
    defeated: false,
  };
  let nextGroupId = 1;
  let bossRoot: RunningEmitter | null = null;
  if (boss) {
    // Static origin (top-centre). A swaying boss would need its child emitters to
    // track it; static is fine for the demo (documented extension, not built).
    const bossDeps: BossDeps = {
      rng,
      target,
      spawnChild: deps.spawnChild,
      nextGroup: () => nextGroupId++,
      beginPhase(spec: PhaseSpec) {
        bossState.active = true;
        bossState.name = spec.name;
        bossState.hp = spec.hp;
        bossState.hpMax = spec.hp;
        bossState.timeLimit = spec.timeLimit;
        bossState.timeLeft = spec.timeLimit;
        bossState.isSpell = spec.isSpell ?? false;
        // Capture tracking resets at phase start; a hit or bomb clears it (player.ts).
        player.spellCapturedNoMiss = true;
      },
      endPhase(group: number) {
        for (const em of running) if (em.group === group) em.done = true;
        bossState.active = false;
        // Genre-standard screen clear on capture / phase transition (sign-off §b).
        system.clear();
        lasers.clear();
      },
      hp: () => bossState.hp,
      timeLeft: () => bossState.timeLeft,
      captured: () => player.spellCapturedNoMiss,
    };
    bossRoot = startBoss(boss, PLAYFIELD_W / 2, PLAYFIELD_H * 0.16, 0, bossDeps);
    running.push(bossRoot);
  }

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
  const sgen = new Float32Array(SIM_CAPACITY);
  // Laser scratch (live beams, packed in pool order — deterministic).
  const lx = new Float32Array(LASER_CAPACITY);
  const ly = new Float32Array(LASER_CAPACITY);
  const lang = new Float32Array(LASER_CAPACITY);
  const llen = new Float32Array(LASER_CAPACITY);
  const lwid = new Float32Array(LASER_CAPACITY);
  const lspin = new Float32Array(LASER_CAPACITY);
  const lage = new Float32Array(LASER_CAPACITY);
  // Running-emitter scratch: (resumeTick, group) per live emitter, in array order
  // (deterministic). Directly fingerprints the scheduler — the central new
  // machinery — beyond what the bullets those emitters spawn already imply. NOTE:
  // this caps only the HASH fold at 64 concurrent emitters (execution is unbounded;
  // bullets still hash) — far above any real scene, but a silent cap if it's ever hit.
  const EMITTER_SCRATCH = 64;
  const semitRT = new Float32Array(EMITTER_SCRATCH);
  const semitG = new Float32Array(EMITTER_SCRATCH);
  // Scalar block: sim/scene/laser state (0-7), the full player struct (8-17), and
  // boss/spell state (18-22: hp, timeLeft, nextGroupId, active, defeated).
  const scalars = new Float32Array(23);

  const step = (input: InputFrame): void => {
    // 1. Player movement from input (focus-aware speed, clamped to the field).
    stepPlayerMovement(player, input, config, dt, PLAYFIELD_W, PLAYFIELD_H);

    // 2. Target tracks the player.
    target.x = player.x;
    target.y = player.y;

    // 3-4. Scene. Either a boss (an emitter-of-emitters root that drives ordered
    //      phases) OR the showcase pattern cycle. Both advance through the same
    //      scheduler array via stepRunning().
    if (bossRoot) {
      stepRunning();
      if (bossRoot.done) bossState.defeated = true;
      // Phase HP/timer evolve HERE, not in the boss coroutine: `input.shoot` is
      // sim-only, and damage must not depend on how often the coroutine resumes.
      // shoot is level-triggered (held = continuous damage) — unlike bomb, which is
      // edge-detected. The coroutine only reads hp/timer to decide transitions.
      if (bossState.active) {
        if (bossState.timeLeft > 0) bossState.timeLeft--;
        if (input.shoot && bossState.hp > 0 && player.state !== PlayerState.GameOver) {
          bossState.hp -= config.shotDps * dt;
          if (bossState.hp < 0) bossState.hp = 0;
        }
      }
    } else if (patterns.length > 0) {
      const idx = Math.floor(tick / PATTERN_TICKS) % patterns.length;
      if (idx !== patternIndex) startPattern(idx, tick);

      // Reposition ONLY the scene root's ctx (not across the array, which would
      // teleport every child emitter); a pattern that moves itself is overridden —
      // fine for the showcase.
      if (patternRoot && !patternRoot.done) {
        patternRoot.ctx.x = bossX(tick);
        patternRoot.ctx.y = bossY();
      }
      stepRunning();
    }

    // 5. Advance bullets (homing reads the shared target), cull off-field.
    system.update(dt, target.x, target.y);
    // 6. Advance beams (age the telegraph→fire→fade lifecycle, sweep, despawn).
    lasers.update(dt);
    // 7. Player-vs-field pass — graze (a write) + hit detection (read-only over
    //    bullets and beams). Consumes no randomness.
    const { hit } = stepCollision(player, system, lasers, config);
    // 8. Death/bomb lifecycle consumes the hit. A bomb (or deathbomb) clears the
    //    field; the clear is done here so the lifecycle step stays free of the
    //    bullet/laser systems.
    const { clearField } = stepPlayerLifecycle(player, input, config, hit, START_X, START_Y);
    if (clearField) {
      system.clear();
      lasers.clear();
    }

    tick++;
  };

  const hash = (): number => {
    const { x, y, vx, vy, angle, bp0, bp1, behavior, age, grazed, gen } = system.store;
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
      sgen[n] = gen[i];
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
    // Pack live emitters' schedule state (array order — deterministic).
    let e = 0;
    for (let i = 0; i < running.length && e < EMITTER_SCRATCH; i++) {
      semitRT[e] = running[i]!.resumeTick;
      semitG[e] = running[i]!.group;
      e++;
    }
    scalars[0] = tick;
    scalars[1] = system.liveCount;
    scalars[2] = player.x;
    scalars[3] = player.y;
    scalars[4] = patternIndex;
    scalars[5] = running.length > 0 ? running[0]!.resumeTick : -1;
    scalars[6] = running.length > 0 ? (running[0]!.done ? 1 : 0) : -1;
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
    scalars[18] = bossState.hp;
    scalars[19] = bossState.timeLeft;
    scalars[20] = nextGroupId;
    scalars[21] = bossState.active ? 1 : 0;
    scalars[22] = bossState.defeated ? 1 : 0;
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
      sgen.subarray(0, n),
      lx.subarray(0, m),
      ly.subarray(0, m),
      lang.subarray(0, m),
      llen.subarray(0, m),
      lwid.subarray(0, m),
      lspin.subarray(0, m),
      lage.subarray(0, m),
      semitRT.subarray(0, e),
      semitG.subarray(0, e),
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
      if (bossRoot) {
        return bossState.active ? bossState.name : bossState.defeated ? "defeated" : "—";
      }
      return patternIndex >= 0 && patternIndex < patterns.length
        ? patterns[patternIndex].name
        : "—";
    },
    get boss() {
      return bossRoot ? bossState : null;
    },
    step,
    hash,
  };
}
