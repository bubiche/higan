// Stage 2's midboss — a short two-phase encounter the stage runs partway through.
//
// Same public boss API as every other boss here; "midboss" is only WHERE the stage runs
// it (mid-stage, `yield*`-awaited so the waves resume when it falls). Its repertoire is
// distinct from the Stage 1 midboss's accelerating pinwheel: a warm approach fan and a
// rippling ring moiré. Pure of (rng, tick, target), so it replays and hot-reloads.

import { type BossScript, type BossVisual, type EmitterScript, curve, Shape } from "higan";
import { scale } from "../../difficulty";
import { demoSprites } from "../../sprites";

const EMBER: readonly [number, number, number] = [1.0, 0.5, 0.2];
const ROSE: readonly [number, number, number] = [1.0, 0.45, 0.55];
const GOLD: readonly [number, number, number] = [1.0, 0.82, 0.4];

/** Phase 0 — "Kindling": a non-spell approach. Aimed ember fans over a slow jittered
 *  backing ring (the rng path, so a replay must capture the seed — and does). */
const kindling: EmitterScript = function* (ctx) {
  let spin = 0;
  while (true) {
    ctx.aimed({ count: scale(ctx.difficulty, 3, 1), spread: 0.44, speed: 135, radius: 4, color: EMBER, sprite: Shape.Rice });
    ctx.ring({
      count: scale(ctx.difficulty, 11, 2),
      speed: 58,
      angle: spin + ctx.rng.range(-0.1, 0.1),
      radius: 4,
      color: ROSE,
      sprite: Shape.Orb,
    });
    spin += 0.37;
    yield 28;
  }
};

/** Phase 1 — "Ember Sign 「Rippling Sparks」": full rings on a steady beat, each rotated by
 *  a fixed off-angle from the last and given a slow curl, so successive rings interleave
 *  into an expanding moiré ripple rather than a clean radial. A clean, readable spell. */
const ripplingSparks: EmitterScript = function* (ctx) {
  let off = 0;
  while (true) {
    ctx.ring({
      count: scale(ctx.difficulty, 13, 2),
      speed: 96,
      angle: off,
      radius: 4,
      color: GOLD,
      sprite: Shape.Star,
      behavior: curve(0.5), // a gentle curl so rings shear into ripples
    });
    off += 0.61; // a fixed off-beat rotation → interleaving rings
    yield scale(ctx.difficulty, 16, -2);
  }
};

/** The Stage 2 midboss: a short two-phase fight (one approach + one spell). */
export const EMBER_MIDBOSS: BossScript = function* (b) {
  yield* b.phase({ name: "Kindling", hp: 440, timeLimit: 720 }, kindling);
  yield* b.phase({ name: "Ember Sign 「Rippling Sparks」", hp: 660, timeLimit: 1000, isSpell: true }, ripplingSparks);
};

/** The Stage 2 midboss body — the SAME shared familiar sprite as Stage 1's midboss, tinted
 *  ember-rose here (the white + tint idiom: one silhouette, a different look per encounter). */
export const EMBER_MIDBOSS_VISUAL: BossVisual = {
  sprite: demoSprites.midbossBody,
  color: [1.0, 0.6, 0.5], // ember-rose
  radius: 22,
};
