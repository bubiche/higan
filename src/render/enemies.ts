// Enemy marshalling — the enemy "render layer".
//
// Enemies draw on the alpha SPRITE pass (representational art), not the additive glow
// pass the bullets use: `resolveLayer` maps the enemy's render-only base layer (`e.sprite`,
// or -1 → the engine default) to the current animation frame's atlas layer, and the sprite
// renderer draws the packed instances with straight-alpha blend. This module stays the pure
// packing step — the enemy pool → an interleaved instance buffer (x, y, scale, angle, r, g,
// b, layer), mirroring `marshalBullets` — with no GL state, so it is headless-testable
// (pass an identity resolver in tests). An instance whose layer resolves to < 0 (unloaded /
// no sprite available) is skipped. Enemies draw upright (angle 0); no velocity rotation.

import type { Enemy } from "../touhou/enemy";
import { INSTANCE_FLOATS } from "./bullets";

/**
 * Pack the live enemies into `out` as interleaved instance data, skipping dead slots and
 * any whose sprite layer resolves to < 0. `resolveLayer(e.sprite)` turns the enemy's
 * render-only base layer into the current atlas layer (default substitution + animation).
 * Returns the instance count; `out` must hold at least `liveCount * INSTANCE_FLOATS` floats.
 */
export function marshalEnemies(
  enemies: readonly Enemy[],
  out: Float32Array,
  resolveLayer: (base: number) => number,
): number {
  let o = 0;
  let count = 0;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e.alive) continue;
    const layer = resolveLayer(e.sprite);
    if (layer < 0) continue;
    out[o] = e.x;
    out[o + 1] = e.y;
    out[o + 2] = e.radius;
    out[o + 3] = 0; // enemies are upright, no velocity rotation
    out[o + 4] = e.r;
    out[o + 5] = e.g;
    out[o + 6] = e.b;
    out[o + 7] = layer;
    o += INSTANCE_FLOATS;
    count++;
  }
  return count;
}
