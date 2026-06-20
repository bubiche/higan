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

/** Floats written per bullet instance: x, y, scale, angle, r, g, b, layer. */
export const INSTANCE_FLOATS = 8;

/**
 * Pack the live bullets in `[0, highWater)` into `out` as interleaved instance
 * data, skipping free-list holes. Returns the number of instances written; the
 * caller draws exactly that many. `out` must hold at least `liveCount *
 * INSTANCE_FLOATS` floats.
 */
export function marshalBullets(
  store: BulletStore,
  alive: Uint8Array,
  highWater: number,
  out: Float32Array,
): number {
  const { x, y, angle, radius, r, g, b, sprite } = store;
  let o = 0;
  let drawn = 0;
  for (let i = 0; i < highWater; i++) {
    if (alive[i] === 0) continue;
    out[o] = x[i];
    out[o + 1] = y[i];
    out[o + 2] = radius[i];
    out[o + 3] = angle[i];
    out[o + 4] = r[i];
    out[o + 5] = g[i];
    out[o + 6] = b[i];
    out[o + 7] = sprite[i];
    o += INSTANCE_FLOATS;
    drawn++;
  }
  return drawn;
}

const VS = `#version 300 es
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
 * A single non-bullet marker (the keyboard-controlled player/target) drawn on the
 * same instanced program after the bullets. It is deliberately NOT a bullet — it
 * never enters the simulation or the determinism hash — so it gets its own
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
   * Marshal, upload, and draw the live bullets, plus an optional one-instance
   * `overlay` (e.g. the player marker). Returns the bullet instance count drawn.
   */
  draw(store: BulletStore, alive: Uint8Array, highWater: number, overlay?: Overlay): number;
}

export function createBulletRenderer(
  gl: WebGL2RenderingContext,
  fieldW: number,
  fieldH: number,
  capacity: number,
): BulletRenderer {
  const prog = createProgram(gl, VS, FS);
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

  // Instance buffer, pre-allocated at capacity; we upload the active prefix.
  const instData = new Float32Array(capacity * INSTANCE_FLOATS);
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
    draw(store, alive, highWater, overlay): number {
      const count = marshalBullets(store, alive, highWater, instData);
      if (count === 0 && !overlay) return 0;
      gl.useProgram(prog);
      gl.uniform2f(uViewport, fieldW, fieldH);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.uniform1i(uTex, 0);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      if (count > 0) {
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, instData, 0, count * INSTANCE_FLOATS);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      }
      if (overlay) {
        // Reuse the head of the instance buffer for a single-instance draw; the
        // bullet draw above is already issued, so overwriting is safe, and marshal
        // rewrites the buffer next frame.
        overlayData[0] = overlay.x;
        overlayData[1] = overlay.y;
        overlayData[2] = overlay.radius;
        overlayData[3] = 0; // angle: marker is round, no rotation
        overlayData[4] = overlay.color[0];
        overlayData[5] = overlay.color[1];
        overlayData[6] = overlay.color[2];
        overlayData[7] = overlay.sprite;
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, overlayData, 0, INSTANCE_FLOATS);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1);
      }
      gl.bindVertexArray(null);
      return count;
    },
  };
}
