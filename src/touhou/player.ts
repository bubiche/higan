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
// game-state fields (lives, bombs, graze, the invuln/deathbomb timers, the bomb
// edge-detect bit, spell-capture tracking) live here from the start so the hash
// layout is stable; collision and the bomb/death machine WRITE into them from
// later steps of sim.step. The movement step consumes ZERO randomness, so the
// emitter RNG stream — and every existing pattern's replay — is unaffected.

import type { InputFrame } from "../core/input";

/** Player lifecycle, driving the death/respawn step machine. A const object
 *  rather than a TS enum so it stays fully erasable under isolatedModules. */
export const PlayerState = {
  Alive: 0,
  Dying: 1, // deathbomb window open
  Respawning: 2,
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
  /** Reserved for M4a scoring; affects nothing yet, present so the hash layout
   *  doesn't reshuffle when scoring lands. */
  power: number;
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

export function createPlayer(cfg: PlayerConfig, x: number, y: number): Player {
  return {
    x,
    y,
    focused: false,
    lives: cfg.lives,
    bombs: cfg.bombs,
    graze: 0,
    power: 0,
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
