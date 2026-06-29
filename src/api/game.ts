// The game composition root — the typed definition the shell runs OVER.
//
// This is the engine/game dividing line. A game is authored as data: a title, a
// run seed, an ordered list of stages, and the playable characters. The shell
// (`src/app`) consumes a `GameDefinition` the same way the sim consumes a seed and
// a boss script — injected, never hardcoded. The reference game lives under
// `games/` and is the ONLY thing that imports its own content; `src/core|api|
// touhou|render|audio` never import `games/`.
//
// Deliberately small. It defines exactly enough surface to place that boundary and
// drive the title→in-game→results flow over real game data. The per-system
// authoring surfaces (richer stage scripts, shot/bomb definitions, scoring rules,
// asset slots, menus) are extracted at the seam as the reference game grows a
// second consumer — a stable API with a single consumer is the wrong abstraction.

import type { StageScript } from "./stage";
import type { BossScript } from "./boss";
import type { PlayerConfig } from "../touhou/player";
import type { ShotConfig } from "../touhou/shot";

/**
 * One stage of a game. The `script` is the scene root: a coroutine (boss idiom) that
 * orchestrates the whole stage, calling `ctx.spawnBoss()` when it's time for the
 * boss. The `boss` is the script the stage spawns; the enemy/wave content the script
 * fires arrives with the sim economy work (#2b).
 */
export interface StageDef {
  readonly id: string;
  /** The stage's scene-root coroutine. */
  readonly script: StageScript;
  /** The boss this stage spawns (via `ctx.spawnBoss()`), if any. */
  readonly boss?: BossScript;
}

/** A playable character: its movement/life tuning plus its shot definition. (Bomb
 *  def graduates here later, alongside scoring.) */
export interface CharacterDef {
  readonly id: string;
  readonly config: PlayerConfig;
  /** The character's player-shot definition. Defaults to the engine's standard shot
   *  if omitted, so a minimal game needn't author one. */
  readonly shot?: ShotConfig;
}

export interface GameDefinition {
  /** Title shown on the title screen. */
  readonly title: string;
  /** Run seed — the single root the run's randomness derives from. */
  readonly seed: number;
  /** Ordered stages. The slice runs the first as the only stage. */
  readonly stages: readonly StageDef[];
  /** Playable characters. The slice uses the first as the default. */
  readonly characters: readonly CharacterDef[];
}

/**
 * Validate and normalize a game definition. Returns the definition the shell runs.
 * Throws on a structurally invalid game so authoring mistakes surface at boot
 * rather than as a blank screen.
 */
export function defineGame(def: GameDefinition): GameDefinition {
  if (def.stages.length === 0) {
    throw new Error("defineGame: a game needs at least one stage.");
  }
  if (def.characters.length === 0) {
    throw new Error("defineGame: a game needs at least one playable character.");
  }
  return def;
}
