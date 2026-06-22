// The shell's single keyboard source.
//
// One source owns all key capture for the whole app — attaching window listeners
// once — and screens poll it; no screen attaches its own listeners (that would
// leak and double-fire across the title→in-game→results loop). It serves two
// distinct needs from the same key state:
//
//   - `sample(tick)` → an InputFrame of HELD keys for the simulation. This mapping
//     is the producer side of the determinism seam and is byte-for-byte identical
//     to what the engine has always sampled, so replays are unaffected.
//   - `takeEvents()` → the queue of discrete key PRESSES (edges, auto-repeat
//     filtered out) since the last call, for menu confirm and the frame-step
//     debugger keys. Reading drains the queue.
//
// The sim never sees the keyboard, only the sampled InputFrame — which is what
// lets those frames be recorded and replayed.

import type { InputFrame, InputSource } from "../core/input";

export interface ShellInput extends InputSource {
  /** Held-key snapshot for the sim. Byte-identical to the engine's original mapping. */
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

export function createShellInput(): ShellInput {
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
      let dx = 0;
      let dy = 0;
      if (down.has("ArrowLeft") || down.has("KeyA")) dx -= 1;
      if (down.has("ArrowRight") || down.has("KeyD")) dx += 1;
      if (down.has("ArrowUp") || down.has("KeyW")) dy -= 1;
      if (down.has("ArrowDown") || down.has("KeyS")) dy += 1;
      return {
        dx,
        dy,
        shoot: down.has("KeyZ"),
        focus: down.has("ShiftLeft") || down.has("ShiftRight"),
        bomb: down.has("KeyX"),
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
