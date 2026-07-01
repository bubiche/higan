// The player as a deterministic simulation entity.
//
// The player is part of the sim, not the render/demo layer: its position and full
// game state are stepped from the per-tick InputFrame and folded into sim.hash(),
// so replays reproduce it bit-identically (Hard Rule 2). Bullets are dumb data in
// flat arrays because there are tens of thousands of them; the player is a single
// O(1) entity, so a plain struct is the right shape here — the SoA rule does not
// apply.
//
// This module owns the struct, the run-rules config, and the movement step. The
// game-state fields (lives, bombs, graze, power, the run-economy score/piv/extend
// fields, the invuln/deathbomb timers, the bomb edge-detect bit, spell-capture
// tracking) live here from the start so the hash layout is stable; collision, the
// bomb/death machine, item collection, and the scoring economy WRITE into them from
// later steps of sim.step. The movement step consumes ZERO randomness, so the
// emitter RNG stream — and every existing pattern's replay — is unaffected.

import type { InputFrame } from "../core/input";

/** Player lifecycle, driving the death/respawn step machine. A const object
 *  rather than a TS enum so it stays fully erasable under isolatedModules. */
export const PlayerState = {
  Alive: 0,
  Dying: 1, // deathbomb window open
  Respawning: 2, // post-death i-frames; controllable, becomes Alive when they elapse
  GameOver: 3, // out of lives; an absorbing state — every lifecycle branch skips it
} as const;
export type PlayerState = (typeof PlayerState)[keyof typeof PlayerState];

/**
 * Developer-tunable run rules. Defaults match the design note; an author overrides
 * per game. This is CONSTRUCTION input (like seed / dt / patterns): the values feed
 * deterministic sim state, but the config object itself is NOT in the hash.
 */
export interface PlayerConfig {
  /** Starting lives. */
  readonly lives: number;
  /** Starting bombs. */
  readonly bombs: number;
  /** Movement clamp radius — keeps the player inside the field. */
  readonly playerRadius: number;
  /** Full-speed movement, sim units / second. */
  readonly moveSpeed: number;
  /** Focused (precise/slow) movement, sim units / second. */
  readonly focusSpeed: number;
  /** Collision hitbox radius — the tiny Touhou pinprick. */
  readonly hitboxRadius: number;
  /** Graze radius — larger, for near-miss detection. */
  readonly grazeRadius: number;
  /** Deathbomb window length, in ticks. */
  readonly deathbombWindow: number;
  /** I-frames granted after a respawn, in ticks. */
  readonly respawnInvuln: number;
  /** I-frames granted after a bomb, in ticks. */
  readonly bombInvuln: number;
}

export const DEFAULT_PLAYER_CONFIG: PlayerConfig = {
  lives: 3,
  bombs: 3,
  playerRadius: 6,
  moveSpeed: 260,
  focusSpeed: 120,
  hitboxRadius: 2.5,
  grazeRadius: 16,
  deathbombWindow: 8,
  respawnInvuln: 120,
  bombInvuln: 120,
};

/** The mutable player struct. All fields are deterministic and folded into the
 *  hash; integer/bool fields stay well within f32's exact-integer range (2^24). */
export interface Player {
  x: number;
  y: number;
  /** Focus held this tick — focus as state, not just a transient speed read. */
  focused: boolean;
  lives: number;
  bombs: number;
  /** Graze count; incremented once per bullet lifetime (see collision). */
  graze: number;
  /** Shot power level — scales the player-shot stream count (see touhou/shot.ts).
   *  Starts at 0; Power / FullPower items feed it. (Graduates into run-state when
   *  scoring lands.) */
  power: number;
  /** Point-items collected this run (raw count for the HUD — folded into the hash).
   *  The scoring value of each is `piv × height-factor`, accumulated into `score`. */
  pointItemsCollected: number;
  /** Running score (gameplay → hashed via a two-lane f32 fold, since it exceeds f32's
   *  2^24 exact-integer range). Kept integer-valued — every award floors (see score.ts).
   *  (Graduates into run-state alongside lives/bombs/power/graze when stages chain.) */
  score: number;
  /** Point-item value: what the next point item scores at full height; grows over the
   *  run, capped. Hashed (two-lane fold) like `score`; kept integer. */
  piv: number;
  /** Index into the extend-threshold list — the next score-based extra life. Advances
   *  once per threshold crossed (see score.ts `applyExtends`). Hashed. */
  nextExtendIndex: number;
  /** >0 = invulnerable (i-frames after respawn/bomb); counts down. */
  invulnTicks: number;
  /** >0 = deathbomb window open; counts down. */
  deathbombTicks: number;
  /** Bomb-held state from the previous tick, for rising-edge detection. Bomb is
   *  produced as HELD, so it must be edge-detected or one press burns every bomb. */
  prevBomb: boolean;
  /** True while the current spell has been survived without a miss; cleared at
   *  spell start, read on capture. */
  spellCapturedNoMiss: boolean;
  state: PlayerState;
}

/** `pivBase` is the run's starting point-item value (`ScoringConfig.pivBase`), passed
 *  in so the player struct stays free of the scoring economy module. */
export function createPlayer(cfg: PlayerConfig, x: number, y: number, pivBase: number): Player {
  return {
    x,
    y,
    focused: false,
    lives: cfg.lives,
    bombs: cfg.bombs,
    graze: 0,
    power: 0,
    pointItemsCollected: 0,
    score: 0,
    piv: pivBase,
    nextExtendIndex: 0,
    invulnTicks: 0,
    deathbombTicks: 0,
    prevBomb: false,
    spellCapturedNoMiss: true,
    state: PlayerState.Alive,
  };
}

/**
 * Step the player's movement from this tick's input: focus-aware speed, integrated
 * by the fixed dt, clamped to the field; and the focus-as-state flag. Consumes no
 * randomness. The bomb edge bit and the timers/death machine are stepped elsewhere
 * (collision + the bomb/death step), so this stays a pure movement update.
 */
export function stepPlayerMovement(
  p: Player,
  input: InputFrame,
  cfg: PlayerConfig,
  dt: number,
  fieldW: number,
  fieldH: number,
): void {
  p.focused = input.focus;
  const speed = input.focus ? cfg.focusSpeed : cfg.moveSpeed;
  p.x += input.dx * speed * dt;
  p.y += input.dy * speed * dt;
  const r = cfg.playerRadius;
  if (p.x < r) p.x = r;
  else if (p.x > fieldW - r) p.x = fieldW - r;
  if (p.y < r) p.y = r;
  else if (p.y > fieldH - r) p.y = fieldH - r;
}

/**
 * Step the player's death/bomb lifecycle for one tick, given whether collision
 * reported a hit this tick. Pure and consumes no randomness, so the emitter RNG
 * stream is unaffected and the whole machine folds into the deterministic hash via
 * the player struct. Returns whether a bomb fired this tick (`clearField` — the caller
 * does the actual bullet/laser clear, so this stays free of the bullet/laser systems),
 * whether that bomb was a deathbomb (vs a normal bomb), and whether the player lost a
 * life this tick. The two extra flags are presentation-only — they let the caller raise
 * the right sound and are never read back into hashed logic.
 *
 * Order within the tick matters and is deliberate:
 *  1. A fresh hit opens the deathbomb window (Dying). Done first so that a bomb
 *     pressed on the very frame of the hit (step 2) is read as a deathbomb, not a
 *     wasted normal bomb — the panic-bomb-on-death-frame Touhou players rely on.
 *  2. Bomb on the RISING EDGE only. `InputFrame.bomb` is produced HELD, so a
 *     level-triggered check would burn every bomb in a few frames — and because
 *     that bug is fully deterministic it replays bit-identically, invisible to the
 *     replay gate. Edge-detect via `prevBomb` (in the hash) is the fix; the
 *     isolated check asserts bomb COUNT to catch a regression here.
 *  3-4. Timers count down; an unbombed window expiry costs a life and respawns.
 *  5. Respawn i-frames elapsing returns control to normal play.
 */
export function stepPlayerLifecycle(
  p: Player,
  input: InputFrame,
  cfg: PlayerConfig,
  hit: boolean,
  startX: number,
  startY: number,
): { clearField: boolean; deathbomb: boolean; lifeLost: boolean } {
  let clearField = false;
  let deathbomb = false;
  let lifeLost = false;

  // 1. A fresh hit (while vulnerable — collision already gated `hit` on that) opens
  //    the deathbomb window. A hit is a miss for capture purposes.
  if (hit && p.state === PlayerState.Alive) {
    p.state = PlayerState.Dying;
    p.deathbombTicks = cfg.deathbombWindow;
    p.spellCapturedNoMiss = false;
  }

  // 2. Bomb (rising edge). Inside the deathbomb window it negates the death;
  //    otherwise (Alive or Respawning) it is a normal/revival bomb. Either way it
  //    breaks a no-bomb capture and clears the field.
  const bombEdge = input.bomb && !p.prevBomb;
  p.prevBomb = input.bomb;
  if (bombEdge && p.bombs > 0) {
    if (p.state === PlayerState.Dying && p.deathbombTicks > 0) {
      p.bombs--;
      p.state = PlayerState.Alive;
      p.deathbombTicks = 0;
      p.invulnTicks = cfg.bombInvuln;
      p.spellCapturedNoMiss = false;
      clearField = true;
      deathbomb = true;
    } else if (p.state !== PlayerState.Dying && p.state !== PlayerState.GameOver) {
      p.bombs--;
      p.invulnTicks = cfg.bombInvuln;
      p.spellCapturedNoMiss = false;
      clearField = true;
    }
  }

  // 3. Invulnerability counts down.
  if (p.invulnTicks > 0) p.invulnTicks--;

  // 4. Deathbomb window counts down; an unbombed expiry costs a life. (Set to the
  //    window length in step 1 this same tick, so the bomb-check in step 2 above
  //    sees the full window on the hit frame; this decrement makes the window
  //    exactly `deathbombWindow` accept-ticks.)
  if (p.state === PlayerState.Dying) {
    p.deathbombTicks--;
    if (p.deathbombTicks <= 0) {
      p.deathbombTicks = 0;
      p.lives--;
      lifeLost = true;
      if (p.lives < 0) {
        p.lives = 0;
        p.state = PlayerState.GameOver;
      } else {
        p.state = PlayerState.Respawning;
        p.x = startX;
        p.y = startY;
        p.invulnTicks = cfg.respawnInvuln;
      }
    }
  }

  // 5. Respawn i-frames elapsed → back to normal play.
  if (p.state === PlayerState.Respawning && p.invulnTicks === 0) {
    p.state = PlayerState.Alive;
  }

  return { clearField, deathbomb, lifeLost };
}
