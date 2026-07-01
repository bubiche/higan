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
import { SfxId, type SfxEvent } from "./events";
import { createBulletSystem, type BulletSystem } from "../bullets/system";
import { createLaserSystem, type LaserSystem } from "../touhou/laser";
import { createEnemySystem, stepEnemyShotCollision, type EnemySystem, type Enemy } from "../touhou/enemy";
import {
  createItemSystem,
  stepItemCollection,
  ITEM_VISUAL,
  ItemType,
  type ItemSystem,
} from "../touhou/item";
import {
  startEmitter,
  stepEmitter,
  type EmitterDeps,
  type EmitterScript,
  type RunningEmitter,
  type Vec2,
} from "../api/emitter";
import { startBoss, type BossDeps, type PhaseSpec, type BossScript } from "../api/boss";
import { startStage, type StageDeps, type EnemySpec } from "../api/stage";
import type { StageDef, CharacterDef } from "../api/game";
import type { RunConfig } from "../api/config";
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
import { DEFAULT_BOMB_CONFIG } from "../touhou/bomb";
import { awardGraze, awardSpellCapture, awardStageClear, applyExtends, awardCancel } from "../touhou/score";

/** Bullet-store capacity a stage sim allocates — also the size the renderer's
 *  instance buffer is built to, so the shell can size renderers before a sim exists. */
export const SIM_CAPACITY = 4096;
/** Laser-pool capacity (the renderer's beam buffer is sized to match). */
export const LASER_CAPACITY = 64;
/** Player-shot pool capacity (the renderer marshals at most this many shots). */
export const SHOT_CAPACITY = 256;
/** Enemy-pool capacity (§f ~tens; the renderer + hash scratch size to match). */
export const ENEMY_CAPACITY = 64;
/** Item-pool capacity (the renderer + hash scratch size to match). NOTE: a future
 *  bullet-cancel shower can spawn far more — bump this (or aggregate value) there. */
export const ITEM_CAPACITY = 256;
/** Item-pool capacity is fixed (the cancel cap is the real shower bound); the per-item
 *  physics, drop kinematics, and cancel cap are run-config (`config.item`). */
const CULL_MARGIN = 16;
/** Off-field margin past which an enemy is culled. Generous — enemies enter from
 *  above the field, so this must clear their spawn point (the tight bullet
 *  `CULL_MARGIN` would kill them the moment they spawn off-screen). */
const ENEMY_CULL_MARGIN = 96;
/** Boss collision radius — the disc player shots damage. A constant for the demo
 *  (the boss origin is static); a per-boss hitbox/position is a content seam later. */
const BOSS_HIT_RADIUS = 22;

/** RNG-stream ids. Each stream derives an independent generator from the stage seed
 *  (`mixSeed(stageSeed, id)`). The boss stream is protected from the enemy stream's
 *  play-dependent churn (see the module header); items get their own so drop-scatter
 *  randomness never reshapes danmaku. */
const STREAM = { Boss: 0, Enemy: 1, Item: 2 } as const;

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
  /** The enemy pool (hittable foes that fire their own danmaku) the renderer draws. */
  readonly enemies: EnemySystem;
  /** The item pool (pickups enemies drop) the renderer draws. */
  readonly items: ItemSystem;
  /** The player struct (position + game state). Read-only to consumers — only the
   *  sim mutates it, so the HUD/renderer can never become a second source of truth. */
  readonly player: Readonly<Player>;
  /** Name of the currently-running scene element (boss phase, or the stage). */
  readonly patternName: string;
  /** Boss/spell-card state while a boss is on the field (midboss or final), or null
   *  between encounters and before the first. Read-only — the HUD displays it and
   *  keeps no counters of its own. */
  readonly boss: Readonly<BossState> | null;
  /** The stage script has returned — the scene is over (its waves, midboss, and final
   *  boss are all done). This, not any single boss's defeat, is the run-end signal: a
   *  midboss falling resumes the stage rather than ending the run. */
  readonly stageComplete: boolean;
  /** SFX events from the LAST step — presentation only. NOT hashed and never read back
   *  into sim logic; pushing them consumes zero RNG. Cleared at the start of each step,
   *  so this reflects exactly one tick's worth. Reading or ignoring it has zero effect
   *  on the hash (audio is provably presentation). The in-game screen plays these after
   *  a live forward step and suppresses them during bulk scrub/replay re-steps. */
  readonly events: readonly SfxEvent[];
  /** Advance the simulation by exactly one fixed step, given this tick's input. */
  step(input: InputFrame): void;
  /** Bit-level fingerprint of the current state (live slots only). */
  hash(): number;
}

export function createStageSim(
  stageDef: StageDef,
  stageSeed: number,
  character: CharacterDef,
  difficulty: number,
  runConfig: RunConfig,
  dt: number,
): Simulation {
  const config = character.config;
  const shot = character.shot ?? DEFAULT_SHOT_CONFIG;
  const bomb = character.bomb ?? DEFAULT_BOMB_CONFIG;
  // The run's economy/physics tuning (scoring + item), construction input (not hashed).
  const scoring = runConfig.scoring;
  const itemCfg = runConfig.item;
  // Power ceiling: the level past which more power buys no extra shot streams. Derived
  // from the shot config (it IS where streams cap), so it needs no separate knob — a
  // FullPower item jumps here and a Power item past it converts to a point. (LITMUS:
  // if power ever gains a second consumer — e.g. bomb scaling — promote this to an
  // independent config field rather than a shot-derived value.)
  const MAX_POWER = Math.max(0, (shot.maxStreams - shot.baseStreams) * shot.powerPerStream);
  // Per-source RNG streams. The boss stream is protected; the enemy stream drives the
  // stage script + enemy danmaku (play-dependent); the item stream feeds drop-scatter
  // so item randomness never perturbs danmaku.
  const rngBoss = new Rng(mixSeed(stageSeed, STREAM.Boss));
  const rngEnemy = new Rng(mixSeed(stageSeed, STREAM.Enemy));
  const rngItem = new Rng(mixSeed(stageSeed, STREAM.Item));

  const system = createBulletSystem(
    { width: PLAYFIELD_W, height: PLAYFIELD_H, margin: CULL_MARGIN },
    SIM_CAPACITY,
  );
  const lasers = createLaserSystem(LASER_CAPACITY);
  const shots = createShotSystem(
    { width: PLAYFIELD_W, height: PLAYFIELD_H, margin: CULL_MARGIN },
    SHOT_CAPACITY,
  );
  const enemies = createEnemySystem(ENEMY_CAPACITY);
  const items = createItemSystem(
    { width: PLAYFIELD_W, height: PLAYFIELD_H, margin: CULL_MARGIN },
    ITEM_CAPACITY,
    itemCfg,
  );

  // Spawn / respawn position — the bottom-centre start. A constant (not hashed),
  // passed to the lifecycle step so a respawn returns the player here.
  const START_X = PLAYFIELD_W / 2;
  const START_Y = PLAYFIELD_H * 0.8;
  // Boss origin (static for the demo): the boss spawns here, and it is the centre of
  // the disc player shots damage.
  const BOSS_ORIGIN_X = PLAYFIELD_W / 2;
  const BOSS_ORIGIN_Y = PLAYFIELD_H * 0.16;
  const player = createPlayer(config, START_X, START_Y, scoring.pivBase);
  // The shared aim/home target. A stable object that views the player position:
  // emitters and the bullet update loop read it each tick; we mutate its fields in
  // place rather than replacing it.
  const target: Vec2 = { x: player.x, y: player.y };

  let tick = 0;
  // Rising-edge latch for the one-shot stage-clear bonus (awarded when the stage script
  // returns). Stays false on a game-over: the stage only "completes" by the script
  // returning, which needs the final boss beaten — a dead player can't, so this never
  // fires on a loss (and is gated on it besides).
  let prevStageComplete = false;
  // The scheduler runs an ordered array of emitter roots + their children (the stage
  // root, the boss once spawned, and every `sub`-spawned emitter). Stepped in array
  // order each tick; stable order + the clamped-yield rule keep it deterministic.
  let running: RunningEmitter[] = [];
  // Enemy slot ↔ its root emitter. An enemy is both a hittable target (the struct in
  // the pool — hashed, drawn, shot-collided) and an emitter (a coroutine on the enemy
  // stream that moves itself + fires). The coroutine OWNS position via `ctx.x/y`; the
  // sim PUBLISHES it to the struct each tick (single source = the struct) and tears
  // the pair down together (free slot + end emitter) on death / coroutine-return /
  // off-field, so the slot and its emitter can never desync. Insertion order is
  // deterministic. (The enemy's `ctx.sub`-spawned children are free emitters, not
  // bound — already-fired sub-streams persist after the enemy dies, genre-correct.)
  let bound: { slot: number; em: RunningEmitter }[] = [];

  // Per-tick SFX event list (design note §h). PRESENTATION ONLY: it is not hashed, is
  // never read back into sim logic, and `emit` consumes zero RNG and touches no hashed
  // field — so it cannot affect a replay (the same discipline that makes the HUD a
  // read-only view). Cleared at the START of each `step`, so it holds exactly one tick.
  // The audio layer reads `sim.events` AFTER the step; the sim never plays a sound.
  const events: SfxEvent[] = [];
  // `y` is appended LAST (after `n`) so the M7 call sites — which pass `(id)`, `(id, x)`, or
  // `(id, x, n)` — are unchanged; only the M8 spark-worthy sites add the position. All fields
  // are presentation-only: the event list is never hashed and `emit` consumes zero RNG.
  const emit = (id: SfxId, x?: number, n?: number, y?: number): void => {
    events.push({ id, x, n, y });
  };

  const deps: EmitterDeps = {
    system,
    lasers,
    target,
    difficulty,
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
  };
  let nextGroupId = 1;
  // The boss currently on the field (midboss or final), or null between encounters.
  // A stage may run several bosses in sequence; each spawn replaces this, and it is
  // nulled when an encounter ends so the HUD gauge / shot-vs-boss only apply while a
  // boss is live. (Sequential bosses share the protected boss stream — an earlier
  // boss's lifetime advances `rngBoss`, the same intra-stream coupling that already
  // exists across a single boss's phases. F4 — boss stream ⊥ enemy stream — is
  // unaffected; per-encounter sub-streams are deferred, no consumer yet.)
  let bossRoot: RunningEmitter | null = null;

  const bossDeps: BossDeps = {
    // The boss runs on its dedicated protected stream.
    rng: rngBoss,
    target,
    difficulty,
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
      // SFX (presentation): announce a spell card. Zero RNG, not hashed.
      if (bossState.isSpell) emit(SfxId.SpellDeclare);
    },
    endPhase(group: number, captured: boolean) {
      // Spell-capture bonus: awarded FIRST, while bossState still holds this phase's
      // timer/limit/isSpell (cleared just below). Only a captured SPELL pays — a
      // timed-out or ordinary phase does not. Gameplay (it can trigger an extend) →
      // hashed, zero RNG. The declining-with-time bonus lives in score.ts.
      if (captured && bossState.isSpell) {
        awardSpellCapture(player, bossState.timeLeft, bossState.timeLimit, scoring);
        // SFX (presentation): the capture jingle. Shares this already-gated branch with
        // the (hashed) score award, but `emit` only pushes — zero RNG, not hashed — so
        // it cannot perturb the hash; the pinned baselines confirm it.
        emit(SfxId.SpellCapture);
      }
      for (const em of running) if (em.group === group) em.done = true;
      bossState.active = false;
      // Genre-standard screen clear on capture / phase transition / boss defeat — now a
      // bullet-cancel (converts the cleared field into point-items + score), not a silent
      // wipe. Fires on EVERY phase end, including a timeout: a timeout grants only the
      // modest cancel, never the (separately-gated) capture bonus, so capture stays the
      // headline reward. (Gating the cancel on `captured` would wrongly skip a phase
      // beaten with a miss; threading the end-reason isn't worth it — see implementation
      // notes.) Beams clear without converting. Always a full-field clear (radius 0) — the
      // genre screen-clear on a phase boundary, independent of any character's bomb radius.
      cancelBullets(player.x, player.y, 0);
      lasers.clear();
    },
    hp: () => bossState.hp,
    timeLeft: () => bossState.timeLeft,
    captured: () => player.spellCapturedNoMiss,
  };

  // The stage's `spawnBoss` hook: create a boss on the protected boss stream as a
  // mid-run child (resuming next tick, like any spawned child), track it for HP-drain
  // + defeat, and return its root so the stage can await `done`. The stage may call
  // this several times in sequence (midboss, then the final boss) — each call replaces
  // `bossRoot` and resets the phase state; the stage's `boss()` await guarantees the
  // previous encounter is over first. `script` overrides the stage's headline boss
  // (`stageDef.boss`); with neither, there is no boss to spawn (null).
  const spawnBoss = (script?: BossScript): RunningEmitter | null => {
    const bossScript = script ?? stageDef.boss;
    if (!bossScript) return null;
    bossState.active = false;
    bossRoot = startBoss(bossScript, BOSS_ORIGIN_X, BOSS_ORIGIN_Y, tick + 1, bossDeps);
    running.push(bossRoot);
    return bossRoot;
  };

  // Spawn an enemy: allocate a struct slot, then bind a root emitter to it on the
  // ENEMY stream (the §c protected-stream discipline — enemies ride the play-
  // dependent enemy stream, never the boss's). The emitter resumes next tick (the
  // no-same-tick-re-entry rule, like spawnChild). A no-op if the pool is full — the
  // enemy AND its emitter are dropped together (deterministic). Group 0: an enemy is
  // not part of a boss phase, so a phase transition's group-clear leaves it.
  const spawnEnemy = (script: EmitterScript, ex: number, ey: number, spec: EnemySpec): void => {
    const slot = enemies.spawn({
      x: ex,
      y: ey,
      hp: spec.hp,
      radius: spec.radius,
      // Render-only atlas base layer (not hashed). The handle's layer is stamped by the
      // sprite loader (presentation); `-1` when omitted or not yet loaded — the renderer
      // substitutes the engine default enemy sprite. In a headless (no-GL) run the loader
      // never runs, so this stays -1 and, being unhashed, leaves every baseline untouched.
      sprite: spec.sprite?.layer ?? -1,
      r: spec.color[0],
      g: spec.color[1],
      b: spec.color[2],
      drops: spec.drops,
    });
    if (slot < 0) return;
    const em = startEmitter(script, ex, ey, tick + 1, deps, rngEnemy, 0);
    running.push(em);
    bound.push({ slot, em });
  };

  // Spawn one item type's drops, popping up from (ex, ey) with an item-stream scatter
  // then falling (item.ts owns the fall/magnet/collect). The per-type look is engine-
  // owned (ITEM_VISUAL); content chose only the counts.
  const emitDrop = (type: ItemType, count: number | undefined, ex: number, ey: number): void => {
    const n = count ?? 0;
    const vis = ITEM_VISUAL[type];
    for (let i = 0; i < n; i++) {
      items.spawn({
        type,
        x: ex,
        y: ey,
        vx: rngItem.range(-itemCfg.popScatterX, itemCfg.popScatterX),
        vy: -itemCfg.popVy + rngItem.range(-itemCfg.popScatterVy, itemCfg.popScatterVy),
        sprite: vis.sprite,
        r: vis.color[0],
        g: vis.color[1],
        b: vis.color[2],
      });
    }
  };
  // An enemy's full death-drop. Called from the death seam ONLY on a shot-kill (an
  // enemy that flies off or culls drops nothing), in a fixed type order so the item-
  // stream draws are deterministic.
  const spawnDrops = (e: Enemy): void => {
    const d = e.drops;
    if (!d) return;
    emitDrop(ItemType.Power, d.power, e.x, e.y);
    emitDrop(ItemType.Point, d.point, e.x, e.y);
    emitDrop(ItemType.Life, d.life, e.x, e.y);
    emitDrop(ItemType.Bomb, d.bomb, e.x, e.y);
    emitDrop(ItemType.FullPower, d.fullPower, e.x, e.y);
  };

  // Bullet-cancel: the deterministic transform a field clear (spell capture, phase
  // transition, boss defeat, or a bomb/deathbomb) runs over the live bullets before
  // they vanish — the genre mechanic where cleared danmaku pays out (sign-off §c). Every
  // cancelled bullet pays a flat cancel score; the first CANCEL_ITEM_CAP of them ALSO leave
  // a Point item (the collectable shower) — the cap BOUNDS the conversion so a thousand-
  // bullet clear can't spike the item pool (the pool drops-when-full behind it too).
  // Consumes ZERO rng (cancel items pop with no scatter, vx=vy=0), so it never perturbs
  // the item stream; the score delta + the new items are already hashed, so the transform
  // needs no new hash fields. While game-over it awards/spawns nothing (consistent with
  // the stage-clear bonus + item collection, which also skip a dead player) but STILL
  // clears the field. The score write routes through score.ts (the single-writer rule).
  // Lasers are cleared by the caller — beams aren't bullets, so they don't convert. The
  // visual cancel sparkle is a later (presentation) milestone; this is only the mechanic.
  //
  // `radius` scopes the clear (a character's `BombConfig.radius`): `0` = the whole field —
  // the bulk path, which `system.clear()`s every slot at once (the spell-capture / phase-
  // transition / default-bomb behavior, kept byte-for-byte so existing baselines hold);
  // `>0` = only bullets within `radius` of `(cx, cy)`, freed slot by slot, with the cancel
  // count (and the item shower) covering ONLY those — a partial-screen offensive bomb.
  const cancelBullets = (cx: number, cy: number, radius: number): void => {
    const { alive, store } = system;
    const hw = system.highWater;
    const vis = ITEM_VISUAL[ItemType.Point];
    const award = player.state !== PlayerState.GameOver;
    const r2 = radius * radius;
    let n = 0;
    let spawned = 0;
    for (let i = 0; i < hw; i++) {
      if (alive[i] === 0) continue;
      // Spatial scope: the bulk path (radius 0) takes every live bullet; a radial bomb
      // takes only those inside the circle and leaves the rest flying.
      if (radius > 0) {
        const dx = store.x[i]! - cx;
        const dy = store.y[i]! - cy;
        if (dx * dx + dy * dy > r2) continue;
      }
      n++;
      // Spawn at the bullet's position with zero velocity (it then falls / magnets /
      // attracts like any item). First-cap rather than spread — the visible spread is
      // a presentation concern (the sparkle), not gameplay.
      if (award && spawned < itemCfg.cancelItemCap) {
        items.spawn({
          type: ItemType.Point,
          x: store.x[i]!,
          y: store.y[i]!,
          vx: 0,
          vy: 0,
          sprite: vis.sprite,
          r: vis.color[0],
          g: vis.color[1],
          b: vis.color[2],
        });
        spawned++;
      }
      // Radial: free just this slot (out-of-circle bullets survive). The bulk path frees
      // everything at once below — cheaper than per-slot despawn and exactly the old code.
      if (radius > 0) system.despawn(i);
    }
    if (award && n > 0) awardCancel(player, n, scoring);
    // SFX (presentation): one event for the WHOLE cleared batch (never per bullet, §h),
    // whenever bullets were actually cancelled. `cx`/`cy` are the clear origin (player on a
    // bomb; player on a full-field phase clear) — pan + sparkle burst. Zero RNG, not hashed.
    if (n > 0) emit(SfxId.Cancel, cx, n, cy);
    if (radius === 0) system.clear();
  };

  const stageDeps: StageDeps = {
    // The stage script runs on the (play-dependent) enemy stream.
    rng: rngEnemy,
    target,
    difficulty,
    spawnChild: deps.spawnChild,
    spawnEnemy,
    spawnBoss,
  };

  // The stage script is the scene root (R3). Started at construction so it begins on
  // tick 0; it directs the waves, runs the midboss and final boss, and returns when the
  // stage is over. Its `done` is the run-end signal (`stageComplete`) — a boss falling
  // resumes it, only its return ends the scene.
  const stageRoot = startStage(stageDef.script, BOSS_ORIGIN_X, 0, 0, stageDeps);
  running.push(stageRoot);

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
  // Enemy scratch (live enemies, packed in pool order — deterministic). The evolving
  // state (position, hp, age) + the constant radius (a spawn-path tripwire, like a
  // laser's length); sprite/colour are render-only, left out as the laser's are.
  const enx = new Float32Array(ENEMY_CAPACITY);
  const eny = new Float32Array(ENEMY_CAPACITY);
  const enhp = new Float32Array(ENEMY_CAPACITY);
  const enrad = new Float32Array(ENEMY_CAPACITY);
  const enage = new Float32Array(ENEMY_CAPACITY);
  // Item scratch (live items, packed in pool order — deterministic). The evolving
  // motion + lifecycle (position, velocity, state, age) + the type (it decides the
  // collection effect); sprite/colour are render-only, left out as enemies' are.
  const itx = new Float32Array(ITEM_CAPACITY);
  const ity = new Float32Array(ITEM_CAPACITY);
  const itvx = new Float32Array(ITEM_CAPACITY);
  const itvy = new Float32Array(ITEM_CAPACITY);
  const itstate = new Float32Array(ITEM_CAPACITY);
  const itage = new Float32Array(ITEM_CAPACITY);
  const ittype = new Float32Array(ITEM_CAPACITY);
  // Running-emitter scratch: (resumeTick, group) per live emitter, in array order
  // (deterministic). Directly fingerprints the scheduler — the central machinery —
  // beyond what the bullets those emitters spawn already imply. NOTE: this caps only
  // the HASH fold at 64 concurrent emitters (execution is unbounded; bullets still
  // hash) — far above any real scene, but a silent cap if it's ever hit.
  const EMITTER_SCRATCH = 64;
  const semitRT = new Float32Array(EMITTER_SCRATCH);
  const semitG = new Float32Array(EMITTER_SCRATCH);
  // Per-stream RNG state (boss x,y,z,w, then enemy, then item). Stored as u32 and
  // hashed via a Float32 VIEW over the same buffer, so the FNV byte-hash folds the
  // exact 32-bit words losslessly — a direct, early tripwire for a stream-ordering
  // desync (e.g. the boss accidentally drawing from the wrong stream), beyond the
  // bullets those draws produce. (Lossless matters less here than for score — rng
  // divergence is chaotic, not incremental — but it costs nothing to do right.)
  const rngStateU32 = new Uint32Array(12);
  const rngStateView = new Float32Array(rngStateU32.buffer);
  // Score/PIV folded LOSSLESSLY as two u32 lanes each (hi·2^32 + lo), then hashed via
  // a Float32 VIEW over the same buffer — like rngStateView. A single f32 lane would
  // truncate the low bits of a 10^7-10^9 score (past f32's 2^24 exact-integer range),
  // a divergence the byte-hash would silently miss; the two-lane split keeps every bit.
  // Order: score hi, score lo, piv hi, piv lo. (score/piv are kept integer — score.ts.)
  const scoreU32 = new Uint32Array(4);
  const scoreView = new Float32Array(scoreU32.buffer);
  // Scalar block: sim/scene/laser state (0-7), the full player struct (8-17),
  // boss/spell state (18-21), the stage-complete flag (22), the player-shot live
  // count (23), the enemy live count (24), the item live count (25), point-items
  // collected (26), the next-extend index (27). (score/piv fold via scoreView above.)
  const scalars = new Float32Array(28);

  const step = (input: InputFrame): void => {
    // Reset the per-tick SFX list first, so it holds exactly this step's events (bounds
    // it to one tick — no accumulation across a `loadRecording` re-step). Presentation
    // only; see the `events`/`emit` declaration above.
    events.length = 0;

    // 1. Player movement from input (focus-aware speed, clamped to the field).
    stepPlayerMovement(player, input, config, dt, PLAYFIELD_W, PLAYFIELD_H);

    // 2. Target tracks the player.
    target.x = player.x;
    target.y = player.y;

    // 2b. Player fires (ZERO RNG — deterministic cadence + fixed angles, so the
    //     player never perturbs any danmaku stream, §c). Shots spawn at the just-
    //     moved player position and advance with the bullets below. One SFX per volley
    //     tick regardless of stream count.
    if (fireShots(shots, player, input, shot, tick)) emit(SfxId.Shoot, player.x);

    // 3. Scene. The stage root, the boss (once spawned), and every child emitter all
    //    advance through the same scheduler array. The stage drives the scene; the
    //    boss is a mid-run child it spawns.
    stepRunning();
    // 3a. Stage-clear bonus (one-shot, rising edge). The stage script returns only
    //     when the run is cleared (final boss down); award the remaining-lives/bombs
    //     bonus once, BEFORE the end-of-step extend check so a clear bonus can itself
    //     trigger an extend. Gated on a live player so a boss timing out after a
    //     game-over can't pay a clear bonus.
    if (!prevStageComplete && stageRoot.done && player.state !== PlayerState.GameOver) {
      awardStageClear(player, scoring);
    }
    prevStageComplete = stageRoot.done;
    // An encounter ends when its boss coroutine returns; null `bossRoot` so the HUD
    // gauge and shot-vs-boss stop until the stage spawns the next boss (if any). The
    // stage's `boss()` await polls the root's own `done`, so it resumes independently
    // of this pointer being cleared.
    if (bossRoot && bossRoot.done) {
      bossState.active = false;
      bossRoot = null;
    }
    // The phase TIMER evolves here (tick-driven); the coroutine only reads hp/timer
    // to decide transitions. HP is drained by player shots LANDING (step 5b).
    if (bossRoot && bossState.active && bossState.timeLeft > 0) bossState.timeLeft--;

    // 3b. Publish each bound enemy emitter's coroutine position to its struct (the
    //     coroutine, stepped just above, owns movement; the struct is the canonical
    //     position the hash/render/collision read), and age the live enemies.
    for (let i = 0; i < bound.length; i++) {
      const e = enemies.enemies[bound[i]!.slot]!;
      if (!e.alive) continue;
      e.x = bound[i]!.em.ctx.x;
      e.y = bound[i]!.em.ctx.y;
      e.age++;
    }

    // 4. Advance bullets (homing reads the shared target), cull off-field.
    system.update(dt, target.x, target.y);
    // 4b. Advance player shots, then resolve shot-vs-enemy and shot-vs-boss. Enemies
    //     first (popcorn in front): a shot spent on an enemy can't also hit the boss.
    //     HP (enemy + boss) falls only as shots actually land, so aim/position matters.
    //     Run AFTER stepRunning so a boss coroutine read this tick's pre-drain HP (the
    //     one-tick transition lag, see api/boss.ts).
    shots.update(dt);
    const enemyHits = stepEnemyShotCollision(enemies, shots);
    if (enemyHits > 0) emit(SfxId.EnemyHit, undefined, enemyHits); // batched: one/tick
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
    // 4c. Enemy teardown — the deterministic death seam. An enemy dies on hp<=0
    //     (shot down), coroutine-return (em.done — flew its course), or leaving the
    //     field (generous margin). Free the slot AND end its emitter together so they
    //     can never desync. One fixed-order sweep, then compact `bound` + `running`.
    //     In-flight bullets the enemy fired persist (genre-correct). Items drop ONLY on
    //     a shot-kill (hp<=0) — a fly-off / cull yields nothing, the Touhou rule — and
    //     the drop scatter rides the dedicated item stream. A shot-kill also raises an
    //     EnemyDeath SFX event (presentation only; §h).
    let torn = false;
    for (let i = 0; i < bound.length; i++) {
      const { slot, em } = bound[i]!;
      const e = enemies.enemies[slot]!;
      const off =
        e.x < -ENEMY_CULL_MARGIN ||
        e.x > PLAYFIELD_W + ENEMY_CULL_MARGIN ||
        e.y < -ENEMY_CULL_MARGIN ||
        e.y > PLAYFIELD_H + ENEMY_CULL_MARGIN;
      const killed = e.hp <= 0;
      if (killed || em.done || off) {
        if (killed) {
          spawnDrops(e);
          // SFX (presentation): only a shot-kill sonifies — a fly-off / cull is silent,
          // mirroring the drop rule. `e.x` for pan, `e.y` for the death-spark origin.
          // Zero RNG, not hashed.
          emit(SfxId.EnemyDeath, e.x, undefined, e.y);
        }
        enemies.despawn(slot);
        em.done = true;
        torn = true;
      }
    }
    if (torn) {
      bound = bound.filter((b) => !b.em.done);
      running = running.filter((em) => !em.done);
    }
    // 5. Advance beams (age the telegraph→fire→fade lifecycle, sweep, despawn).
    lasers.update(dt);
    // 6. Player-vs-field pass — graze (a write) + hit detection (read-only over
    //    bullets and beams). Consumes no randomness. Score the graze delta this tick
    //    (graze→score) from the count change `stepCollision` made — no scoring inside
    //    the collision loop, which stays a pure graze/hit pass.
    const grazeBefore = player.graze;
    const { hit } = stepCollision(player, system, lasers, config);
    if (player.graze > grazeBefore) {
      const grazeDelta = player.graze - grazeBefore;
      awardGraze(player, grazeDelta, scoring);
      // SFX (presentation): zero RNG, not hashed. `player.y` places the graze sparkle.
      emit(SfxId.Graze, player.x, grazeDelta, player.y);
    }
    // 7. Death/bomb lifecycle consumes the hit. A bomb (or deathbomb) clears the
    //    field; the clear is done here so the lifecycle step stays free of the
    //    bullet/laser systems.
    const { clearField, deathbomb, lifeLost } = stepPlayerLifecycle(player, input, config, hit, START_X, START_Y);
    // SFX (presentation, zero RNG, not hashed). Pichuun on the death that costs a life
    // (deathbomb-window expiry, including the final game-over death); the bomb sound
    // distinguishes a panic deathbomb from an ordinary bomb. `clearField` and `lifeLost`
    // are mutually exclusive in a tick (a successful bomb leaves the Dying state), so
    // order is immaterial.
    if (lifeLost) emit(SfxId.Pichuun, player.x, undefined, player.y);
    if (clearField) {
      emit(deathbomb ? SfxId.PlayerDeathBomb : SfxId.Bomb, player.x, undefined, player.y);
      // A bomb/deathbomb runs the active character's bomb (its `BombConfig`): cancel the
      // field — wholly (radius 0) or within the bomb's radius of the player — converting it
      // to point-items + score; optionally nuke every beam and vacuum every item (including
      // the just-spawned cancel items) toward the player; and deal the bomb's flat damage to
      // the active boss. The radius is bullet-only — laser-clear/item-vacuum stay global —
      // and `bossDamage` lands on the same hashed boss HP the shot-vs-boss drain (4b) hits,
      // guarded the same way, so a defensive bomb (default: radius 0, 0 boss damage) is the
      // unchanged full-screen clear and an offensive one dents the boss + clears around the
      // player. `clearField` only fires from a successful bomb press (bombs > 0, not game-
      // over), so the boss-damage game-over guard is belt-and-suspenders, matching 4b.
      cancelBullets(player.x, player.y, bomb.radius);
      if (bomb.clearLasers) lasers.clear();
      if (bomb.vacuumItems) items.attractAll();
      if (
        bomb.bossDamage > 0 &&
        bossRoot &&
        bossState.active &&
        bossState.hp > 0 &&
        player.state !== PlayerState.GameOver
      ) {
        bossState.hp -= bomb.bossDamage;
        if (bossState.hp < 0) bossState.hp = 0;
      }
    }

    // 8. Items: advance pop/gravity/magnet/home (cull off the bottom), then collect any
    //    overlapping the player. End-of-tick so they read the FINAL player position
    //    (post-movement, post-respawn) and a 1up can't undo a same-tick death (death
    //    resolves in step 7 first). Full power, or the player above the PoC line,
    //    auto-attracts the whole field. ZERO RNG (the scatter was drawn at drop time).
    const fullPower = MAX_POWER > 0 && player.power >= MAX_POWER;
    items.update(dt, player.x, player.y, fullPower);
    const collected = stepItemCollection(items, player, MAX_POWER, scoring, itemCfg);
    // SFX (presentation): batched to one/tick (per-type ids are a deferred seam — §13);
    // `n` carries the count. Player x for pan (items home to the player). Zero RNG.
    if (collected > 0) emit(SfxId.ItemCollect, player.x, collected, player.y);

    // 9. Extends: every score-threshold the run has crossed this tick grants a life.
    //    Runs last, after every award this tick (point items, graze, spell capture,
    //    stage clear) has landed in `score`. Bounded by the threshold list; zero RNG.
    const extended = applyExtends(player, scoring);
    if (extended > 0) emit(SfxId.Extend, player.x); // SFX (presentation): zero RNG, not hashed

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
    // Compact live enemies in pool order (same rationale as bullet slots).
    const ep = enemies.enemies;
    let q = 0;
    for (let i = 0; i < ep.length; i++) {
      const e = ep[i];
      if (!e.alive) continue;
      enx[q] = e.x;
      eny[q] = e.y;
      enhp[q] = e.hp;
      enrad[q] = e.radius;
      enage[q] = e.age;
      q++;
    }
    // Compact live items in pool order (same rationale as bullet slots).
    const itp = items.items;
    let t = 0;
    for (let i = 0; i < itp.length; i++) {
      const it = itp[i];
      if (!it.alive) continue;
      itx[t] = it.x;
      ity[t] = it.y;
      itvx[t] = it.vx;
      itvy[t] = it.vy;
      itstate[t] = it.state;
      itage[t] = it.age;
      ittype[t] = it.type;
      t++;
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
    const its = rngItem.snapshot();
    rngStateU32[0] = bs[0];
    rngStateU32[1] = bs[1];
    rngStateU32[2] = bs[2];
    rngStateU32[3] = bs[3];
    rngStateU32[4] = es[0];
    rngStateU32[5] = es[1];
    rngStateU32[6] = es[2];
    rngStateU32[7] = es[3];
    rngStateU32[8] = its[0];
    rngStateU32[9] = its[1];
    rngStateU32[10] = its[2];
    rngStateU32[11] = its[3];
    // Two-lane fold of the integer-valued score + piv (hi = whole 2^32 blocks, lo =
    // remainder). Both are < 2^53, so hi/lo land in [0, 2^32) and the Uint32 store is
    // exact — no bit lost. (Negative score never occurs; awards are non-negative.)
    const scoreHi = Math.floor(player.score / 0x100000000);
    const pivHi = Math.floor(player.piv / 0x100000000);
    scoreU32[0] = scoreHi;
    scoreU32[1] = player.score - scoreHi * 0x100000000;
    scoreU32[2] = pivHi;
    scoreU32[3] = player.piv - pivHi * 0x100000000;
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
    scalars[22] = stageRoot.done ? 1 : 0;
    scalars[23] = shots.liveCount;
    scalars[24] = enemies.liveCount;
    scalars[25] = items.liveCount;
    scalars[26] = player.pointItemsCollected;
    scalars[27] = player.nextExtendIndex;
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
      enx.subarray(0, q),
      eny.subarray(0, q),
      enhp.subarray(0, q),
      enrad.subarray(0, q),
      enage.subarray(0, q),
      itx.subarray(0, t),
      ity.subarray(0, t),
      itvx.subarray(0, t),
      itvy.subarray(0, t),
      itstate.subarray(0, t),
      itage.subarray(0, t),
      ittype.subarray(0, t),
      semitRT.subarray(0, e),
      semitG.subarray(0, e),
      rngStateView,
      scoreView,
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
    enemies,
    items,
    player,
    get patternName() {
      if (bossRoot) return bossState.active ? bossState.name : "—";
      return stageRoot.done ? "complete" : "stage";
    },
    get boss() {
      return bossRoot ? bossState : null;
    },
    get stageComplete() {
      return stageRoot.done;
    },
    get events() {
      return events;
    },
    step,
    hash,
  };
}
