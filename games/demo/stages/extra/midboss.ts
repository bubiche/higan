// The Extra stage's midboss — a short two-phase encounter partway through the far shore.
//
// Same public boss API as every other boss here; "midboss" is only WHERE the stage runs it.
// Its repertoire is distinct from the campaign midbosses: a whirling petal spiral and a
// crossing wave lattice, both pitched a notch denser than the Stage 3 midboss to set the
// Extra stage's harder tone. Pure of (rng, tick, target), so it replays and hot-reloads. It
// stays stationary — the moving boss is the finale below it.

import { type BossScript, type BossVisual, type EmitterScript, curve, wave, Shape } from "higan";
import { scale } from "../../difficulty";
import { demoSprites } from "../../sprites";

const CRIMSON: readonly [number, number, number] = [1.0, 0.25, 0.35];
const SCARLET: readonly [number, number, number] = [1.0, 0.45, 0.25];
const BONE: readonly [number, number, number] = [1.0, 0.9, 0.8];

/** Phase 0 — "Petalfall": a non-spell approach. A fast whirling spiral of small orbs given a
 *  gentle curl (successive rings shear into a spreading bloom) over an aimed bone volley; a
 *  little rng jitter keeps the seeded path exercised. */
const petalfall: EmitterScript = function* (ctx) {
  let arm = 0;
  while (true) {
    ctx.ring({
      count: scale(ctx.difficulty, 12, 2),
      speed: 78,
      angle: arm + ctx.rng.range(-0.08, 0.08),
      radius: 4,
      color: CRIMSON,
      sprite: Shape.Orb,
      behavior: curve(0.65),
    });
    ctx.aimed({ count: scale(ctx.difficulty, 3, 1), spread: 0.4, speed: 160, radius: 4, color: BONE, sprite: Shape.Rice });
    arm += 0.52;
    yield 24;
  }
};

/** Phase 1 — "Tide Sign 「Crossing Wake」": fast aimed streams that snake (the `wave` "fake
 *  laser" leg) into crossing wakes, punctuated by a steady scarlet backing ring, so the player
 *  threads moving lanes rather than a static wall. */
const crossingWake: EmitterScript = function* (ctx) {
  let a = 0;
  while (true) {
    // Difficulty adds a snaking lane per rank so the hardest-to-read aimed pressure thins on
    // Easy rather than staying fixed.
    for (let i = 0; i < scale(ctx.difficulty, 3, 1); i++) {
      ctx.aimed({ count: 1, speed: 168, radius: 4, color: SCARLET, sprite: Shape.Oval, behavior: wave(22, 5) });
    }
    ctx.ring({ count: scale(ctx.difficulty, 13, 2), speed: 88, angle: a, radius: 4, color: CRIMSON, sprite: Shape.Orb });
    a += 0.46;
    yield scale(ctx.difficulty, 22, -3);
  }
};

/** The Extra midboss: a short two-phase fight (one approach + one spell). */
export const SHOREKEEPER_MIDBOSS: BossScript = function* (b) {
  yield* b.phase({ name: "Petalfall", hp: 560, timeLimit: 820 }, petalfall);
  yield* b.phase({ name: "Tide Sign 「Crossing Wake」", hp: 820, timeLimit: 1120, isSpell: true }, crossingWake);
};

/** The Extra midboss body — the SAME shared familiar sprite as the campaign midbosses, tinted
 *  deep crimson here (one silhouette, a different look per encounter). */
export const SHOREKEEPER_MIDBOSS_VISUAL: BossVisual = {
  sprite: demoSprites.midbossBody,
  color: [1.0, 0.35, 0.42], // far-shore crimson
  radius: 22,
};
