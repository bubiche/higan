// Deterministic simulation core.
//
// This module is intentionally free of any browser surface — no DOM, no
// `performance.now`, no `Math.random`. Its entire output is a pure function of
// (stage definition, stage seed, character): construct it, feed it a sequence of
// InputFrames, and the resulting state — and its hash — are bit-identical every
// time (Hard Rule 2). That purity is what lets the determinism check run
// headlessly and what makes backward-scrub (replay from seed) and replay work.
//
// One sim runs ONE stage (a run chains a sim per stage). The STAGE SCRIPT is the
// scene root: a coroutine that orchestrates the whole stage — spawning emitters,
// and the boss partway through — in the emitter idiom. The boss is therefore a
// mid-run child, not the privileged whole-scene root it used to be. Both the stage
// definition and the character are passed IN (the game supplies them) so this core
// stays content-agnostic and the engine/game boundary holds — core never imports a
// game's content.
//
// Randomness flows down per-source STREAMS, not one global RNG: the boss danmaku
// has its own protected stream so a player's clear-speed (which advances the enemy
// stream by killing enemies sooner/later) can never reshape the boss's patterns.
// Each emitter root is started on a specific stream and `spawnChild` hands that
// stream to its children. Player shots and the player step consume ZERO RNG, so
// firing never perturbs any stream. Emitters run at the emitter layer (O(hundreds));
// bullets stay dumb data updated by the flat numeric loop (Hard Rule 1).

import { Rng, mixSeed } from "./prng";
import { hashFloat32Arrays } from "./hash";
import { createBulletSystem, type BulletSystem } from "../bullets/system";
import { createLaserSystem, type LaserSystem } from "../touhou/laser";
import {
  startEmitter,
  stepEmitter,
  type EmitterDeps,
  type RunningEmitter,
  type Vec2,
} from "../api/emitter";
import { startBoss, type BossDeps, type PhaseSpec } from "../api/boss";
import { startStage, type StageDeps } from "../api/stage";
import type { StageDef, CharacterDef } from "../api/game";
import { PLAYFIELD_W, PLAYFIELD_H } from "./playfield";
import type { InputFrame } from "./input";
import {
  createPlayer,
  stepPlayerMovement,
  stepPlayerLifecycle,
  PlayerState,
  type Player,
} from "../touhou/player";
import { stepCollision } from "../touhou/collision";
import {
  createShotSystem,
  fireShots,
  stepShotCollision,
  DEFAULT_SHOT_CONFIG,
  type ShotSystem,
} from "../touhou/shot";

/** Bullet-store capacity a stage sim allocates — also the size the renderer's
 *  instance buffer is built to, so the shell can size renderers before a sim exists. */
export const SIM_CAPACITY = 4096;
/** Laser-pool capacity (the renderer's beam buffer is sized to match). */
export const LASER_CAPACITY = 64;
/** Player-shot pool capacity (the renderer marshals at most this many shots). */
export const SHOT_CAPACITY = 256;
const CULL_MARGIN = 16;
/** Boss collision radius — the disc player shots damage. A constant for the demo
 *  (the boss origin is static); a per-boss hitbox/position is a content seam later. */
const BOSS_HIT_RADIUS = 22;

/** RNG-stream ids. Each stream derives an independent generator from the stage seed
 *  (`mixSeed(stageSeed, id)`). The boss stream is protected from the enemy stream's
 *  play-dependent churn (see the module header). The item stream joins at M6#3. */
const STREAM = { Boss: 0, Enemy: 1 } as const;

/** Ticks the demo's showcase stage runs each pattern (referenced by the demo). */
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
  /** The player-shot pool (the offensive bullets the player fires) the renderer draws. */
  readonly shots: ShotSystem;
  /** The player struct (position + game state). Read-only to consumers — only the
   *  sim mutates it, so the HUD/renderer can never become a second source of truth. */
  readonly player: Readonly<Player>;
  /** Name of the currently-running scene element (boss phase, or the stage). */
  readonly patternName: string;
  /** Boss/spell-card state, or null until the stage spawns the boss. Read-only — the
   *  HUD displays it and keeps no counters of its own. */
  readonly boss: Readonly<BossState> | null;
  /** Advance the simulation by exactly one fixed step, given this tick's input. */
  step(input: InputFrame): void;
  /** Bit-level fingerprint of the current state (live slots only). */
  hash(): number;
}

export function createStageSim(
  stageDef: StageDef,
  stageSeed: number,
  character: CharacterDef,
  dt: number,
): Simulation {
  const config = character.config;
  const shot = character.shot ?? DEFAULT_SHOT_CONFIG;
  // Per-source RNG streams. The boss stream is protected; the enemy stream drives
  // the stage script + (from M6#2b) enemy danmaku, and is play-dependent.
  const rngBoss = new Rng(mixSeed(stageSeed, STREAM.Boss));
  const rngEnemy = new Rng(mixSeed(stageSeed, STREAM.Enemy));

  const system = createBulletSystem(
    { width: PLAYFIELD_W, height: PLAYFIELD_H, margin: CULL_MARGIN },
    SIM_CAPACITY,
  );
  const lasers = createLaserSystem(LASER_CAPACITY);
  const shots = createShotSystem(
    { width: PLAYFIELD_W, height: PLAYFIELD_H, margin: CULL_MARGIN },
    SHOT_CAPACITY,
  );

  // Spawn / respawn position — the bottom-centre start. A constant (not hashed),
  // passed to the lifecycle step so a respawn returns the player here.
  const START_X = PLAYFIELD_W / 2;
  const START_Y = PLAYFIELD_H * 0.8;
  // Boss origin (static for the demo): the boss spawns here, and it is the centre of
  // the disc player shots damage.
  const BOSS_ORIGIN_X = PLAYFIELD_W / 2;
  const BOSS_ORIGIN_Y = PLAYFIELD_H * 0.16;
  const player = createPlayer(config, START_X, START_Y);
  // The shared aim/home target. A stable object that views the player position:
  // emitters and the bullet update loop read it each tick; we mutate its fields in
  // place rather than replacing it.
  const target: Vec2 = { x: player.x, y: player.y };

  let tick = 0;
  // The scheduler runs an ordered array of emitter roots + their children (the stage
  // root, the boss once spawned, and every `sub`-spawned emitter). Stepped in array
  // order each tick; stable order + the clamped-yield rule keep it deterministic.
  let running: RunningEmitter[] = [];

  const deps: EmitterDeps = {
    system,
    lasers,
    target,
    // A child spawned this tick is appended and first resumes NEXT tick (tick + 1):
    // no same-tick re-entry, and `stepRunning` captures the length before iterating
    // so the new entry is not visited until then. The caller passes its own stream
    // (`rng`) so the child inherits the parent's RNG stream.
    spawnChild(script, cx, cy, group, rng) {
      running.push(startEmitter(script, cx, cy, tick + 1, deps, rng, group));
    },
  };

  // Boss/spell-card state + the deferred boss root. The stage spawns the boss partway
  // through (R3), so `bossRoot` is null until then; every gate below guards on it.
  // `nextGroupId` hands each phase a fresh group so a transition clears exactly its
  // emitters.
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

  const bossDeps: BossDeps = {
    // The boss runs on its dedicated protected stream.
    rng: rngBoss,
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

  // The stage's `spawnBoss` hook: create the boss on the boss stream as a mid-run
  // child (resuming next tick, like any spawned child), and track it for HP-drain +
  // defeat detection. A no-op if the stage defines no boss, or if already spawned.
  const spawnBoss = (): void => {
    if (!stageDef.boss || bossRoot) return;
    bossRoot = startBoss(stageDef.boss, BOSS_ORIGIN_X, BOSS_ORIGIN_Y, tick + 1, bossDeps);
    running.push(bossRoot);
  };

  const stageDeps: StageDeps = {
    // The stage script runs on the (play-dependent) enemy stream.
    rng: rngEnemy,
    target,
    spawnChild: deps.spawnChild,
    spawnBoss,
  };

  // The stage script is the scene root (R3). Started at construction so it begins on
  // tick 0; it spawns the boss (and, from #2b, waves) as the stage progresses.
  running.push(startStage(stageDef.script, BOSS_ORIGIN_X, 0, 0, stageDeps));

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
  // Player-shot scratch (live shots, packed in pool order — deterministic). Motion
  // + the sim-affecting fields (damage drains boss HP, radius sets the hit test);
  // sprite/colour are render-only and left out, as laser colour is.
  const shx = new Float32Array(SHOT_CAPACITY);
  const shy = new Float32Array(SHOT_CAPACITY);
  const shvx = new Float32Array(SHOT_CAPACITY);
  const shvy = new Float32Array(SHOT_CAPACITY);
  const shage = new Float32Array(SHOT_CAPACITY);
  const shdmg = new Float32Array(SHOT_CAPACITY);
  const shrad = new Float32Array(SHOT_CAPACITY);
  // Running-emitter scratch: (resumeTick, group) per live emitter, in array order
  // (deterministic). Directly fingerprints the scheduler — the central machinery —
  // beyond what the bullets those emitters spawn already imply. NOTE: this caps only
  // the HASH fold at 64 concurrent emitters (execution is unbounded; bullets still
  // hash) — far above any real scene, but a silent cap if it's ever hit.
  const EMITTER_SCRATCH = 64;
  const semitRT = new Float32Array(EMITTER_SCRATCH);
  const semitG = new Float32Array(EMITTER_SCRATCH);
  // Per-stream RNG state (boss x,y,z,w then enemy x,y,z,w). Stored as u32 and hashed
  // via a Float32 VIEW over the same buffer, so the FNV byte-hash folds the exact
  // 32-bit words losslessly — a direct, early tripwire for a stream-ordering desync
  // (e.g. the boss accidentally drawing from the wrong stream), beyond the bullets
  // those draws produce. (Lossless matters less here than for score — rng divergence
  // is chaotic, not incremental — but it costs nothing to do right.)
  const rngStateU32 = new Uint32Array(8);
  const rngStateView = new Float32Array(rngStateU32.buffer);
  // Scalar block: sim/scene/laser state (0-7), the full player struct (8-17),
  // boss/spell state (18-22), and the player-shot live count (23).
  const scalars = new Float32Array(24);

  const step = (input: InputFrame): void => {
    // 1. Player movement from input (focus-aware speed, clamped to the field).
    stepPlayerMovement(player, input, config, dt, PLAYFIELD_W, PLAYFIELD_H);

    // 2. Target tracks the player.
    target.x = player.x;
    target.y = player.y;

    // 2b. Player fires (ZERO RNG — deterministic cadence + fixed angles, so the
    //     player never perturbs any danmaku stream, §c). Shots spawn at the just-
    //     moved player position and advance with the bullets below.
    fireShots(shots, player, input, shot, tick);

    // 3. Scene. The stage root, the boss (once spawned), and every child emitter all
    //    advance through the same scheduler array. The stage drives the scene; the
    //    boss is a mid-run child it spawns.
    stepRunning();
    if (bossRoot && bossRoot.done) bossState.defeated = true;
    // The phase TIMER evolves here (tick-driven); the coroutine only reads hp/timer
    // to decide transitions. HP is drained by player shots LANDING (step 5b).
    if (bossRoot && bossState.active && bossState.timeLeft > 0) bossState.timeLeft--;

    // 4. Advance bullets (homing reads the shared target), cull off-field.
    system.update(dt, target.x, target.y);
    // 4b. Advance player shots, then resolve shot-vs-boss. HP falls only as shots
    //     actually land, so aim/position matters. Run AFTER stepRunning so the
    //     coroutine read this tick's pre-drain HP (the one-tick transition lag, see
    //     api/boss.ts). Gated on the boss existing + being active.
    shots.update(dt);
    if (bossRoot && bossState.active && bossState.hp > 0 && player.state !== PlayerState.GameOver) {
      const dmg = stepShotCollision(shots, {
        x: BOSS_ORIGIN_X,
        y: BOSS_ORIGIN_Y,
        radius: BOSS_HIT_RADIUS,
      });
      if (dmg > 0) {
        bossState.hp -= dmg;
        if (bossState.hp < 0) bossState.hp = 0;
      }
    }
    // 5. Advance beams (age the telegraph→fire→fade lifecycle, sweep, despawn).
    lasers.update(dt);
    // 6. Player-vs-field pass — graze (a write) + hit detection (read-only over
    //    bullets and beams). Consumes no randomness.
    const { hit } = stepCollision(player, system, lasers, config);
    // 7. Death/bomb lifecycle consumes the hit. A bomb (or deathbomb) clears the
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
    // Compact live player shots in pool order (same rationale as bullet slots).
    const sp = shots.shots;
    let k = 0;
    for (let i = 0; i < sp.length; i++) {
      const s = sp[i];
      if (!s.alive) continue;
      shx[k] = s.x;
      shy[k] = s.y;
      shvx[k] = s.vx;
      shvy[k] = s.vy;
      shage[k] = s.age;
      shdmg[k] = s.damage;
      shrad[k] = s.radius;
      k++;
    }
    // Pack live emitters' schedule state (array order — deterministic).
    let e = 0;
    for (let i = 0; i < running.length && e < EMITTER_SCRATCH; i++) {
      semitRT[e] = running[i]!.resumeTick;
      semitG[e] = running[i]!.group;
      e++;
    }
    // Fold each stream's 4-word state (boss then enemy) — the stream-desync tripwire.
    const bs = rngBoss.snapshot();
    const es = rngEnemy.snapshot();
    rngStateU32[0] = bs[0];
    rngStateU32[1] = bs[1];
    rngStateU32[2] = bs[2];
    rngStateU32[3] = bs[3];
    rngStateU32[4] = es[0];
    rngStateU32[5] = es[1];
    rngStateU32[6] = es[2];
    rngStateU32[7] = es[3];
    scalars[0] = tick;
    scalars[1] = system.liveCount;
    scalars[2] = player.x;
    scalars[3] = player.y;
    scalars[4] = bossRoot ? 1 : 0;
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
    scalars[23] = shots.liveCount;
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
      shx.subarray(0, k),
      shy.subarray(0, k),
      shvx.subarray(0, k),
      shvy.subarray(0, k),
      shage.subarray(0, k),
      shdmg.subarray(0, k),
      shrad.subarray(0, k),
      semitRT.subarray(0, e),
      semitG.subarray(0, e),
      rngStateView,
      scalars,
    ]);
  };

  return {
    get tick() {
      return tick;
    },
    system,
    lasers,
    shots,
    player,
    get patternName() {
      if (bossRoot) {
        return bossState.active ? bossState.name : bossState.defeated ? "defeated" : "—";
      }
      return "stage";
    },
    get boss() {
      return bossRoot ? bossState : null;
    },
    step,
    hash,
  };
}
