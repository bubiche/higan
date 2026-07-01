// Title screen.
//
// The flow's entry point: shows the game's title as a small menu (Start / Options).
// Pure presentation — it draws nothing on the GL field (the shell clears it) and
// reads only discrete key presses from the shared input source. Opening Options
// pushes it on top; because each menu owns its own DOM element, the title menu
// stays put beneath and is revealed again on back-out without being rebuilt.

import type { Screen, Shell } from "../screen";
import { createMenu, type Menu } from "../menu";
import { createCharacterScreen, proceedAfterCharacter } from "./character";
import { CHARACTER_INDEX } from "../run";
import { createOptionsScreen } from "./options";

export function createTitleScreen(shell: Shell): Screen {
  const { overlay, input, def } = shell;
  let menu: Menu;

  // Start → character select, unless the game offers a single character, in which case
  // there's nothing to choose: skip straight to the difficulty step (which itself skips to
  // a fresh run when there's a single difficulty). The "after a character is chosen" step
  // lives in `proceedAfterCharacter`, shared with the character screen's confirm.
  const start = (): void => {
    if (def.characters.length <= 1) proceedAfterCharacter(shell, CHARACTER_INDEX);
    else shell.router.replace(createCharacterScreen(shell));
  };

  // `shell.router` is read lazily inside the callbacks (NOT destructured here): the
  // title is the initial screen, so it is constructed by `createRouter(...)` before
  // the shell's `router` field is assigned. Destructuring would capture `undefined`;
  // the getter resolves correctly by the time a menu action fires.
  return {
    enter(): void {
      // Drop the keypress that brought us here so it isn't re-read as a confirm.
      input.flush();
      // Title/menu BGM (idempotent; `null` = fade to silence if the game names none).
      // Carries through character/difficulty select untouched, then the in-game screen
      // switches to the stage theme.
      shell.audio.playBgm(def.assets?.audio?.shell?.title ?? null);
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
