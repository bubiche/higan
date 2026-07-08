// A small keyboard-driven menu — the shared widget behind the title, pause,
// options, and continue screens.
//
// It owns its own DOM element under `#overlay` (it never touches `overlay.innerHTML`
// directly), so menus can stack: pushing Options over a Pause menu appends a second
// element on top, and popping it removes only its own — the menu beneath survives
// untouched even though the router does not re-enter a revealed screen. This is what
// makes the router's "an overlay sits over a frozen screen" contract literally true
// for DOM-over-DOM, not just DOM-over-playfield.
//
// Pure presentation: it reads discrete key presses (passed in by the screen) and
// mutates DOM. It never enters the simulation or its hash.

import { SfxId } from "../core/events";

const UP = new Set(["ArrowUp", "KeyW"]);
const DOWN = new Set(["ArrowDown", "KeyS"]);
const LEFT = new Set(["ArrowLeft", "KeyA"]);
const RIGHT = new Set(["ArrowRight", "KeyD"]);
const CONFIRM = new Set(["KeyZ", "Enter", "NumpadEnter"]);
const CANCEL = new Set(["Escape", "KeyX"]);

/** A menu navigation intent read from a raw `KeyboardEvent.code`. */
export type MenuNav = "up" | "down" | "left" | "right" | "confirm" | "cancel";

/** Map a raw key code to a menu navigation intent, or `undefined` for an unrelated key.
 *  The single source of truth for menu nav keys — shared by `createMenu` and any screen
 *  that drives its own DOM (e.g. character-select) so the two can't drift apart. */
export function classifyMenuKey(code: string): MenuNav | undefined {
  if (UP.has(code)) return "up";
  if (DOWN.has(code)) return "down";
  if (LEFT.has(code)) return "left";
  if (RIGHT.has(code)) return "right";
  if (CONFIRM.has(code)) return "confirm";
  if (CANCEL.has(code)) return "cancel";
  return undefined;
}

/** An item that runs an action when confirmed. */
export interface ActionItem {
  kind: "action";
  label: string;
  onConfirm: () => void;
}

/** An item that adjusts a value with left/right (e.g. a volume slider). */
export interface ValueItem {
  kind: "value";
  label: string;
  /** Current value, formatted for display. */
  value: () => string;
  left: () => void;
  right: () => void;
}

export type MenuItem = ActionItem | ValueItem;

export interface MenuConfig {
  /** Heading shown above the list. */
  title?: string;
  items: MenuItem[];
  /** Footer hint line. A function receives the highlighted item's index, so a menu can
   *  show a per-item blurb that updates as the selection moves (the difficulty select
   *  uses this for each rank's description). */
  hint?: string | ((selectedIndex: number) => string);
  /** Cancel (Esc / X) — e.g. resume from pause, back out of options. */
  onCancel?: () => void;
  /** UI SFX sink. The widget fires `MenuMove` on navigation (and on a value tweak, so
   *  a volume slider ticks at its new level), `MenuConfirm`/`MenuCancel` on confirm/back.
   *  Presentation only — screens pass `(id) => shell.audio.play(id)`. */
  onSfx?: (id: SfxId) => void;
  /** Selection-change sink: fired with the highlighted item's index on every move AND
   *  once for the initial selection (without an accompanying `MenuMove` — nothing moved).
   *  Generalizes the `hint` function beyond text; the Music room uses it to play the
   *  highlighted track. Most menus don't pass it. */
  onHighlight?: (selectedIndex: number) => void;
}

export interface Menu {
  /** Apply this frame's key presses. Returns after invoking a confirm/cancel
   *  callback, since that callback may tear this menu's screen down. */
  handleEvents(codes: readonly string[]): void;
  /** Remove the menu's DOM element. */
  dispose(): void;
}

/** Build a menu as a child element of `parent` (the `#overlay` layer). */
export function createMenu(parent: HTMLElement, config: MenuConfig): Menu {
  const root = document.createElement("div");
  root.className = "menu-screen";
  parent.appendChild(root);

  let selected = config.items.findIndex((it) => it.kind === "action" || it.kind === "value");
  if (selected < 0) selected = 0;

  const render = (): void => {
    const rows = config.items
      .map((it, i) => {
        const sel = i === selected;
        const marker = sel ? "▶ " : "  ";
        const value = it.kind === "value" ? `<span class="menu-value">${it.value()}</span>` : "";
        return `<div class="menu-item${sel ? " sel" : ""}"><span class="menu-label">${marker}${it.label}</span>${value}</div>`;
      })
      .join("");
    const hint = typeof config.hint === "function" ? config.hint(selected) : config.hint;
    root.innerHTML = `
      <div class="menu-card">
        ${config.title ? `<h1>${config.title}</h1>` : ""}
        <div class="menu-list">${rows}</div>
        ${hint ? `<p class="menu-hint">${hint}</p>` : ""}
      </div>`;
  };
  render();
  // Announce the initial selection (no MenuMove — nothing moved). Lets a screen react to
  // what's highlighted on open, e.g. the Music room starting the first track.
  config.onHighlight?.(selected);

  const move = (dir: number): void => {
    const n = config.items.length;
    selected = (selected + dir + n) % n; // every item is selectable, so just wrap
    render();
    config.onSfx?.(SfxId.MenuMove);
    config.onHighlight?.(selected);
  };

  return {
    handleEvents(codes: readonly string[]): void {
      for (const code of codes) {
        const item = config.items[selected];
        const nav = classifyMenuKey(code);
        if (nav === "up") {
          move(-1);
        } else if (nav === "down") {
          move(1);
        } else if (nav === "left") {
          if (item?.kind === "value") {
            item.left();
            render();
            // After the tweak — so a volume slider's tick plays at its NEW level.
            config.onSfx?.(SfxId.MenuMove);
          }
        } else if (nav === "right") {
          if (item?.kind === "value") {
            item.right();
            render();
            config.onSfx?.(SfxId.MenuMove);
          }
        } else if (nav === "confirm") {
          if (item?.kind === "action") {
            config.onSfx?.(SfxId.MenuConfirm);
            item.onConfirm();
            return; // may have torn down this screen
          }
        } else if (nav === "cancel") {
          // Sound only a real cancel (some menus have none, e.g. the title); the press is
          // still consumed either way, preserving the prior return-on-cancel behaviour.
          if (config.onCancel) {
            config.onSfx?.(SfxId.MenuCancel);
            config.onCancel();
          }
          return;
        }
      }
    },
    dispose(): void {
      root.remove();
    },
  };
}
