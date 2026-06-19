// Bullet system — allocation, spawn/despawn, off-field culling, and the
// dumb-data update loop on top of the SoA store.
//
// Bullets are dumb data (Hard Rule 1): this module owns no per-bullet objects,
// closures, or virtual dispatch. A bullet is a slot index into the store's flat
// typed arrays, and the per-frame update is a single tight numeric loop.
//
// Allocation is a LIFO free-list over slots:
//   - `spawn` reuses the most recently freed slot, or grows the high-water mark
//     if none are free, or returns -1 when the store is full.
//   - `despawn` returns a slot to the free-list and clears its alive flag.
//   - Slot indices are stable for a bullet's lifetime (no swap-compaction), which
//     keeps group-addressing open for the emitter/controller layer built later.
// Because freed slots are reused, the high-water mark settles at the maximum
// number ever simultaneously live and does not creep under steady-state churn.
//
// The update loop is a pure function of (state, dt): no RNG, no clock, no DOM.
// Spawn values are supplied by the caller, so all randomness lives upstream in
// the seeded sim — which is what keeps the whole thing deterministic (Hard Rule 2).

import { createBulletStore, MAX_BULLETS, type BulletStore } from "./store";

/** Field rectangle plus the off-field margin past which bullets are culled. */
export interface BulletBounds {
  readonly width: number;
  readonly height: number;
  readonly margin: number;
}

export interface BulletSystem {
  readonly store: BulletStore;
  readonly capacity: number;
  /** 1 = slot holds a live bullet, 0 = free. Indexed by slot. */
  readonly alive: Uint8Array;
  /** One past the highest slot ever simultaneously live; iterate `[0, highWater)`. */
  readonly highWater: number;
  /** Number of live bullets. */
  readonly liveCount: number;
  /**
   * Spawn a bullet. Returns its slot index, or -1 if the store is full.
   * `radius` is both the collision and the draw half-size, in sim units.
   */
  spawn(
    x: number,
    y: number,
    vx: number,
    vy: number,
    radius: number,
    r: number,
    g: number,
    b: number,
  ): number;
  /** Free a slot. A no-op if the slot is already free. */
  despawn(slot: number): void;
  /** Advance every live bullet one fixed step and cull those past the bounds. */
  update(dt: number): void;
  /** Return to the empty state (used to rebuild a run from scratch). */
  clear(): void;
}

export function createBulletSystem(
  bounds: BulletBounds,
  capacity: number = MAX_BULLETS,
): BulletSystem {
  const store = createBulletStore(capacity);
  const { x, y, vx, vy, radius, r, g, b } = store;
  const alive = new Uint8Array(capacity);
  // Stack of free slot indices; `freeTop` is the number of entries in use.
  const freeStack = new Int32Array(capacity);
  let freeTop = 0;
  let highWater = 0;
  let liveCount = 0;

  const minX = -bounds.margin;
  const maxX = bounds.width + bounds.margin;
  const minY = -bounds.margin;
  const maxY = bounds.height + bounds.margin;

  return {
    store,
    capacity,
    alive,
    get highWater() {
      return highWater;
    },
    get liveCount() {
      return liveCount;
    },
    spawn(sx, sy, svx, svy, sr, cr, cg, cb): number {
      let slot: number;
      if (freeTop > 0) {
        slot = freeStack[--freeTop];
      } else if (highWater < capacity) {
        slot = highWater++;
      } else {
        return -1;
      }
      alive[slot] = 1;
      liveCount++;
      x[slot] = sx;
      y[slot] = sy;
      vx[slot] = svx;
      vy[slot] = svy;
      radius[slot] = sr;
      r[slot] = cr;
      g[slot] = cg;
      b[slot] = cb;
      return slot;
    },
    despawn(slot): void {
      if (alive[slot] === 0) return;
      alive[slot] = 0;
      freeStack[freeTop++] = slot;
      liveCount--;
    },
    update(dt): void {
      for (let i = 0; i < highWater; i++) {
        if (alive[i] === 0) continue;
        const nx = x[i] + vx[i] * dt;
        const ny = y[i] + vy[i] * dt;
        x[i] = nx;
        y[i] = ny;
        if (nx < minX || nx > maxX || ny < minY || ny > maxY) {
          // Cull inline — avoids a call into despawn() in the hot loop.
          alive[i] = 0;
          freeStack[freeTop++] = i;
          liveCount--;
        }
      }
    },
    clear(): void {
      alive.fill(0);
      freeTop = 0;
      highWater = 0;
      liveCount = 0;
    },
  };
}
