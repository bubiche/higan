// Instanced bullet renderer.
//
// One textured quad per bullet, drawn in a single instanced draw call with
// additive blending for the Touhou glow look. The instance stream is one
// interleaved buffer of [x, y, scale, r, g, b] per bullet; quads are sized in
// sim units and projected through `uViewport`, so device-pixel ratio is handled
// entirely by the GL viewport (no per-point pixel scaling).
//
// `marshalBullets` — packing the live SoA slots into that interleaved buffer —
// is split out as a pure function so it can be measured headlessly: it is the
// new per-frame CPU cost the bullet system adds over the spike's contiguous
// range (skipping free-list holes to keep the GPU draw dense).

import { createProgram, createGlowTexture } from "./gl";
import type { BulletStore } from "../bullets/store";

/** Floats written per bullet instance: x, y, scale, r, g, b. */
export const INSTANCE_FLOATS = 6;

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
  const { x, y, radius, r, g, b } = store;
  let o = 0;
  let drawn = 0;
  for (let i = 0; i < highWater; i++) {
    if (alive[i] === 0) continue;
    out[o] = x[i];
    out[o + 1] = y[i];
    out[o + 2] = radius[i];
    out[o + 3] = r[i];
    out[o + 4] = g[i];
    out[o + 5] = b[i];
    o += INSTANCE_FLOATS;
    drawn++;
  }
  return drawn;
}

const VS = `#version 300 es
layout(location=0) in vec2 aCorner;   // unit quad (-1..1)
layout(location=1) in vec2 aPos;      // instance centre (sim units)
layout(location=2) in float aScale;   // instance radius (sim units)
layout(location=3) in vec3 aColor;
uniform vec2 uViewport;               // playfield size in sim units
out vec2 vUV;
out vec3 vColor;
void main() {
  vUV = aCorner * 0.5 + 0.5;
  vColor = aColor;
  vec2 p = aPos + aCorner * aScale;
  vec2 clip = (p / uViewport) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0); // flip Y: sim is top-down
}`;

const FS = `#version 300 es
precision mediump float;
in vec2 vUV;
in vec3 vColor;
uniform sampler2D uTex;
out vec4 frag;
void main() {
  float a = texture(uTex, vUV).a;
  frag = vec4(vColor * a, a); // premultiplied; drawn with additive blend
}`;

export interface BulletRenderer {
  /** Marshal, upload, and draw the live bullets. Returns the instance count drawn. */
  draw(store: BulletStore, alive: Uint8Array, highWater: number): number;
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
  const tex = createGlowTexture(gl);

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
  const instBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, instData.byteLength, gl.DYNAMIC_DRAW);
  const stride = INSTANCE_FLOATS * 4;
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 8);
  gl.vertexAttribDivisor(2, 1);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 3, gl.FLOAT, false, stride, 12);
  gl.vertexAttribDivisor(3, 1);
  gl.bindVertexArray(null);

  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE); // additive (premultiplied source) — the glow look

  return {
    draw(store, alive, highWater): number {
      const count = marshalBullets(store, alive, highWater, instData);
      if (count === 0) return 0;
      gl.useProgram(prog);
      gl.uniform2f(uViewport, fieldW, fieldH);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(uTex, 0);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instData, 0, count * INSTANCE_FLOATS);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.bindVertexArray(null);
      return count;
    },
  };
}
