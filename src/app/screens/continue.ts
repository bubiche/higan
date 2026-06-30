// Continue prompt — shown when a run ends in game-over (out of lives).
//
// Pushed over the in-game screen so the frozen death moment shows behind it (same
// flow-pause mechanic as the pause menu). The player chooses to continue the run or
// give up to the results screen. Continues are LIMITED (MAX_CONTINUES per run): each
// continue rebuilds the run, which on a fresh sim resets score and restores lives/bombs
// to the start-of-stage defaults (createPlayer) — exactly the "reset score + restored
// lives" economy — and advances the run's continue count so the prompt collapses to
// give-up-only once they're spent. The count is run-level meta threaded above the sim;
// it absorbs into RunState at the cross-stage pass, where the continue/give-up DECISION
// also becomes recorded per-run-replay meta-input (a genuine player choice, not
// derivable from sim state). Resetting score on a fresh sim already falls out for free.

import type { Screen, Shell } from "../screen";
import { createMenu, type Menu, type MenuItem } from "../menu";
import { createInGameScreen } from "./ingame";
import { createResultsScreen } from "./results";

/** `continuesUsed` is how many continues this run has already spent (0 on the first
 *  game-over). Threaded in by the in-game screen, which carries it across the rebuild.
 *  The per-run continue allowance is a game-level run rule (`config.continues`). */
export function createContinueScreen(shell: Shell, continuesUsed = 0): Screen {
  const { overlay, input, router } = shell;
  const remaining = shell.def.config.continues - continuesUsed;
  let menu: Menu;

  const doContinue = (): void => {
    router.pop(); // remove this prompt…
    // …and rebuild the run. The fresh sim resets score + restores lives/bombs; the
    // incremented count means the next game-over offers one fewer continue.
    router.replace(createInGameScreen(shell, continuesUsed + 1));
  };
  const giveUp = (): void => {
    router.pop();
    router.replace(createResultsScreen(shell, "gameover"));
  };

  return {
    enter(): void {
      input.flush();
      // Offer Continue only while continues remain; otherwise it's give-up-only.
      const items: MenuItem[] = [];
      if (remaining > 0) {
        items.push({ kind: "action", label: `Continue  (${remaining} left)`, onConfirm: doContinue });
      }
      items.push({ kind: "action", label: "Give up", onConfirm: giveUp });
      menu = createMenu(overlay, {
        title: "GAME OVER",
        hint: remaining > 0 ? "↑/↓ select · Z confirm" : "No continues left · Z to end",
        onCancel: giveUp,
        items,
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
