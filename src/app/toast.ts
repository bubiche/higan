// BGM now-playing toast — the "♪ <track>" flash shown when the music changes.
//
// Shell-owned (created once by `runGame`, like the fade overlay), because BGM is a shell-level
// state that crosses screens — the title theme, each stage's theme, a boss theme — so the toast
// can't live in a per-screen overlay that's torn down on exit. It is driven off the audio
// engine's `onTrackStart` hook, which fires the instant a track ACTUALLY starts (not on
// request), so the toast lands with the music, never before it's audible.
//
// Pure presentation: it shows a string. Animation is CSS (wall clock); DOM use is confined to
// the factory. Engine-owned styles are injected once so the toast travels with the engine.

const STYLE_ID = "higan-toast-style";

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
#bgm-toast { position:fixed; left:20px; bottom:20px; z-index:40; pointer-events:none;
  max-width:min(60vw, 320px); padding:7px 14px; border-radius:5px;
  font:600 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing:1px;
  color:#eaf0ff; background:linear-gradient(90deg, rgba(20,26,48,0.92), rgba(20,26,48,0.6));
  border-left:3px solid #6f8cff; text-shadow:0 0 12px #2a52d0, 0 1px 2px #000;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; opacity:0; }
#bgm-toast.show { animation:bgmToast 3.6s ease-out forwards; }
@keyframes bgmToast {
  0% { opacity:0; transform:translateY(8px); }
  8% { opacity:1; transform:none; }
  80% { opacity:1; transform:none; } 100% { opacity:0; transform:translateY(4px); } }`;
  document.head.appendChild(style);
}

/** The toast handle. */
export interface BgmToast {
  /** Flash "♪ <title>". Re-fires cleanly if the track changes mid-animation. */
  show(title: string): void;
}

/** Build the shell-owned BGM toast, appending its element to `document.body`. */
export function createBgmToast(): BgmToast {
  injectStyles();
  const el = document.createElement("div");
  el.id = "bgm-toast";
  document.body.appendChild(el);

  return {
    show(title): void {
      el.textContent = `♪ ${title}`;
      // Restart the CSS animation: drop the class, force a reflow, re-add it. Without the
      // reflow the browser coalesces the toggle and the animation never replays.
      el.classList.remove("show");
      void el.offsetWidth;
      el.classList.add("show");
    },
  };
}
