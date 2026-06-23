// Options screen.
//
// Edits the persisted settings: music/SFX volume and the playfield display scale.
// Display scale applies live (the shell re-sizes the canvas); volumes are persisted
// now and read by the audio engine when it lands. Every change writes through to
// localStorage immediately, so backing out (or the tab closing) never loses a
// setting. Pure presentation — none of this touches the simulation or its hash.
//
// Reachable from the title and from the pause menu; because each menu owns its own
// DOM element (see `menu.ts`), opening this over a paused menu and backing out
// leaves the menu beneath intact.

import type { Screen, Shell } from "../screen";
import { createMenu, type Menu } from "../menu";
import { clampDisplayScale } from "../save";

const VOL_STEP = 0.1;
const SCALE_STEP = 0.1;
const round1 = (n: number): number => Math.round(n * 10) / 10;
const pct = (v: number): string => `${Math.round(v * 100)}%`;

export function createOptionsScreen(shell: Shell): Screen {
  const { overlay, input, save } = shell;
  let menu: Menu;

  const setVolume = (key: "bgmVolume" | "sfxVolume", delta: number): void => {
    save.settings[key] = round1(Math.max(0, Math.min(1, save.settings[key] + delta)));
    shell.persist();
  };
  const setScale = (delta: number): void => {
    save.settings.displayScale = clampDisplayScale(round1(save.settings.displayScale + delta));
    shell.applyDisplayScale();
    shell.persist();
  };

  const back = (): void => shell.router.pop();

  return {
    enter(): void {
      input.flush();
      menu = createMenu(overlay, {
        title: "OPTIONS",
        hint: "←/→ adjust · Z select · Esc/X back",
        onCancel: back,
        items: [
          {
            kind: "value",
            label: "BGM volume",
            value: () => pct(save.settings.bgmVolume),
            left: () => setVolume("bgmVolume", -VOL_STEP),
            right: () => setVolume("bgmVolume", VOL_STEP),
          },
          {
            kind: "value",
            label: "SFX volume",
            value: () => pct(save.settings.sfxVolume),
            left: () => setVolume("sfxVolume", -VOL_STEP),
            right: () => setVolume("sfxVolume", VOL_STEP),
          },
          {
            kind: "value",
            label: "Display scale",
            value: () => `${clampDisplayScale(save.settings.displayScale).toFixed(1)}×`,
            left: () => setScale(-SCALE_STEP),
            right: () => setScale(SCALE_STEP),
          },
          { kind: "action", label: "Back", onConfirm: back },
        ],
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
      // DOM-only; nothing on the GL field.
    },
  };
}
