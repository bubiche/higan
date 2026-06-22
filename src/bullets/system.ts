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

// Per-bullet behaviour selectors interpreted by the update loop. A bullet's
// "behaviour" is one of these ids plus up to two numeric params (bp0, bp1) — a
// fixed-size descriptor, never user code (Hard Rule 1). Only Ramp and Home pay
// per-frame trig, and only over their own bullets; Linear (the common case) and
// Accelerate stay a bare add.
//
// A const object (not an enum) so it stays fully erasable under isolatedModules /
// verbatimModuleSyntax and the headless test flow, while still reading as
// `Behavior.Linear` at the call sites.
export const Behavior = {
  /** Constant velocity. */
  Linear: 0,
  /** Constant cartesian acceleration in `(bp0, bp1)`; direction unchanged. */
  Accelerate: 1,
  /** Ramp speed by `bp0`/s and heading by `bp1` rad/s. */
  Ramp: 2,
  /** Steer heading toward the shared target, up to `bp0` rad/s, keeping speed. */
  Home: 3,
  /** Hold in place for `bp0` ticks, then launch at speed `bp1` along `angle`. */
  Delay: 4,
  /** Weave sideways: lateral offset `bp0`*sin(`bp1`*age*dt) about the heading. */
  Wave: 5,
} as const;
export type Behavior = (typeof Behavior)[keyof typeof Behavior];

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
   * Positional (not an opts object) so the emitter layer can spawn tens of
   * thousands per frame with zero per-bullet allocation. `radius` is both the
   * collision and the draw half-size; `angle` is the draw heading; `sprite` is
   * the atlas shape; `behavior`/`bp0`/`bp1` form the per-bullet descriptor.
   */
  spawn(
    x: number,
    y: number,
    vx: number,
    vy: number,
    angle: number,
    radius: number,
    r: number,
    g: number,
    b: number,
    sprite: number,
    behavior: number,
    bp0: number,
    bp1: number,
  ): number;
  /** Free a slot. A no-op if the slot is already free. */
  despawn(slot: number): void;
  /**
   * Advance every live bullet one fixed step (interpreting its behaviour) and
   * cull those past the bounds. `targetX`/`targetY` is the shared homing target.
   */
  update(dt: number, targetX: number, targetY: number): void;
  /** Return to the empty state (used to rebuild a run from scratch). */
  clear(): void;
}

export function createBulletSystem(
  bounds: BulletBounds,
  capacity: number = MAX_BULLETS,
): BulletSystem {
  const store = createBulletStore(capacity);
  const { x, y, vx, vy, angle, radius, r, g, b, sprite, behavior, bp0, bp1, age, grazed, gen } =
    store;
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
    spawn(sx, sy, svx, svy, sang, sr, cr, cg, cb, ssprite, sbehavior, sbp0, sbp1): number {
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
      angle[slot] = sang;
      radius[slot] = sr;
      r[slot] = cr;
      g[slot] = cg;
      b[slot] = cb;
      sprite[slot] = ssprite;
      behavior[slot] = sbehavior;
      bp0[slot] = sbp0;
      bp1[slot] = sbp1;
      age[slot] = 0;
      // A reused slot must not inherit the previous bullet's graze bit.
      grazed[slot] = 0;
      // Bump the generation stamp so any group handle still holding this slot from
      // the bullet that previously occupied it sees a mismatch and skips it.
      gen[slot] = (gen[slot] + 1) & 0xffff;
      return slot;
    },
    despawn(slot): void {
      if (alive[slot] === 0) return;
      alive[slot] = 0;
      freeStack[freeTop++] = slot;
      liveCount--;
    },
    update(dt, targetX, targetY): void {
      for (let i = 0; i < highWater; i++) {
        if (alive[i] === 0) continue;
        age[i]++;

        // Behaviour. Linear is the first (near-always-taken) branch; only Ramp
        // and Home pay trig, and only over their own bullets.
        const beh = behavior[i];
        if (beh !== Behavior.Linear) {
          if (beh === Behavior.Accelerate) {
            // Constant cartesian acceleration; direction (and `angle`) unchanged.
            vx[i] += bp0[i] * dt;
            vy[i] += bp1[i] * dt;
          } else if (beh === Behavior.Ramp) {
            const sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]) + bp0[i] * dt;
            const an = angle[i] + bp1[i] * dt;
            vx[i] = Math.cos(an) * sp;
            vy[i] = Math.sin(an) * sp;
            angle[i] = an;
          } else if (beh === Behavior.Home) {
            const sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
            const desired = Math.atan2(targetY - y[i], targetX - x[i]);
            let diff = desired - angle[i];
            // Wrap the heading error into [-PI, PI] so we always turn the short way.
            while (diff > Math.PI) diff -= 2 * Math.PI;
            while (diff < -Math.PI) diff += 2 * Math.PI;
            const maxTurn = bp0[i] * dt;
            if (diff > maxTurn) diff = maxTurn;
            else if (diff < -maxTurn) diff = -maxTurn;
            const an = angle[i] + diff;
            vx[i] = Math.cos(an) * sp;
            vy[i] = Math.sin(an) * sp;
            angle[i] = an;
          } else if (beh === Behavior.Delay) {
            // Held at spawn with vx=vy=0. On the launch tick, fire at the stashed
            // speed (bp1) along the stored heading, then become a plain Linear
            // bullet so subsequent ticks take the fast path.
            if (age[i] >= bp0[i]) {
              vx[i] = Math.cos(angle[i]) * bp1[i];
              vy[i] = Math.sin(angle[i]) * bp1[i];
              behavior[i] = Behavior.Linear;
            }
          } else if (beh === Behavior.Wave) {
            // Sine weave perpendicular to the (constant) heading. vx/vy carry the
            // forward velocity untouched; we add only the per-tick lateral delta,
            // so the cumulative offset telescopes to bp0*sin(bp1*age*dt) — a clean
            // ±bp0 snake. Two sins/frame, paid only over wave bullets.
            const t = age[i] * dt;
            const dLat = bp0[i] * (Math.sin(bp1[i] * t) - Math.sin(bp1[i] * (t - dt)));
            x[i] += -Math.sin(angle[i]) * dLat;
            y[i] += Math.cos(angle[i]) * dLat;
          }
        }

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
