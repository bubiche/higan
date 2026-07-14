// Bullet-image table — maps a bullet/shot's look selector to either a procedural
// glow shape or a custom sprite-atlas image, packed into the one `sprite` byte the
// SoA store (and the shot pool) already carry.
//
// The byte's meaning:
//   - `s < 128`         → a procedural glow `Shape` (the atlas layer, 0..SHAPE_COUNT-1).
//   - `s & 0x80` (>=128) → a CUSTOM IMAGE: `s & 0x7f` indexes this table, whose entry
//                          is a `SpriteHandle` (into the async sprite atlas shared with
//                          enemies/boss/items). The render layer resolves the handle's
//                          current atlas layer at draw time (with animation).
//
// The table is interned by handle IDENTITY and owned by the sim (like the staged-program
// table on the bullet system): resolving the same handle twice returns the same id, so
// the table stays bounded by the number of DISTINCT custom bullet images a game uses.
//
// Determinism: the `sprite` byte is render-only — `sim.hash()` does not fold it (nor
// `r`/`g`/`b`). So neither the encoding nor the intern ORDER can perturb a trajectory
// hash; this whole module is presentation. (That's also why interning by identity —
// rather than a stable structural key — is acceptable here, unlike `registerProgram`
// whose id IS hashed.)

import type { SpriteHandle } from "../api/sprites";

/** High bit of a `sprite` byte: set = custom image, clear = procedural glow shape. */
export const IMAGE_FLAG = 0x80;
/** Low 7 bits of an image `sprite` byte: the index into the bullet-image table. */
export const IMAGE_INDEX_MASK = 0x7f;
/** Max distinct custom bullet images per sim (the 7-bit table index space). */
export const MAX_BULLET_IMAGES = 128;

export interface BulletImageTable {
  /**
   * Resolve an author selector to the render `sprite` byte. A number passes through
   * (it is a glow `Shape` layer, asserted `< 128`); a `SpriteHandle` is interned and
   * returned as `IMAGE_FLAG | id`.
   */
  resolve(sprite: number | SpriteHandle): number;
  /** The interned handles, indexed by table id (`byte & IMAGE_INDEX_MASK`). The render
   *  layer reads `handles[id].layer` to find the atlas base layer. */
  readonly handles: readonly SpriteHandle[];
  /** Drop all interned handles (called when the sim rebuilds a run). */
  clear(): void;
}

export function createBulletImageTable(): BulletImageTable {
  const handles: SpriteHandle[] = [];
  const index = new Map<SpriteHandle, number>();

  return {
    handles,
    resolve(sprite): number {
      if (typeof sprite === "number") {
        // A glow shape layer. Must fit below the image flag; a value >= 128 is an
        // authoring error (there are only a handful of shapes), so fail loudly rather
        // than silently aliasing into the image space.
        if (sprite < 0 || sprite >= IMAGE_FLAG) {
          throw new Error(`bullet shape selector out of range: ${sprite} (expected 0..${IMAGE_FLAG - 1})`);
        }
        return sprite;
      }
      let id = index.get(sprite);
      if (id === undefined) {
        if (handles.length >= MAX_BULLET_IMAGES) {
          throw new Error(`too many distinct custom bullet images (max ${MAX_BULLET_IMAGES})`);
        }
        id = handles.length;
        handles.push(sprite);
        index.set(sprite, id);
      }
      return IMAGE_FLAG | id;
    },
    clear(): void {
      handles.length = 0;
      index.clear();
    },
  };
}
