// Run-rules configuration — the game-level economy a `defineGame` definition tunes.
//
// `RunConfig` composes the per-domain config shapes (scoring economy, item physics/
// values) plus the run-level limits (continues), promoting what used to be hardcoded
// `src/` constants into authored game data. A game overrides any of it with zero
// engine edit — the "second game, zero changes under src/" litmus.
//
// Construction input, NOT hashed (like seed / PlayerConfig / ShotConfig): the values
// feed deterministic sim state (score, item trajectories, extends), but the config
// object never enters `sim.hash()`. `DEFAULT_RUN_CONFIG` carries the reference values
// (each domain owns its own defaults; this just assembles them).
//
// Layering: this `api` module composes the `touhou` domain shapes (api → touhou, the
// established direction). The domain modules never import this — the sim passes the
// relevant slice (`config.scoring` / `config.item`) down to them.

import { type ScoringConfig, DEFAULT_SCORING } from "../touhou/score";
import { type ItemConfig, DEFAULT_ITEM_CONFIG } from "../touhou/item";

export type { ScoringConfig, ItemConfig };

/**
 * When clearing the main campaign flips the Extra-stage unlock. A game-authored POLICY,
 * not a hardcoded branch in the shell — a game switches idioms by changing this one field,
 * with zero engine change (the maker thesis). Evaluated at run-end from the run-outcome
 * facts already on hand (see `evaluateExtraUnlock`); never enters the sim or the hash.
 *
 * - `"any-clear"` — the DEFAULT. Any final-main-stage clear unlocks Extra (the beginner-
 *   friendly reading; also what a game that authors nothing gets).
 * - `"no-continue-normal-plus"` — the traditional Touhou idiom: a *no-continue* clear at
 *   Normal or above. "Normal or above" is read as difficulty index ≥ 1 — any rank above the
 *   easiest (index 0), per the documented easiest-first `difficulties` ordering. A game whose
 *   difficulty layout doesn't fit this (e.g. no Easy tier) is served by the future arbitrary-
 *   predicate seam, not this built-in.
 */
export type ExtraUnlockPolicy = "any-clear" | "no-continue-normal-plus";

export interface RunConfig {
  /** Continues allowed per run (a continue rebuilds the run with reset score + restored
   *  lives). Read by the continue prompt; bounds the choice. */
  readonly continues: number;
  /** Scoring economy — point values, bonuses, extend thresholds. */
  readonly scoring: ScoringConfig;
  /** Item physics, collection, and drop/cancel tuning. */
  readonly item: ItemConfig;
  /** When a main-campaign clear unlocks the Extra stage. Optional — omitted reads as
   *  `"any-clear"` (today's behavior), so a minimal game needn't author it. */
  readonly extraUnlock?: ExtraUnlockPolicy;
}

/** The reference game's run rules (the engine's defaults). */
export const DEFAULT_RUN_CONFIG: RunConfig = {
  continues: 3,
  scoring: DEFAULT_SCORING,
  item: DEFAULT_ITEM_CONFIG,
  extraUnlock: "any-clear",
};

/** Run-outcome facts the Extra-unlock policy is evaluated against — all already on hand at
 *  run-end (the outcome, the run's continue count, the run's difficulty rank). */
export interface ExtraUnlockFacts {
  /** Whether the run cleared (vs. ended at game-over). */
  readonly cleared: boolean;
  /** Continues spent over the run. */
  readonly continuesUsed: number;
  /** The run's difficulty rank (0-based index into the game's difficulties, easiest-first). */
  readonly difficulty: number;
}

/**
 * Decide whether a finished run should unlock the Extra stage, under `policy` (defaulting to
 * `"any-clear"` when unset). Pure and total — returns false for a non-clear regardless of
 * policy, so a caller can invoke it on any run-end. See `ExtraUnlockPolicy` for the modes.
 */
export function evaluateExtraUnlock(
  policy: ExtraUnlockPolicy | undefined,
  facts: ExtraUnlockFacts,
): boolean {
  if (!facts.cleared) return false;
  switch (policy ?? "any-clear") {
    case "no-continue-normal-plus":
      return facts.continuesUsed === 0 && facts.difficulty >= 1;
    case "any-clear":
    default:
      return true;
  }
}
