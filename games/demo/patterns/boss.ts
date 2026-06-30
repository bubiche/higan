// The demo boss — authored against the public boss/emitter API.
//
// A boss is a coroutine that drives ordered phases (`yield* b.phase(...)`); each
// phase spawns child emitters that fire dumb-data bullets. Shoot it down before the
// timer to capture a spell (no death/bomb), or survive the timeout. Everything here
// goes through the typed surface and `ctx.rng`/`ctx.tick` only, so it stays
// deterministic and replayable — the boss runs script, the bullets never do.

import {
  type BossScript,
  type EmitterScript,
  accelerate,
  curve,
  home,
  Shape,
} from "../../../src/api";
import { scale } from "../difficulty";

const CYAN: readonly [number, number, number] = [0.45, 0.85, 1.0];
const MAGENTA: readonly [number, number, number] = [1.0, 0.45, 0.85];
const AMBER: readonly [number, number, number] = [1.0, 0.8, 0.4];
const GREEN: readonly [number, number, number] = [0.5, 1.0, 0.6];
const VIOLET: readonly [number, number, number] = [0.75, 0.6, 1.0];

/** Phase 0 — a non-spell opening: sweeping aimed rice over a slow backing ring. */
const opening: EmitterScript = function* (ctx) {
  let phase = 0;
  while (true) {
    // Difficulty thickens the aimed volley and the backing ring per rank.
    ctx.aimed({ count: scale(ctx.difficulty, 5, 1), speed: 150, spread: 0.6, radius: 4, color: CYAN, sprite: Shape.Rice });
    // A touch of rng jitter on the backing ring — exercises the seeded-rng path
    // (so a replay must capture the seed, which it does).
    ctx.ring({
      count: scale(ctx.difficulty, 16, 2),
      speed: 65,
      angle: phase + ctx.rng.range(-0.08, 0.08),
      radius: 4,
      color: VIOLET,
      sprite: Shape.Orb,
    });
    phase += 0.21;
    yield 22;
  }
};

/** Phase 1 — "Spiral Veil": two constant-curve arms (the `curve` alias) plus a
 *  counter-rotating sub-stream spawned with `ctx.sub` (cleared with the phase). */
const spiralVeil: EmitterScript = function* (ctx) {
  ctx.sub(function* (c) {
    let a = Math.PI;
    while (true) {
      c.fire({ speed: 115, angle: a, radius: 4, color: AMBER, sprite: Shape.Star, behavior: curve(-1.5) });
      a -= 0.31;
      yield 3;
    }
  });
  let a = 0;
  while (true) {
    ctx.fire({ speed: 115, angle: a, radius: 4, color: MAGENTA, sprite: Shape.Star, behavior: curve(1.5) });
    ctx.fire({ speed: 115, angle: a + Math.PI, radius: 4, color: MAGENTA, sprite: Shape.Star, behavior: curve(1.5) });
    a += 0.31;
    // Difficulty tightens the fire interval (Normal = 3, Lunatic = 1), so this spell's
    // climax also thickens with rank — not just the waves. Centred on Normal, so the
    // reference trajectory is unchanged; the emitter clamps the wait to ≥ 1 regardless.
    yield scale(ctx.difficulty, 3, -1);
  }
};

/** Phase 2 — "Hunting Snap": fire a slow drifting wave, let it spread, then snap the
 *  survivors straight at the player. The live-group-retarget consumer (generation
 *  stamps make reaching back into already-flying bullets safe). */
const huntingSnap: EmitterScript = function* (ctx) {
  while (true) {
    const wave = ctx.spawnGroup({ count: 26, speed: 52, radius: 5, color: GREEN, sprite: Shape.Orb });
    yield 40;
    wave.retarget(ctx.target.x, ctx.target.y, 210);
    yield 48;
  }
};

/** Phase 3 — "Beam Rake": sweeping straight beams with homing fill bullets between
 *  volleys; a finale that uses lasers + an accelerating aimed punctuation. */
const beamRake: EmitterScript = function* (ctx) {
  let dir = 1;
  while (true) {
    const n = 4;
    const spread = 1.0;
    for (let i = 0; i < n; i++) {
      const ang = Math.PI / 2 - spread / 2 + (i / (n - 1)) * spread;
      ctx.laser({
        angle: ang,
        length: 600,
        width: 12,
        color: i % 2 === 0 ? MAGENTA : VIOLET,
        telegraph: 40,
        duration: 90,
        spin: dir * 0.16,
      });
    }
    dir = -dir;
    for (let k = 0; k < 5; k++) {
      ctx.ring({ count: scale(ctx.difficulty, 6, 1), speed: 78, angle: k * 0.3, radius: 5, color: CYAN, sprite: Shape.Oval, behavior: home(1.1) });
      ctx.aimed({ count: 1, speed: 130, radius: 4, color: AMBER, sprite: Shape.Kunai, behavior: accelerate(70) });
      yield 20;
    }
  }
};

/** The demo boss: four ordered phases (one opening + three spell cards). */
export const DEMO_BOSS: BossScript = function* (b) {
  yield* b.phase({ name: "Opening", hp: 700, timeLimit: 900 }, opening);
  yield* b.phase({ name: "Veil Sign 「Spiral Veil」", hp: 900, timeLimit: 1200, isSpell: true }, spiralVeil);
  yield* b.phase({ name: "Hunt Sign 「Hunting Snap」", hp: 900, timeLimit: 1200, isSpell: true }, huntingSnap);
  yield* b.phase({ name: "Light Sign 「Beam Rake」", hp: 1100, timeLimit: 1400, isSpell: true }, beamRake);
};
