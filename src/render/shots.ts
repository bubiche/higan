// Player-shot marshalling — the placeholder shot "render layer".
//
// Player shots are not bullets (they live in their own struct pool), but visually
// they are the same primitive the bullet renderer already draws: a textured,
// additively-blended, velocity-rotated quad sampled from the shape atlas. So rather
// than stand up a second near-identical shader (a new shader is a live-only failure
// surface), shots reuse the bullet renderer's program via `drawInstances`. This
// module is just the pure packing step — the shot pool → an interleaved instance
// buffer — mirroring `marshalBullets`. No GL state here, so it is headless-testable.
//
// Real shot sprites swap in at the presentation milestone with no change to this
// path (the atlas layer is just a per-instance index).

import type { Shot } from "../touhou/shot";
import { INSTANCE_FLOATS } from "./bullets";

/**
 * Pack the live shots into `out` as interleaved instance data
 * (x, y, scale, angle, r, g, b, layer), skipping dead slots. The draw angle is the
 * shot's heading, so a needle sprite points along travel. Returns the instance
 * count; `out` must hold at least `liveCount * INSTANCE_FLOATS` floats.
 */
export function marshalShots(shots: readonly Shot[], out: Float32Array): number {
  let o = 0;
  let count = 0;
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    if (!s.alive) continue;
    out[o] = s.x;
    out[o + 1] = s.y;
    out[o + 2] = s.radius;
    out[o + 3] = Math.atan2(s.vy, s.vx); // heading: 0 = +x, matches the bullet shader
    out[o + 4] = s.r;
    out[o + 5] = s.g;
    out[o + 6] = s.b;
    out[o + 7] = s.sprite;
    o += INSTANCE_FLOATS;
    count++;
  }
  return count;
}
