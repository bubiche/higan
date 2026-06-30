// Title screen.
//
// The flow's entry point: shows the game's title as a small menu (Start / Options).
// Pure presentation — it draws nothing on the GL field (the shell clears it) and
// reads only discrete key presses from the shared input source. Opening Options
// pushes it on top; because each menu owns its own DOM element, the title menu
// stays put beneath and is revealed again on back-out without being rebuilt.

import type { Screen, Shell } from "../screen";
import { createMenu, type Menu } from "../menu";
import { createInGameScreen } from "./ingame";
import { createSelectScreen } from "./select";
import { createOptionsScreen } from "./options";
import { DEFAULT_DIFFICULTIES } from "../../api/game";

export function createTitleScreen(shell: Shell): Screen {
  const { overlay, input, def } = shell;
  let menu: Menu;

  // Start → difficulty select, unless the game offers a single difficulty (the engine
  // default), in which case there's nothing to choose: go straight in at rank 0.
  const start = (): void => {
    const difficulties = def.difficulties ?? DEFAULT_DIFFICULTIES;
    if (difficulties.length <= 1) shell.router.replace(createInGameScreen(shell, 0, 0));
    else shell.router.replace(createSelectScreen(shell));
  };

  // `shell.router` is read lazily inside the callbacks (NOT destructured here): the
  // title is the initial screen, so it is constructed by `createRouter(...)` before
  // the shell's `router` field is assigned. Destructuring would capture `undefined`;
  // the getter resolves correctly by the time a menu action fires.
  return {
    enter(): void {
      // Drop the keypress that brought us here so it isn't re-read as a confirm.
      input.flush();
      menu = createMenu(overlay, {
        title: def.title,
        hint: "↑/↓ select · Z / Enter confirm",
        items: [
          { kind: "action", label: "Start", onConfirm: start },
          { kind: "action", label: "Options", onConfirm: () => shell.router.push(createOptionsScreen(shell)) },
        ],
      });
    },
    exit(): void {
      menu.dispose();
    },
    frame(): void {
      menu.handleEvents(input.takeEvents());
    },
    render(): void {
      // Field stays empty (cleared by the shell); the title is DOM.
    },
  };
}
