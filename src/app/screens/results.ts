// Results screen.
//
// Shown when a run ends — either the stage was cleared or the player gave up at the
// continue prompt. It reports the outcome and returns to the title on confirm, and on
// a clear shows the final score (read off the sim at run-end, passed in). On a clear it
// also PROJECTS that score into the save's hi-score table (per character×difficulty) —
// the durable record-keeping half of run-end. The game-over path comes through the
// continue prompt and carries no score/run (threading run-state through continues is its
// own milestone), so it writes nothing. It owns its own DOM element under `#overlay`
// (rather than overwriting the shared overlay) so it composes with the per-screen
// container model the menus use. (Spell-capture summary lands here when it graduates.)

import type { Screen, Shell } from "../screen";
import type { RunController } from "../run";
import { DEFAULT_DIFFICULTIES } from "../../api/game";
import { evaluateExtraUnlock } from "../../api/config";
import { recordHiScore } from "../save";
import { SfxId } from "../../core/events";
import { createTitleScreen } from "./title";

const CONFIRM = new Set(["KeyZ", "Enter", "NumpadEnter"]);

export type RunOutcome = "clear" | "gameover";

/**
 * `score` is the final run score, shown on a clear; omitted on the game-over path. `run`
 * is the just-ended run, passed on a clear so results can key the hi-score write by the
 * run's character and difficulty; omitted on the game-over path (nothing to record).
 */
export function createResultsScreen(
  shell: Shell,
  outcome: RunOutcome,
  score?: number,
  run?: RunController,
): Screen {
  const { overlay, input, router } = shell;
  const heading = outcome === "clear" ? "STAGE CLEAR" : "GAME OVER";
  const scoreLine =
    score !== undefined ? `<p class="menu-hint">Score <b>${score.toLocaleString("en-US")}</b></p>` : "";
  // Durable run-end projections (hi-score + Extra unlock) fire only on a MAIN-campaign clear
  // that carries a score + run (game-over carries neither). A standalone single-stage run
  // (Extra/practice) is deliberately excluded: it shares a character×difficulty key with the
  // campaign, so recording it would overwrite the campaign's record, and an Extra clear must
  // not re-evaluate the very unlock that gates Extra. Such a run still shows its results card;
  // it just leaves the durable meta untouched.
  const records =
    outcome === "clear" && run !== undefined && score !== undefined && run.isMainCampaign;
  let el: HTMLElement;

  return {
    enter(): void {
      input.flush();
      // Results BGM (idempotent; `null` = silence if the game names none).
      shell.audio.playBgm(shell.def.assets?.audio?.shell?.results?.id ?? null);
      // Project the final score into the save's hi-score table, keyed by the run's character
      // and difficulty (stable ids, resolved via the same default-difficulty fallback the
      // config fingerprint uses so a game with none doesn't throw), then persist. The save is
      // presentation/meta — a durable projection of a run outcome, never sim state — so the
      // write lives here in `enter` (a side effect of the screen becoming active), not at
      // construction. A new record flags a card line.
      let isRecord = false;
      if (records) {
        isRecord = recordHiScore(
          shell.save,
          shell.def.characters[run!.character]!.id,
          (shell.def.difficulties ?? DEFAULT_DIFFICULTIES)[run!.difficulty]!.id,
          score!,
        );
        // The Extra-stage unlock — the other durable run-end projection (main-campaign only,
        // via the `records` gate above). Evaluate the game's unlock policy against this run's
        // outcome facts and set the flag if it passes (idempotent: `= true` can't "re-unlock",
        // so re-clearing is a no-op). Presentation/meta like the hi-score, never hashed.
        if (
          evaluateExtraUnlock(shell.def.config.extraUnlock, {
            cleared: true,
            continuesUsed: run!.continuesUsed,
            difficulty: run!.difficulty,
          })
        ) {
          shell.save.unlocks.extra = true;
        }
        shell.persist();
      }
      const recordLine = isRecord ? `<p class="menu-hint"><b>New record!</b></p>` : "";
      el = document.createElement("div");
      el.className = "menu-screen";
      el.innerHTML = `
        <div class="menu-card">
          <h1>${heading}</h1>
          ${scoreLine}
          ${recordLine}
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
          // Bespoke screen (no createMenu), so it fires its own UI SFX — else it would be
          // the one silent confirm next to the clicky menus.
          shell.audio.play(SfxId.MenuConfirm);
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
