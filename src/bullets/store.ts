// Bullet data store — struct-of-arrays (SoA).
//
// Bullets are dumb data, never objects (Hard Rule 1). Each field is a flat
// typed array indexed by bullet slot, so the per-frame update is a tight
// numeric loop with no per-bullet allocation, closures, or megamorphic property
// access. Spawn/despawn, the free-list, off-screen culling, and the update loop
// are built on top of this layout later.

/** Maximum number of simultaneous bullets the store pre-allocates for. */
export const MAX_BULLETS = 50_000;

export interface BulletStore {
  readonly capacity: number;
  /** Position, in sim units. */
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Velocity, in sim units per second. */
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  /** Heading for drawing, in radians (0 = +x, CW in screen space). Set at spawn;
   *  rewritten only by behaviours that turn (ramp/home). Lets non-square sprites
   *  (rice/kunai) point along travel without per-frame trig on linear bullets. */
  readonly angle: Float32Array;
  /** Collision / draw radius, in sim units. */
  readonly radius: Float32Array;
  /** Colour, linear 0..1. */
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  /** Shape index into the sprite atlas. */
  readonly sprite: Uint8Array;
  /** Per-bullet behaviour selector for the update loop (see the bullet system). */
  readonly behavior: Uint8Array;
  /** Two behaviour parameters; their meaning depends on `behavior`. */
  readonly bp0: Float32Array;
  readonly bp1: Float32Array;
  /** Ticks alive. Incremented each update; for time-gated behaviours. */
  readonly age: Uint16Array;
}

export function createBulletStore(capacity: number = MAX_BULLETS): BulletStore {
  return {
    capacity,
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    vx: new Float32Array(capacity),
    vy: new Float32Array(capacity),
    angle: new Float32Array(capacity),
    radius: new Float32Array(capacity),
    r: new Float32Array(capacity),
    g: new Float32Array(capacity),
    b: new Float32Array(capacity),
    sprite: new Uint8Array(capacity),
    behavior: new Uint8Array(capacity),
    bp0: new Float32Array(capacity),
    bp1: new Float32Array(capacity),
    age: new Uint16Array(capacity),
  };
}
