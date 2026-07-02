// The Stage-1 midboss — a shorter, two-phase encounter the stage runs partway through.
//
// Authored against the SAME public boss API as the final boss: the only thing that
// makes it a "midboss" is WHERE the stage runs it (mid-stage, `yield*`-awaited so the
// waves resume when it falls), not anything structural. Its HP is tuned so a focused
// player drains each phase well inside the timer — a real fight, not a timed pause.
// Pure of (rng, tick, target) like every other script, so it replays and hot-reloads.

import { type BossScript, type EmitterScript, accelerate, Shape } from "higan";
import { scale } from "../../difficulty";

const ICE: readonly [number, number, number] = [0.6, 0.85, 1.0];
const ROSE: readonly [number, number, number] = [1.0, 0.6, 0.7];
const GOLD: readonly [number, number, number] = [1.0, 0.85, 0.45];

/** Phase 0 — a non-spell approach: aimed three-fans punctuated by a slow jittered
 *  ring (the rng path, so a replay must capture the seed — and does). */
const approach: EmitterScript = function* (ctx) {
  let spin = 0;
  while (true) {
    // Difficulty thickens the approach fan and its backing ring per rank.
    ctx.aimed({ count: scale(ctx.difficulty, 3, 1), spread: 0.4, speed: 130, radius: 4, color: ICE, sprite: Shape.Rice });
    ctx.ring({
      count: scale(ctx.difficulty, 12, 2),
      speed: 60,
      angle: spin + ctx.rng.range(-0.1, 0.1),
      radius: 4,
      color: ROSE,
      sprite: Shape.Orb,
    });
    spin += 0.4;
    yield 28;
  }
};

/** Phase 1 — "Pinwheel Sign 「Whirligig」": four arms of accelerating pellets sweeping
 *  steadily round — a clean, memorizable spell for the slice's midboss. */
const whirligig: EmitterScript = function* (ctx) {
  const arms = 4;
  let a = 0;
  while (true) {
    for (let i = 0; i < arms; i++) {
      const ang = a + (i / arms) * Math.PI * 2;
      ctx.fire({ speed: 70, angle: ang, radius: 4, color: GOLD, sprite: Shape.Star, behavior: accelerate(60) });
    }
    a += 0.22;
    yield 4;
  }
};

/** The Stage-1 midboss: a short two-phase fight (one approach + one spell). */
export const MIDBOSS: BossScript = function* (b) {
  yield* b.phase({ name: "Approach", hp: 420, timeLimit: 720 }, approach);
  yield* b.phase({ name: "Pinwheel Sign 「Whirligig」", hp: 620, timeLimit: 1000, isSpell: true }, whirligig);
};
