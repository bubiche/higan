// Results screen.
//
// Shown when a run ends — either the stage was cleared or the player gave up at the
// continue prompt. It reports the outcome and returns to the title on confirm, and on
// a clear shows the final score (read off the sim at run-end, passed in). Spell-capture
// summary and hi-score persistence land here when run-state + save graduate (later
// milestones); the game-over path comes through the continue prompt and carries no
// score (threading run-state through continues is its own milestone). It owns its own
// DOM element under `#overlay` (rather than overwriting the shared overlay) so it
// composes with the per-screen container model the menus use.

import type { Screen, Shell } from "../screen";
import { createTitleScreen } from "./title";

const CONFIRM = new Set(["KeyZ", "Enter", "NumpadEnter"]);

export type RunOutcome = "clear" | "gameover";

/** `score` is the final run score, shown on a clear; omitted on the game-over path. */
export function createResultsScreen(shell: Shell, outcome: RunOutcome, score?: number): Screen {
  const { overlay, input, router } = shell;
  const heading = outcome === "clear" ? "STAGE CLEAR" : "GAME OVER";
  const scoreLine =
    score !== undefined ? `<p class="menu-hint">Score <b>${score.toLocaleString("en-US")}</b></p>` : "";
  let el: HTMLElement;

  return {
    enter(): void {
      input.flush();
      el = document.createElement("div");
      el.className = "menu-screen";
      el.innerHTML = `
        <div class="menu-card">
          <h1>${heading}</h1>
          ${scoreLine}
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
