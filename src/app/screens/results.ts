// Results screen.
//
// Shown when a run ends — either the stage was cleared or the player ran out of
// lives. For now it reports the outcome and returns to the title on confirm; the
// run summary (score, spell captures, hi-score) lands here once run-state exists.

import type { Screen, Shell } from "../screen";
import { createTitleScreen } from "./title";

const CONFIRM = new Set(["KeyZ", "Enter", "NumpadEnter"]);

export type RunOutcome = "clear" | "gameover";

export function createResultsScreen(shell: Shell, outcome: RunOutcome): Screen {
  const { overlay, input } = shell;
  const heading = outcome === "clear" ? "STAGE CLEAR" : "GAME OVER";

  return {
    enter(): void {
      input.flush();
      overlay.innerHTML = `
        <div class="screen-center">
          <div class="menu-card">
            <h1>${heading}</h1>
            <p class="menu-hint">Press <b>Z</b> / <b>Enter</b> for the title</p>
          </div>
        </div>`;
    },
    exit(): void {
      overlay.innerHTML = "";
    },
    frame(): void {
      for (const code of input.takeEvents()) {
        if (CONFIRM.has(code)) {
          shell.router.replace(createTitleScreen(shell));
          return;
        }
      }
    },
    render(): void {
      // Field stays empty (cleared by the shell); the summary is DOM.
    },
  };
}
