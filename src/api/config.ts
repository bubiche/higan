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

export interface RunConfig {
  /** Continues allowed per run (a continue rebuilds the run with reset score + restored
   *  lives). Read by the continue prompt; bounds the choice. */
  readonly continues: number;
  /** Scoring economy — point values, bonuses, extend thresholds. */
  readonly scoring: ScoringConfig;
  /** Item physics, collection, and drop/cancel tuning. */
  readonly item: ItemConfig;
}

/** The reference game's run rules (the engine's defaults). */
export const DEFAULT_RUN_CONFIG: RunConfig = {
  continues: 3,
  scoring: DEFAULT_SCORING,
  item: DEFAULT_ITEM_CONFIG,
};
