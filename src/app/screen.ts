// The screen router — the app state machine that sits above the simulation.
//
// The shell runs ONE animation loop; each frame it advances the top screen and
// then draws the screen stack. A `Screen` is pure presentation — it never enters
// the simulation's input log or its hash. The in-game screen owns a sim driver and
// forwards real-time frames into it; other screens (title, results) just read
// input and draw DOM.
//
// The router is a stack so an overlay (a pause menu, a dialogue box) can sit over a
// frozen screen: only the TOP screen receives `frame`, but EVERY screen in the
// stack renders bottom-to-top, so the screen beneath shows its frozen state behind
// the overlay. The title→in-game→results flow uses a single-entry stack via
// `replace`.

import type { GameDefinition } from "../api/game";
import type { ShellInput } from "./keyboard";
import type { BulletRenderer } from "../render/bullets";
import type { LaserRenderer } from "../render/lasers";
import type { SaveData } from "./save";
import type { AudioEngine } from "../audio/engine";

export interface Screen {
  /** Called when this screen becomes active (build DOM, create the sim, etc.). */
  enter?(): void;
  /** Called when this screen is popped or replaced (tear down its DOM). */
  exit?(): void;
  /** Advance presentation by the real elapsed seconds. The in-game screen forwards
   *  this into its sim driver; menu screens read input and update transitions. */
  frame(dtSeconds: number): void;
  /** Draw. The GL canvas is cleared once by the shell before the stack renders. */
  render(): void;
}

/**
 * Shell services every screen shares. The GL context and the two renderers are
 * created ONCE by the shell and reused across runs (they are content-agnostic and
 * fixed-capacity), so re-entering the in-game screen never churns GPU resources.
 */
export interface Shell {
  readonly gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement;
  /** DOM layer over the playfield, for full-field menus (title, results). */
  readonly overlay: HTMLElement;
  /** Side panel beside the playfield, for the in-game HUD + replay controls. */
  readonly sidebar: HTMLElement;
  readonly input: ShellInput;
  readonly bullets: BulletRenderer;
  readonly lasers: LaserRenderer;
  /** The sound system, created once by the shell (like the renderers) and reused across
   *  runs. A null-object engine when the game is silent or the browser has no Web Audio,
   *  so screens call it unconditionally. Presentation-only — never enters the sim. */
  readonly audio: AudioEngine;
  readonly def: GameDefinition;
  readonly router: Router;
  /** The in-memory save document. Options edits `save.settings` in place, then calls
   *  `persist()`; nothing here is part of the simulation or its hash. */
  readonly save: SaveData;
  /** Write the current `save` to localStorage. */
  persist(): void;
  /** Re-apply `save.settings.displayScale` to the canvas (live, no reload). */
  applyDisplayScale(): void;
}

export interface Router {
  /** The active (top-of-stack) screen. */
  readonly top: Screen;
  /** Push a screen over the current one (an overlay). */
  push(screen: Screen): void;
  /** Pop the top screen, returning to the one beneath. */
  pop(): void;
  /** Replace the top screen (the title→in-game→results flow uses this). */
  replace(screen: Screen): void;
  /** Advance the top screen. */
  frame(dtSeconds: number): void;
  /** Render the whole stack, bottom-to-top. */
  render(): void;
}

export function createRouter(initial: Screen): Router {
  const stack: Screen[] = [];
  const enter = (screen: Screen): void => {
    stack.push(screen);
    screen.enter?.();
  };
  enter(initial);

  return {
    get top(): Screen {
      return stack[stack.length - 1]!;
    },
    push(screen: Screen): void {
      enter(screen);
    },
    pop(): void {
      stack.pop()?.exit?.();
    },
    replace(screen: Screen): void {
      stack.pop()?.exit?.();
      enter(screen);
    },
    frame(dtSeconds: number): void {
      stack[stack.length - 1]?.frame(dtSeconds);
    },
    render(): void {
      for (let i = 0; i < stack.length; i++) stack[i]!.render();
    },
  };
}
