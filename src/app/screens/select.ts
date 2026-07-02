// Difficulty-select screen.
//
// Sits between character-select and the in-game screen (Title → Character → Difficulty →
// InGame). It lists the game's `difficulties` — display data the game authors (label + an
// optional blurb) — and threads the chosen entry's INDEX into the run as its rank, along
// with the `character` already chosen upstream. Both are construction inputs the sim and
// content branch on (`ctx.difficulty`, and which character config feeds the sim); this
// screen never touches the simulation or its hash. Like the rest of the flow it uses
// single-entry `replace`, so it replaces the character screen and is itself replaced by
// the in-game screen (or, on cancel, by the previous step — character-select when the game
// has more than one character, else the title).
//
// Draws the game's `menuBackground` (if any) on its own presentation clock, same as title
// and character-select — this screen sits in the same single-entry chain, so without its
// own draw call the field would otherwise go dark for this one step.

import type { Screen, Shell } from "../screen";
import { createMenu, type Menu } from "../menu";
import { createInGameScreen } from "./ingame";
import { createRunController } from "../run";
import { createTitleScreen } from "./title";
import { createCharacterScreen } from "./character";
import { DEFAULT_DIFFICULTIES } from "../../api/game";

export function createSelectScreen(shell: Shell, character: number): Screen {
  const { overlay, input } = shell;
  // The game's difficulties (engine fallback if it authored none); the entry's index
  // is the rank passed to the run.
  const difficulties = shell.def.difficulties ?? DEFAULT_DIFFICULTIES;
  let menu: Menu;
  // This screen's own presentation clock for the menu background's scroll (mirrors title
  // and character-select — the same field carries through the whole pre-game flow).
  let presentationClock = 0;

  return {
    enter(): void {
      input.flush();
      menu = createMenu(overlay, {
        title: "DIFFICULTY",
        // The footer shows the highlighted rank's blurb (updating as the cursor moves)
        // followed by the controls, so the controls stay visible even when every rank
        // has a description.
        hint: (i) => {
          const blurb = difficulties[i]?.description;
          return blurb ? `${blurb}   ·   Z start · X back` : "↑/↓ select · Z start · X back";
        },
        // Back goes one step up the flow: to character-select if the game offers a choice,
        // else straight to the title (the character screen was skipped on the way in).
        onCancel: () =>
          shell.router.replace(
            shell.def.characters.length > 1 ? createCharacterScreen(shell) : createTitleScreen(shell),
          ),
        onSfx: (id) => shell.audio.play(id),
        items: difficulties.map((d, rank) => ({
          kind: "action",
          label: d.label,
          // The chosen rank is this entry's index; the character was chosen upstream. A
          // fresh controller starts a clean run with both. Fade through black into the stage.
          onConfirm: () =>
            shell.transition(() =>
              shell.router.replace(createInGameScreen(shell, createRunController(shell.def, rank, character))),
            ),
        })),
      });
    },
    exit(): void {
      menu.dispose();
    },
    frame(dtSeconds: number): void {
      presentationClock += dtSeconds;
      menu.handleEvents(input.takeEvents());
    },
    render(): void {
      // The game's menu background, if any (read fresh — see title.ts for why); the menu
      // itself is DOM, drawn over it.
      shell.background.draw(shell.def.menuBackground?.layers ?? [], presentationClock);
    },
  };
}
