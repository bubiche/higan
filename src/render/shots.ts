// Player-shot marshalling — splits the shot pool into the two render passes.
//
// Player shots are not bullets (they live in their own struct pool), but visually
// they are the same primitive the two instanced passes already draw: a textured,
// velocity-rotated quad. A shot's look is either a procedural glow `Shape` (drawn on
// the additive bullet pass) or a custom image (drawn on the straight-alpha sprite
// pass) — the two can't share a draw call because the blend mode differs, so this
// packs the live shots into TWO interleaved buffers, one per pass, in a single sweep.
//
// This module is the pure packing step — no GL state — so it is headless-testable:
// the image-layer lookup is injected (`imageLayer`), and the glow/image split is a
// cheap high-bit test on the render byte the shot already carries.

import type { Shot } from "../touhou/shot";
import { INSTANCE_FLOATS } from "./bullets";
import { IMAGE_FLAG, IMAGE_INDEX_MASK } from "../bullets/sprite-table";
import { Shape } from "./shapes";

/** Counts written to each pass's buffer by `marshalShots`. */
export interface ShotMarshalResult {
  /** Instances written to the additive glow buffer. */
  glow: number;
  /** Instances written to the straight-alpha image buffer. */
  image: number;
}

/**
 * Pack the live shots into two interleaved instance buffers, skipping dead slots:
 * `glowOut` (procedural `Shape`s, drawn additive) and `imageOut` (custom images, drawn
 * straight-alpha). Each instance is (x, y, scale, angle, r, g, b, layer); the draw angle
 * is the shot's heading, so a needle/image points along travel.
 *
 * `imageLayer(tableId)` resolves a custom image's current atlas layer (animation folded
 * in), or -1 if it isn't ready yet — in which case the shot falls back to a glow `Orb`
 * so it is never invisible while the atlas loads. Both buffers must hold at least
 * `liveCount * INSTANCE_FLOATS` floats.
 */
export function marshalShots(
  shots: readonly Shot[],
  glowOut: Float32Array,
  imageOut: Float32Array,
  imageLayer: (tableId: number) => number,
): ShotMarshalResult {
  let go = 0;
  let io = 0;
  let glow = 0;
  let image = 0;
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    if (!s.alive) continue;
    const byte = s.sprite;
    let out: Float32Array;
    let o: number;
    let layer: number;
    if (byte & IMAGE_FLAG) {
      const resolved = imageLayer(byte & IMAGE_INDEX_MASK);
      if (resolved >= 0) {
        out = imageOut;
        o = io;
        layer = resolved;
        io += INSTANCE_FLOATS;
        image++;
      } else {
        // Atlas not ready (or a failed url): draw a glow orb rather than nothing.
        out = glowOut;
        o = go;
        layer = Shape.Orb;
        go += INSTANCE_FLOATS;
        glow++;
      }
    } else {
      out = glowOut;
      o = go;
      layer = byte;
      go += INSTANCE_FLOATS;
      glow++;
    }
    out[o] = s.x;
    out[o + 1] = s.y;
    out[o + 2] = s.radius;
    out[o + 3] = Math.atan2(s.vy, s.vx); // heading: 0 = +x, matches the quad shader
    out[o + 4] = s.r;
    out[o + 5] = s.g;
    out[o + 6] = s.b;
    out[o + 7] = layer;
  }
  return { glow, image };
}
