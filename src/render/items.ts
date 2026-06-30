// Item marshalling — the placeholder item "render layer".
//
// Items are not bullets (they live in their own struct pool), but for the slice
// they draw as the same primitive the bullet renderer already draws: a textured,
// additively-blended quad sampled from the shape atlas. So rather than stand up a
// second shader (a new shader is a live-only failure surface — cf. the
// `sampler2DArray` precision bug), items reuse the bullet renderer's program via
// `drawInstances`. This module is just the pure packing step — the item pool → an
// interleaved instance buffer — mirroring `marshalShots`/`marshalEnemies`. No GL
// state here, so it is headless-testable.
//
// Real item sprites (a power "P", a point star, a 1up) swap in behind the asset slot
// at the presentation milestone with no change to this path — the atlas layer is
// just a per-instance index. Items draw upright (angle 0); they don't velocity-rotate.

import type { Item } from "../touhou/item";
import { INSTANCE_FLOATS } from "./bullets";

/**
 * Pack the live items into `out` as interleaved instance data
 * (x, y, scale, angle, r, g, b, layer), skipping dead slots. Returns the instance
 * count; `out` must hold at least `liveCount * INSTANCE_FLOATS` floats.
 */
export function marshalItems(items: readonly Item[], out: Float32Array): number {
  let o = 0;
  let count = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.alive) continue;
    out[o] = it.x;
    out[o + 1] = it.y;
    out[o + 2] = 6; // draw radius — placeholder item size (sim units)
    out[o + 3] = 0; // items are upright, no velocity rotation
    out[o + 4] = it.r;
    out[o + 5] = it.g;
    out[o + 6] = it.b;
    out[o + 7] = it.sprite;
    o += INSTANCE_FLOATS;
    count++;
  }
  return count;
}
