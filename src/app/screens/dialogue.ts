// Dialogue box — a data-authored VN-style overlay pushed over the in-game screen.
//
// This is the one determinism-sensitive piece of the presentation layer, but the freeze
// mechanism itself is pure presentation: it works exactly like the pause menu (screen.ts) —
// while this screen sits on top of the router stack, the in-game screen stops receiving
// `frame`, so its driver never advances. No tick passes, nothing enters the hash or the input
// log, while a dialogue box is open. The DETERMINISTIC half — the stage-side latch that
// decides WHEN to open one, and the driver hook that halts on the exact tick — lives in
// `api/stage.ts` (`ctx.dialogue`), `core/sim.ts` (`Simulation.dialogueRequest`), and
// `core/runtime.ts` (`SimDriverOptions.shouldHalt`); see the in-game screen's wiring of them.
//
// The advance/skip keys are shell actions, never sim input — exactly like "resume" on the
// pause menu — so a replay records nothing extra and reproduces bit-identically regardless of
// how long a box sat open or how it was dismissed.

import type { Screen, Shell } from "../screen";
import type { Dialogue } from "../../api/stage";
import { createPortraitResolver } from "../portrait";
import { SfxId } from "../../core/events";

const STYLE_ID = "higan-dialogue-style";

/** Inject the dialogue stylesheet once (idempotent) — ships with the engine, like the cut-in
 *  overlay's, rather than depending on the host page's CSS. */
function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.dialogue-overlay { position:absolute; inset:0; pointer-events:none;
  font:600 15px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color:#eaf0ff; }
.dialogue-portrait { position:absolute; bottom:19%; width:44%; height:62%;
  background-size:contain; background-repeat:no-repeat; background-position:bottom center;
  filter:drop-shadow(0 0 18px rgba(120,150,255,0.5));
  opacity:0; transform:translateY(10px); transition:opacity .25s ease, transform .25s ease; }
.dialogue-portrait.left { left:1%; }
.dialogue-portrait.right { right:1%; }
.dialogue-portrait.show { opacity:1; transform:none; }
.dialogue-box { position:absolute; left:4%; right:4%; bottom:4%; padding:14px 18px;
  background:rgba(14,18,32,0.88); border:1px solid rgba(140,170,255,0.35); border-radius:6px;
  box-shadow:0 8px 28px rgba(0,0,0,0.5); }
.dialogue-name { font-size:13px; letter-spacing:2px; color:#a8c4ff; margin-bottom:6px; }
.dialogue-text { white-space:pre-wrap; }
.dialogue-hint { position:absolute; right:22px; bottom:14px; font-size:11px; letter-spacing:1px;
  color:#7d8cb8; }`;
  document.head.appendChild(style);
}

/** Push over the in-game screen to show `script` one line at a time; pops itself (ending the
 *  freeze) once the player dismisses the last line or skips. */
export function createDialogueScreen(shell: Shell, script: Dialogue): Screen {
  const { overlay, input, router } = shell;
  const portraitUrl = createPortraitResolver();
  let index = 0;
  let root: HTMLDivElement;
  let portraitEl: HTMLDivElement;
  let nameEl: HTMLDivElement;
  let textEl: HTMLDivElement;

  const showLine = (): void => {
    const line = script[index]!;
    portraitEl.className = `dialogue-portrait ${line.side ?? "left"}`;
    const url = portraitUrl(line.portrait);
    if (url) {
      portraitEl.style.backgroundImage = `url("${url}")`;
      // Re-trigger the fade-in on a line/side change (className was just reset above).
      requestAnimationFrame(() => portraitEl.classList.add("show"));
    }
    nameEl.textContent = line.name ?? "";
    nameEl.style.display = line.name ? "" : "none";
    textEl.textContent = line.text;
  };

  const close = (): void => router.pop();

  const advance = (): void => {
    shell.audio.play(SfxId.MenuConfirm);
    index++;
    if (index >= script.length) close();
    else showLine();
  };

  const skip = (): void => {
    shell.audio.play(SfxId.MenuCancel);
    close();
  };

  return {
    enter(): void {
      input.flush();
      injectStyles();
      root = document.createElement("div");
      root.className = "dialogue-overlay";
      portraitEl = document.createElement("div");
      const box = document.createElement("div");
      box.className = "dialogue-box";
      nameEl = document.createElement("div");
      nameEl.className = "dialogue-name";
      textEl = document.createElement("div");
      textEl.className = "dialogue-text";
      box.append(nameEl, textEl);
      const hint = document.createElement("div");
      hint.className = "dialogue-hint";
      hint.textContent = "Z / Enter — continue · Esc — skip";
      root.append(portraitEl, box, hint);
      overlay.appendChild(root);
      index = 0;
      showLine();
    },
    exit(): void {
      root.remove();
      // Drop the closing press so the revealed in-game screen doesn't read it as gameplay.
      input.flush();
    },
    frame(): void {
      for (const code of input.takeEvents()) {
        if (code === "KeyZ" || code === "Enter" || code === "NumpadEnter") advance();
        else if (code === "Escape" || code === "KeyX") skip();
      }
    },
    render(): void {
      // DOM-only; the frozen playfield is drawn by the in-game screen beneath.
    },
  };
}
