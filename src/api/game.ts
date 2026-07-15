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
import type { BombConfig } from "../touhou/bomb";
import type { AssetManifest, BgmHandle } from "./audio";
import type { SpriteHandle, BackgroundLayer } from "./sprites";

/**
 * A boss's presentation identity — its display name (shown on the nameplate + the
 * appear splash) and cut-in portrait (shown when it declares a spell card). Purely
 * presentation, and a SIBLING of `music`/`background` on `StageDef` for exactly that
 * reason: the shell reads it to drive the boss splash / nameplate / spell cut-in, and
 * the sim never sees it — so it never touches a determinism baseline or the replay
 * `configId`. The `portrait` is a `SpriteHandle` (from a `defineSprites` block) resolved
 * to a DOM image rather than atlased, so declare it OUTSIDE `assets.sprites.library`
 * (the same routing rule backgrounds follow — a handle is atlased only if it's in the
 * library). This describes the stage's HEADLINE boss; a midboss run via `ctx.boss(script)`
 * has no nameplate yet (a documented extension, not built for the slice).
 */
export interface BossInfo {
  /** Display name for the nameplate + the appear splash (e.g. a character/boss name). */
  readonly name?: string;
  /** Cut-in portrait, shown when the boss declares a spell card. DOM-resolved from its
   *  source; declare the handle outside `assets.sprites.library` so it isn't atlased. */
  readonly portrait?: SpriteHandle;
}

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
  /** Display name shown on the stage-opening splash (e.g. "Stage 1", "Extra Stage").
   *  Presentation-only, read by the shell — never by the sim (a sibling of `music`/
   *  `background`/`bossInfo`). Omit for no splash. */
  readonly title?: string;
  /** Optional second line on the splash, under `title` (e.g. a place/scene name). Shown only
   *  when `title` is set. Presentation-only. */
  readonly subtitle?: string;
  /** The stage's headline boss, run by `ctx.boss()` with no argument, if any. */
  readonly boss?: BossScript;
  /** The headline boss's presentation identity (nameplate name + spell cut-in portrait).
   *  Presentation-only, read by the shell — never by the sim (a sibling of `music`/
   *  `background`). Omit for a boss with no splash/nameplate/cut-in. */
  readonly bossInfo?: BossInfo;
  /** BGM for the stage, as handles from `assets.audio.bgm` (a `defineBgm` result): `stage`
   *  plays during the stage, `boss` (if given) during a boss encounter. Presentation-only —
   *  the in-game screen reads sim state and asserts the theme; the sim never sees this.
   *  Omit for a silent stage. */
  readonly music?: { readonly stage: BgmHandle; readonly boss?: BgmHandle };
  /** The stage's parallax background: layers drawn full-field BEHIND the danmaku,
   *  back-to-front in array order. Each names a `SpriteHandle` (from `defineSprites`) —
   *  referenced HERE, not in `assets.sprites.library` (the background pass loads it at full
   *  resolution). Presentation-only — scroll runs off a wall clock, never the sim, so it
   *  never touches a determinism baseline or the replay configId. Omit for a bare field. */
  readonly background?: { readonly layers: readonly BackgroundLayer[] };
  /** Marks this stage as an EXTRA stage — outside the main campaign chain. A normal run
   *  chains the non-`extra` stages in `def.stages` order and hands run-state across each
   *  boundary; an `extra` stage is entered only as a standalone single-stage run (full
   *  resources, no advance-to-next). Default false. Keeping ONE `stages[]` array (rather
   *  than a separate list) preserves the single stage-index space replays record. */
  readonly extra?: boolean;
}

/** A playable character: its movement/life tuning plus its shot and bomb definitions. */
export interface CharacterDef {
  readonly id: string;
  /** Display name on the character-select screen, if it should differ from the stable
   *  `id` (which keys saves/replays). Optional — the `id` is shown when omitted. */
  readonly name?: string;
  /** One-line blurb shown when this character is highlighted on select — flavor / a
   *  hint at the shot's feel. Mirrors `DifficultyDef.description`. Optional. */
  readonly description?: string;
  /** Marks this character as locked: it appears on select but can't be chosen (rendered
   *  as a placeholder row). Default false. Presentation/meta only — a locked character is
   *  never selectable, so it never reaches the sim. The reference game ships every
   *  character unlocked; this is infra for a game that gates part of its roster. */
  readonly locked?: boolean;
  readonly config: PlayerConfig;
  /** The character's player-shot definition. Defaults to the engine's standard shot
   *  if omitted, so a minimal game needn't author one. */
  readonly shot?: ShotConfig;
  /** The character's bomb definition. Defaults to the engine's full-screen defensive
   *  bomb (`DEFAULT_BOMB_CONFIG`) if omitted, so a minimal game needn't author one. */
  readonly bomb?: BombConfig;
  /** The player craft sprite (render-only), from `defineSprites`. Optional — omit to use
   *  the engine's default player sprite. */
  readonly sprite?: SpriteHandle;
  /** The character's cut-in portrait, shown when THIS character bombs. Presentation-only,
   *  DOM-resolved from its source (declare it outside `assets.sprites.library` so it isn't
   *  atlased). Optional — omit for no bomb cut-in (the bomb flash/shake still fires). */
  readonly portrait?: SpriteHandle;
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
  /** Presentation assets (audio now; sprites/backgrounds later). Optional — a game with
   *  none is silent-but-valid, and the headless/determinism paths never touch it (it is
   *  presentation, outside the sim). */
  readonly assets?: AssetManifest;
  /** Game-level parallax scenery drawn behind the title / character-select / options
   *  screens — independent of any `StageDef.background` (the title isn't stage 1). Reuses
   *  the same `BackgroundLayer` vocabulary and renderer as stage backgrounds; each menu
   *  screen scrolls it on its own presentation clock. Presentation-only — never read by the
   *  sim, so it never touches a determinism baseline or the replay `configId`. Omit for a
   *  bare menu. */
  readonly menuBackground?: { readonly layers: readonly BackgroundLayer[] };
  /** Staff-roll shown when the final main-campaign stage is cleared, before results. The
   *  `lines` are the game's own credits (roles, names) scrolled bottom-to-top; the screen
   *  frames them with the game title and a closing card, and a blank string is a spacer.
   *  Purely presentation — a wall-clock scroll, never read by the sim, so it never touches a
   *  determinism baseline or the replay `configId`. Omit for a bare title + closing card. */
  readonly ending?: { readonly lines: readonly string[] };
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
  // Extra stages must come AFTER every main-campaign stage, so the main chain is a
  // contiguous prefix [0..m-1] of `stages`. That keeps each stage-advance a +1 step in
  // the shared stage-index space, which is what lets a replay distinguish an advance
  // (index +1) from a continue (same index) without storing the run's stage sequence.
  const firstExtra = def.stages.findIndex((s) => s.extra);
  if (firstExtra !== -1 && def.stages.slice(firstExtra).some((s) => !s.extra)) {
    throw new Error("defineGame: extra stages must come after all main-campaign stages.");
  }
  if (def.stages.every((s) => s.extra)) {
    throw new Error("defineGame: a game needs at least one main-campaign (non-extra) stage.");
  }
  return def;
}
