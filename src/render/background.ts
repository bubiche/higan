// Parallax background pass — the full-field scrolling scenery drawn BEFORE the danmaku.
//
// This is a THIRD render pass, distinct from both the additive-glow bullet/laser pass and
// the alpha representational-sprite pass:
//   - It draws one full-field quad per background layer, back-to-front in array order, each
//     sampling its OWN 2D texture with a scrolling + (optionally) tiling UV, straight-alpha
//     blended so a transparent layer shows the layers (and clear colour) behind it.
//   - Unlike the sprite atlas (a `TEXTURE_2D_ARRAY` of 128px cells, CLAMP-wrapped), each
//     background is a standalone `TEXTURE_2D` at full resolution with REPEAT wrap — so a
//     tiling layer repeats seamlessly and a real image keeps its native detail. Sharing the
//     sprite atlas would cap fidelity at the cell size and need in-shader `fract()` tiling
//     with mipmap seams; a dedicated texture is both higher-fidelity AND simpler here.
//   - Layers reference the SAME author vocabulary as sprites — a `BackgroundLayer` names a
//     `SpriteHandle` (from `defineSprites`) and this pass resolves `handle.def.source`
//     directly. Background handles are referenced from `StageDef.background`, NOT the sprite
//     `library`: routing follows the reference site, so nothing is atlased twice.
//
// Determinism: nothing here is sim state. Scroll is driven by the presentation clock (wall
// seconds), never the sim tick — so it never touches the hash and a replay is unaffected.
// Import-safe in a headless (no-GL/DOM) context: every `document`/GL call is inside
// `load`/`createBackgroundRenderer`, never at module load.

import { createProgram } from "./gl";
import type { BackgroundLayer, ImageSource } from "../api/sprites";

/** Canvas resolution for a PROCEDURAL background tile. Larger than a sprite cell — a
 *  full-field scrolling layer wants the detail; a url layer keeps its native size. */
const BG_SIZE = 256;

// Tiling convention: one square tile spans the field WIDTH (the `fieldW` passed in),
// repeating vertically to keep tiles square on a non-square field. Not a per-layer knob —
// a single convention keeps `BackgroundLayer` declarative; an author tunes the art, not the
// scale. (See the `tile` branch in `draw`.)

const VS = `#version 300 es
layout(location=0) in vec2 aCorner;   // full-field quad, 0..1 (top-left origin)
uniform vec2 uScale;                  // UV repeats across the field (1 = fill once)
uniform vec2 uOffset;                 // UV scroll offset
out vec2 vUV;
void main() {
  vUV = aCorner * uScale + uOffset;
  vec2 clip = aCorner * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0); // flip Y: field is top-down, like the bullet VS
}`;

const FS = `#version 300 es
precision mediump float;
in vec2 vUV;
uniform sampler2D uTex;
uniform float uOpacity;
out vec4 frag;
void main() {
  vec4 t = texture(uTex, vUV);
  frag = vec4(t.rgb, t.a * uOpacity); // straight alpha, faded by the layer's opacity
}`;

/** Paint a procedural background source into a `BG_SIZE` square canvas (frame 0 — background
 *  layers are static images; a scrolling layer scrolls its UV, it does not frame-animate). */
function paintProcedural(source: Extract<ImageSource, { kind: "procedural" }>): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = BG_SIZE;
  const ctx = c.getContext("2d")!;
  source.draw(ctx, BG_SIZE, 0, 1);
  return c;
}

/** Load one url image into an HTMLImageElement (defensive: resolves null on any failure — a
 *  missing background must not break the game, mirroring the sprite/audio loaders). */
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => {
      console.warn("[higan background] failed to load image:", src);
      resolve(null);
    };
    img.src = src;
  });
}

export interface BackgroundRenderer {
  /** Resolve + upload a texture for every distinct handle referenced by `layers` (deduped
   *  by handle identity). Awaitable; call again to hot-reload — it rebuilds the texture set
   *  wholesale and deletes the previous textures (a merge would leak). Procedural sources
   *  paint immediately; url sources are fetched + decoded first. */
  load(layers: readonly BackgroundLayer[]): Promise<void>;
  /** Draw `layers` back-to-front (array order) as full-field parallax at `clockSec`. A layer
   *  whose texture isn't loaded is skipped; a no-op entirely until the first `load` resolves
   *  or for an empty list. */
  draw(layers: readonly BackgroundLayer[], clockSec: number): void;
  /** Whether at least one texture has been uploaded (drawing is a no-op before this). */
  readonly loaded: boolean;
}

export function createBackgroundRenderer(
  gl: WebGL2RenderingContext,
  fieldW: number,
  fieldH: number,
): BackgroundRenderer {
  const prog = createProgram(gl, VS, FS);
  const uScale = gl.getUniformLocation(prog, "uScale");
  const uOffset = gl.getUniformLocation(prog, "uOffset");
  const uTex = gl.getUniformLocation(prog, "uTex");
  const uOpacity = gl.getUniformLocation(prog, "uOpacity");

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const cornerBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
  // A 0..1 quad as a triangle strip (top-left, top-right, bottom-left, bottom-right).
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  // One GL texture per distinct handle, keyed by handle identity. Rebuilt wholesale on load.
  let textures = new Map<BackgroundLayer["sprite"], WebGLTexture>();
  let loaded = false;

  /** Upload one `TexImageSource` (canvas or image) as a REPEAT-wrapped, mipmapped 2D texture. */
  function upload(src: TexImageSource): WebGLTexture {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D); // WebGL2 allows NPOT + REPEAT + mipmaps
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return tex;
  }

  async function load(layers: readonly BackgroundLayer[]): Promise<void> {
    // Distinct handles only — the same background can be referenced by several stages/layers.
    const handles = [...new Set(layers.map((l) => l.sprite))];
    // Resolve every source first (awaiting url decodes) so a slow image doesn't leave a
    // half-built map on screen; then swap the map + drop the old textures in one step.
    const resolved = await Promise.all(
      handles.map(async (handle) => {
        const source = handle.def.source;
        const bitmap: TexImageSource | null =
          source.kind === "procedural" ? paintProcedural(source) : await loadImage(source.src);
        return { handle, bitmap };
      }),
    );

    const next = new Map<BackgroundLayer["sprite"], WebGLTexture>();
    for (const { handle, bitmap } of resolved) {
      if (bitmap) next.set(handle, upload(bitmap));
    }

    for (const tex of textures.values()) gl.deleteTexture(tex);
    textures = next;
    loaded = true;
  }

  return {
    load,
    get loaded(): boolean {
      return loaded;
    },
    draw(layers, clockSec): void {
      if (!loaded || layers.length === 0) return;
      gl.useProgram(prog);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); // straight-alpha "over"
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(uTex, 0);
      gl.bindVertexArray(vao);
      for (const layer of layers) {
        const tex = textures.get(layer.sprite);
        if (!tex) continue; // unloaded / failed → skip (never a wrong texture)
        const tile = layer.tile ?? true;
        const scrollX = layer.scrollX ?? 0;
        const scrollY = layer.scrollY ?? 0;
        // Tiling: one square tile spans the field width, repeating vertically to keep the
        // aspect square; scroll is sim units → UV where one tile = `fieldW` units. Non-tiling:
        // stretch the image once across the field; scroll in whole-field units.
        if (tile) {
          gl.uniform2f(uScale, 1, fieldH / fieldW);
          gl.uniform2f(uOffset, (scrollX * clockSec) / fieldW, (scrollY * clockSec) / fieldW);
        } else {
          gl.uniform2f(uScale, 1, 1);
          gl.uniform2f(uOffset, (scrollX * clockSec) / fieldW, (scrollY * clockSec) / fieldH);
        }
        gl.uniform1f(uOpacity, layer.opacity ?? 1);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      gl.bindVertexArray(null);
    },
  };
}
