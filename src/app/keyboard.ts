// The shell's single keyboard source.
//
// One source owns all key capture for the whole app — attaching window listeners
// once — and screens poll it; no screen attaches its own listeners (that would
// leak and double-fire across the title→in-game→results loop). It serves two
// distinct needs from the same key state:
//
//   - `sample(tick)` → an InputFrame of HELD keys for the simulation, resolved through
//     the live key bindings. This is the producer side of the determinism seam:
//     replays store the produced InputFrame, never the key code, so remapping which
//     physical key means "shoot" can never change a recorded run.
//   - `takeEvents()` → the queue of discrete key PRESSES (edges, auto-repeat
//     filtered out) since the last call, for menu confirm and the frame-step
//     debugger keys. Reading drains the queue.
//
// The sim never sees the keyboard, only the sampled InputFrame — which is what
// lets those frames be recorded and replayed.

import type { InputFrame, InputSource } from "../core/input";
import type { KeyBindings } from "./bindings";

export interface ShellInput extends InputSource {
  /** Held-key snapshot for the sim, resolved through the current key bindings. */
  sample(tick: number): InputFrame;
  /** Key-press codes (edges) since the last call, then clears them. */
  takeEvents(): readonly string[];
  /** Drop any pending press edges — call on a screen transition so the keypress
   *  that caused it isn't re-consumed by the screen it lands on. */
  flush(): void;
  dispose(): void;
}

// Keys whose browser default (page scroll / button activation) we suppress so they
// don't fight gameplay or the debugger. Determinism-neutral: this changes only the
// browser side effect, never the sampled InputFrame.
const SWALLOW = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/**
 * @param getBindings reads the live action→code map each tick. Passing a getter (not a
 *   snapshot) means a rebind or reset-to-defaults takes effect immediately, even when
 *   the bindings object is replaced wholesale.
 */
export function createShellInput(getBindings: () => KeyBindings): ShellInput {
  const down = new Set<string>();
  let events: string[] = [];

  const onDown = (e: KeyboardEvent): void => {
    if (SWALLOW.has(e.code)) e.preventDefault();
    if (!e.repeat) events.push(e.code);
    down.add(e.code);
  };
  const onUp = (e: KeyboardEvent): void => {
    down.delete(e.code);
  };
  window.addEventListener("keydown", onDown);
  window.addEventListener("keyup", onUp);

  return {
    sample(): InputFrame {
      const b = getBindings();
      let dx = 0;
      let dy = 0;
      if (down.has(b.left)) dx -= 1;
      if (down.has(b.right)) dx += 1;
      if (down.has(b.up)) dy -= 1;
      if (down.has(b.down)) dy += 1;
      return {
        dx,
        dy,
        shoot: down.has(b.shoot),
        focus: down.has(b.focus),
        bomb: down.has(b.bomb),
      };
    },
    takeEvents(): readonly string[] {
      if (events.length === 0) return events;
      const taken = events;
      events = [];
      return taken;
    },
    flush(): void {
      events.length = 0;
    },
    dispose(): void {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    },
  };
}
