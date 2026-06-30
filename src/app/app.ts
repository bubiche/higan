// The app shell — the single entry the engine exposes for running a game.
//
// `runGame(def)` wires the browser surface the screens share: it creates the GL
// context and the two renderers ONCE (they are content-agnostic and fixed
// capacity, so a run can start and end and start again without churning GPU
// resources), the one keyboard source, the screen router, and the one animation
// loop. Each frame it advances the active screen, clears the canvas, and renders
// the screen stack. The simulation lives inside the in-game screen; this layer
// knows only screens.
//
// This is the engine side of the engine/game boundary: it takes a `GameDefinition`
// and never imports anything under `games/`.

import { startAnimationLoop } from "../core/loop";
import { createGL } from "../render/gl";
import { createBulletRenderer } from "../render/bullets";
import { createLaserRenderer } from "../render/lasers";
import { SIM_CAPACITY, LASER_CAPACITY } from "../core/sim";
import { PLAYFIELD_W, PLAYFIELD_H } from "../core/playfield";
import { createShellInput, type ShellInput } from "./keyboard";
import { createRouter, type Router, type Shell } from "./screen";
import { createTitleScreen } from "./screens/title";
import { loadSave, persistSave, clampDisplayScale } from "./save";
import type { GameDefinition } from "../api/game";

export interface AppHandle {
  readonly router: Router;
  readonly input: ShellInput;
  /** Replace the running game definition (dev HMR). Screens read `shell.def` fresh, so
   *  the next-built screen — and the live in-game screen on its next rebuild/resync —
   *  use the new content. A no-op to gameplay until something rebuilds. */
  reloadDef(def: GameDefinition): void;
  /** Stop the loop and release the keyboard source. */
  stop(): void;
}

export function runGame(def: GameDefinition): AppHandle {
  const canvas = document.getElementById("playfield") as HTMLCanvasElement;
  const overlay = document.getElementById("overlay") as HTMLElement;
  const sidebar = document.getElementById("sidebar") as HTMLElement;
  const gl = createGL(canvas);

  // The live game definition. Mutable so dev HMR can swap in freshly-imported content
  // (via the returned `reloadDef`); the shell exposes it as a getter so every screen
  // reads the current one. Stable in production (HMR is dev-only).
  let currentDef = def;

  // Load persisted settings BEFORE the first resize so the saved display scale is
  // applied on boot, not after a flash at the default.
  const save = loadSave();

  const resize = (): void => {
    const scale = clampDisplayScale(save.settings.displayScale);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = `${PLAYFIELD_W * scale}px`;
    canvas.style.height = `${PLAYFIELD_H * scale}px`;
    // Bullets are sized in sim units and projected through the GL viewport, so DPR
    // is handled entirely here — no per-instance pixel scaling.
    canvas.width = Math.round(PLAYFIELD_W * scale * dpr);
    canvas.height = Math.round(PLAYFIELD_H * scale * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  resize();
  window.addEventListener("resize", resize);

  const input = createShellInput(() => save.settings.keybinds);
  const bullets = createBulletRenderer(gl, PLAYFIELD_W, PLAYFIELD_H, SIM_CAPACITY);
  const lasers = createLaserRenderer(gl, PLAYFIELD_W, PLAYFIELD_H, LASER_CAPACITY);

  // `router` is filled in just below; the getter defers the read until a screen's
  // frame/enter runs (after assignment), breaking the shell↔screen construction cycle.
  let router!: Router;
  const shell: Shell = {
    gl,
    canvas,
    overlay,
    sidebar,
    input,
    bullets,
    lasers,
    get def(): GameDefinition {
      return currentDef;
    },
    save,
    get router(): Router {
      return router;
    },
    persist(): void {
      persistSave(save);
    },
    applyDisplayScale(): void {
      resize();
    },
  };
  router = createRouter(createTitleScreen(shell));

  const loop = startAnimationLoop((dtSeconds) => {
    router.frame(dtSeconds);
    // One clear per frame, then the stack draws over it (an overlay renders above
    // the frozen screen beneath). The driver advanced the sim in `frame`; drawing
    // is unconditional so a paused/stepped sim still shows on the next frame.
    gl.clearColor(0.008, 0.012, 0.04, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    router.render();
  });

  return {
    router,
    input,
    reloadDef(next: GameDefinition): void {
      currentDef = next;
    },
    stop(): void {
      loop.stop();
      window.removeEventListener("resize", resize);
      input.dispose();
    },
  };
}
