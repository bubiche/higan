// Straight-laser primitive — a Touhou first-class beam.
//
// A laser is NOT a bullet. It is a stateful entity (origin + heading + length +
// width + a telegraph→fire→fade lifecycle), and there are only ever O(tens) of
// them at once. The dumb-data SoA rule exists for O(10k) bullets' cache locality
// (Hard Rule 1) and deliberately does not apply at this scale — so a laser is a
// plain object in a fixed pre-allocated pool (no per-spawn allocation, stable
// iteration order), and the sim packs the live ones into a scratch Float32Array
// at hash time exactly the way it already compacts live bullet slots. Determinism
// (Hard Rule 2) is unaffected: spawn order, update, and despawn are pure of clock
// and RNG.
//
// Lifecycle is age-driven, so it reproduces under replay/scrub:
//   age <  telegraph                       → warning: a thin bright line
//   telegraph <= age < telegraph+duration  → fired: full width (last FADE_TICKS
//                                            taper out)
//   age >= telegraph+duration              → despawn
// `spin` (rad/s) rotates the beam about its fixed origin — the iconic sweep.
//
// NO COLLISION yet: bullets have none either until the player/hitbox work, so a
// beam is currently visual + lifecycle only. The segment-vs-point hitbox (a laser
// is a line segment from the origin out to `length` along `angle`, with `width` as
// the half-thickness) is the documented seam to add alongside player collision.

/** A single straight beam. Mutated in place inside its pool slot. */
export interface Laser {
  alive: boolean;
  /** Beam origin (sim units) — fixed at spawn (boss-anchoring is a later seam). */
  x: number;
  y: number;
  /** Heading in radians (0 = +x). The beam emanates from (x, y) along this. */
  angle: number;
  /** Full length and full (fired) width, sim units. */
  length: number;
  width: number;
  /** Linear RGB tint, 0..1. */
  r: number;
  g: number;
  b: number;
  /** Angular velocity, rad/s — the sweep. 0 = static beam. */
  spin: number;
  /** Ticks since spawn. */
  age: number;
  /** Warning (thin) phase length, ticks. */
  telegraph: number;
  /** Fired phase length, ticks; the beam despawns at telegraph + duration. */
  duration: number;
}

/** Spawn parameters — every field explicit; defaulting happens at the API layer. */
export interface LaserSpawn {
  x: number;
  y: number;
  angle: number;
  length: number;
  width: number;
  r: number;
  g: number;
  b: number;
  spin: number;
  telegraph: number;
  duration: number;
}

export interface LaserSystem {
  /** The fixed pool; iterate `[0, lasers.length)` and skip `!alive` slots. */
  readonly lasers: readonly Laser[];
  /** Number of live beams. */
  readonly liveCount: number;
  /** Spawn a beam. A no-op (drop) if the pool is full — deterministic. */
  spawn(o: LaserSpawn): void;
  /** Advance every live beam one fixed step and despawn expired ones. */
  update(dt: number): void;
  /** Return to the empty state (used on pattern cuts / run rebuild). */
  clear(): void;
}

/** How wide the warning line is, as a fraction of the fired width. */
export const TELEGRAPH_WIDTH_FRAC = 0.16;
/** Brightness of the warning line relative to the fired beam. */
export const TELEGRAPH_INTENSITY = 0.45;
/** Ticks at the end of the fired phase over which the beam tapers out. */
export const FADE_TICKS = 10;

/** What the renderer draws this frame: a width and a brightness, both age-derived. */
export interface LaserDisplay {
  displayWidth: number;
  intensity: number;
}

/**
 * Map a beam's lifecycle phase to its on-screen width and brightness. Pure of any
 * GL/DOM state so it is unit-testable headlessly (the render geometry it feeds
 * cannot be) — keep all phase math here, not in the shader.
 */
export function laserDisplay(l: Laser): LaserDisplay {
  if (l.age < l.telegraph) {
    return { displayWidth: l.width * TELEGRAPH_WIDTH_FRAC, intensity: TELEGRAPH_INTENSITY };
  }
  const fireAge = l.age - l.telegraph;
  const fade = Math.min(FADE_TICKS, l.duration);
  const fadeStart = l.duration - fade;
  if (fireAge < fadeStart) return { displayWidth: l.width, intensity: 1 };
  // Taper: k runs 1 → 0 across the final `fade` ticks.
  const k = fade <= 0 ? 0 : (l.duration - fireAge) / fade;
  const c = k < 0 ? 0 : k > 1 ? 1 : k;
  return { displayWidth: l.width * c, intensity: c };
}

export function createLaserSystem(capacity = 64): LaserSystem {
  const pool: Laser[] = [];
  for (let i = 0; i < capacity; i++) {
    pool.push({
      alive: false,
      x: 0,
      y: 0,
      angle: 0,
      length: 0,
      width: 0,
      r: 0,
      g: 0,
      b: 0,
      spin: 0,
      age: 0,
      telegraph: 0,
      duration: 0,
    });
  }
  let liveCount = 0;

  return {
    lasers: pool,
    get liveCount() {
      return liveCount;
    },
    spawn(o): void {
      for (let i = 0; i < pool.length; i++) {
        const l = pool[i];
        if (l.alive) continue;
        l.alive = true;
        l.x = o.x;
        l.y = o.y;
        l.angle = o.angle;
        l.length = o.length;
        l.width = o.width;
        l.r = o.r;
        l.g = o.g;
        l.b = o.b;
        l.spin = o.spin;
        l.telegraph = o.telegraph;
        l.duration = o.duration;
        l.age = 0;
        liveCount++;
        return;
      }
      // Pool full: drop the new beam. Keeping the in-flight set stable is
      // deterministic; at O(tens) capacity this realistically never trips.
    },
    update(dt): void {
      for (let i = 0; i < pool.length; i++) {
        const l = pool[i];
        if (!l.alive) continue;
        l.age++;
        if (l.spin !== 0) l.angle += l.spin * dt;
        if (l.age >= l.telegraph + l.duration) {
          l.alive = false;
          liveCount--;
        }
      }
    },
    clear(): void {
      for (let i = 0; i < pool.length; i++) pool[i].alive = false;
      liveCount = 0;
    },
  };
}
