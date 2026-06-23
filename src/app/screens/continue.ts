// Continue prompt — shown when a run ends in game-over (out of lives).
//
// Pushed over the in-game screen so the frozen death moment shows behind it (same
// flow-pause mechanic as the pause menu). The player chooses to continue the run or
// give up to the results screen. "Continue" here is a plain rebuild of the run; the
// real economy — limited continues that reset score and restore lives, and the
// recorded continue-decision that the per-run replay needs — arrives with run-state.
// The continue/give-up choice is a genuine player decision (not derivable from sim
// state), which is exactly why the design note records it as replay meta-input later.

import type { Screen, Shell } from "../screen";
import { createMenu, type Menu } from "../menu";
import { createInGameScreen } from "./ingame";
import { createResultsScreen } from "./results";

export function createContinueScreen(shell: Shell): Screen {
  const { overlay, input, router } = shell;
  let menu: Menu;

  const doContinue = (): void => {
    router.pop(); // remove this prompt…
    router.replace(createInGameScreen(shell)); // …and rebuild the run
  };
  const giveUp = (): void => {
    router.pop();
    router.replace(createResultsScreen(shell, "gameover"));
  };

  return {
    enter(): void {
      input.flush();
      menu = createMenu(overlay, {
        title: "GAME OVER",
        hint: "↑/↓ select · Z confirm",
        onCancel: giveUp,
        items: [
          { kind: "action", label: "Continue", onConfirm: doContinue },
          { kind: "action", label: "Give up", onConfirm: giveUp },
        ],
      });
    },
    exit(): void {
      menu.dispose();
      input.flush();
    },
    frame(): void {
      menu.handleEvents(input.takeEvents());
    },
    render(): void {
      // DOM-only; the frozen field is drawn by the in-game screen beneath.
    },
  };
}
