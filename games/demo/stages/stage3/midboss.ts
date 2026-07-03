// Stage 3's midboss — a short two-phase encounter partway through the final stage.
//
// Same public boss API as every other boss here; "midboss" is only WHERE the stage runs it
// (mid-stage, `yield*`-awaited so the waves resume when it falls). Its repertoire is distinct
// from both earlier midbosses (Stage 1's accelerating pinwheel, Stage 2's approach-fan +
// moiré): a spreading stardust spiral and snaking comet trails. Pure of (rng, tick, target),
// so it replays and hot-reloads. It stays stationary — the moving boss is the finale below it.

import { type BossScript, type BossVisual, type EmitterScript, curve, wave, Shape } from "higan";
import { scale } from "../../difficulty";
import { demoSprites } from "../../sprites";

const INDIGO: readonly [number, number, number] = [0.55, 0.5, 1.0];
const SILVER: readonly [number, number, number] = [0.82, 0.88, 1.0];
const CYAN: readonly [number, number, number] = [0.5, 0.9, 1.0];

/** Phase 0 — "Stardust": a non-spell approach. A slow spiral of small orbs given a gentle
 *  curl (successive rings shear into a spreading galaxy) over an aimed silver volley; a
 *  little rng jitter keeps the seeded path exercised. */
const stardust: EmitterScript = function* (ctx) {
  let arm = 0;
  while (true) {
    ctx.ring({
      count: scale(ctx.difficulty, 10, 2),
      speed: 70,
      angle: arm + ctx.rng.range(-0.08, 0.08),
      radius: 4,
      color: INDIGO,
      sprite: Shape.Orb,
      behavior: curve(0.6),
    });
    ctx.aimed({ count: scale(ctx.difficulty, 3, 1), spread: 0.42, speed: 150, radius: 4, color: SILVER, sprite: Shape.Rice });
    arm += 0.5;
    yield 26;
  }
};

/** Phase 1 — "Comet Sign 「Comet Trail」": fast aimed streams that snake (the `wave` "fake
 *  laser" leg) into curving comet tails, punctuated by a steady backing ring, so the player
 *  reads and threads moving lanes rather than a static wall. */
const cometTrail: EmitterScript = function* (ctx) {
  let a = 0;
  while (true) {
    // Difficulty adds a snaking comet lane per rank (one at Easy up to four at Lunatic), so
    // the aimed pressure — the hardest part to read — thins on Easy rather than staying fixed.
    for (let i = 0; i < scale(ctx.difficulty, 2, 1); i++) {
      ctx.aimed({ count: 1, speed: 160, radius: 4, color: CYAN, sprite: Shape.Oval, behavior: wave(20, 5) });
    }
    ctx.ring({ count: scale(ctx.difficulty, 12, 2), speed: 84, angle: a, radius: 4, color: INDIGO, sprite: Shape.Orb });
    a += 0.44;
    yield scale(ctx.difficulty, 24, -3);
  }
};

/** The Stage 3 midboss: a short two-phase fight (one approach + one spell). */
export const NOCTURNE_MIDBOSS: BossScript = function* (b) {
  yield* b.phase({ name: "Stardust", hp: 480, timeLimit: 760 }, stardust);
  yield* b.phase({ name: "Comet Sign 「Comet Trail」", hp: 720, timeLimit: 1040, isSpell: true }, cometTrail);
};

/** The Stage 3 midboss body — the SAME shared familiar sprite as the other midbosses, tinted
 *  cool indigo here (the white + tint idiom: one silhouette, a different look per encounter). */
export const NOCTURNE_MIDBOSS_VISUAL: BossVisual = {
  sprite: demoSprites.midbossBody,
  color: [0.62, 0.6, 1.0], // astral indigo
  radius: 22,
};
