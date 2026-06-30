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
import type { RunConfig } from "./config";
import type { PlayerConfig } from "../touhou/player";
import type { ShotConfig } from "../touhou/shot";

/**
 * One stage of a game. The `script` is the scene root: a coroutine (boss idiom) that
 * orchestrates the whole stage — directing enemy waves, then `yield* ctx.boss(...)`-ing
 * each encounter (a midboss, then the final boss) and resuming when it falls. The
 * `boss` is the stage's headline boss, run by `ctx.boss()` with no argument (kept a
 * named field so it can be hot-reloaded by name); a midboss is passed to `ctx.boss()`
 * explicitly by the script.
 */
export interface StageDef {
  readonly id: string;
  /** The stage's scene-root coroutine. */
  readonly script: StageScript;
  /** The stage's headline boss, run by `ctx.boss()` with no argument, if any. */
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

/**
 * One selectable difficulty — purely the select screen's display data. The game
 * authors the name and an optional blurb; a different game writes its own. The RANK
 * the sim runs at is this entry's INDEX in `difficulties` (0-based), surfaced to
 * content as `ctx.difficulty`; the engine holds no multiplier table, so the game's
 * own scripts decide what a higher rank means. `id` is a stable key (for saves/
 * replays) independent of the display label.
 */
export interface DifficultyDef {
  readonly id: string;
  /** Display name on the select screen (e.g. "Normal", "Lunatic"). */
  readonly label: string;
  /** Optional one-line blurb shown when this difficulty is highlighted. */
  readonly description?: string;
}

/** The engine's fallback difficulty list for a game that authors none: a single
 *  "Normal" rank (index 0). A game with real difficulty tiers supplies its own. */
export const DEFAULT_DIFFICULTIES: readonly DifficultyDef[] = [{ id: "normal", label: "Normal" }];

export interface GameDefinition {
  /** Title shown on the title screen. */
  readonly title: string;
  /** Run seed — the single root the run's randomness derives from. */
  readonly seed: number;
  /** Ordered stages. The slice runs the first as the only stage. */
  readonly stages: readonly StageDef[];
  /** Playable characters. The slice uses the first as the default. */
  readonly characters: readonly CharacterDef[];
  /** Selectable difficulties, ordered easiest-first; the chosen entry's INDEX is the
   *  rank passed to the sim as `ctx.difficulty`. Display data only (the game's own
   *  scripts scale on the rank). Optional — `DEFAULT_DIFFICULTIES` (a single "Normal")
   *  applies when omitted, so a minimal game needn't author any. */
  readonly difficulties?: readonly DifficultyDef[];
  /** Run rules — scoring economy, item tuning, continues. Construction input (not
   *  hashed); `DEFAULT_RUN_CONFIG` is a ready default a game can use or override. */
  readonly config: RunConfig;
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
