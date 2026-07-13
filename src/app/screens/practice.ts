// Practice-menu screen.
//
// Reached from the title menu, beside Music Room. It lists the main-campaign stages the
// player has REACHED on a real run (recorded as each stage is entered — see ingame.ts) and
// launches the highlighted one as a standalone single-stage run: full resources, no
// advance-to-next, and none of the run-end campaign projections (staff-roll / hi-score /
// Extra unlock). Pure presentation/meta: it reads `save.unlocks.practiceStages` and drives
// the shared run-launch flow; it never touches the sim or its hash.
//
// It uses the shared list `createMenu` (a simple list fits, unlike the Records grid) and is
// PUSHED over the title like Music Room, so X pops straight back to the revealed title. To
// launch, it pops itself first and then delegates to `beginRun` — the exact idiom the
// continue prompt uses (`pop()` the sub-screen, then `replace` the revealed one beneath): the
// launch then joins the same single-entry flow the title's own Start/Extra use, so it can't
// leave a stale title stacked under the character screen. It never touches audio, so the
// title theme keeps playing underneath and is revealed intact on pop.

import type { Screen, Shell } from "../screen";
import type { GameDefinition } from "../../api/game";
import type { SaveData } from "../save";
import { createMenu, type Menu, type MenuItem } from "../menu";
import { beginRun } from "./character";

/**
 * The main-campaign stage indices available for practice: the non-`extra` stages the save has
 * marked reached, in `stages` declaration order. Iterating the live `stages` (rather than the
 * stored index list) keeps it robust to a shrunk roster — a stale saved index for a stage the
 * game no longer has simply isn't produced — and pins the display order to the game's, not the
 * order stages happened to be reached. Shared by the title (to decide whether to show the
 * Practice entry at all) and this screen (to build the list), so the two can't disagree.
 */
export function practiceableStageIndices(def: GameDefinition, save: SaveData): number[] {
  const reached = save.unlocks.practiceStages;
  return def.stages.flatMap((s, i) => (!s.extra && reached.includes(i) ? [i] : []));
}

export function createPracticeScreen(shell: Shell): Screen {
  const { overlay, input, def } = shell;
  const indices = practiceableStageIndices(def, shell.save);
  let menu: Menu;

  // One entry per practiceable stage. The label is derived, needing no new authoring field: a
  // "Stage N" number (the stage's position in the main chain, which is its `stages` index since
  // the chain is the contiguous prefix) plus the headline boss's name when the stage declares
  // one — the same `bossInfo.name` the nameplate/cut-in use.
  const stageItems: MenuItem[] = indices.map((i) => {
    const bossName = def.stages[i]!.bossInfo?.name;
    return {
      kind: "action",
      label: bossName ? `Stage ${i + 1} · ${bossName}` : `Stage ${i + 1}`,
      onConfirm: (): void => {
        // Pop THIS menu, then launch through the shared flow — the revealed title beneath is the
        // screen `beginRun`'s `replace` swaps into the character/difficulty flow (see header).
        shell.router.pop();
        beginRun(shell, [i]);
      },
    };
  });

  return {
    enter(): void {
      input.flush();
      menu = createMenu(overlay, {
        title: "PRACTICE",
        hint: stageItems.length ? "↑/↓ select · Z start · X back" : "Play the game to unlock stages · X back",
        onCancel: () => shell.router.pop(),
        onSfx: (id) => shell.audio.play(id),
        items: [...stageItems, { kind: "action", label: "Back", onConfirm: (): void => shell.router.pop() }],
      });
    },
    exit(): void {
      menu.dispose();
    },
    frame(): void {
      menu.handleEvents(input.takeEvents());
    },
    render(): void {
      // DOM-only; the title beneath draws the menu background (dimmed by this screen's backdrop).
    },
  };
}
