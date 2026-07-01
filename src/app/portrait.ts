// Shared portrait-URL resolver — the DOM-image half of the sprite vocabulary, used by both
// the cut-in overlay and the dialogue box. Resolves a `SpriteHandle`'s `ImageSource` to a CSS
// `url(...)` value: a `procedural` source paints frame 0 to an offscreen canvas → data URL
// (cached by handle identity, since a procedural draw is otherwise re-run on every read); a
// `url` source is used directly (the bundler-fingerprinted href).

import type { SpriteHandle } from "../api/sprites";

const PORTRAIT_PX = 320;

function resolve(handle: SpriteHandle): string {
  const src = handle.def.source;
  if (src.kind === "url") return src.src;
  const c = document.createElement("canvas");
  c.width = c.height = PORTRAIT_PX;
  const ctx = c.getContext("2d")!;
  src.draw(ctx, PORTRAIT_PX, 0, 1);
  return c.toDataURL();
}

/** A cached `handle → url` resolver. Each caller (cutins, dialogue) creates its own — cheap
 *  (a Map plus an occasional canvas paint) and keeps the two overlays independent. */
export function createPortraitResolver(): (handle?: SpriteHandle) => string | null {
  const cache = new Map<SpriteHandle, string>();
  return (handle) => {
    if (!handle) return null;
    let url = cache.get(handle);
    if (url === undefined) {
      url = resolve(handle);
      cache.set(handle, url);
    }
    return url;
  };
}
