// Records screen.
//
// Reached from the title menu, beside Music Room — the same menu-gated-viewer precedent. It
// renders the full hi-score grid (every character × every difficulty) read straight from the
// save, the display half of the run-end hi-score writer. Pure presentation/meta: it reads
// `save.hiScores` through `readHiScore` (so it composes the save key identically to the
// writer) and never touches the sim, a determinism baseline, or the replay configId.
//
// Like character-select it drives its OWN DOM (a grid, which the shared list `createMenu`
// can't host) and reuses `classifyMenuKey` so the nav keys stay one source of truth. It is a
// static, read-only view — there is nothing to select, so any dismiss key backs out. It never
// touches audio, so the title theme keeps playing underneath and is revealed intact on pop.

import type { Screen, Shell } from "../screen";
import { classifyMenuKey } from "../menu";
import { readHiScore } from "../save";
import { DEFAULT_DIFFICULTIES } from "../../api/game";
import { SfxId } from "../../core/events";

export function createRecordsScreen(shell: Shell): Screen {
  const { overlay, input } = shell;
  const characters = shell.def.characters;
  const difficulties = shell.def.difficulties ?? DEFAULT_DIFFICULTIES;
  let root: HTMLElement;

  const back = (): void => {
    shell.audio.play(SfxId.MenuCancel);
    shell.router.pop();
  };

  const grid = (): string => {
    const head = difficulties.map((d) => `<th>${d.label}</th>`).join("");
    const rows = characters
      .map((c) => {
        // A locked character is masked here too (its records can't have been earned), matching
        // how character-select hides its name.
        const name = c.locked ? "?????" : c.name ?? c.id;
        const cells = difficulties
          .map((d) => {
            const s = c.locked ? null : readHiScore(shell.save, c.id, d.id);
            return `<td>${s === null ? "—" : s.toLocaleString("en-US")}</td>`;
          })
          .join("");
        return `<tr><th class="records-row-head${c.locked ? " locked" : ""}">${name}</th>${cells}</tr>`;
      })
      .join("");
    return `<table class="records-table"><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
  };

  return {
    enter(): void {
      input.flush();
      root = document.createElement("div");
      root.className = "menu-screen"; // reuse the shared full-field dimmed backdrop
      root.innerHTML = `
        <div class="records-card">
          <h1>RECORDS</h1>
          <div class="records-scroll">${grid()}</div>
          <p class="menu-hint">X back</p>
        </div>`;
      overlay.appendChild(root);
    },
    exit(): void {
      root.remove();
    },
    frame(): void {
      for (const code of input.takeEvents()) {
        const nav = classifyMenuKey(code);
        // A read-only view — confirm and cancel both dismiss it.
        if (nav === "cancel" || nav === "confirm") {
          back();
          return; // popped this screen
        }
      }
    },
    render(): void {
      // DOM-only; the title beneath draws the menu background (dimmed by this screen's backdrop).
    },
  };
}
