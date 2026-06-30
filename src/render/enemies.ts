// Enemy marshalling — the placeholder enemy "render layer".
//
// Enemies are not bullets (they live in their own struct pool), but for the slice
// they draw as the same primitive the bullet renderer already draws: a textured,
// additively-blended quad sampled from the shape atlas. So rather than stand up a
// second shader (a new shader is a live-only failure surface — cf. the
// `sampler2DArray` precision bug), enemies reuse the bullet renderer's program via
// `drawInstances`. This module is just the pure packing step — the enemy pool → an
// interleaved instance buffer — mirroring `marshalShots`/`marshalBullets`. No GL
// state here, so it is headless-testable.
//
// Caveat: additive blend makes a placeholder enemy read as a tinted glow, not a
// solid sprite. Real enemy sprites (with proper alpha) swap in at the presentation
// milestone with no change to this path — the atlas layer is just a per-instance
// index. Enemies draw upright (angle 0); they don't velocity-rotate like bullets.

import type { Enemy } from "../touhou/enemy";
import { INSTANCE_FLOATS } from "./bullets";

/**
 * Pack the live enemies into `out` as interleaved instance data
 * (x, y, scale, angle, r, g, b, layer), skipping dead slots. Returns the instance
 * count; `out` must hold at least `liveCount * INSTANCE_FLOATS` floats.
 */
export function marshalEnemies(enemies: readonly Enemy[], out: Float32Array): number {
  let o = 0;
  let count = 0;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e.alive) continue;
    out[o] = e.x;
    out[o + 1] = e.y;
    out[o + 2] = e.radius;
    out[o + 3] = 0; // enemies are upright, no velocity rotation
    out[o + 4] = e.r;
    out[o + 5] = e.g;
    out[o + 6] = e.b;
    out[o + 7] = e.sprite;
    o += INSTANCE_FLOATS;
    count++;
  }
  return count;
}
