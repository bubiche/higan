import { createGL } from "../render/gl";
import { startFixedTimestepLoop } from "../core/loop";

// Touhou-convention playfield: a 4:3-ish portrait field, measured in sim units.
const PLAYFIELD_W = 384;
const PLAYFIELD_H = 448;
const CSS_SCALE = 1.6;
const DT = 1 / 60;

const canvas = document.getElementById("playfield") as HTMLCanvasElement;
const gl = createGL(canvas);

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = `${PLAYFIELD_W * CSS_SCALE}px`;
  canvas.style.height = `${PLAYFIELD_H * CSS_SCALE}px`;
  canvas.width = Math.round(PLAYFIELD_W * CSS_SCALE * dpr);
  canvas.height = Math.round(PLAYFIELD_H * CSS_SCALE * dpr);
  gl.viewport(0, 0, canvas.width, canvas.height);
}
resize();
window.addEventListener("resize", resize);

function step(): void {
  // No simulation yet — the playfield is intentionally empty.
}

function render(): void {
  gl.clearColor(0.008, 0.012, 0.04, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

startFixedTimestepLoop({ dt: DT, step, render });
