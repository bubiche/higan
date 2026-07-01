// Visual asset authoring types — the loader-slot model a game declares its art with.
//
// This is the author-facing visual surface (re-exported from the `higan` barrel). It is
// the visual twin of the audio manifest (`src/api/audio.ts`), and follows the same two
// principles:
//
//   1. A source is a LOADER SLOT, not an image. Today it holds a procedural stand-in (a
//      canvas drawer); later it holds a real image file — swapping one for the other is a
//      one-line edit (`kind: "procedural"` → `kind: "url"`) with zero other change,
//      because the loader resolves either into the same atlas layer / DOM image.
//
//   2. Game-owned art is referenced by TYPED HANDLE, not a string id. `defineSprites`
//      names a game's art once and returns handles you reference inline — so a typo is a
//      compile error, not a silent blank sprite, and there is one place to organize it.
//      (This is the deliberate improvement over the audio BGM `Record<string,…>` keys;
//      the engine-owned, fixed vocabularies — bullet `Shape`s, `SfxId`s — stay enums,
//      because those are engine-fixed sets, not game-open libraries.)
//
// Presentation-only: nothing here enters the sim or the hash. A `procedural` drawer runs
// entirely outside the sim (use `Math`/`Math.random` freely). Sprite-sheet animation is
// driven by a presentation clock, never the sim tick — so it never affects a replay.

import type { ItemType } from "../touhou/item";

/**
 * A loader slot for one image. `procedural` is a canvas-drawn stand-in (now); `url` is a
 * real image file fetched + decoded (later). Both resolve to the same atlas layer (for a
 * GL sprite) or DOM image (for a portrait), so a game swaps a placeholder for real art by
 * changing only this union member.
 *
 * `draw` is handed a square canvas context sized `size × size`; paint the sprite with
 * alpha (unlike the additive-glow bullet shapes, representational sprites are alpha-
 * blended, so transparent regions read as empty, not black). For an animated sprite the
 * loader calls `draw` once per frame — `frame` is the current frame index and `frames` the
 * total — so a procedural sprite animates by branching on `frame`; a static drawer just
 * ignores both.
 */
export type ImageSource =
  | {
      readonly kind: "procedural";
      readonly draw: (ctx: CanvasRenderingContext2D, size: number, frame: number, frames: number) => void;
    }
  | { readonly kind: "url"; readonly src: string };

/**
 * A sprite = its image source plus optional sprite-sheet animation. A single-image sprite
 * omits `frames`/`fps`. An animated sprite has `frames > 1`: a `url` source lays its frames
 * out HORIZONTALLY (a `frames`-wide strip of square cells); a `procedural` source has its
 * `draw` called once per frame index. Either way the loader produces `frames` consecutive
 * atlas layers and the renderer cycles them at `fps`.
 */
export interface SpriteDef {
  readonly source: ImageSource;
  /** Horizontal frame count in a sprite-sheet strip. Default 1 (a static single image). */
  readonly frames?: number;
  /** Animation playback rate (frames per second). Default 0 = static (show frame 0).
   *  Presentation-clock driven — never the sim tick, so it is replay-irrelevant. */
  readonly fps?: number;
}

/**
 * A typed reference to one declared sprite. Opaque to the author — you get these from
 * `defineSprites` and pass them straight into content (`EnemySpec.sprite`, a background
 * layer, a portrait); you never read the fields. The loader stamps `layer` after it
 * uploads the atlas; the renderer reads `layer`/`frames`/`fps` to draw the current frame.
 */
export interface SpriteHandle {
  /** The key it was declared under in `defineSprites` — a stable id for debug + the
   *  loader's hot-reload keying. */
  readonly id: string;
  /** Atlas base layer (of frame 0), stamped by the loader. `-1` until loaded — an
   *  unloaded handle renders as nothing, never as a wrong sprite. */
  layer: number;
  /** Frame count (normalized: at least 1). */
  readonly frames: number;
  /** Playback fps (0 = static). */
  readonly fps: number;
  /** The source def, retained so the loader — and a hot-reload — can (re)resolve it. */
  readonly def: SpriteDef;
}

/**
 * Name a game's sprites once and get back typed handles to reference inline.
 *
 *   const sprites = defineSprites({
 *     fairyBlue: { source: proceduralFairy("blue"), frames: 4, fps: 12 },
 *     boss:      { source: { kind: "url", src: "/art/boss.png" } },
 *   });
 *   ctx.spawnEnemy(fairyAI, x, y, { sprite: sprites.fairyBlue, hp: 60, radius: 14, color: WHITE });
 *
 * Hand the whole returned map to `assets.sprites.library` so the loader preloads + atlases
 * every handle; the loader stamps atlas placement onto these same objects, so the handles
 * you reference inline are the ones that carry the resolved layer (shared by reference —
 * no registry, no import-order fragility, no string lookup).
 */
export function defineSprites<K extends string>(defs: Record<K, SpriteDef>): Record<K, SpriteHandle> {
  const out = {} as Record<K, SpriteHandle>;
  for (const id in defs) {
    const def = defs[id];
    out[id] = { id, layer: -1, frames: Math.max(1, def.frames ?? 1), fps: def.fps ?? 0, def };
  }
  return out;
}

/**
 * One layer of a (parallax) stage background. Referenced by handle; drawn full-field
 * BEFORE the danmaku, back-to-front in array order. Scroll speeds are in sim units/second
 * (presentation-only — a scrolling background never enters the sim).
 */
export interface BackgroundLayer {
  readonly sprite: SpriteHandle;
  /** Horizontal scroll, sim units/sec (default 0). */
  readonly scrollX?: number;
  /** Vertical scroll, sim units/sec (default 0; positive = the field scrolls downward,
   *  i.e. the layer appears to move up, the usual "flying forward" look). */
  readonly scrollY?: number;
  /** Repeat the image to fill the field (default true). A non-tiling layer draws once. */
  readonly tile?: boolean;
  /** Layer opacity, 0..1 (default 1). */
  readonly opacity?: number;
}

/**
 * A game's declared sprites. `library` is every handle the game references (the
 * `defineSprites(...)` result) — the loader preloads + atlases each. `items` optionally
 * overrides the engine's default item sprites per type (the SFX pattern: engine ships a
 * default for every `ItemType`, a game overrides only the ones it wants).
 */
export interface SpriteManifest {
  /** Everything referenced by handle — enemies, boss, player, portraits, backgrounds. */
  readonly library: Record<string, SpriteHandle>;
  /** Optional per-type overrides of the engine's default item sprites. */
  readonly items?: Partial<Record<ItemType, SpriteDef>>;
}
