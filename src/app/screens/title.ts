// Title screen.
//
// The flow's entry point: shows the game's title as a small menu (Start / Options).
// Pure presentation — the only thing it draws on the GL field is the game's optional
// `menuBackground` (the shell clears the field otherwise); it reads only discrete key
// presses from the shared input source. Opening Options pushes it on top; because each
// menu owns its own DOM element, the title menu stays put beneath and is revealed again
// on back-out without being rebuilt — and because Options' own `render` is a no-op, this
// screen's background keeps showing through underneath it too.

import type { Screen, Shell } from "../screen";
import { createMenu, type Menu } from "../menu";
import { beginRun } from "./character";
import { createOptionsScreen } from "./options";
import { createMusicRoomScreen } from "./musicroom";
import { createRecordsScreen } from "./records";
import { createPracticeScreen, practiceableStageIndices } from "./practice";
import type { MenuItem } from "../menu";

export function createTitleScreen(shell: Shell): Screen {
  const { overlay, input, def } = shell;
  let menu: Menu;
  // Presentation clock (seconds) for the menu background's scroll — this screen's own,
  // like the in-game screen's; freezes while Options is on top (this screen stops
  // receiving `frame`), which pauses its scroll too.
  let presentationClock = 0;

  // Start / Extra / Practice all launch a run through the shared `beginRun` (character-select,
  // or a skip for a single-character game). Its `stageSequence` distinguishes the entry: the
  // main campaign passes none (the controller chains the campaign stages); Extra and practice
  // pass `[stageIndex]` — a standalone single-stage run. All share the identical
  // character/difficulty flow.

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
      shell.audio.playBgm(def.assets?.audio?.shell?.title?.id ?? null);
      // Music room only if the game declares a BGM library — a silent game would open an
      // empty, dead-end room, so it doesn't get the entry.
      const hasBgm = Object.keys(def.assets?.audio?.bgm ?? {}).length > 0;
      // Extra entry: shown only once the game has an Extra stage AND the save has unlocked it
      // (a fresh save hides it entirely — the reveal IS the reward). It launches a standalone
      // single-stage run at that stage rather than the campaign chain.
      const extraIndex = def.stages.findIndex((s) => s.extra);
      const extraUnlocked = extraIndex !== -1 && shell.save.unlocks.extra;
      // Practice entry: shown once at least one main-campaign stage has been reached (recorded
      // as each stage is entered on a real run). Like Extra, a fresh save hides it — the reveal
      // IS the reward — and it only ever grows. It opens a stage picker that launches a
      // standalone single-stage run at the chosen stage.
      const canPractice = practiceableStageIndices(def, shell.save).length > 0;
      const items: MenuItem[] = [
        { kind: "action", label: "Start", onConfirm: () => beginRun(shell) },
        ...(extraUnlocked
          ? [{ kind: "action" as const, label: "Extra", onConfirm: () => beginRun(shell, [extraIndex]) }]
          : []),
        ...(canPractice
          ? [{ kind: "action" as const, label: "Practice", onConfirm: () => shell.router.push(createPracticeScreen(shell)) }]
          : []),
        ...(hasBgm
          ? [{ kind: "action" as const, label: "Music Room", onConfirm: () => shell.router.push(createMusicRoomScreen(shell)) }]
          : []),
        // Records: the hi-score grid viewer. Always shown — a run always has a score, so
        // unlike the Music Room (silent-game-gated) this is never a dead end; a fresh save
        // just shows an all-"—" grid the player fills in.
        { kind: "action", label: "Records", onConfirm: () => shell.router.push(createRecordsScreen(shell)) },
        { kind: "action", label: "Options", onConfirm: () => shell.router.push(createOptionsScreen(shell)) },
      ];
      menu = createMenu(overlay, {
        title: def.title,
        hint: "↑/↓ select · Z / Enter confirm",
        onSfx: (id) => shell.audio.play(id),
        items,
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
      // The game's menu background, if any; the menu itself is DOM, drawn over it. Reads
      // `shell.def` FRESH (not the captured `def`), so a content hot-reload that swaps in
      // new background handles keeps resolving while this screen sits on top — the same
      // reason the in-game screen re-reads its stage background every frame.
      shell.background.draw(shell.def.menuBackground?.layers ?? [], presentationClock);
    },
  };
}
