// Key bindings — the shared vocabulary between the save document (which persists
// them), the keyboard source (which reads them to produce InputFrames), and the
// rebind screen (which edits them).
//
// A binding maps a gameplay ACTION to a single `KeyboardEvent.code`. This is the
// PRODUCER side of the determinism seam: it decides which physical key sets a frame's
// shoot/focus/bomb/dx/dy. Replays store the produced InputFrame, never the key code,
// so remapping which key means "shoot" can never change a recorded run — bindings sit
// entirely outside the simulation and its hash, exactly like the volume sliders.
//
// One code per action (matching the persisted shape). Menu navigation is intentionally
// NOT here — `menu.ts` keeps its own fixed arrows/WASD/Z/Esc set so the menus (and this
// rebind screen) stay operable no matter how the gameplay keys are remapped.

export type GameAction = "up" | "down" | "left" | "right" | "shoot" | "focus" | "bomb";

/** Action → `KeyboardEvent.code`. Exactly the keys the sim's InputFrame needs. */
export type KeyBindings = Record<GameAction, string>;

/** The actions in display order, with their rebind-screen labels. */
export const ACTIONS: readonly { readonly action: GameAction; readonly label: string }[] = [
  { action: "up", label: "Move up" },
  { action: "down", label: "Move down" },
  { action: "left", label: "Move left" },
  { action: "right", label: "Move right" },
  { action: "shoot", label: "Shoot" },
  { action: "focus", label: "Focus" },
  { action: "bomb", label: "Bomb" },
];

export const DEFAULT_BINDINGS: KeyBindings = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  shoot: "KeyZ",
  focus: "ShiftLeft",
  bomb: "KeyX",
};

/**
 * Coerce loosely-typed stored data into a complete, valid `KeyBindings`: every action
 * gets the stored code if it's a non-empty string, otherwise the default. This is what
 * makes the keyboard source safe to drive off the save — a corrupt or partial stored
 * `keybinds` can never leave an action mapped to `undefined` (which would silently make
 * that action dead, since `down.has(undefined)` is always false).
 */
export function sanitizeBindings(raw: unknown): KeyBindings {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out = {} as KeyBindings;
  for (const { action } of ACTIONS) {
    const code = src[action];
    out[action] = typeof code === "string" && code.length > 0 ? code : DEFAULT_BINDINGS[action];
  }
  return out;
}

// Friendly names for the codes a player is likely to bind. Anything not listed falls
// through the prefix rules below, then prints its raw code as a last resort.
const SPECIAL_NAMES: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  ShiftLeft: "L-Shift",
  ShiftRight: "R-Shift",
  ControlLeft: "L-Ctrl",
  ControlRight: "R-Ctrl",
  AltLeft: "L-Alt",
  AltRight: "R-Alt",
  Space: "Space",
  Enter: "Enter",
  NumpadEnter: "Num Enter",
  Escape: "Esc",
  Tab: "Tab",
  Backspace: "Bksp",
};

/** Human-readable label for a `KeyboardEvent.code` (e.g. `KeyZ` → "Z", `ArrowUp` → "↑"). */
export function keyDisplayName(code: string): string {
  const special = SPECIAL_NAMES[code];
  if (special) return special;
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`;
  return code;
}
