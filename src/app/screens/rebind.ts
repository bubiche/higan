// Key-config screen — rebind the gameplay actions (move/shoot/focus/bomb).
//
// Reached from Options. Bespoke rather than a `createMenu`, because the capture
// interaction ("press a key now") and the live per-row key display don't fit the
// shared menu's item kinds. It edits `save.settings.keybinds` in place and persists on
// every change, so backing out never loses a binding; the keyboard source reads the
// same object live, so a rebind takes effect on the very next sampled frame.
//
// Pure presentation/config: replays store produced InputFrames, never key codes, so
// nothing here touches the simulation or its hash. Menu navigation stays on the fixed
// keys (arrows/WASD/Z/Esc) — those are NOT rebindable, so a player can never strand
// themselves on this screen by remapping the keys they'd use to escape it.

import type { Screen, Shell } from "../screen";
import { SfxId } from "../../core/events";
import { ACTIONS, DEFAULT_BINDINGS, keyDisplayName, type GameAction } from "../bindings";

const UP = new Set(["ArrowUp", "KeyW"]);
const DOWN = new Set(["ArrowDown", "KeyS"]);
const CONFIRM = new Set(["KeyZ", "Enter", "NumpadEnter"]);
const CANCEL = new Set(["Escape", "KeyX"]);

const labelOf = (action: GameAction): string => ACTIONS.find((a) => a.action === action)!.label;

export function createRebindScreen(shell: Shell): Screen {
  const { overlay, input, save } = shell;
  const binds = save.settings.keybinds;

  let root: HTMLElement;
  let selected = 0;
  // The action awaiting a keypress, or null in normal navigation mode.
  let capturing: GameAction | null = null;
  // A transient note shown in the hint line (e.g. a swap), cleared on the next move.
  let message: string | null = null;

  // Action rows, then the two trailing commands. Index into this drives selection.
  const rows: { label: string; value: () => string; onConfirm: () => void }[] = [
    ...ACTIONS.map(({ action, label }) => ({
      label,
      value: (): string => (capturing === action ? "[ press a key ]" : keyDisplayName(binds[action])),
      onConfirm: (): void => {
        capturing = action;
        message = null;
        render();
      },
    })),
    { label: "Reset to defaults", value: (): string => "", onConfirm: (): void => reset() },
    { label: "Back", value: (): string => "", onConfirm: (): void => shell.router.pop() },
  ];

  const reset = (): void => {
    Object.assign(binds, DEFAULT_BINDINGS); // mutate in place so the keyboard's ref stays live
    message = "reset to defaults";
    shell.persist();
    render();
  };

  // Apply the captured key to the action being edited. If the key already belongs to
  // another action, swap them (the displaced action inherits the old key) — so a clean
  // one-step swap is possible and nothing is ever left unbound.
  const capture = (code: string): void => {
    const action = capturing!;
    if (code === "Escape") {
      shell.audio.play(SfxId.MenuCancel);
      capturing = null;
      message = null;
      render();
      return;
    }
    shell.audio.play(SfxId.MenuConfirm);
    const owner = ACTIONS.find((a) => binds[a.action] === code)?.action ?? null;
    const old = binds[action];
    binds[action] = code;
    if (owner && owner !== action) {
      binds[owner] = old;
      message = `↔ swapped with ${labelOf(owner)}`;
    } else {
      message = null;
    }
    capturing = null;
    shell.persist();
    render();
  };

  const render = (): void => {
    const list = rows
      .map((r, i) => {
        const sel = i === selected;
        const marker = sel ? "▶ " : "  ";
        const val = r.value();
        const value = val ? `<span class="menu-value">${val}</span>` : "";
        return `<div class="menu-item${sel ? " sel" : ""}"><span class="menu-label">${marker}${r.label}</span>${value}</div>`;
      })
      .join("");
    const hint = capturing
      ? `Press a key for <b>${labelOf(capturing)}</b> · Esc cancels`
      : (message ?? "↑↓ select · Z rebind · Esc/X back");
    root.innerHTML = `
      <div class="menu-card">
        <h1>KEY CONFIG</h1>
        <div class="menu-list">${list}</div>
        <p class="menu-hint">${hint}</p>
      </div>`;
  };

  const move = (dir: number): void => {
    selected = (selected + dir + rows.length) % rows.length;
    message = null;
    render();
    shell.audio.play(SfxId.MenuMove);
  };

  return {
    enter(): void {
      input.flush();
      root = document.createElement("div");
      root.className = "menu-screen";
      overlay.appendChild(root);
      render();
    },
    exit(): void {
      root.remove();
      input.flush();
    },
    frame(): void {
      for (const code of input.takeEvents()) {
        if (capturing) {
          capture(code);
          return; // one key per capture; don't let a fast second press leak in
        }
        if (UP.has(code)) move(-1);
        else if (DOWN.has(code)) move(1);
        else if (CONFIRM.has(code)) {
          shell.audio.play(SfxId.MenuConfirm);
          rows[selected]!.onConfirm();
          return; // may have entered capture or popped this screen
        } else if (CANCEL.has(code)) {
          shell.audio.play(SfxId.MenuCancel);
          shell.router.pop();
          return;
        }
      }
    },
    render(): void {
      // DOM-only; nothing on the GL field.
    },
  };
}
