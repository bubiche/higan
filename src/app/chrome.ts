// In-game field chrome — the stage-opening splash and the always-on FPS counter.
//
// The DOM overlay that frames a live stage: the title/subtitle splash that fades in over
// the stage's opening, and a tiny frame-rate readout in the corner. It is the sibling of
// the boss cut-in layer (`cutins.ts`) — driven by the in-game screen, reads nothing of its
// own, keeps no gameplay state, and so can never touch the sim or the hash. The splash text
// comes from `StageDef.title/subtitle` (a game authors it); the FPS is rAF-measured on the
// render side (wall clock), never the sim tick.
//
// Engine-owned like the cut-ins: it injects its OWN stylesheet once, so a second game gets
// the splash + counter for free with no host-page CSS. Animation is pure CSS (wall-clock
// keyframes) — no per-frame JS timer. DOM use is confined to the factory (import-safe headless).

const STYLE_ID = "higan-chrome-style";

/** Inject the field-chrome stylesheet once (idempotent). */
function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.field-chrome { position:absolute; inset:0; overflow:hidden; pointer-events:none;
  font:600 14px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color:#eaf0ff; }
.chrome-fps { position:absolute; right:6px; bottom:5px; font-size:11px; letter-spacing:1px;
  color:#8d97ac; font-variant-numeric:tabular-nums; text-shadow:0 1px 2px #000; opacity:0.75; }
.chrome-splash { position:absolute; left:0; right:0; top:41%; text-align:center;
  animation:chromeSplash 2.8s ease-out forwards; }
.chrome-splash .cs-title { font-size:30px; font-weight:800; letter-spacing:7px; color:#fff;
  text-shadow:0 0 26px #6f8cff, 0 2px 5px #000; }
.chrome-splash .cs-sub { margin-top:8px; font-size:15px; letter-spacing:3px; color:#cdd6ea;
  text-shadow:0 0 14px #2a52d0, 0 1px 2px #000; }
@keyframes chromeSplash {
  0% { opacity:0; transform:translateY(10px); }
  14% { opacity:1; transform:none; }
  78% { opacity:1; transform:none; } 100% { opacity:0; transform:translateY(-6px); } }`;
  document.head.appendChild(style);
}

/** The field-chrome handle. Owned by the in-game screen (built into `shell.overlay`,
 *  destroyed on exit); presentation-only. */
export interface FieldChrome {
  /** Play the stage-opening splash. A no-op if `title` is empty/omitted (a game that
   *  authors no stage title simply gets no splash). */
  splash(title: string | undefined, subtitle?: string): void;
  /** Update the corner FPS readout to the current (smoothed) frame rate. */
  fps(value: number): void;
  /** Remove the chrome DOM (screen exit). */
  destroy(): void;
}

export function createFieldChrome(overlay: HTMLElement): FieldChrome {
  injectStyles();

  const root = document.createElement("div");
  root.className = "field-chrome";
  const fpsEl = document.createElement("div");
  fpsEl.className = "chrome-fps";
  root.appendChild(fpsEl);
  overlay.appendChild(root);

  return {
    splash(title, subtitle): void {
      if (!title) return;
      root.querySelector(".chrome-splash")?.remove(); // restart cleanly if re-fired
      const node = document.createElement("div");
      node.className = "chrome-splash";
      const titleEl = document.createElement("div");
      titleEl.className = "cs-title";
      titleEl.textContent = title;
      node.appendChild(titleEl);
      if (subtitle) {
        const subEl = document.createElement("div");
        subEl.className = "cs-sub";
        subEl.textContent = subtitle;
        node.appendChild(subEl);
      }
      node.addEventListener("animationend", () => node.remove(), { once: true });
      root.appendChild(node);
    },
    fps(value): void {
      fpsEl.textContent = `${Math.round(value)} FPS`;
    },
    destroy(): void {
      root.remove();
    },
  };
}
