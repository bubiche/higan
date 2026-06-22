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

import type { ScenePattern } from "./emitter";
import type { BossScript } from "./boss";
import type { PlayerConfig } from "../touhou/player";

/**
 * One stage of a game. For now the scene is the boss (an emitter-of-emitters) plus
 * an optional showcase-style pattern cycle — exactly what the sim accepts today.
 * The richer stage-script-as-scene-root shape arrives with the sim economy work.
 */
export interface StageDef {
  readonly id: string;
  /** The boss this stage runs, if any. */
  readonly boss?: BossScript;
  /** A pattern cycle the scene runs (used when there is no boss). */
  readonly patterns?: readonly ScenePattern[];
}

/** A playable character: its tuning config (shot/bomb/hitbox graduate here later). */
export interface CharacterDef {
  readonly id: string;
  readonly config: PlayerConfig;
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
