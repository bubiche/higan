// Continue prompt — shown when a run ends in game-over (out of lives).
//
// Pushed over the in-game screen so the frozen death moment shows behind it (same
// flow-pause mechanic as the pause menu). The player chooses to continue the run or
// give up to the results screen. Continues are LIMITED (config.continues per run): each
// continue rebuilds the run from the SAME controller, which on a fresh sim resets score
// and restores lives/bombs to the start-of-stage defaults (createPlayer) — exactly the
// "reset score + restored lives" economy — and spends a continue so the prompt collapses
// to give-up-only once they're used up.
//
// The continue/give-up DECISION is recorded per-run-replay meta-input (a genuine player
// choice, not derivable from sim state): choosing Continue promotes the just-finished
// play into the run's pre-continue segment log (`recordContinue`), so a saved replay
// reproduces the whole run across the rebuild. Give-up drops that play — the run ended,
// so it is not a prior segment of an ongoing run.

import type { Screen, Shell } from "../screen";
import type { RunController } from "../run";
import type { ReplaySegment } from "../../touhou/replay";
import { createMenu, type Menu, type MenuItem } from "../menu";
import { createInGameScreen } from "./ingame";
import { createResultsScreen } from "./results";

/** `run` is the run-scoped controller (rank + continue count + segment log), carried
 *  across the rebuild so the run spans the continue. `lastPlay` is the play that just
 *  ended in game-over: on Continue it becomes a prior segment; on give-up it is dropped.
 *  The per-run continue allowance is a game-level run rule (`config.continues`). */
/** The continue prompt auto-declines after this many seconds — the arcade countdown: choose
 *  to continue before the timer runs out, or the run ends. Presentation timer (real dt), never
 *  the sim (which is frozen behind this overlay). */
const COUNTDOWN_SECONDS = 9;

export function createContinueScreen(shell: Shell, run: RunController, lastPlay: ReplaySegment): Screen {
  const { overlay, input, router } = shell;
  // Read BEFORE recordContinue runs, so this prompt offers the allowance still left.
  const remaining = shell.def.config.continues - run.continuesUsed;
  let menu: Menu;
  let countdownEl: HTMLElement;
  let elapsed = 0;
  // Latch: the decision (a menu confirm/cancel OR the countdown expiring) fires exactly once.
  // Without it, the countdown could auto-decline the same frame the player chose Continue —
  // after the choice has already popped this screen.
  let decided = false;

  const doContinue = (): void => {
    if (decided) return;
    decided = true;
    // Promote the just-finished play into the run's history and spend a continue, then
    // rebuild the run from the same controller. The fresh sim resets score + restores
    // lives/bombs; the next game-over offers one fewer continue.
    run.recordContinue(lastPlay);
    router.pop(); // remove this prompt…
    router.replace(createInGameScreen(shell, run));
  };
  const giveUp = (): void => {
    if (decided) return;
    decided = true;
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
        onSfx: (id) => shell.audio.play(id),
        items,
      });
      // Big arcade countdown below the prompt (its own element — the menu widget has no
      // per-frame text hook). Inline-styled so it needs no host-page CSS.
      countdownEl = document.createElement("div");
      Object.assign(countdownEl.style, {
        position: "absolute",
        left: "0",
        right: "0",
        top: "63%",
        textAlign: "center",
        font: "800 40px/1 ui-monospace, SFMono-Regular, Menlo, monospace",
        color: "#ff6a6a",
        textShadow: "0 0 18px #ff2a2a, 0 2px 4px #000",
        pointerEvents: "none",
      });
      overlay.appendChild(countdownEl);
    },
    exit(): void {
      menu.dispose();
      countdownEl.remove();
      input.flush();
    },
    frame(dtSeconds: number): void {
      if (decided) return;
      menu.handleEvents(input.takeEvents());
      if (decided) return; // the player just chose — don't also run the timer this frame
      elapsed += dtSeconds;
      countdownEl.textContent = `${Math.max(0, Math.ceil(COUNTDOWN_SECONDS - elapsed))}`;
      if (elapsed >= COUNTDOWN_SECONDS) giveUp();
    },
    render(): void {
      // DOM-only; the frozen field is drawn by the in-game screen beneath.
    },
  };
}
