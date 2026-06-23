// Results screen.
//
// Shown when a run ends — either the stage was cleared or the player gave up at the
// continue prompt. For now it reports the outcome and returns to the title on
// confirm; the run summary (score, spell captures, hi-score) lands here once
// run-state exists. It owns its own DOM element under `#overlay` (rather than
// overwriting the shared overlay) so it composes with the per-screen container model
// the menus use.

import type { Screen, Shell } from "../screen";
import { createTitleScreen } from "./title";

const CONFIRM = new Set(["KeyZ", "Enter", "NumpadEnter"]);

export type RunOutcome = "clear" | "gameover";

export function createResultsScreen(shell: Shell, outcome: RunOutcome): Screen {
  const { overlay, input, router } = shell;
  const heading = outcome === "clear" ? "STAGE CLEAR" : "GAME OVER";
  let el: HTMLElement;

  return {
    enter(): void {
      input.flush();
      el = document.createElement("div");
      el.className = "menu-screen";
      el.innerHTML = `
        <div class="menu-card">
          <h1>${heading}</h1>
          <p class="menu-hint">Press <b>Z</b> / <b>Enter</b> for the title</p>
        </div>`;
      overlay.appendChild(el);
    },
    exit(): void {
      el.remove();
    },
    frame(): void {
      for (const code of input.takeEvents()) {
        if (CONFIRM.has(code)) {
          router.replace(createTitleScreen(shell));
          return;
        }
      }
    },
    render(): void {
      // Field stays empty (cleared by the shell); the summary is DOM.
    },
  };
}
