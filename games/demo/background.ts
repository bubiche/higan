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
import extraShoreUrl from "./assets/images/extra-shore.png";

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

/** Warm ember variant of the star scatter: motes tinted orange→gold instead of cool white,
 *  for Stage 2's dusk sky. Same seamless-tiling wrap trick as `scatterStars`. */
function scatterEmbers(
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
    const warm = rnd();
    const cr = 245 + Math.round(warm * 10);
    const cg = 150 + Math.round(warm * 70);
    const cb = 60 + Math.round(warm * 60);
    const a = 0.45 + rnd() * 0.5;
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

/** Far dusk haze: many small dim embers — the slow, distant layer. */
const emberDriftFar: ImageSource = {
  kind: "procedural",
  draw(ctx, size) {
    scatterEmbers(ctx, size, 70, 0x2c1a, 0.6, 1.4);
  },
};

/** Near embers: fewer, larger, brighter motes — the faster foreground layer. */
const emberDriftNear: ImageSource = {
  kind: "procedural",
  draw(ctx, size) {
    scatterEmbers(ctx, size, 22, 0x7f3d, 1.3, 2.8);
  },
};

/** Astral variant of the star scatter: cool indigo→silver motes, larger and brighter than
 *  Stage 1's distant white field, for Stage 3's starlit-night sky. Same seamless-tiling wrap
 *  trick as `scatterStars`. */
function scatterAstral(
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
    // Cool tint sweeping indigo→silver per star.
    const cool = rnd();
    const cr = 150 + Math.round(cool * 90);
    const cg = 160 + Math.round(cool * 80);
    const cb = 235 + Math.round((1 - cool) * 20);
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

/** Far astral haze: many small dim indigo motes — the slow, distant layer. */
const astralFar: ImageSource = {
  kind: "procedural",
  draw(ctx, size) {
    scatterAstral(ctx, size, 100, 0x3b6d, 0.6, 1.3);
  },
};

/** Near astral field: fewer, larger, brighter silver stars — the faster foreground layer. */
const astralNear: ImageSource = {
  kind: "procedural",
  draw(ctx, size) {
    scatterAstral(ctx, size, 30, 0xc41f, 1.3, 2.8);
  },
};

/** Crimson variant of the star scatter: deep-red spider-lily motes (scarlet→wine), for the
 *  Extra stage's far-shore sky. Same seamless-tiling wrap trick as `scatterStars`. */
function scatterPetals(
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
    // Warm sweep scarlet→wine per mote.
    const warm = rnd();
    const cr = 210 + Math.round(warm * 45);
    const cg = 30 + Math.round(warm * 55);
    const cb = 45 + Math.round(warm * 40);
    const a = 0.45 + rnd() * 0.5;
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

/** Near crimson field: scarlet motes drawn over the image far layer — the faster foreground
 *  layer whose speed against the far shore is the parallax. */
const petalDriftNear: ImageSource = {
  kind: "procedural",
  draw(ctx, size) {
    scatterPetals(ctx, size, 26, 0xb17e, 1.3, 2.9);
  },
};

// The Extra stage's far layer is a REAL image file — the reference example of a `kind: "url"`
// background asset (a seamless-tiling crimson "far shore" texture), imported through Vite so
// it resolves to a base-relative hashed URL in the build. Every other background layer here is
// procedural; this is the one that ships bytes, mirroring the Extra BGM (a `url` audio file).
const extraShore: ImageSource = {
  kind: "url",
  src: extraShoreUrl,
};

/** Background handles. Referenced from the stage's `background` (see ./game.ts), not the
 *  sprite library. Swap either `source` to `{ kind: "url", src }` for a real tiling texture. */
export const demoBackground = defineSprites({
  starfieldFar: { source: starfieldFar },
  starfieldNear: { source: starfieldNear },
  emberDriftFar: { source: emberDriftFar },
  emberDriftNear: { source: emberDriftNear },
  astralFar: { source: astralFar },
  astralNear: { source: astralNear },
  extraShore: { source: extraShore },
  petalDriftNear: { source: petalDriftNear },
});

/** The stage's parallax layers, back-to-front: the slow far field under the faster near
 *  field. Handed to `StageDef.background.layers`. The 3× scroll difference is the depth cue. */
export const demoBackgroundLayers = [
  { sprite: demoBackground.starfieldFar, scrollY: 12, opacity: 0.85 },
  { sprite: demoBackground.starfieldNear, scrollY: 38, opacity: 0.95 },
];

/** Stage 2's parallax layers — the warm ember drift, back-to-front, faster than Stage 1 so
 *  the dusk sky feels closer. Handed to that stage's `StageDef.background.layers`. */
export const demoStage2BackgroundLayers = [
  { sprite: demoBackground.emberDriftFar, scrollY: 14, opacity: 0.8 },
  { sprite: demoBackground.emberDriftNear, scrollY: 44, opacity: 0.95 },
];

/** Stage 3's parallax layers — the cool astral starfield, back-to-front. The slowest far
 *  drift of the three stages (a deep, still night) under a brighter near field. Handed to
 *  that stage's `StageDef.background.layers`. */
export const demoStage3BackgroundLayers = [
  { sprite: demoBackground.astralFar, scrollY: 9, opacity: 0.85 },
  { sprite: demoBackground.astralNear, scrollY: 30, opacity: 0.95 },
];

/** The Extra stage's parallax layers, back-to-front: the real crimson-shore IMAGE as the slow
 *  far layer, under a faster procedural petal drift. Mixing a `url` image layer with a
 *  procedural one in a single stage is the point — the loader treats both the same. Handed to
 *  the Extra `StageDef.background.layers`. */
export const demoExtraBackgroundLayers = [
  { sprite: demoBackground.extraShore, scrollY: 14, opacity: 0.9 },
  { sprite: demoBackground.petalDriftNear, scrollY: 50, opacity: 0.95 },
];

/** The title/character-select/options menu background — a single, slower pass of the SAME
 *  far starfield handle (no extra texture upload; the loader dedupes by handle identity).
 *  Independent of any stage: handed to `GameDefinition.menuBackground.layers`, not a
 *  `StageDef.background` (the title isn't stage 1). */
export const demoMenuBackgroundLayers = [{ sprite: demoBackground.starfieldFar, scrollY: 6, opacity: 0.6 }];
