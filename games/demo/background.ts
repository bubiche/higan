// The reference game's stage background — a placeholder procedural parallax starfield.
//
// Two layers scroll downward at different rates (a slow far field + a faster near field), so
// the depth reads as parallax behind the danmaku. Like the sprite placeholders, each layer's
// `source` is a `procedural` drawer standing in for real art: swapping one to a
// `{ kind: "url", src }` (a seamless tiling texture) is a one-line change, nothing else moves.
//
// The handles are referenced ONLY from the stage's `background` (see ./game.ts) — NOT from
// `assets.sprites.library`. Routing follows the reference site: atlas sprites go in `library`;
// background layers name their handle in `StageDef.background`, and the background pass loads
// them at full resolution. So the author never decides "which bucket" — it's the usage.

import { defineSprites, type ImageSource } from "higan";
import tileUrl from "./assets/tile.png";

// A tiny deterministic PRNG (mulberry32) so the starfield is STABLE across loads/hot-reloads
// — a placeholder that reshuffles on every edit would be distracting. Presentation-only, so
// this has nothing to do with the sim's seeded RNG.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Scatter `count` round stars into a `size` tile, seamlessly TILEABLE: each star is drawn
 *  with its 8 wrap-around neighbours (offset by ±size), so one that straddles an edge appears
 *  on the opposite edge too — no seam when the texture REPEATs. */
function scatterStars(
  ctx: CanvasRenderingContext2D,
  size: number,
  count: number,
  seed: number,
  minR: number,
  maxR: number,
): void {
  const rnd = mulberry32(seed);
  for (let i = 0; i < count; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = minR + rnd() * (maxR - minR);
    // Slightly warm/cool tint per star, mostly white — coloured by nothing downstream
    // (backgrounds aren't per-instance tinted), so bake the colour in here.
    const warm = rnd();
    const cr = 220 + Math.round(warm * 35);
    const cg = 225 + Math.round((1 - Math.abs(warm - 0.5) * 2) * 30);
    const cb = 235 + Math.round((1 - warm) * 20);
    const a = 0.5 + rnd() * 0.5;
    for (let dx = -size; dx <= size; dx += size) {
      for (let dy = -size; dy <= size; dy += size) {
        ctx.beginPath();
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`;
        ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

/** Far field: many small dim stars — the slow, distant layer. */
const starfieldFar: ImageSource = {
  kind: "procedural",
  draw(ctx, size) {
    scatterStars(ctx, size, 90, 0x51ce, 0.5, 1.2);
  },
};

/** Near field: fewer, larger, brighter stars — the faster foreground layer whose speed
 *  against the far field is the parallax. */
const starfieldNear: ImageSource = {
  kind: "procedural",
  draw(ctx, size) {
    scatterStars(ctx, size, 28, 0x9a71, 1.1, 2.4);
  },
};

// example of a url source
const tiles: ImageSource = {
  kind: "url",
  src: tileUrl,
}

/** Background handles. Referenced from the stage's `background` (see ./game.ts), not the
 *  sprite library. Swap either `source` to `{ kind: "url", src }` for a real tiling texture. */
export const demoBackground = defineSprites({
  starfieldFar: { source: starfieldFar },
  starfieldNear: { source: starfieldNear },
});

/** The stage's parallax layers, back-to-front: the slow far field under the faster near
 *  field. Handed to `StageDef.background.layers`. The 3× scroll difference is the depth cue. */
export const demoBackgroundLayers = [
  { sprite: demoBackground.starfieldFar, scrollY: 12, opacity: 0.85 },
  { sprite: demoBackground.starfieldNear, scrollY: 38, opacity: 0.95 },
];

/** The title/character-select/options menu background — a single, slower pass of the SAME
 *  far starfield handle (no extra texture upload; the loader dedupes by handle identity).
 *  Independent of any stage: handed to `GameDefinition.menuBackground.layers`, not a
 *  `StageDef.background` (the title isn't stage 1). */
export const demoMenuBackgroundLayers = [{ sprite: demoBackground.starfieldFar, scrollY: 6, opacity: 0.6 }];
