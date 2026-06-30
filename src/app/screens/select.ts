// Difficulty-select screen.
//
// Sits between the title's Start and the in-game screen (Title → Select → InGame).
// It lists the game's `difficulties` — display data the game authors (label + an
// optional blurb) — and threads the chosen entry's INDEX into the run as its rank.
// The rank is construction input the sim and content branch on (`ctx.difficulty`);
// this screen never touches the simulation or its hash. Like the rest of the flow it
// uses single-entry `replace`, so it replaces the title and is itself replaced by the
// in-game screen (or by a fresh title on cancel).

import type { Screen, Shell } from "../screen";
import { createMenu, type Menu } from "../menu";
import { createInGameScreen } from "./ingame";
import { createTitleScreen } from "./title";
import { DEFAULT_DIFFICULTIES } from "../../api/game";

export function createSelectScreen(shell: Shell): Screen {
  const { overlay, input } = shell;
  // The game's difficulties (engine fallback if it authored none); the entry's index
  // is the rank passed to the run.
  const difficulties = shell.def.difficulties ?? DEFAULT_DIFFICULTIES;
  let menu: Menu;

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
        onCancel: () => shell.router.replace(createTitleScreen(shell)),
        items: difficulties.map((d, rank) => ({
          kind: "action",
          label: d.label,
          // The chosen rank is this entry's index; a fresh run starts with 0 continues.
          onConfirm: () => shell.router.replace(createInGameScreen(shell, 0, rank)),
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
