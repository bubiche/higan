// Instanced straight-laser renderer.
//
// Lasers are O(tens), not O(tens-of-thousands), so this is a small, separate
// instanced draw with its own program/VAO — the proven bullet renderer (the
// perf-critical hot path) stays untouched. One stretched quad per beam: a unit
// quad scaled to (length, width), rotated by the beam heading, anchored so it
// EMANATES FROM the origin (0..length along the heading) rather than straddling
// it. A soft cross-beam falloff with a hot core line is computed in the fragment
// shader and drawn additively (the same glow look as bullets); the per-beam width
// and brightness come from `laserDisplay`, so the lifecycle (telegraph→fire→fade)
// is entirely CPU-side data and the shader stays trivial.
//
// `marshalLasers` is split out as a pure function (mirrors marshalBullets) so the
// instance packing — including the lifecycle→width/brightness mapping — can be
// exercised headlessly. The geometry itself only runs in a live GL context.

import { createProgram } from "./gl";
import { laserDisplay, type Laser } from "../touhou/laser";

/** Floats per laser instance: x, y, angle, length, width, r, g, b. */
export const LASER_INSTANCE_FLOATS = 8;

/**
 * Pack the live beams into `out` as interleaved instance data, folding each
 * beam's lifecycle phase into its display width and a brightness-scaled colour
 * (additive blend, so scaling RGB dims/brightens). Returns the instance count.
 * `out` must hold at least `liveCount * LASER_INSTANCE_FLOATS` floats.
 */
export function marshalLasers(lasers: readonly Laser[], out: Float32Array): number {
  let o = 0;
  let drawn = 0;
  for (let i = 0; i < lasers.length; i++) {
    const l = lasers[i];
    if (!l.alive) continue;
    const { displayWidth, intensity } = laserDisplay(l);
    if (displayWidth <= 0) continue;
    out[o] = l.x;
    out[o + 1] = l.y;
    out[o + 2] = l.angle;
    out[o + 3] = l.length;
    out[o + 4] = displayWidth;
    out[o + 5] = l.r * intensity;
    out[o + 6] = l.g * intensity;
    out[o + 7] = l.b * intensity;
    o += LASER_INSTANCE_FLOATS;
    drawn++;
  }
  return drawn;
}

const VS = `#version 300 es
layout(location=0) in vec2 aCorner;   // unit quad (-1..1)
layout(location=1) in vec2 aPos;      // beam origin (sim units)
layout(location=2) in float aAngle;   // heading (radians, 0 = +x)
layout(location=3) in float aLength;  // beam length (sim units)
layout(location=4) in float aWidth;   // beam width (sim units)
layout(location=5) in vec3 aColor;
uniform vec2 uViewport;               // playfield size in sim units
out vec2 vUV;                         // x: 0..1 along beam, y: -1..1 across width
out vec3 vColor;
void main() {
  float along = (aCorner.x * 0.5 + 0.5) * aLength; // 0 at origin → length at tip
  float perp = aCorner.y * 0.5 * aWidth;           // centred ±width/2
  vUV = vec2(aCorner.x * 0.5 + 0.5, aCorner.y);
  vColor = aColor;
  float c = cos(aAngle);
  float s = sin(aAngle);
  // Forward axis (c, s); perpendicular axis (-s, c).
  vec2 p = aPos + vec2(c, s) * along + vec2(-s, c) * perp;
  vec2 clip = (p / uViewport) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0); // flip Y: sim is top-down
}`;

const FS = `#version 300 es
precision mediump float;
in vec2 vUV;
in vec3 vColor;
out vec4 frag;
void main() {
  float edge = abs(vUV.y);                  // 0 at the centre line → 1 at the edge
  float glow = 1.0 - edge;
  glow *= glow;                             // soften the cross-beam falloff
  float core = smoothstep(0.34, 0.0, edge); // bright central filament
  float tip = smoothstep(1.0, 0.9, vUV.x);  // taper the very end so it isn't a slab
  float a = clamp(glow + core * 0.85, 0.0, 1.0) * tip;
  frag = vec4(vColor * a, a); // premultiplied; drawn with additive blend
}`;

export interface LaserRenderer {
  /** Marshal, upload, and draw the live beams. Returns the instance count drawn. */
  draw(lasers: readonly Laser[]): number;
}

export function createLaserRenderer(
  gl: WebGL2RenderingContext,
  fieldW: number,
  fieldH: number,
  capacity: number,
): LaserRenderer {
  const prog = createProgram(gl, VS, FS);
  const uViewport = gl.getUniformLocation(prog, "uViewport");

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const cornerBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const instData = new Float32Array(capacity * LASER_INSTANCE_FLOATS);
  const instBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
  gl.bufferData(gl.ARRAY_BUFFER, instData.byteLength, gl.DYNAMIC_DRAW);
  const stride = LASER_INSTANCE_FLOATS * 4;
  gl.enableVertexAttribArray(1); // aPos
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.enableVertexAttribArray(2); // aAngle
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 8);
  gl.vertexAttribDivisor(2, 1);
  gl.enableVertexAttribArray(3); // aLength
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 12);
  gl.vertexAttribDivisor(3, 1);
  gl.enableVertexAttribArray(4); // aWidth
  gl.vertexAttribPointer(4, 1, gl.FLOAT, false, stride, 16);
  gl.vertexAttribDivisor(4, 1);
  gl.enableVertexAttribArray(5); // aColor
  gl.vertexAttribPointer(5, 3, gl.FLOAT, false, stride, 20);
  gl.vertexAttribDivisor(5, 1);
  gl.bindVertexArray(null);

  return {
    draw(lasers): number {
      const count = marshalLasers(lasers, instData);
      if (count === 0) return 0;
      gl.useProgram(prog);
      gl.uniform2f(uViewport, fieldW, fieldH);
      // Additive, premultiplied — matches the bullet glow. The bullet renderer
      // leaves BLEND enabled in this mode, but set it here too so draw order with
      // any future opaque pass stays correct.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, instData, 0, count * LASER_INSTANCE_FLOATS);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.bindVertexArray(null);
      return count;
    },
  };
}
