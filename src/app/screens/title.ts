// Title screen.
//
// The flow's entry point: shows the game's title and waits for a confirm press to
// begin a run. Pure presentation — it draws nothing on the GL field (the shell
// clears it) and only reads discrete key presses from the shared input source.

import type { Screen, Shell } from "../screen";
import { createInGameScreen } from "./ingame";

const CONFIRM = new Set(["KeyZ", "Enter", "NumpadEnter"]);

export function createTitleScreen(shell: Shell): Screen {
  const { overlay, input, def } = shell;

  return {
    enter(): void {
      // Drop the keypress that brought us here so it isn't re-read as a confirm.
      input.flush();
      overlay.innerHTML = `
        <div class="screen-center">
          <div class="menu-card">
            <h1>${def.title}</h1>
            <p class="menu-hint">Press <b>Z</b> / <b>Enter</b> to start</p>
          </div>
        </div>`;
    },
    exit(): void {
      overlay.innerHTML = "";
    },
    frame(): void {
      for (const code of input.takeEvents()) {
        if (CONFIRM.has(code)) {
          shell.router.replace(createInGameScreen(shell));
          return;
        }
      }
    },
    render(): void {
      // Field stays empty (cleared by the shell); the title is DOM.
    },
  };
}
