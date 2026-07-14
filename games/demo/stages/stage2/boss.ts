// Stage 2's headline boss — the Ember Songstress.
//
// Same public boss/emitter API as Stage 1 (four ordered phases, each spawning child
// emitters that fire dumb-data bullets), but a deliberately different repertoire: a
// breathing ring, a sweeping searchlight, decelerating "petal" blooms (the `ramp`
// speed-change leg), and a rotating three-beam "waltz" with snaking `wave` fill. So
// clearing this boss doesn't feel like re-fighting the Gatekeeper. Pure of (rng, tick,
// target) like every script here, so it stays deterministic, replayable, hot-reloadable.

import {
  type BossScript,
  type BossVisual,
  type EmitterScript,
  home,
  ramp,
  wave,
  Shape,
} from "higan";
import { scale } from "../../difficulty";
import { demoSprites } from "../../sprites";

// The stage's dusk/ember palette — warm, to contrast Stage 1's cool azure.
const EMBER: readonly [number, number, number] = [1.0, 0.5, 0.2];
const ROSE: readonly [number, number, number] = [1.0, 0.4, 0.5];
const GOLD: readonly [number, number, number] = [1.0, 0.82, 0.35];
const DUSK: readonly [number, number, number] = [0.72, 0.5, 1.0];
const ASH: readonly [number, number, number] = [1.0, 0.88, 0.72];

/** Phase 0 — "Overture": a non-spell warm-up. A backing ring whose count breathes on a
 *  slow cosine (the wall pulses rather than drums), punctuated by aimed gold darts. The
 *  rng jitter on the ring angle keeps the seeded-rng path under the replay/determinism net. */
const overture: EmitterScript = function* (ctx) {
  let t = 0;
  while (true) {
    const pulse = Math.round(3 * (1 + Math.cos(t))); // 0..6, the "breath"
    ctx.ring({
      count: scale(ctx.difficulty, 14, 2) + pulse,
      speed: 72,
      angle: t * 0.5 + ctx.rng.range(-0.06, 0.06),
      radius: 4,
      color: DUSK,
      sprite: Shape.Orb,
    });
    ctx.aimed({ count: scale(ctx.difficulty, 3, 1), spread: 0.42, speed: 165, radius: 4, color: GOLD, sprite: Shape.Kunai });
    t += 0.5;
    yield 24;
  }
};

/** Phase 1 — "Flame Sign 「Cinder Rondo」": a searchlight. A wide fan whose centre sweeps
 *  back and forth across the lower arc (a sine sweep around straight-down), with a snaking
 *  ember tracer threading the gaps — the `wave` "fake-laser" behavior, which Stage 1's boss
 *  never uses. Difficulty widens the fan and tightens the beat. */
const cinderRondo: EmitterScript = function* (ctx) {
  let phase = 0;
  while (true) {
    const centre = Math.PI / 2 + Math.sin(phase) * 0.95; // sweep centred on down
    ctx.fan({ count: scale(ctx.difficulty, 7, 1), angle: centre, spread: 0.5, speed: 150, radius: 4, color: EMBER, sprite: Shape.Rice });
    ctx.fire({ speed: 128, angle: centre, radius: 4, color: GOLD, sprite: Shape.Oval, behavior: wave(24, 5) });
    phase += 0.19;
    yield scale(ctx.difficulty, 7, -1);
  }
};

/** Phase 2 — "Bloom Sign 「Kiln Petals」": decelerating blooms. Each ring of soft bubbles is
 *  fired fast then RAMPED down in speed while curling (the `ramp` speed-change leg — again
 *  new vs Stage 1), so it opens into a hanging petal field instead of flying off; a fast
 *  aimed crystal cross forces the player out of the bloom. */
const kilnPetals: EmitterScript = function* (ctx) {
  let spin = 0;
  while (true) {
    ctx.ring({
      count: scale(ctx.difficulty, 12, 2),
      speed: 165,
      angle: spin,
      radius: 6,
      color: ROSE,
      sprite: Shape.Bubble,
      behavior: ramp(-80, 0.6), // decelerate + curl into a bloom
    });
    spin += 0.4;
    ctx.aimed({ count: scale(ctx.difficulty, 2, 1), spread: 0.2, speed: 240, radius: 4, color: GOLD, sprite: Shape.Crystal });
    yield 36;
  }
};

/** Phase 3 — "Ember Sign 「Phoenix Waltz」": a three-beat finale. Three beams a third-circle
 *  apart sweep together (telegraph → fire → fade), stepping a ninth of a turn per volley for
 *  a slow rotation; snaking ember fill weaves between them and a homing spark chases on the
 *  off-beat. A laser+home+wave mix distinct from Stage 1's Beam Rake. */
const phoenixWaltz: EmitterScript = function* (ctx) {
  let base = 0;
  while (true) {
    for (let i = 0; i < 3; i++) {
      ctx.laser({
        angle: base + (i / 3) * Math.PI * 2,
        length: 640,
        width: 12,
        color: i === 0 ? GOLD : EMBER,
        telegraph: 44,
        duration: 96,
        spin: 0.22,
      });
    }
    base += (Math.PI * 2) / 9; // a ninth per volley → a slow three-beat rotation
    for (let k = 0; k < 4; k++) {
      ctx.fire({ speed: 110, angle: base + k * 1.6, radius: 4, color: ASH, sprite: Shape.Oval, behavior: wave(20, 4) });
      if (k % 2 === 1) ctx.aimed({ count: 1, speed: 150, radius: 4, color: ROSE, sprite: Shape.Heart, behavior: home(1.2) });
      yield scale(ctx.difficulty, 22, -3);
    }
  }
};

/** The Ember Songstress: four ordered phases (one opening + three spell cards). */
export const EMBER_BOSS: BossScript = function* (b) {
  yield* b.phase({ name: "Overture", hp: 760, timeLimit: 960 }, overture);
  yield* b.phase({ name: "Flame Sign 「Cinder Rondo」", hp: 980, timeLimit: 1260, isSpell: true }, cinderRondo);
  yield* b.phase({ name: "Bloom Sign 「Kiln Petals」", hp: 980, timeLimit: 1260, isSpell: true }, kilnPetals);
  yield* b.phase({ name: "Ember Sign 「Phoenix Waltz」", hp: 1180, timeLimit: 1500, isSpell: true }, phoenixWaltz);
};

/** The Ember Songstress's on-field body, drawn at the boss origin during the encounter.
 *  Passed as the second `ctx.boss` argument (the headline boss takes no script). */
export const EMBER_BOSS_VISUAL: BossVisual = {
  sprite: demoSprites.songstressBody,
  color: [1.0, 0.55, 0.35], // ember, echoing her portrait
  radius: 30,
};
