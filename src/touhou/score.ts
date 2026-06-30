// Scoring economy — score, point-item value (PIV), graze, spell-capture/stage
// bonuses, and score-threshold extends.
//
// Determinism (Hard Rule 2): every award here is a pure function of already-hashed
// state (score / piv / graze / the phase timer / lives / bombs) and consumes ZERO
// randomness — so scoring never perturbs any danmaku stream and replays hold
// bit-identically, exactly as the player/collision/item passes do.
//
// THE INTEGER INVARIANT (load-bearing): `score` and `piv` are folded into the hash
// as two 32-bit lanes each (the f64→two-u32 split in sim.ts), which truncates any
// fractional part. So every award MUST keep score/piv integer-valued — the height
// scaling (the only place a fraction enters) is `Math.floor`ed here, at the point of
// award. A fractional leak would be invisible to the replay gate (deterministic but
// lossy, the same class as the bomb-edge trap), so all `player.score +=` writes live
// in THIS module and nowhere else, to keep the discipline auditable in one place.
//
// LITMUS NOTE (slice-gate): these constants are hardcoded in `src/`, so a game that
// wants different point values, bonus sizes, or extend thresholds needs a src/ edit —
// which fails the "second game with zero src/ changes" litmus. They start as engine
// constants (one consumer, the extract-at-seam discipline) and are flagged to promote
// to run-config (a `RunConfig.scoring` block) at the litmus review, alongside item.ts's
// physics constants and the cross-stage RunState migration.

import type { Player } from "./player";

// ── Point-item value (PIV) ──────────────────────────────────────────────────────
/** Starting point-item value (a point item collected at the PoC line scores this). */
export const PIV_BASE = 10_000;
/** PIV gained per point item collected — rewards sustained collection over a run. */
export const PIV_PER_POINT = 50;
/** PIV ceiling. */
export const PIV_MAX = 100_000;
/** Floor on the height factor: a point item collected at the very bottom is worth
 *  this fraction of full PIV (collecting high — at/above the PoC line — is worth 1). */
export const PIV_MIN_FACTOR = 0.25;

// ── Graze / bonuses / extends ─────────────────────────────────────────────────────
/** Score per graze (a near-miss). */
export const GRAZE_SCORE = 500;
/** Flat score per bullet removed by a cancel (a spell capture / phase transition /
 *  boss defeat / bomb clearing the field). An immediate, capacity-independent reward;
 *  the capped point-item shower the cancel ALSO drops scores separately, on collection
 *  (the sim owns the shower + its cap). Deliberately small so a captured spell's bonus
 *  stays the headline reward: cancelling a 1000-bullet field pays 100k direct here vs.
 *  the up-to-2M capture bonus, and the shower (≤ cap × PIV × height) rides on top. */
export const CANCEL_SCORE = 100;
/** Spell-capture bonus at zero elapsed time; declines as the phase runs. */
export const SPELL_BONUS_BASE = 2_000_000;
/** Spell-bonus lost per tick the phase runs before capture. */
export const SPELL_BONUS_DECAY = 1_000;
/** Floor on the spell-capture bonus (a slow capture still pays this). */
export const SPELL_BONUS_MIN = 100_000;
/** Stage-clear bonus per life and per bomb held at the clear. */
export const STAGE_BONUS_PER_LIFE = 3_000_000;
export const STAGE_BONUS_PER_BOMB = 1_000_000;
/** Score thresholds that each grant one extra life (ascending). A run crossing a
 *  threshold gains a life and advances to the next; past the last, no more extends. */
export const EXTEND_THRESHOLDS: readonly number[] = [10_000_000, 30_000_000, 60_000_000];

/**
 * Award a collected point item (or a Power item that overflowed past max power and
 * converts to a point). `heightFactor` (0..1, computed by the caller from where it
 * was collected — 1 at/above the PoC line) scales the value: collecting high is worth
 * full PIV. Floors the value to keep score integer (the hash-fold invariant), then
 * grows PIV toward its max. `pointItemsCollected` keeps its raw count for the HUD.
 */
export function awardPointItem(player: Player, heightFactor: number): void {
  player.score += Math.floor(player.piv * heightFactor);
  player.piv = Math.min(PIV_MAX, player.piv + PIV_PER_POINT);
  player.pointItemsCollected++;
}

/** Award score for `count` grazes this tick (the sim passes the per-tick delta). */
export function awardGraze(player: Player, count: number): void {
  player.score += count * GRAZE_SCORE;
}

/** Award the flat cancel bonus for `count` bullets removed by a field clear this tick
 *  (capture / phase transition / boss defeat / bomb). Integer by construction. The
 *  capped point-item shower the cancel also spawns is scored separately, on collection
 *  (`awardPointItem`), so this is just the immediate per-bullet reward — the sim owns
 *  the shower. Pure of randomness; folds into the hash via `score`. */
export function awardCancel(player: Player, count: number): void {
  player.score += count * CANCEL_SCORE;
}

/**
 * Award the spell-capture bonus: a base that declines linearly with the ticks the
 * phase ran before capture, floored at a minimum. Integer by construction (all
 * constants and the tick counts are integers). Called by the sim only on a captured
 * spell phase.
 */
export function awardSpellCapture(player: Player, timeLeft: number, timeLimit: number): void {
  const elapsed = timeLimit - timeLeft;
  const bonus = Math.max(SPELL_BONUS_MIN, SPELL_BONUS_BASE - SPELL_BONUS_DECAY * elapsed);
  player.score += bonus;
}

/** Award the stage-clear bonus from remaining lives and bombs. Integer. */
export function awardStageClear(player: Player): void {
  player.score += player.lives * STAGE_BONUS_PER_LIFE + player.bombs * STAGE_BONUS_PER_BOMB;
}

/**
 * Grant an extra life for every extend threshold the score has crossed since the last
 * check, advancing the index so each threshold fires once. Bounded by the threshold
 * list (no extends past the last). Pure of randomness; folds into the hash via
 * lives + nextExtendIndex.
 */
export function applyExtends(player: Player): void {
  while (
    player.nextExtendIndex < EXTEND_THRESHOLDS.length &&
    player.score >= EXTEND_THRESHOLDS[player.nextExtendIndex]!
  ) {
    player.lives++;
    player.nextExtendIndex++;
  }
}
