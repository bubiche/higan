// Enemy pool — the stage's danmaku-firing popcorn and bigger foes.
//
// Like the laser and the player-shot pool (and unlike enemy bullets), enemies are
// O(tens), so the dumb-data SoA rule does NOT apply: that rule exists for O(10k)
// bullets' cache locality (Hard Rule 1). An enemy is a plain object in a fixed
// pre-allocated pool, iterated in pool order; the sim packs the live ones into a
// scratch Float32Array at hash time exactly the way it compacts live bullet slots,
// laser beams, and player shots.
//
// An enemy is the HITTABLE-TARGET half of an entity whose BEHAVIOUR half is an
// ordinary emitter coroutine the sim binds to it (the emitter-of-emitters model:
// the coroutine moves the enemy and fires its danmaku; the bullets it fires stay
// dumb data). This module owns only the target half — the struct + the pool + the
// player-shot collision that drains it. The slot↔emitter binding, the per-tick
// position sync, and the death/cull teardown live in the sim (which owns the
// scheduler), so this module stays self-contained and free of the api layer (no
// cycle). It consumes ZERO randomness — an enemy's rng draws happen in its bound
// emitter, on the enemy stream (Hard Rule 2).

import type { ShotSystem } from "./shot";
import type { ItemDropTable } from "./item";

/** A single enemy. Mutated in place inside its pool slot. */
export interface Enemy {
  alive: boolean;
  /** Position (sim units) — the canonical hashed/drawn/collided position. The bound
   *  emitter's coroutine owns movement; the sim publishes its `ctx.x/y` here each tick. */
  x: number;
  y: number;
  /** Hit points; player shots drain `hp`, and the sim kills the enemy at `hp <= 0`. */
  hp: number;
  /** Starting hp (for a future health gauge / scoring ratio). */
  hpMax: number;
  /** Collision + draw radius, sim units. */
  radius: number;
  /** Ticks since spawn (sim state — folded into the hash). */
  age: number;
  /** Shape atlas layer — render-only (not hashed), like a laser's/shot's colour. */
  sprite: number;
  /** Linear RGB tint, 0..1 — render-only. */
  r: number;
  g: number;
  b: number;
  /** Items dropped when SHOT DOWN. Construction content, like sprite/colour — a ref
   *  to the authored table, NOT evolving state, so it is NOT hashed; only the items
   *  it spawns on death are. `undefined` = drops nothing. */
  drops: ItemDropTable | undefined;
}

/** Spawn parameters — every field explicit; defaulting happens at the API layer. */
export interface EnemySpawn {
  x: number;
  y: number;
  hp: number;
  radius: number;
  sprite: number;
  r: number;
  g: number;
  b: number;
  drops?: ItemDropTable;
}

export interface EnemySystem {
  /** The fixed pool; iterate `[0, enemies.length)` and skip `!alive` slots. */
  readonly enemies: readonly Enemy[];
  /** Number of live enemies. */
  readonly liveCount: number;
  /** Spawn an enemy. Returns its pool slot, or -1 if the pool is full (a
   *  deterministic drop, the laser/shot-pool rule). The sim needs the slot to bind
   *  the enemy's emitter to it. */
  spawn(o: EnemySpawn): number;
  /** Free a slot (used by the sim's death/cull teardown). A no-op if already free. */
  despawn(i: number): void;
  /** Return to the empty state (used on a fresh run build). */
  clear(): void;
}

export function createEnemySystem(capacity = 64): EnemySystem {
  const pool: Enemy[] = [];
  for (let i = 0; i < capacity; i++) {
    pool.push({ alive: false, x: 0, y: 0, hp: 0, hpMax: 0, radius: 0, age: 0, sprite: 0, r: 0, g: 0, b: 0, drops: undefined });
  }
  let liveCount = 0;

  return {
    enemies: pool,
    get liveCount() {
      return liveCount;
    },
    spawn(o): number {
      for (let i = 0; i < pool.length; i++) {
        const e = pool[i];
        if (e.alive) continue;
        e.alive = true;
        e.x = o.x;
        e.y = o.y;
        e.hp = o.hp;
        e.hpMax = o.hp;
        e.radius = o.radius;
        e.sprite = o.sprite;
        e.r = o.r;
        e.g = o.g;
        e.b = o.b;
        e.drops = o.drops;
        e.age = 0;
        liveCount++;
        return i;
      }
      // Pool full: drop the new enemy (deterministic). At O(tens) capacity this
      // realistically never trips; the sim drops the bound emitter with it.
      return -1;
    },
    despawn(i): void {
      const e = pool[i];
      if (!e.alive) return;
      e.alive = false;
      liveCount--;
    },
    clear(): void {
      for (let i = 0; i < pool.length; i++) pool[i].alive = false;
      liveCount = 0;
    },
  };
}

/**
 * Drain enemy HP from player shots that overlap them (the one N×M pass §f names —
 * O(shots × enemies), ~10⁴/tick worst case, negligible beside the bullet floor). A
 * shot is consumed by the FIRST enemy it overlaps in pool order (then despawns), so
 * it can't also hit a second enemy or the boss — deterministic in (shot pool order,
 * enemy pool order). ZERO randomness. The sim applies death (`hp <= 0`) afterward;
 * this only reads positions and writes hp + despawns shots.
 */
export function stepEnemyShotCollision(enemies: EnemySystem, shots: ShotSystem): void {
  const pool = enemies.enemies;
  const sp = shots.shots;
  for (let i = 0; i < sp.length; i++) {
    const s = sp[i];
    if (!s.alive) continue;
    for (let j = 0; j < pool.length; j++) {
      const e = pool[j];
      if (!e.alive) continue;
      const dx = s.x - e.x;
      const dy = s.y - e.y;
      const thr = s.radius + e.radius;
      if (dx * dx + dy * dy <= thr * thr) {
        e.hp -= s.damage;
        shots.despawn(i);
        break; // the shot is spent on the first enemy it hits
      }
    }
  }
}
