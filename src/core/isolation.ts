// Cross-stream RNG isolation guard.
//
// Determinism (determinism.ts) proves a run REPRODUCES; this proves the boss's
// danmaku stream is ISOLATED from the play-dependent enemy stream. They are
// different properties, and a stream-crossing bug passes the determinism guard:
// two identical runs reproduce bit-for-bit whether or not the boss accidentally
// draws from the enemy's RNG. Only a test that varies PLAY — kills different
// numbers of enemies between two runs — can catch an enemy emitter spawned on the
// protected boss stream.
//
// The property: boss/spell danmaku rides `rngBoss`; enemy danmaku rides the
// play-dependent `rngEnemy`. If those are genuinely separate streams, then how
// fast the player clears the popcorn (which advances rngEnemy by killing enemies
// sooner/later) cannot reshape the boss's patterns. This guard asserts exactly that.
//
// Pure (no DOM, no clock, no Math.random) so it runs headlessly. It is a COMMITTED
// test that joins CI when a test runner lands — the same graduation determinism.ts
// anticipates — NOT a browser-boot guard: it uses its own fixed fixtures, so it can
// only catch ENGINE-seam regressions, which is exactly what an offline test is for
// (and it keeps the browser boot cheap). It uses its OWN minimal fixtures, never a
// game's content, so it tests the engine seam regardless of which game is loaded.
//
// IMPORTANT — this does NOT reuse `sim.hash()`. That hash folds the per-stream RNG
// words (rngStateView), which this harness makes diverge BY CONSTRUCTION (different
// enemy-kill counts → different rngEnemy draws), so the full hash would differ
// A-vs-B regardless of stream-crossing and prove nothing. The fingerprint here is
// the BULLET STORE ONLY (the motion/behaviour state, minus the rng words) — and
// since the harness enemies fire zero bullets, that store is boss danmaku only.

import { createStageSim, SIM_CAPACITY, type Simulation } from "./sim";
import { hashFloat32Arrays } from "./hash";
import { PLAYFIELD_W } from "./playfield";
import type { InputFrame } from "./input";
import type { StageDef, CharacterDef } from "../api/game";
import type { StageScript } from "../api/stage";
import type { BossScript } from "../api/boss";
import type { EmitterScript } from "../api/emitter";
import { DEFAULT_PLAYER_CONFIG, PlayerState } from "../touhou/player";
import { DEFAULT_SHOT_CONFIG } from "../touhou/shot";

// ── Harness fixtures (engine-owned; deliberately NOT game content) ─────────────

// An enemy that draws the enemy stream EVERY live tick (so dying earlier = strictly
// fewer draws = a real, observable divergence) and fires ZERO bullets (so the bullet
// store stays boss-only). It never moves — its position is irrelevant to the test,
// and holding it still keeps the only A/B difference "when a player shot kills it".
const isoEnemy: EmitterScript = function* (ctx) {
  while (true) {
    ctx.rng.u32();
    yield 1;
  }
};

// The boss body: rng-jittered rings forever, NEVER branching its firing on hp or
// timeLeft. So the bullet store it produces is a pure function of (rngBoss, tick) —
// which lets the two runs be compared EXACTLY per tick, with no "modulo phase
// timing" fudge.
const isoBossBody: EmitterScript = function* (ctx) {
  while (true) {
    ctx.ring({ count: 12, speed: 40, angle: ctx.rng.range(0, Math.PI * 2), radius: 4 });
    yield 18;
  }
};

// One phase whose HP and timer dwarf the window, so it never transitions within the
// run (no group-clear, no hp/timer branch ever taken). 1e12 hp easily survives the
// few thousand shot damage the shooting run leaks past the dead enemies.
const isoBoss: BossScript = function* (ctx) {
  yield* ctx.phase({ name: "isolation", hp: 1e12, timeLimit: 1_000_000 }, isoBossBody);
};

// Enemies stacked in the player's shot column, spaced so no single shot overlaps two
// at once (gap > 2·radius). The player shoots up the column; in the shooting run they
// die early (few rngEnemy draws), in the quiet run they live the whole window.
const ENEMY_LANES = 4;
const ENEMY_GAP = 45;
const ENEMY_TOP = 130;
const isoStage: StageScript = function* (ctx) {
  const x = PLAYFIELD_W / 2;
  for (let i = 0; i < ENEMY_LANES; i++) {
    ctx.spawnEnemy(isoEnemy, x, ENEMY_TOP + i * ENEMY_GAP, {
      hp: 30,
      radius: 14,
      sprite: 0,
      color: [1, 1, 1],
    });
  }
  ctx.spawnBoss();
  // The stage root has done its job; returning removes it from the scheduler. The
  // spawned enemies and boss run on independently.
};

const ISO_STAGE: StageDef = { id: "stream-isolation", script: isoStage, boss: isoBoss };
// A self-contained character so the test never depends on a game's shot tuning.
const ISO_CHARACTER: CharacterDef = {
  id: "iso",
  config: DEFAULT_PLAYER_CONFIG,
  shot: DEFAULT_SHOT_CONFIG,
};

// Two input streams differing in EXACTLY one bit: whether the player shoots. Both
// hold position (dx=dy=0) and focus (a tight shot column for reliable hits), so the
// player's position — and thus everything that reads the shared target — is identical
// between runs. The only A/B channel is shots killing enemies → enemy-stream draws.
const INPUT_SHOOT: InputFrame = { dx: 0, dy: 0, shoot: true, focus: true, bomb: false };
const INPUT_QUIET: InputFrame = { dx: 0, dy: 0, shoot: false, focus: true, bomb: false };

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

// Window length. Chosen so the boss's downward bullets (speed 40 from y≈72) reach
// only ≈y 337 within the window — short of the static player at y≈358 — so the player
// never dies and the shooting run fires uninterrupted. `playerStayedAliveShoot`
// surfaces this so a future tuning change that breaks the assumption is visible.
const ISO_TICKS = 400;

export interface IsolationResult {
  /** Isolation holds AND the test is non-vacuous on both sides (all gates pass). */
  readonly ok: boolean;
  /** Boss-store trajectory fingerprint, shooting run. */
  readonly bossHashShoot: number;
  /** Boss-store trajectory fingerprint, quiet run. Equal to `bossHashShoot` iff the
   *  enemy stream's divergence left the boss danmaku untouched (isolation holds). */
  readonly bossHashQuiet: number;
  /** True iff the two runs' live-enemy-count trajectories differ — the anti-vacuous
   *  tripwire on the ENEMY side (the runs really did consume rngEnemy differently). */
  readonly enemyTrajectoryDiffers: boolean;
  /** Peak live boss bullets in the shooting run — the anti-vacuous tripwire on the
   *  BOSS side (an empty store hashes identically regardless of any stream-crossing). */
  readonly peakBossBullets: number;
  /** Live enemies at the final tick, each run — the divergence shape (e.g. 0 vs 4). */
  readonly finalEnemiesShoot: number;
  readonly finalEnemiesQuiet: number;
  /** Whether the player's lifecycle stayed Alive throughout the shooting run (so the
   *  shooting run fired uninterrupted). Informational — symmetric death would not
   *  invalidate the test, but a regression that lets it die should be visible. */
  readonly playerStayedAliveShoot: boolean;
  readonly ticks: number;
}

/**
 * Run the same boss under two input streams that kill different numbers of enemies
 * and compare the BOSS-STORE-ONLY fingerprint. Isolation holds iff the boss danmaku
 * is bit-identical across the two runs while the enemy-count trajectory differs.
 */
export function checkStreamIsolation(stageSeed: number, dt: number): IsolationResult {
  // Scratch for the bullet-store-only fingerprint (the bullet portion of the sim
  // hash, MINUS the rng words — see the header). Live slots packed in slot order,
  // which is deterministic because spawn/despawn order is.
  const cap = SIM_CAPACITY;
  const sx = new Float32Array(cap);
  const sy = new Float32Array(cap);
  const svx = new Float32Array(cap);
  const svy = new Float32Array(cap);
  const sang = new Float32Array(cap);
  const sbp0 = new Float32Array(cap);
  const sbp1 = new Float32Array(cap);
  const sbeh = new Float32Array(cap);
  const sage = new Float32Array(cap);

  const bulletStoreHash = (sim: Simulation): number => {
    const { x, y, vx, vy, angle, bp0, bp1, behavior, age } = sim.system.store;
    const alive = sim.system.alive;
    const hw = sim.system.highWater;
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
      n++;
    }
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
    ]);
  };

  const run = (
    input: InputFrame,
  ): { bossHash: number; enemyCounts: number[]; peakBullets: number; stayedAlive: boolean } => {
    const sim = createStageSim(ISO_STAGE, stageSeed, ISO_CHARACTER, dt);
    let acc = FNV_OFFSET;
    let peakBullets = 0;
    let stayedAlive = true;
    const enemyCounts: number[] = [];
    for (let i = 0; i < ISO_TICKS; i++) {
      sim.step(input);
      acc = Math.imul(acc ^ bulletStoreHash(sim), FNV_PRIME) >>> 0;
      enemyCounts.push(sim.enemies.liveCount);
      if (sim.system.liveCount > peakBullets) peakBullets = sim.system.liveCount;
      if (sim.player.state !== PlayerState.Alive) stayedAlive = false;
    }
    return { bossHash: acc, enemyCounts, peakBullets, stayedAlive };
  };

  const shoot = run(INPUT_SHOOT);
  const quiet = run(INPUT_QUIET);

  let enemyTrajectoryDiffers = false;
  for (let i = 0; i < ISO_TICKS; i++) {
    if (shoot.enemyCounts[i] !== quiet.enemyCounts[i]) {
      enemyTrajectoryDiffers = true;
      break;
    }
  }

  return {
    ok: shoot.bossHash === quiet.bossHash && enemyTrajectoryDiffers && shoot.peakBullets > 0,
    bossHashShoot: shoot.bossHash,
    bossHashQuiet: quiet.bossHash,
    enemyTrajectoryDiffers,
    peakBossBullets: shoot.peakBullets,
    finalEnemiesShoot: shoot.enemyCounts[ISO_TICKS - 1],
    finalEnemiesQuiet: quiet.enemyCounts[ISO_TICKS - 1],
    playerStayedAliveShoot: shoot.stayedAlive,
    ticks: ISO_TICKS,
  };
}

/** As `checkStreamIsolation`, but throws on failure with a diagnostic that names
 *  which gate tripped (stream-crossing vs a vacuous test on either side). */
export function assertStreamIsolation(stageSeed: number, dt: number): IsolationResult {
  const r = checkStreamIsolation(stageSeed, dt);
  if (!r.ok) {
    let reason: string;
    if (r.bossHashShoot !== r.bossHashQuiet) {
      reason =
        `boss danmaku diverged across enemy-kill counts ` +
        `(0x${r.bossHashShoot.toString(16).padStart(8, "0")} != ` +
        `0x${r.bossHashQuiet.toString(16).padStart(8, "0")}) — an emitter is crossing RNG streams`;
    } else if (!r.enemyTrajectoryDiffers) {
      reason =
        `vacuous (enemy side): the two runs' enemy-count trajectories were identical ` +
        `(final ${r.finalEnemiesShoot} vs ${r.finalEnemiesQuiet}), so no enemy-stream divergence was exercised`;
    } else {
      reason = `vacuous (boss side): the boss fired no bullets (peak ${r.peakBossBullets}), so the fingerprint is empty`;
    }
    throw new Error(`Stream-isolation check FAILED after ${r.ticks} ticks: ${reason}.`);
  }
  return r;
}
