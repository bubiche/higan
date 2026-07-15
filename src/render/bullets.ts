// Instanced bullet renderer.
//
// One textured quad per bullet, drawn in a single instanced draw call with
// additive blending for the Touhou glow look. The instance stream is one
// interleaved buffer of [x, y, scale, angle, r, g, b, layer] per bullet; quads
// are sized in sim units and projected through `uViewport`, so device-pixel ratio
// is handled entirely by the GL viewport (no per-point pixel scaling). Each quad
// is rotated by its `angle` in the vertex shader so non-round shapes (rice,
// kunai) point along travel, and samples a `TEXTURE_2D_ARRAY` shape atlas by the
// per-instance `layer`, so every shape draws in the same call.
//
// `marshalBullets` — packing the live SoA slots into that interleaved buffer —
// is split out as a pure function so it can be measured headlessly: it is the
// per-frame CPU cost of compacting the SoA into a dense instance stream,
// skipping free-list holes to keep the GPU draw dense.

import { createProgram, createShapeAtlas } from "./gl";
import type { BulletStore } from "../bullets/store";
import { IMAGE_FLAG, IMAGE_INDEX_MASK } from "../bullets/sprite-table";
import { Shape } from "./shapes";

/** Floats written per bullet instance: x, y, scale, angle, r, g, b, layer. */
export const INSTANCE_FLOATS = 8;

/**
 * Spawn-flash tuning. For its first `ticks` of life a bullet gets an extra additive `Flare`
 * bloom stacked over it, `maxScale`× its radius fading to 1× as it settles, so a fresh wave
 * reads as a burst of light instead of popping in flat. Presentation-only (keyed on the
 * bullet's already-hashed `age`; nothing here is written back to the sim). Default on, no
 * per-bullet opt-out — a game gets it for free. The stress bench mutates these live to tune
 * scale/duration against the frame budget without a rebuild; the game leaves the defaults.
 */
export const FLARE = { ticks: 10, maxScale: 2.5 };

/** Instance counts written to each pass's buffer by `marshalBullets`. */
export interface BulletMarshalResult {
  /** Instances written to the additive glow buffer. */
  glow: number;
  /** Instances written to the straight-alpha custom-image buffer. */
  image: number;
}

/**
 * Pack the live bullets in `[0, highWater)` into two interleaved instance buffers,
 * skipping free-list holes: `glowOut` (procedural `Shape` glow, drawn additive) and
 * `imageOut` (custom images, drawn straight-alpha). The split is a single high-bit test
 * on the render byte — a bullet whose `sprite` has `IMAGE_FLAG` set is a custom image.
 * Returns the count written to each buffer; the caller draws exactly that many per pass.
 *
 * `imageLayer(tableId)` resolves a custom image's current atlas layer (animation folded
 * in), or -1 if it isn't ready yet — in which case that bullet falls back to a glow `Orb`
 * so it is never invisible while the atlas loads. This is the per-frame CPU hot path at
 * tens of thousands of bullets, so each branch writes its statically-known array inline
 * (no `out = …` indirection) to keep the loop monomorphic; the glow branch — the near-
 * always-taken case — is a single not-taken test away from the plain write it always was.
 *
 * A just-spawned bullet (`age < FLARE.ticks`) additionally emits an extra `Flare` bloom
 * into `glowOut` — the spawn flash — regardless of whether the bullet itself is a glow shape
 * or a custom image (the flare is a generic additive glow, not a per-sprite effect). So the
 * glow stream can hold up to TWO instances per live bullet: `glowOut` must therefore be sized
 * `2 * liveCount * INSTANCE_FLOATS` (the renderer's internal buffer is), while `imageOut`
 * still needs only `liveCount * INSTANCE_FLOATS` (images never double). Player shots are
 * deliberately left flare-free (see `marshalShots`): they spawn every few ticks, so flashing
 * them would be constant noise rather than a spawn accent.
 */
export function marshalBullets(
  store: BulletStore,
  alive: Uint8Array,
  highWater: number,
  glowOut: Float32Array,
  imageOut: Float32Array,
  imageLayer: (tableId: number) => number,
): BulletMarshalResult {
  const { x, y, angle, radius, r, g, b, sprite, age } = store;
  // Hoist the flare tuning once per call (never per bullet) so the hot loop stays tight.
  const flashTicks = FLARE.ticks;
  const scaleSpan = FLARE.maxScale - 1;
  let go = 0;
  let io = 0;
  let glow = 0;
  let image = 0;
  for (let i = 0; i < highWater; i++) {
    if (alive[i] === 0) continue;
    const byte = sprite[i];
    if (byte & IMAGE_FLAG) {
      const resolved = imageLayer(byte & IMAGE_INDEX_MASK);
      if (resolved >= 0) {
        imageOut[io] = x[i];
        imageOut[io + 1] = y[i];
        imageOut[io + 2] = radius[i];
        imageOut[io + 3] = angle[i];
        imageOut[io + 4] = r[i];
        imageOut[io + 5] = g[i];
        imageOut[io + 6] = b[i];
        imageOut[io + 7] = resolved;
        io += INSTANCE_FLOATS;
        image++;
      } else {
        // Atlas not ready (or a failed url): draw a glow orb rather than nothing.
        glowOut[go] = x[i];
        glowOut[go + 1] = y[i];
        glowOut[go + 2] = radius[i];
        glowOut[go + 3] = angle[i];
        glowOut[go + 4] = r[i];
        glowOut[go + 5] = g[i];
        glowOut[go + 6] = b[i];
        glowOut[go + 7] = Shape.Orb;
        go += INSTANCE_FLOATS;
        glow++;
      }
    } else {
      // Glow shape — the near-always-taken path; `byte` is the atlas layer directly.
      glowOut[go] = x[i];
      glowOut[go + 1] = y[i];
      glowOut[go + 2] = radius[i];
      glowOut[go + 3] = angle[i];
      glowOut[go + 4] = r[i];
      glowOut[go + 5] = g[i];
      glowOut[go + 6] = b[i];
      glowOut[go + 7] = byte;
      go += INSTANCE_FLOATS;
      glow++;
    }
    // Spawn flash: stack a scaled, fading additive bloom over any just-spawned bullet. A
    // not-taken test for the whole (typical) old-bullet field; only young slots pay the write.
    const a = age[i];
    if (a < flashTicks) {
      const fade = 1 - a / flashTicks; // 1 at spawn → 0 as it settles
      glowOut[go] = x[i];
      glowOut[go + 1] = y[i];
      glowOut[go + 2] = radius[i] * (1 + scaleSpan * fade); // maxScale× → 1×
      glowOut[go + 3] = 0; // round bloom — rotation irrelevant
      glowOut[go + 4] = r[i] * fade; // additive: dim the tint to fade the bloom out
      glowOut[go + 5] = g[i] * fade;
      glowOut[go + 6] = b[i] * fade;
      glowOut[go + 7] = Shape.Flare;
      go += INSTANCE_FLOATS;
      glow++;
    }
  }
  return { glow, image };
}

/** The instanced textured-quad vertex shader. Shared with the alpha sprite pass
 *  (`render/atlas.ts`), which reuses this exact quad transform with a different fragment
 *  shader + blend, so the two passes can't drift on positioning/rotation. */
export const INSTANCED_QUAD_VS = `#version 300 es
layout(location=0) in vec2 aCorner;   // unit quad (-1..1)
layout(location=1) in vec2 aPos;      // instance centre (sim units)
layout(location=2) in float aScale;   // instance radius (sim units)
layout(location=3) in float aAngle;   // instance heading (radians, 0 = +x)
layout(location=4) in vec3 aColor;
layout(location=5) in float aLayer;   // shape atlas layer
uniform vec2 uViewport;               // playfield size in sim units
out vec2 vUV;
out vec3 vColor;
flat out float vLayer;
void main() {
  vUV = aCorner * 0.5 + 0.5;          // UV tied to the unrotated corner identity
  vColor = aColor;
  vLayer = aLayer;
  float c = cos(aAngle);
  float s = sin(aAngle);
  vec2 rc = vec2(aCorner.x * c - aCorner.y * s, aCorner.x * s + aCorner.y * c);
  vec2 p = aPos + rc * aScale;
  vec2 clip = (p / uViewport) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0); // flip Y: sim is top-down
}`;

const FS = `#version 300 es
precision mediump float;
precision mediump sampler2DArray;   // 3.00 has no default precision for array samplers
in vec2 vUV;
in vec3 vColor;
flat in float vLayer;
uniform sampler2DArray uTex;
out vec4 frag;
void main() {
  float a = texture(uTex, vec3(vUV, vLayer)).a;
  frag = vec4(vColor * a, a); // premultiplied; drawn with additive blend
}`;

/**
 * A non-bullet marker (e.g. the player marker, or the focus hitbox dot) drawn on
 * the same instanced program after the bullets. These are deliberately NOT bullets
 * — they never enter the simulation or the determinism hash — so each gets its own
 * one-instance draw rather than a slot in the store.
 */
export interface Overlay {
  x: number;
  y: number;
  radius: number;
  color: readonly [number, number, number];
  sprite: number;
}

export interface BulletRenderer {
  /**
   * Marshal and draw the live bullets, splitting them by look: procedural glow `Shape`s
   * on this additive pass (uploaded + drawn here), and custom-image bullets packed into
   * `imageOut` for the caller to draw on the straight-alpha sprite pass afterwards (this
   * renderer can't bind that atlas). Any one-instance `overlays` (player marker, hitbox
   * dot, …) draw in order on top of the glow bullets. `imageLayer` resolves an image's
   * current atlas layer (or -1 → glow-orb fallback). Returns both instance counts;
   * `imageOut` must hold at least `liveCount * INSTANCE_FLOATS` floats.
   */
  draw(
    store: BulletStore,
    alive: Uint8Array,
    highWater: number,
    imageOut: Float32Array,
    imageLayer: (tableId: number) => number,
    overlays?: readonly Overlay[],
  ): BulletMarshalResult;
  /**
   * Draw `count` caller-marshalled instances (player shots, items, …) on the same
   * instanced program — the generalisation of the one-instance overlay path. `data`
   * holds `INSTANCE_FLOATS` per instance (x, y, scale, angle, r, g, b, layer).
   * Reuses the instance buffer head, so it must be issued before any later draw that
   * overwrites it (same ordering the overlay loop relies on). A no-op for count ≤ 0.
   */
  drawInstances(data: Float32Array, count: number): void;
}

export function createBulletRenderer(
  gl: WebGL2RenderingContext,
  fieldW: number,
  fieldH: number,
  capacity: number,
): BulletRenderer {
  const prog = createProgram(gl, INSTANCED_QUAD_VS, FS);
  const uViewport = gl.getUniformLocation(prog, "uViewport");
  const uTex = gl.getUniformLocation(prog, "uTex");
  const tex = createShapeAtlas(gl);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  // Static unit quad, drawn as a triangle strip.
  const cornerBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Instance buffer, pre-allocated; we upload the active prefix. Sized to 2× capacity because
  // the glow stream carries up to one spawn-flash flare PER live bullet on top of the bullet
  // itself (see `marshalBullets`), so a fully-young field marshals 2× capacity glow instances.
  const instData = new Float32Array(capacity * 2 * INSTANCE_FLOATS);
  // Scratch for the optional one-instance overlay draw.
  const overlayData = new Float32Array(INSTANCE_FLOATS);
  const instBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, instData.byteLength, gl.DYNAMIC_DRAW);
  const stride = INSTANCE_FLOATS * 4;
  gl.enableVertexAttribArray(1); // aPos
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2); // aScale
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 8);
  gl.vertexAttribDivisor(2, 1);
  gl.enableVertexAttribArray(3); // aAngle
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 12);
  gl.vertexAttribDivisor(3, 1);
  gl.enableVertexAttribArray(4); // aColor
  gl.vertexAttribPointer(4, 3, gl.FLOAT, false, stride, 16);
  gl.vertexAttribDivisor(4, 1);
  gl.enableVertexAttribArray(5); // aLayer
  gl.vertexAttribPointer(5, 1, gl.FLOAT, false, stride, 28);
  gl.vertexAttribDivisor(5, 1);
  gl.bindVertexArray(null);

  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE); // additive (premultiplied source) — the glow look

  return {
    draw(store, alive, highWater, imageOut, imageLayer, overlays): BulletMarshalResult {
      const counts = marshalBullets(store, alive, highWater, instData, imageOut, imageLayer);
      const count = counts.glow;
      const overlayCount = overlays ? overlays.length : 0;
      if (count === 0 && overlayCount === 0) return counts;
      gl.useProgram(prog);
      gl.uniform2f(uViewport, fieldW, fieldH);
      // Re-assert additive blend every draw: the alpha sprite pass (enemies/items/player)
      // runs between the shot and bullet draws and leaves straight-alpha set, so the glow
      // layers must restore their own mode rather than rely on the creation-time state.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.uniform1i(uTex, 0);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      if (count > 0) {
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, instData, 0, count * INSTANCE_FLOATS);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      }
      for (let k = 0; k < overlayCount; k++) {
        // Reuse the head of the instance buffer for each single-instance draw; the
        // bullet draw above is already issued and each overlay draw is submitted
        // before the next overwrite, so reusing the head is safe — and marshal
        // rewrites the buffer next frame.
        const o = overlays![k];
        overlayData[0] = o.x;
        overlayData[1] = o.y;
        overlayData[2] = o.radius;
        overlayData[3] = 0; // angle: markers are round, no rotation
        overlayData[4] = o.color[0];
        overlayData[5] = o.color[1];
        overlayData[6] = o.color[2];
        overlayData[7] = o.sprite;
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, overlayData, 0, INSTANCE_FLOATS);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1);
      }
      gl.bindVertexArray(null);
      return counts;
    },
    drawInstances(data, count): void {
      if (count <= 0) return;
      gl.useProgram(prog);
      gl.uniform2f(uViewport, fieldW, fieldH);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE); // additive glow — restore after the alpha sprite pass
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.uniform1i(uTex, 0);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * INSTANCE_FLOATS);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.bindVertexArray(null);
    },
  };
}
