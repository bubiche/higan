// Item marshalling — the item "render layer".
//
// Items draw on the alpha SPRITE pass, like enemies. Their look is engine genre convention
// (power = red, point = blue, …), so the sprite is resolved by item TYPE, not a per-item
// field: `resolveLayer(it.type)` maps the type to its atlas layer (the engine default, or a
// game's per-type override) and the item's `r/g/b` tint colours it. This module stays the
// pure packing step — the item pool → an interleaved instance buffer (x, y, scale, angle,
// r, g, b, layer) — with no GL state, so it is headless-testable. An instance whose layer
// resolves to < 0 (unloaded) is skipped. Items draw upright (angle 0); no velocity rotation.

import type { Item, ItemType } from "../touhou/item";
import { INSTANCE_FLOATS } from "./bullets";

/**
 * Pack the live items into `out` as interleaved instance data, skipping dead slots and any
 * whose sprite layer resolves to < 0. `resolveLayer(it.type)` turns the item's type into
 * the current atlas layer. Returns the instance count; `out` must hold at least `liveCount *
 * INSTANCE_FLOATS` floats.
 */
export function marshalItems(
  items: readonly Item[],
  out: Float32Array,
  resolveLayer: (type: ItemType) => number,
): number {
  let o = 0;
  let count = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it.alive) continue;
    const layer = resolveLayer(it.type);
    if (layer < 0) continue;
    out[o] = it.x;
    out[o + 1] = it.y;
    out[o + 2] = 6; // draw radius — item size (sim units)
    out[o + 3] = 0; // items are upright, no velocity rotation
    out[o + 4] = it.r;
    out[o + 5] = it.g;
    out[o + 6] = it.b;
    out[o + 7] = layer;
    o += INSTANCE_FLOATS;
    count++;
  }
  return count;
}
