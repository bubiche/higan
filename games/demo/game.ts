// The reference game definition.
//
// This is the engine/game boundary in practice: the game is authored entirely as
// data handed to `defineGame`, importing only the public API and its own content.
// The shell runs over this — nothing under `src/` knows it exists.
//
// It is a three-stage main campaign plus a standalone Extra stage (each stage a
// self-contained folder under `stages/` holding its scene script, boss, and midboss)
// with three characters. A run chains the main stages in order, handing
// score/lives/bombs/power across each boundary; clearing the last main stage rolls the
// ending. The `extra: true` stage sits outside that chain — reached only as a standalone
// single-stage run once it is unlocked. Adding a stage is adding a folder + one entry in
// the `stages` array below — no engine change.

import {
  defineGame,
  DEFAULT_RUN_CONFIG,
  DEFAULT_PLAYER_CONFIG,
  Shape,
  type ShotConfig,
  type BombConfig,
} from "higan";
import { DEMO_BOSS } from "./stages/stage1/boss";
import { demoStage } from "./stages/stage1/stage";
import { EMBER_BOSS } from "./stages/stage2/boss";
import { emberStage } from "./stages/stage2/stage";
import { NOCTURNE_BOSS } from "./stages/stage3/boss";
import { nocturneStage } from "./stages/stage3/stage";
import { SHOREKEEPER_BOSS } from "./stages/extra/boss";
import { shoreStage } from "./stages/extra/stage";
import { demoAudio, demoBgm } from "./audio";
import { demoSprites } from "./sprites";
import { demoPortraits } from "./portraits";
import {
  demoBackgroundLayers,
  demoStage2BackgroundLayers,
  demoStage3BackgroundLayers,
  demoExtraBackgroundLayers,
  demoMenuBackgroundLayers,
} from "./background";

// Three reference characters — authored content (a different game defines its own
// with zero engine change). Spread and Focus differ in BOTH halves of the offense:
// the shot (how you deal damage) and the bomb (the panic-clear) — that contrast is
// the engine litmus, a character swap must change the bomb, not just the shot.
// Homing is the third shot idiom the engine's shot config supports: a tracking
// stream mixed alongside the straight one.

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

// ── Homing: weak tracking amulets mixed with a thin center needle while unfocused
// (breadth without much single-shot power); focus drops the amulets entirely and
// switches the needle to a much stronger column via `focusDamage` — the "stronger
// straight bullets when focused" contrast, on top of Spread/Focus's spread contrast.
// Its bomb is the engine default (omitted below), like Spread's.
const HOMING_SHOT: ShotConfig = {
  fireInterval: 4,
  speed: 600,
  damage: 7,
  focusDamage: 26,
  radius: 5,
  sprite: Shape.Kunai,
  color: [1.0, 0.55, 0.75],
  baseStreams: 1,
  powerPerStream: 40,
  maxStreams: 3,
  spread: 0.05,
  focusSpreadFrac: 0.6,
  homing: {
    fireInterval: 9,
    streams: 2,
    damage: 4,
    speed: 380,
    turnRate: 2.2,
    radius: 5,
    sprite: Shape.Ofuda,
    color: [1.0, 0.85, 0.3],
    spread: 0.55,
  },
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
      music: { stage: demoBgm.stage1, boss: demoBgm.boss1 },
      background: { layers: demoBackgroundLayers },
    },
    {
      id: "stage-2",
      script: emberStage,
      boss: EMBER_BOSS,
      bossInfo: { name: "Ember Songstress", portrait: demoPortraits.songstress },
      music: { stage: demoBgm.stage2, boss: demoBgm.boss2 },
      background: { layers: demoStage2BackgroundLayers },
    },
    {
      id: "stage-3",
      script: nocturneStage,
      boss: NOCTURNE_BOSS,
      bossInfo: { name: "Nocturne Sovereign", portrait: demoPortraits.nocturne },
      music: { stage: demoBgm.stage3, boss: demoBgm.boss3 },
      background: { layers: demoStage3BackgroundLayers },
    },
    {
      // The Extra stage. `extra: true` keeps it OUT of the main-campaign chain (the run
      // controller only chains non-extra stages); it is reachable solely as a standalone
      // single-stage run from the title's Extra entry, which appears once `unlocks.extra` is
      // set (clearing Stage 3). Its far-shore theme is the game's one real audio FILE and its
      // background far layer the one real image FILE — the reference url-asset examples.
      id: "extra",
      extra: true,
      script: shoreStage,
      boss: SHOREKEEPER_BOSS,
      bossInfo: { name: "Crimson Shorekeeper", portrait: demoPortraits.shorekeeper },
      music: { stage: demoBgm.extra, boss: demoBgm.bossExtra },
      background: { layers: demoExtraBackgroundLayers },
    },
  ],
  // Three characters: Spread and Homing share the default defensive bomb (omitted);
  // Focus has an explicit offensive bomb. All share the run's player config; a
  // different game would tune lives/speed per character too.
  characters: [
    {
      id: "Spread",
      description: "The all-rounder. Wide unfocused fans for crowds; focus tightens it into a column.",
      config: DEFAULT_PLAYER_CONFIG,
      shot: SPREAD_SHOT,
      sprite: demoSprites.player,
      portrait: demoPortraits.heroine,
    },
    {
      id: "Focus",
      description: "The glass cannon. A narrow column of hard-hitting stars, and an offensive bomb.",
      config: DEFAULT_PLAYER_CONFIG,
      shot: FOCUS_SHOT,
      bomb: FOCUS_BOMB,
      sprite: demoSprites.player,
      portrait: demoPortraits.heroine,
    },
    {
      id: "Homing",
      description: "Tracking amulets while unfocused; focus drops them for a much stronger needle.",
      config: DEFAULT_PLAYER_CONFIG,
      shot: HOMING_SHOT,
      sprite: demoSprites.player,
      portrait: demoPortraits.heroine,
    },
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
  // Game-level scenery behind the title/character-select/options screens — independent of
  // stage 1's own `background` (see ./background). Presentation-only, same as above.
  menuBackground: { layers: demoMenuBackgroundLayers },
  // Staff-roll shown on the final-stage clear, before results. The screen frames these
  // lines with the game title and a closing card; blanks are spacers. Presentation-only.
  ending: {
    lines: [
      "A danmaku demo",
      "built on the Higan engine",
      "",
      "Bullets, bosses, and stages",
      "authored entirely in the game layer",
      "",
      "— Staff —",
      "",
      "Design & Programming",
      "The Higan Project",
      "",
      "In the lineage of the",
      "Touhou Project shooting games",
      "",
      "See you again",
    ],
  },
});
