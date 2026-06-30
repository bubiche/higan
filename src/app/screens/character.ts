// Character-select screen.
//
// The first choice in the flow: Title → Character → Difficulty → InGame. It lists the
// game's `characters` by `id` and threads the chosen INDEX downstream — through difficulty
// into the run, where it selects which character's config/shot/bomb feeds the sim. The
// index is a run-parameter (captured in the replay, NOT hashed); this screen is pure
// presentation and never touches the simulation. Like the rest of the flow it uses
// single-entry `replace`.
//
// A game with a single character skips this screen entirely (the title goes straight to
// difficulty), so it only ever shows a real choice — mirroring how the title skips
// difficulty-select for a single-difficulty game.

import type { Screen, Shell } from "../screen";
import { createMenu, type Menu } from "../menu";
import { createInGameScreen } from "./ingame";
import { createSelectScreen } from "./select";
import { createTitleScreen } from "./title";
import { createRunController } from "../run";
import { DEFAULT_DIFFICULTIES } from "../../api/game";

/** Continue the flow once a character is chosen: to difficulty-select if the game offers
 *  a choice, else straight into a fresh run at rank 0 (mirroring the title's difficulty
 *  skip). Called from the character screen's confirm AND from the title when it skips the
 *  character screen for a single-character game, so the "after a character is chosen" step
 *  lives in one place. */
export function proceedAfterCharacter(shell: Shell, character: number): void {
  const difficulties = shell.def.difficulties ?? DEFAULT_DIFFICULTIES;
  if (difficulties.length <= 1) {
    shell.router.replace(createInGameScreen(shell, createRunController(shell.def, 0, character)));
  } else {
    shell.router.replace(createSelectScreen(shell, character));
  }
}

export function createCharacterScreen(shell: Shell): Screen {
  const { overlay, input } = shell;
  const characters = shell.def.characters;
  let menu: Menu;

  return {
    enter(): void {
      input.flush();
      menu = createMenu(overlay, {
        title: "CHARACTER",
        hint: "↑/↓ select · Z confirm · X back",
        onCancel: () => shell.router.replace(createTitleScreen(shell)),
        items: characters.map((c, index) => ({
          kind: "action",
          // No display-name field on CharacterDef yet (kept minimal) — the id IS the label.
          label: c.id,
          // The chosen index flows down through difficulty into the run controller.
          onConfirm: () => proceedAfterCharacter(shell, index),
        })),
      });
    },
    exit(): void {
      menu.dispose();
    },
    frame(): void {
      menu.handleEvents(input.takeEvents());
    },
    render(): void {
      // DOM-only; the field stays cleared by the shell.
    },
  };
}
