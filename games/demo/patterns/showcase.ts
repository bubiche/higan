// Showcase patterns — authored against the public emitter API.
//
// This module is the thing you hot-edit live: change a number, save, and the
// scene rebuilds + replays to the current tick with the new code. Everything here
// goes through the typed `ctx` surface and `ctx.rng` / `ctx.tick` only — no clock,
// no Math.random — so it stays deterministic and replayable (see api/index.ts).
//
// Each pattern is an `EmitterScript` (a generator function): it fires bullets and
// `yield`s the number of ticks to wait before resuming.

import {
  type EmitterScript,
  type ScenePattern,
  type StageScript,
  accelerate,
  delay,
  home,
  ramp,
  wave,
  Shape,
} from "../../../src/api";

const CYAN: readonly [number, number, number] = [0.45, 0.85, 1.0];
const MAGENTA: readonly [number, number, number] = [1.0, 0.45, 0.85];
const AMBER: readonly [number, number, number] = [1.0, 0.8, 0.4];
const GREEN: readonly [number, number, number] = [0.5, 1.0, 0.6];
const VIOLET: readonly [number, number, number] = [0.75, 0.6, 1.0];

/** Even rings whose phase rotates each volley — the classic flower. */
const ringPattern: EmitterScript = function* (ctx) {
  let phase = 0;
  while (true) {
    ctx.ring({ count: 30, speed: 95, angle: phase, radius: 4, color: CYAN, sprite: Shape.Orb });
    phase += 0.21;
    yield 11;
  }
};

/** A fan that sweeps back and forth, fired as rice grains that point along travel. */
const fanPattern: EmitterScript = function* (ctx) {
  let dir = 1;
  let centre = Math.PI / 2; // downward
  while (true) {
    ctx.fan({
      count: 11,
      speed: 130,
      angle: centre,
      spread: 0.9,
      radius: 5,
      color: MAGENTA,
      sprite: Shape.Rice,
    });
    centre += dir * 0.12;
    if (centre > Math.PI / 2 + 0.7 || centre < Math.PI / 2 - 0.7) dir = -dir;
    yield 6;
  }
};

/** A two-arm spiral with a touch of RNG jitter (exercises ctx.rng determinism). */
const spiralPattern: EmitterScript = function* (ctx) {
  let a = 0;
  while (true) {
    const jitter = ctx.rng.range(-0.04, 0.04);
    ctx.fire({ speed: 110, angle: a + jitter, radius: 4, color: AMBER, sprite: Shape.Star });
    ctx.fire({ speed: 110, angle: a + Math.PI + jitter, radius: 4, color: AMBER, sprite: Shape.Star });
    a += 0.37;
    yield 2;
  }
};

/** Aimed kunai bursts at the player, with a slight accelerating bite. */
const aimedPattern: EmitterScript = function* (ctx) {
  while (true) {
    ctx.aimed({
      count: 5,
      speed: 120,
      spread: 0.5,
      radius: 5,
      color: GREEN,
      sprite: Shape.Kunai,
      behavior: accelerate(90),
    });
    yield 22;
  }
};

/** Slow ovals lobbed outward that then home in on the player. */
const homePattern: EmitterScript = function* (ctx) {
  let phase = 0;
  while (true) {
    ctx.ring({
      count: 10,
      speed: 70,
      angle: phase,
      radius: 6,
      color: VIOLET,
      sprite: Shape.Oval,
      behavior: home(1.6),
    });
    phase += 0.5;
    yield 30;
  }
};

/** A speed/angle ramp — bullets that curve and accelerate into a whirl. */
const rampPattern: EmitterScript = function* (ctx) {
  let phase = 0;
  while (true) {
    ctx.ring({
      count: 16,
      speed: 60,
      angle: phase,
      radius: 4,
      color: CYAN,
      sprite: Shape.BigOrb,
      behavior: ramp(40, 1.2),
    });
    phase += 0.13;
    yield 7;
  }
};

/** Suspended rings that hang in the air, then snap outward all at once. */
const delayPattern: EmitterScript = function* (ctx) {
  let phase = 0;
  while (true) {
    ctx.ring({
      count: 24,
      speed: 165,
      angle: phase,
      radius: 4,
      color: AMBER,
      sprite: Shape.Orb,
      behavior: delay(38),
    });
    phase += 0.39;
    yield 26;
  }
};

/** Snaking streams — tight rings of bullets that weave as they spread (fake-laser feel). */
const wavePattern: EmitterScript = function* (ctx) {
  let phase = 0;
  while (true) {
    ctx.ring({
      count: 6,
      speed: 95,
      angle: phase,
      radius: 5,
      color: CYAN,
      sprite: Shape.Orb,
      behavior: wave(16, 8),
    });
    phase += 0.17;
    yield 4;
  }
};

/** A sweeping rake of straight beams — telegraph, fire, sweep — with aimed
 *  bullets filling the gaps while the next volley warns up. */
const laserPattern: EmitterScript = function* (ctx) {
  let dir = 1;
  while (true) {
    const n = 5;
    const centre = Math.PI / 2; // downward
    const spread = 1.1;
    for (let i = 0; i < n; i++) {
      const a = centre - spread / 2 + (i / (n - 1)) * spread;
      ctx.laser({
        angle: a,
        length: 620,
        width: 13,
        color: i % 2 === 0 ? MAGENTA : VIOLET,
        telegraph: 42,
        duration: 96,
        spin: dir * 0.18,
      });
    }
    dir = -dir;
    for (let k = 0; k < 6; k++) {
      ctx.aimed({ count: 3, speed: 110, spread: 0.4, radius: 4, color: CYAN, sprite: Shape.Orb });
      yield 18;
    }
  }
};

/** A slow rotating ring that cycles the hard-edged shapes (ofuda, scale, crystal,
 *  bubble) — purely to show the procedural shape set, one colour per shape. */
const shapesPattern: EmitterScript = function* (ctx) {
  const shapes = [Shape.Ofuda, Shape.Scale, Shape.Crystal, Shape.Bubble];
  const colors = [AMBER, GREEN, CYAN, VIOLET];
  let phase = 0;
  while (true) {
    const count = 16;
    for (let i = 0; i < count; i++) {
      const k = i % shapes.length;
      ctx.fire({
        speed: 80,
        angle: phase + (i / count) * Math.PI * 2,
        radius: 6,
        color: colors[k],
        sprite: shapes[k],
      });
    }
    phase += 0.14;
    yield 9;
  }
};

/** Big, slow hearts and butterflies — the spell-flavor shapes, fired large so the
 *  butterfly silhouette reads (it's a single static frame; it can't flap). */
const flutterPattern: EmitterScript = function* (ctx) {
  let phase = 0;
  while (true) {
    const count = 8;
    for (let i = 0; i < count; i++) {
      const even = i % 2 === 0;
      ctx.fire({
        speed: 55,
        angle: phase + (i / count) * Math.PI * 2,
        radius: 13,
        color: even ? MAGENTA : VIOLET,
        sprite: even ? Shape.Heart : Shape.Butterfly,
      });
    }
    phase += 0.2;
    yield 16;
  }
};

/** A guard-only scene that runs every showcase pattern at once, so the continuous
 *  determinism guard covers the `wave`/`delay`/`ramp`-speed-change behavior branches
 *  the boss doesn't exercise. NOT a playable scene — the showcase emitters overflow
 *  the store when run together (deterministically), which is fine for branch coverage
 *  but would not read on screen. Lives here (beside the patterns it runs) so the
 *  playable stage module stays free of guard-only content — which also keeps the demo
 *  stage's single importer the game root, so editing it hot-swaps instead of reloading. */
export const showcaseStage: StageScript = function* (ctx) {
  for (const p of SHOWCASE) ctx.sub(p.script);
};

/** The patterns the showcase scene cycles through, in order. */
export const SHOWCASE: readonly ScenePattern[] = [
  { name: "ring", script: ringPattern },
  { name: "fan", script: fanPattern },
  { name: "spiral", script: spiralPattern },
  { name: "aimed", script: aimedPattern },
  { name: "home", script: homePattern },
  { name: "ramp", script: rampPattern },
  { name: "delay", script: delayPattern },
  { name: "wave", script: wavePattern },
  { name: "laser", script: laserPattern },
  { name: "shapes", script: shapesPattern },
  { name: "flutter", script: flutterPattern },
];
