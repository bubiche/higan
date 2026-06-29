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

export { defineGame, type GameDefinition, type StageDef, type CharacterDef } from "./game";

export { DEFAULT_SHOT_CONFIG, type ShotConfig } from "../touhou/shot";

export {
  linear,
  accelerate,
  ramp,
  home,
  curve,
  delay,
  wave,
  type BulletBehavior,
} from "./controllers";
export { Shape } from "../render/shapes";
