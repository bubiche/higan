// Deterministic simulation core.
//
// This module is intentionally free of any browser surface — no DOM, no
// `performance.now`, no `Math.random`. Its entire output is a pure function of
// (seed, input stream): construct with a seed, feed it a sequence of
// InputFrames, and the resulting state — and its hash — are bit-identical every
// time (Hard Rule 2). That purity is what lets the determinism check run
// headlessly and what makes backward-scrub (replay from seed) and replay work.
//
// The content here (a player you steer and a field of drifting motes) is a
// placeholder to exercise input + the seeded RNG + the SoA store and give the
// determinism hash something real to fingerprint. The actual bullet system —
// spawn/despawn, the free-list, culling, the dumb-data update loop — is built on
// top of the SoA store later; motes are not that system.

import { Rng } from "./prng";
import { hashFloat32Arrays } from "./hash";
import { createBulletStore, type BulletStore } from "../bullets/store";
import { PLAYFIELD_W, PLAYFIELD_H } from "./playfield";
import type { InputFrame } from "./input";

const MOTE_COUNT = 512;
const PLAYER_RADIUS = 6;
const PLAYER_SPEED = 260; // sim units / second
const FOCUS_SPEED = 120;
const SPAWN_MARGIN = 12;

/** A small palette the motes are tinted from, so the field reads as danmaku. */
const PALETTE: readonly [number, number, number][] = [
  [0.45, 0.85, 1.0], // cyan
  [1.0, 0.55, 0.9], // magenta
  [1.0, 0.85, 0.45], // amber
  [0.7, 0.7, 1.0], // periwinkle
];

export interface Simulation {
  /** Number of fixed steps executed so far. */
  readonly tick: number;
  /** The SoA store backing the motes (first `moteCount` slots are live). */
  readonly store: BulletStore;
  readonly moteCount: number;
  readonly playerX: number;
  readonly playerY: number;
  readonly playerRadius: number;
  /** Advance the simulation by exactly one fixed step, given this tick's input. */
  step(input: InputFrame): void;
  /** Bit-level fingerprint of the current state. */
  hash(): number;
}

export function createSimulation(seed: number, dt: number): Simulation {
  const rng = new Rng(seed);
  const store = createBulletStore(MOTE_COUNT);
  const playerBuf = new Float32Array(2);

  let tick = 0;
  let playerX = PLAYFIELD_W / 2;
  let playerY = PLAYFIELD_H * 0.8;

  // Spawn one mote into slot `i` at the top of the field with a fresh random
  // position, downward velocity, and tint — pulling every value from the seeded
  // RNG so respawns keep the deterministic stream churning.
  const spawnMote = (i: number, atTop: boolean): void => {
    store.x[i] = rng.range(0, PLAYFIELD_W);
    store.y[i] = atTop ? -rng.range(0, SPAWN_MARGIN) : rng.range(0, PLAYFIELD_H);
    store.vx[i] = rng.range(-40, 40);
    store.vy[i] = rng.range(80, 180);
    store.radius[i] = rng.range(2.5, 5);
    const c = PALETTE[rng.u32() % PALETTE.length]!;
    store.r[i] = c[0];
    store.g[i] = c[1];
    store.b[i] = c[2];
  };

  for (let i = 0; i < MOTE_COUNT; i++) spawnMote(i, false);

  const step = (input: InputFrame): void => {
    const speed = input.focus ? FOCUS_SPEED : PLAYER_SPEED;
    playerX += input.dx * speed * dt;
    playerY += input.dy * speed * dt;
    if (playerX < PLAYER_RADIUS) playerX = PLAYER_RADIUS;
    else if (playerX > PLAYFIELD_W - PLAYER_RADIUS) playerX = PLAYFIELD_W - PLAYER_RADIUS;
    if (playerY < PLAYER_RADIUS) playerY = PLAYER_RADIUS;
    else if (playerY > PLAYFIELD_H - PLAYER_RADIUS) playerY = PLAYFIELD_H - PLAYER_RADIUS;

    const { x, y, vx, vy } = store;
    for (let i = 0; i < MOTE_COUNT; i++) {
      x[i] += vx[i] * dt;
      y[i] += vy[i] * dt;
      // Reflect off the side walls (deterministic, no RNG).
      if (x[i] < 0) {
        x[i] = 0;
        vx[i] = -vx[i];
      } else if (x[i] > PLAYFIELD_W) {
        x[i] = PLAYFIELD_W;
        vx[i] = -vx[i];
      }
      // Fall off the bottom → respawn at the top with fresh RNG values.
      if (y[i] > PLAYFIELD_H + SPAWN_MARGIN) spawnMote(i, true);
    }

    tick++;
  };

  const hash = (): number => {
    playerBuf[0] = playerX;
    playerBuf[1] = playerY;
    const n = MOTE_COUNT;
    return hashFloat32Arrays([
      store.x.subarray(0, n),
      store.y.subarray(0, n),
      store.vx.subarray(0, n),
      store.vy.subarray(0, n),
      store.r.subarray(0, n),
      store.g.subarray(0, n),
      store.b.subarray(0, n),
      playerBuf,
    ]);
  };

  return {
    get tick() {
      return tick;
    },
    store,
    moteCount: MOTE_COUNT,
    get playerX() {
      return playerX;
    },
    get playerY() {
      return playerY;
    },
    playerRadius: PLAYER_RADIUS,
    step,
    hash,
  };
}
