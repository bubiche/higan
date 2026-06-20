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
  accelerate,
  home,
  ramp,
  Shape,
} from "../../api";

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

/** The patterns the showcase scene cycles through, in order. */
export const SHOWCASE: readonly ScenePattern[] = [
  { name: "ring", script: ringPattern },
  { name: "fan", script: fanPattern },
  { name: "spiral", script: spiralPattern },
  { name: "aimed", script: aimedPattern },
  { name: "home", script: homePattern },
  { name: "ramp", script: rampPattern },
];
