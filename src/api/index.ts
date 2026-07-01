// The authoring surface — what pattern modules import.
//
// A creator writes patterns against this barrel and nothing deeper:
//
//   import { type EmitterScript, accelerate, home, Shape } from "../../api";
//
//   export const myPattern: EmitterScript = function* (ctx) {
//     while (true) {
//       ctx.ring({ count: 24, speed: 90, sprite: Shape.Rice });
//       yield 20; // wait 20 ticks
//     }
//   };
//
// Determinism note for authors: use `ctx.rng` for all randomness and `ctx.tick`
// for all timing. Never read Date.now/performance.now/Math.random, or branch on
// unstable Set/Map iteration order — replays and hot-reload re-run your generator
// from the seed, and only pure-of-(rng, tick, target) code reproduces.

export type {
  EmitterScript,
  EmitterContext,
  ScenePattern,
  FireOpts,
  RingOpts,
  FanOpts,
  AimedOpts,
  LaserOpts,
  BulletGroup,
  Vec2,
} from "./emitter";

export type { BossScript, BossContext, PhaseSpec, PhaseResult } from "./boss";

export type { StageScript, StageContext, EnemySpec } from "./stage";

export { ItemType, type ItemDropTable } from "../touhou/item";

export {
  defineGame,
  DEFAULT_DIFFICULTIES,
  type GameDefinition,
  type StageDef,
  type BossInfo,
  type CharacterDef,
  type DifficultyDef,
} from "./game";

export {
  DEFAULT_RUN_CONFIG,
  type RunConfig,
  type ScoringConfig,
  type ItemConfig,
} from "./config";

export { DEFAULT_SHOT_CONFIG, type ShotConfig } from "../touhou/shot";
export { DEFAULT_BOMB_CONFIG, type BombConfig } from "../touhou/bomb";

// Audio authoring surface. `SfxId` is the sound vocabulary the sim emits against (an
// author provides the SOUND for an id; the engine owns WHEN it plays). The loader-slot
// types declare sound as data (`synth` now, `url` later — a one-line swap). `bgmLoop`
// is the engine's synth toolkit for composing functional placeholder BGM with no audio
// files. The engine ships a default sound per SfxId, but NO stock BGM — music is game
// identity, so a game composes its own tracks (docs/M7-PLAN.md §0.4).
export { SfxId } from "../core/events";
export type { SfxEvent } from "../core/events";
export type { SoundSource, SynthGen, BgmTrack, AudioManifest, AssetManifest } from "./audio";
export { bgmLoop, type BgmSpec } from "../audio/synth";

// Visual asset authoring surface — the loader-slot model for sprites (procedural stand-in
// now, real image later, a one-line swap), plus `defineSprites`, which names a game's art
// and returns TYPED handles referenced inline (a typo is a compile error, not a blank
// sprite). Backgrounds are declared per stage as layers of these handles. See sprites.ts.
export { defineSprites } from "./sprites";
export type {
  ImageSource,
  SpriteDef,
  SpriteHandle,
  SpriteManifest,
  BackgroundLayer,
} from "./sprites";

export {
  linear,
  accelerate,
  ramp,
  home,
  curve,
  delay,
  wave,
  staged,
  type BulletBehavior,
  type StagedSegment,
  type StagedEdit,
} from "./controllers";
export { Shape } from "../render/shapes";

// Engine constants and core types an author references directly: the fixed timestep
// and playfield dimensions (positioning content), the produced input frame (scripted
// runs / replays), and the default player config to build a character from. These are
// stable, presentation-agnostic primitives — re-exported here so a game imports only
// the public surface, never `../core/*`.
export { DT, PLAYFIELD_W, PLAYFIELD_H } from "../core/playfield";
export type { InputFrame } from "../core/input";
export { DEFAULT_PLAYER_CONFIG, type PlayerConfig } from "../touhou/player";
