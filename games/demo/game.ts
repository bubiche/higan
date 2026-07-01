// The reference game definition.
//
// This is the engine/game boundary in practice: the game is authored entirely as
// data handed to `defineGame`, importing only the public API and its own content.
// The shell runs over this — nothing under `src/` knows it exists.
//
// For now it is a single stage (the demo boss) and one default character. The
// engine's sim economy work (player shots, enemies, items, scoring, multiple
// stages) expands what a stage and character carry; this grows with it.

import {
  defineGame,
  DEFAULT_RUN_CONFIG,
  DEFAULT_PLAYER_CONFIG,
  Shape,
  type ShotConfig,
  type BombConfig,
} from "higan";
import { DEMO_BOSS } from "./patterns/boss";
import { demoStage } from "./patterns/stage";
import { demoAudio } from "./audio";
import { demoSprites } from "./sprites";
import { demoPortraits } from "./portraits";
import { demoBackgroundLayers } from "./background";

// Two reference characters — authored content (a different game defines its own with
// zero engine change). They differ in BOTH halves of the offense: the shot (how you
// deal damage) and the bomb (the panic-clear). That contrast is the engine litmus —
// a character swap must change the bomb, not just the shot.

// ── Spread: the all-rounder. A pale needle that points along travel; focus
// concentrates it into a tight column for single-target DPS on the boss, unfocus fans
// it wider. Its bomb is the engine default (omitted below): a full-screen defensive
// clear, no boss damage — pure survival.
const SPREAD_SHOT: ShotConfig = {
  fireInterval: 4,
  speed: 640,
  damage: 10,
  radius: 5,
  sprite: Shape.Kunai,
  color: [0.6, 0.9, 1.0],
  baseStreams: 2,
  powerPerStream: 32,
  maxStreams: 6,
  spread: 0.16,
  focusSpreadFrac: 0.2,
};

// ── Focus: the glass cannon. A narrow gold column — fewer, harder-hitting stars in a
// near-straight line, so almost everything lands on a centred boss (high single-target
// DPS, little crowd coverage). Its bomb is OFFENSIVE: a partial-screen radial clear
// around the player (leaves the field edges) that also lurches the boss's HP bar — the
// visible counterpoint to Spread's full-screen no-damage clear.
const FOCUS_SHOT: ShotConfig = {
  fireInterval: 4,
  speed: 680,
  damage: 20,
  radius: 5,
  sprite: Shape.Star,
  color: [1.0, 0.9, 0.4],
  baseStreams: 2,
  powerPerStream: 32,
  maxStreams: 4,
  spread: 0.06,
  focusSpreadFrac: 0.15,
};

const FOCUS_BOMB: BombConfig = {
  bossDamage: 300, // a visible ~1/3-of-a-phase chunk off the boss bar (phases are 700–1100 HP)
  radius: 140, // clears around the player but not the field edges (field is 384×448)
  clearLasers: true,
  vacuumItems: true,
};

export const demoGame = defineGame({
  title: "HIGAN",
  seed: 0x1a9e,
  stages: [
    {
      id: "stage-1",
      script: demoStage,
      boss: DEMO_BOSS,
      // Presentation identity for the boss splash / nameplate / spell cut-in. The portrait is
      // a `demoPortraits` handle (NOT in `assets.sprites.library`) so it resolves to a DOM
      // cut-in image rather than an atlas layer.
      bossInfo: { name: "Azure Gatekeeper", portrait: demoPortraits.gatekeeper },
      music: { stage: "stage1", boss: "boss1" },
      background: { layers: demoBackgroundLayers },
    },
  ],
  // Two characters: Spread (default defensive bomb — omitted, so it uses the engine
  // default) and Focus (an explicit offensive bomb). Both share the run's player config;
  // a different game would tune lives/speed per character too.
  characters: [
    { id: "Spread", config: DEFAULT_PLAYER_CONFIG, shot: SPREAD_SHOT, sprite: demoSprites.player, portrait: demoPortraits.heroine },
    { id: "Focus", config: DEFAULT_PLAYER_CONFIG, shot: FOCUS_SHOT, bomb: FOCUS_BOMB, sprite: demoSprites.player, portrait: demoPortraits.heroine },
  ],
  // Four difficulties, easiest-first — the chosen entry's INDEX is the rank the content
  // scales on (see `./difficulty`: Easy 0 … Lunatic 3, with NORMAL the unscaled anchor).
  // The labels/blurbs are this game's own; the engine has no opinion on them. A different
  // game writes its own list and its own scaling, zero engine change.
  difficulties: [
    { id: "easy", label: "Easy", description: "Thinner waves — a gentle first read of the patterns." },
    { id: "normal", label: "Normal", description: "The intended fight. Balanced density." },
    { id: "hard", label: "Hard", description: "Denser fans and rings; tighter gaps to thread." },
    { id: "lunatic", label: "Lunatic", description: "Maximum density. For players who have it memorised." },
  ],
  // The reference game uses the engine's default run rules (scoring economy, item
  // tuning, continues). A real game spreads these and overrides what it wants.
  config: DEFAULT_RUN_CONFIG,
  // Presentation assets — the game's own BGM tracks (see ./audio) and sprite library (see
  // ./sprites; enemies/player reference its handles, items use the engine defaults). SFX use
  // the engine defaults (no override map). Outside the sim: adding this doesn't touch any
  // determinism baseline or the replay configId (which fingerprints only gameplay data).
  assets: { audio: demoAudio, sprites: { library: demoSprites } },
});
