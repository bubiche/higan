// Pause menu — a flow-pause overlay pushed over the in-game screen.
//
// This is the "flow-pause" of the design note: it works purely by the router stack.
// While this screen is on top, the in-game screen stops receiving `frame`, so its
// driver never advances — the simulation is frozen, no tick occurs, nothing enters
// the input log or the hash. The whole stack still renders, so the frozen field
// shows behind this menu. It is deliberately distinct from the driver's debug-pause
// (Space): the two never fight because flow-pause is "the screen isn't forwarding
// frames" while debug-pause is "the driver is paused".
//
// Resume returns to the frozen run; Retry starts a FRESH run at the same difficulty;
// Return to Title abandons it. Retry builds a NEW controller (clean continue count + no
// carried-over segment log) seeded with the current run's rank — it is a brand-new run,
// not a continuation, so it must not reuse the live controller and inherit its history.

import type { Screen, Shell } from "../screen";
import type { RunController } from "../run";
import { createMenu, type Menu } from "../menu";
import { createInGameScreen } from "./ingame";
import { createRunController } from "../run";
import { createOptionsScreen } from "./options";
import { createTitleScreen } from "./title";

/** `run` is the live run's controller; Retry reads its rank to start the fresh run at the
 *  same difficulty (a fresh controller, so the new run carries no continues/segments). */
export function createPauseScreen(shell: Shell, run: RunController): Screen {
  const { overlay, input, router } = shell;
  let menu: Menu;

  const resume = (): void => router.pop();
  const retry = (): void => {
    router.pop(); // remove this overlay…
    // …then swap the in-game screen for a fresh run at the same rank (new controller).
    router.replace(createInGameScreen(shell, createRunController(shell.def, run.difficulty)));
  };
  const toTitle = (): void => {
    router.pop();
    router.replace(createTitleScreen(shell));
  };

  return {
    enter(): void {
      input.flush();
      menu = createMenu(overlay, {
        title: "PAUSED",
        hint: "↑/↓ select · Z confirm · Esc resume",
        onCancel: resume,
        items: [
          { kind: "action", label: "Resume", onConfirm: resume },
          { kind: "action", label: "Retry", onConfirm: retry },
          { kind: "action", label: "Options", onConfirm: () => router.push(createOptionsScreen(shell)) },
          { kind: "action", label: "Return to title", onConfirm: toTitle },
        ],
      });
    },
    exit(): void {
      menu.dispose();
      // Drop the confirm/cancel press that closed the menu so the revealed in-game
      // screen (not re-entered on pop) doesn't read it as a gameplay/debug key.
      input.flush();
    },
    frame(): void {
      menu.handleEvents(input.takeEvents());
    },
    render(): void {
      // DOM-only; the frozen playfield is drawn by the in-game screen beneath.
    },
  };
}
