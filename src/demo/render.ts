// Minimal additive glow-point renderer for the demo.
//
// Deliberately small and throwaway: it draws each entity as a single textured
// GL_POINT so the demo is watchable without the real instanced bullet renderer
// (which is a later, much larger piece of work). Instance data is one
// interleaved buffer of [x, y, r, g, b, sizePx] per point.

import { createProgram, createGlowTexture } from "../render/gl";

const FLOATS_PER_POINT = 6;

const VS = `#version 300 es
layout(location=0) in vec2 aPos;     // sim units
layout(location=1) in vec3 aColor;
layout(location=2) in float aSize;   // device pixels
uniform vec2 uField;                 // playfield size in sim units
out vec3 vColor;
void main() {
  vec2 clip = (aPos / uField) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0); // flip Y: sim is top-down
  gl_PointSize = aSize;
  vColor = aColor;
}`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec3 vColor;
out vec4 frag;
void main() {
  float a = texture(uTex, gl_PointCoord).a;
  frag = vec4(vColor * a, a); // premultiplied, for additive blending
}`;

export interface PointRenderer {
  /** Draw the first `count` points from `data` (FLOATS_PER_POINT floats each). */
  draw(data: Float32Array, count: number): void;
}

export function createPointRenderer(
  gl: WebGL2RenderingContext,
  fieldW: number,
  fieldH: number,
  capacity: number,
): PointRenderer {
  const prog = createProgram(gl, VS, FS);
  const tex = createGlowTexture(gl);

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, capacity * FLOATS_PER_POINT * 4, gl.DYNAMIC_DRAW);

  const stride = FLOATS_PER_POINT * 4;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 8);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 20);
  gl.bindVertexArray(null);

  gl.useProgram(prog);
  gl.uniform2f(gl.getUniformLocation(prog, "uField"), fieldW, fieldH);
  gl.uniform1i(gl.getUniformLocation(prog, "uTex"), 0);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE); // additive (premultiplied source)

  return {
    draw(data: Float32Array, count: number): void {
      if (count <= 0) return;
      gl.useProgram(prog);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * FLOATS_PER_POINT);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.drawArrays(gl.POINTS, 0, count);
      gl.bindVertexArray(null);
    },
  };
}
