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
import { createOptionsScreen } from "./options";

export function createTitleScreen(shell: Shell): Screen {
  const { overlay, input, router, def } = shell;
  let menu: Menu;

  return {
    enter(): void {
      // Drop the keypress that brought us here so it isn't re-read as a confirm.
      input.flush();
      menu = createMenu(overlay, {
        title: def.title,
        hint: "↑/↓ select · Z / Enter confirm",
        items: [
          { kind: "action", label: "Start", onConfirm: () => router.replace(createInGameScreen(shell)) },
          { kind: "action", label: "Options", onConfirm: () => router.push(createOptionsScreen(shell)) },
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
