// Scoring economy — score, point-item value (PIV), graze, spell-capture/stage
// bonuses, and score-threshold extends.
//
// Determinism (Hard Rule 2): every award here is a pure function of already-hashed
// state (score / piv / graze / the phase timer / lives / bombs) plus the run's
// scoring config, and consumes ZERO randomness — so scoring never perturbs any
// danmaku stream and replays hold bit-identically, exactly as the player/collision/
// item passes do. The config is CONSTRUCTION input (like seed / PlayerConfig): its
// values feed deterministic state, but the config object is NOT folded into the hash.
//
// THE INTEGER INVARIANT (load-bearing): `score` and `piv` are folded into the hash
// as two 32-bit lanes each (the f64→two-u32 split in sim.ts), which truncates any
// fractional part. So every award MUST keep score/piv integer-valued — the height
// scaling (the only place a fraction enters) is `Math.floor`ed here, at the point of
// award. A fractional leak would be invisible to the replay gate (deterministic but
// lossy, the same class as the bomb-edge trap), so all `player.score +=` writes live
// in THIS module and nowhere else, to keep the discipline auditable in one place.
//
// The economy values are a game-level RunConfig field (`RunConfig.scoring`, composed
// in api/config.ts), so a game tunes point values, bonus sizes, and extend thresholds
// with zero engine edit. `DEFAULT_SCORING` carries the reference values used by the
// reference game.

import type { Player } from "./player";

/**
 * The scoring economy — point-item value growth, graze/cancel pay, the
 * spell-capture and stage-clear bonuses, and the score-threshold extend ladder.
 * Construction input, not hashed (its values feed the hashed score/piv/lives).
 */
export interface ScoringConfig {
  /** Starting point-item value (a point item collected at the PoC line scores this). */
  readonly pivBase: number;
  /** PIV gained per point item collected — rewards sustained collection over a run. */
  readonly pivPerPoint: number;
  /** PIV ceiling. */
  readonly pivMax: number;
  /** Floor on the height factor: a point item collected at the very bottom is worth
   *  this fraction of full PIV (collecting at/above the PoC line is worth 1). Read by
   *  the PoC height scaling in item.ts. */
  readonly pivMinFactor: number;
  /** Score per graze (a near-miss). */
  readonly grazeScore: number;
  /** Flat score per bullet removed by a cancel (capture / phase transition / boss
   *  defeat / bomb clearing the field). */
  readonly cancelScore: number;
  /** Spell-capture bonus at zero elapsed time; declines as the phase runs. */
  readonly spellBonusBase: number;
  /** Spell-bonus lost per tick the phase runs before capture. */
  readonly spellBonusDecay: number;
  /** Floor on the spell-capture bonus (a slow capture still pays this). */
  readonly spellBonusMin: number;
  /** Stage-clear bonus per life held at the clear. */
  readonly stageBonusPerLife: number;
  /** Stage-clear bonus per bomb held at the clear. */
  readonly stageBonusPerBomb: number;
  /** Score thresholds that each grant one extra life (ascending). A run crossing a
   *  threshold gains a life and advances to the next; past the last, no more extends. */
  readonly extendThresholds: readonly number[];
}

/** The reference game's scoring values (the engine's defaults). */
export const DEFAULT_SCORING: ScoringConfig = {
  pivBase: 10_000,
  pivPerPoint: 50,
  pivMax: 100_000,
  pivMinFactor: 0.25,
  grazeScore: 500,
  cancelScore: 100,
  spellBonusBase: 2_000_000,
  spellBonusDecay: 1_000,
  spellBonusMin: 100_000,
  stageBonusPerLife: 3_000_000,
  stageBonusPerBomb: 1_000_000,
  extendThresholds: [10_000_000, 30_000_000, 60_000_000],
};

/**
 * Award a collected point item (or a Power item that overflowed past max power and
 * converts to a point). `heightFactor` (0..1, computed by the caller from where it
 * was collected — 1 at/above the PoC line) scales the value: collecting high is worth
 * full PIV. Floors the value to keep score integer (the hash-fold invariant), then
 * grows PIV toward its max. `pointItemsCollected` keeps its raw count for the HUD.
 */
export function awardPointItem(player: Player, heightFactor: number, s: ScoringConfig): void {
  player.score += Math.floor(player.piv * heightFactor);
  player.piv = Math.min(s.pivMax, player.piv + s.pivPerPoint);
  player.pointItemsCollected++;
}

/** Award score for `count` grazes this tick (the sim passes the per-tick delta). */
export function awardGraze(player: Player, count: number, s: ScoringConfig): void {
  player.score += count * s.grazeScore;
}

/** Award the flat cancel bonus for `count` bullets removed by a field clear this tick
 *  (capture / phase transition / boss defeat / bomb). Integer by construction. The
 *  capped point-item shower the cancel also spawns is scored separately, on collection
 *  (`awardPointItem`), so this is just the immediate per-bullet reward — the sim owns
 *  the shower. Pure of randomness; folds into the hash via `score`. */
export function awardCancel(player: Player, count: number, s: ScoringConfig): void {
  player.score += count * s.cancelScore;
}

/**
 * Award the spell-capture bonus: a base that declines linearly with the ticks the
 * phase ran before capture, floored at a minimum. Integer by construction (all
 * constants and the tick counts are integers). Called by the sim only on a captured
 * spell phase.
 */
export function awardSpellCapture(
  player: Player,
  timeLeft: number,
  timeLimit: number,
  s: ScoringConfig,
): void {
  const elapsed = timeLimit - timeLeft;
  const bonus = Math.max(s.spellBonusMin, s.spellBonusBase - s.spellBonusDecay * elapsed);
  player.score += bonus;
}

/** Award the stage-clear bonus from remaining lives and bombs. Integer. */
export function awardStageClear(player: Player, s: ScoringConfig): void {
  player.score += player.lives * s.stageBonusPerLife + player.bombs * s.stageBonusPerBomb;
}

/**
 * Grant an extra life for every extend threshold the score has crossed since the last
 * check, advancing the index so each threshold fires once. Bounded by the threshold
 * list (no extends past the last). Pure of randomness; folds into the hash via
 * lives + nextExtendIndex.
 *
 * Returns how many extends were granted this tick so the caller can raise a single
 * presentation event; the count is not read by any hashed logic.
 */
export function applyExtends(player: Player, s: ScoringConfig): number {
  let granted = 0;
  while (
    player.nextExtendIndex < s.extendThresholds.length &&
    player.score >= s.extendThresholds[player.nextExtendIndex]!
  ) {
    player.lives++;
    player.nextExtendIndex++;
    granted++;
  }
  return granted;
}
