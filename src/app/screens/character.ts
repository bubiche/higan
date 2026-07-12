// Character-select screen.
//
// The first choice in the flow: Title → Character → Difficulty → InGame. It lists the
// game's `characters` and threads the chosen INDEX downstream — through difficulty into
// the run, where it selects which character's config/shot/bomb feeds the sim. The index
// is a run-parameter (captured in the replay, NOT hashed); this screen is pure
// presentation and never touches the simulation.
//
// Unlike the other menu screens it drives its OWN two-pane DOM (a name list + a portrait/
// info pane) rather than the shared list `createMenu`, because that widget can't host a
// portrait. It reuses `classifyMenuKey` for navigation so the nav keys stay a single
// source of truth, and the shell's audio for the same menu SFX.
//
// A game with a single character skips this screen entirely (the title goes straight to
// difficulty), so it only ever shows a real choice — mirroring how the title skips
// difficulty-select for a single-difficulty game.

import type { Screen, Shell } from "../screen";
import { classifyMenuKey } from "../menu";
import { createInGameScreen } from "./ingame";
import { createSelectScreen } from "./select";
import { createTitleScreen } from "./title";
import { createRunController } from "../run";
import { createPortraitResolver } from "../portrait";
import { readHiScore } from "../save";
import { DEFAULT_DIFFICULTIES, type CharacterDef } from "../../api/game";
import { DEFAULT_SHOT_CONFIG, type ShotConfig } from "../../touhou/shot";
import { DEFAULT_BOMB_CONFIG, type BombConfig } from "../../touhou/bomb";
import { SfxId } from "../../core/events";

/** Continue the flow once a character is chosen: to difficulty-select if the game offers
 *  a choice, else straight into a fresh run at rank 0 (mirroring the title's difficulty
 *  skip). Called from the character screen's confirm AND from the title when it skips the
 *  character screen for a single-character game, so the "after a character is chosen" step
 *  lives in one place. `stageSequence` (present for a standalone Extra/practice entry) is
 *  threaded to the run controller unchanged — the character/difficulty choice is identical
 *  whether the run is the main campaign or a single stage. */
export function proceedAfterCharacter(
  shell: Shell,
  character: number,
  stageSequence?: readonly number[],
): void {
  const difficulties = shell.def.difficulties ?? DEFAULT_DIFFICULTIES;
  if (difficulties.length <= 1) {
    shell.router.replace(createInGameScreen(shell, createRunController(shell.def, 0, character, stageSequence)));
  } else {
    shell.router.replace(createSelectScreen(shell, character, stageSequence));
  }
}

/** A compact, generic preview of a shot config — derived, not authored (the engine owns
 *  these semantics, so summarizing them needs no per-character authoring). */
function shotSummary(shot: ShotConfig): string {
  const streams =
    shot.baseStreams === shot.maxStreams
      ? `${shot.baseStreams} stream${shot.baseStreams === 1 ? "" : "s"}`
      : `${shot.baseStreams}–${shot.maxStreams} streams`;
  const tags: string[] = [];
  if (shot.homing) tags.push("homing");
  if (shot.focusDamage !== undefined && shot.focusDamage > shot.damage) tags.push("focus power");
  return tags.length ? `${streams} · ${tags.join(" · ")}` : streams;
}

/** A compact, generic preview of a bomb config — offensive/defensive and its reach. */
function bombSummary(bomb: BombConfig): string {
  const kind = bomb.bossDamage > 0 ? "Offensive" : "Defensive";
  const reach = bomb.radius === 0 ? "full-screen" : "local";
  return `${kind} · ${reach}`;
}

/** A shot's linear-RGB tint as a CSS `rgb(...)`, used to accent the pane per shot type. */
function accent(shot: ShotConfig): string {
  const [r, g, b] = shot.color;
  const to255 = (c: number): number => Math.max(0, Math.min(255, Math.round(c * 255)));
  return `rgb(${to255(r)}, ${to255(g)}, ${to255(b)})`;
}

export function createCharacterScreen(shell: Shell, stageSequence?: readonly number[]): Screen {
  const { overlay, input } = shell;
  const characters = shell.def.characters;
  const difficulties = shell.def.difficulties ?? DEFAULT_DIFFICULTIES;
  const portraitOf = createPortraitResolver();

  // The highlighted character's best score across every difficulty — a contextual "how am I
  // doing with this shot" glance. Difficulty isn't chosen at this step (it comes next), so
  // there is no single rank to key on; this maxes over all of them and annotates the winning
  // one. The full per-character×difficulty breakdown lives on the Records screen. Returns
  // `null` when this character has no recorded score yet. Reads through `readHiScore` so it
  // composes the save key identically to the writer.
  const bestFor = (char: CharacterDef): { score: number; label: string } | null => {
    let best: { score: number; label: string } | null = null;
    for (const d of difficulties) {
      const s = readHiScore(shell.save, char.id, d.id);
      if (s !== null && (best === null || s > best.score)) best = { score: s, label: d.label };
    }
    return best;
  };
  // This screen's own presentation clock for the menu background's scroll (mirrors title).
  let presentationClock = 0;

  // Start on the first selectable (unlocked) character, so a partly-locked roster doesn't
  // open on a row the player can't confirm. Falls back to 0 if somehow all are locked.
  let selected = characters.findIndex((c) => !c.locked);
  if (selected < 0) selected = 0;

  let root: HTMLElement;
  let listEl: HTMLElement;
  let img: HTMLImageElement;
  let infoEl: HTMLElement;
  let paneEl: HTMLElement;
  let hintEl: HTMLElement;

  const back = (): Screen => createTitleScreen(shell);

  const render = (): void => {
    const rows = characters
      .map((c, i) => {
        const sel = i === selected;
        const marker = sel ? "▶ " : "  ";
        const label = c.locked ? "?????" : c.name ?? c.id;
        return `<div class="char-name${sel ? " sel" : ""}${c.locked ? " locked" : ""}">${marker}${label}</div>`;
      })
      .join("");
    listEl.innerHTML = rows;

    const c = characters[selected]!;
    if (c.locked) {
      paneEl.style.removeProperty("--accent");
      img.style.visibility = "hidden";
      infoEl.innerHTML = `
        <div class="char-pane-name">Locked</div>
        <p class="char-pane-blurb">Clear the game to reveal this character.</p>`;
    } else {
      const shot = c.shot ?? DEFAULT_SHOT_CONFIG;
      const bomb = c.bomb ?? DEFAULT_BOMB_CONFIG;
      paneEl.style.setProperty("--accent", accent(shot));
      const url = portraitOf(c.portrait);
      if (url) {
        img.src = url;
        img.style.visibility = "visible";
      } else {
        img.style.visibility = "hidden";
      }
      const best = bestFor(c);
      const bestText = best ? `${best.score.toLocaleString("en-US")} · ${best.label}` : "—";
      infoEl.innerHTML = `
        <div class="char-pane-name">${c.name ?? c.id}</div>
        ${c.description ? `<p class="char-pane-blurb">${c.description}</p>` : ""}
        <div class="char-pane-stat"><span>Shot</span> ${shotSummary(shot)}</div>
        <div class="char-pane-stat"><span>Bomb</span> ${bombSummary(bomb)}</div>
        <div class="char-pane-stat"><span>Best</span> ${bestText}</div>`;
    }
    hintEl.textContent = "↑/↓ select · Z confirm · X back";
  };

  const move = (dir: number): void => {
    const n = characters.length;
    selected = (selected + dir + n) % n;
    shell.audio.play(SfxId.MenuMove);
    render();
  };

  const confirm = (): void => {
    if (characters[selected]!.locked) {
      shell.audio.play(SfxId.MenuCancel); // denied — a locked row can't be chosen
      return;
    }
    shell.audio.play(SfxId.MenuConfirm);
    proceedAfterCharacter(shell, selected, stageSequence);
  };

  return {
    enter(): void {
      input.flush();
      root = document.createElement("div");
      root.className = "menu-screen"; // reuse the shared full-field dimmed backdrop
      root.innerHTML = `
        <div class="char-card">
          <h1>CHARACTER</h1>
          <div class="char-body">
            <div class="char-list"></div>
            <div class="char-pane">
              <img class="char-portrait" alt="" />
              <div class="char-info"></div>
            </div>
          </div>
          <p class="menu-hint"></p>
        </div>`;
      overlay.appendChild(root);
      listEl = root.querySelector(".char-list")!;
      paneEl = root.querySelector(".char-pane")!;
      img = root.querySelector(".char-portrait")!;
      infoEl = root.querySelector(".char-info")!;
      hintEl = root.querySelector(".menu-hint")!;
      render();
    },
    exit(): void {
      root.remove();
    },
    frame(dtSeconds: number): void {
      presentationClock += dtSeconds;
      for (const code of input.takeEvents()) {
        const nav = classifyMenuKey(code);
        if (nav === "up") move(-1);
        else if (nav === "down") move(1);
        else if (nav === "confirm") {
          confirm();
          return; // confirm may have torn down this screen
        } else if (nav === "cancel") {
          shell.audio.play(SfxId.MenuCancel);
          shell.router.replace(back());
          return;
        }
      }
    },
    render(): void {
      // The game's menu background, if any (read fresh — see title.ts for why); the menu
      // itself is DOM, drawn over it.
      shell.background.draw(shell.def.menuBackground?.layers ?? [], presentationClock);
    },
  };
}
