// Live keyboard → InputFrame source for the demo.
//
// This is the browser-facing producer side of the input seam: it tracks held
// keys and snapshots them into an InputFrame when the driver samples a tick. The
// simulation never sees the keyboard, only the resulting frames — which is what
// lets those same frames be recorded and replayed. Debugger keys are handled
// separately in the demo and are deliberately NOT read here.

import type { InputFrame, InputSource } from "../core/input";

export interface KeyboardInput extends InputSource {
  dispose(): void;
}

export function createKeyboardInput(): KeyboardInput {
  const down = new Set<string>();
  const onDown = (e: KeyboardEvent): void => {
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
    dispose(): void {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    },
  };
}
