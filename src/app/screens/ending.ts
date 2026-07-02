// Ending / staff-roll screen.
//
// Shown once the final main-campaign stage is cleared, BETWEEN the clear and the results
// screen. It scrolls the game's credits column bottom-to-top over the dimmed frozen
// playfield, then hands off to whatever screen the caller named. Purely presentation: it
// runs no sim, touches no determinism baseline, and the scroll rides a wall clock — so it
// is entirely out of the replay/hash story (a loaded replay lands paused at a segment's
// end and never triggers a run-end at all, so it never reaches here).
//
// Decoupled by design: it takes an `advance` thunk rather than the score or the run, so it
// knows nothing about what comes next. The in-game screen captures the final score at the
// clear tick and closes over it in the thunk; the ending is a pure pass-through.

import type { Screen, Shell } from "../screen";
import { SfxId } from "../../core/events";

const SKIP = new Set(["KeyZ", "Enter", "NumpadEnter"]);

/** Wall-clock seconds the roll takes to travel its full distance, whatever its length —
 *  speed is derived from the measured content + viewport height so a short demo roll and a
 *  long one both feel deliberate rather than crawling or racing. */
const SCROLL_SECONDS = 11;

/**
 * Build the ending staff-roll. `advance` produces the screen to replace this one with when
 * the roll finishes (or the player skips) — typically the results screen, pre-bound with the
 * final score by the caller. Kept a thunk so its target screen (whose `enter` writes the
 * hi-score + plays results BGM) is only constructed when the ending actually hands off.
 */
export function createEndingScreen(shell: Shell, advance: () => Screen): Screen {
  const { overlay, input, def } = shell;
  let el: HTMLElement;
  let inner: HTMLElement;
  // Scroll geometry, measured once the DOM is laid out (in `enter`): the inner column
  // starts just below the clip viewport (`startY`) and travels up until its bottom edge
  // clears the top (`-innerHeight`). `speed` is px/sec derived from the total distance.
  let startY = 0;
  let endY = 0;
  let speed = 0;
  let clock = 0;
  // Latch so the scroll-completing and a skip keypress on the same frame can't both fire
  // the hand-off (a double `router.replace`).
  let done = false;

  const finish = (): void => {
    if (done) return;
    done = true;
    shell.audio.play(SfxId.MenuConfirm);
    shell.transition(() => shell.router.replace(advance()));
  };

  return {
    enter(): void {
      // The player is very likely holding shoot/Z as the boss dies — flush so a held key
      // can't instant-skip the roll on frame one (edge-triggered reads below do the rest).
      input.flush();
      // Nothing re-asserts BGM once the in-game screen is gone, so it would keep playing the
      // boss theme under the roll. Assert the run-end (results) theme here; results re-asserts
      // it idempotently, so one clean track spans the roll and the results card.
      shell.audio.playBgm(def.assets?.audio?.shell?.results?.id ?? null);

      const lines = def.ending?.lines ?? [];
      const body = lines
        .map((line) => (line === "" ? '<p>&nbsp;</p>' : `<p>${escapeHtml(line)}</p>`))
        .join("");
      el = document.createElement("div");
      el.className = "menu-screen";
      el.innerHTML = `
        <div class="ending-roll">
          <div class="ending-inner">
            <h1>${escapeHtml(def.title)}</h1>
            ${body}
            <div class="ending-fin">Thank you for playing</div>
            <div class="ending-end">THE END</div>
          </div>
        </div>
        <p class="menu-hint ending-skip">Press <b>Z</b> / <b>Enter</b> to continue</p>`;
      overlay.appendChild(el);

      // Measure now that it is laid out. Start below the viewport, scroll until fully past
      // the top; derive the speed from that total distance so the duration is content-stable.
      inner = el.querySelector(".ending-inner")!;
      const roll = el.querySelector(".ending-roll") as HTMLElement;
      startY = roll.clientHeight;
      endY = -inner.offsetHeight;
      speed = (startY - endY) / SCROLL_SECONDS;
      inner.style.transform = `translateY(${startY}px)`;
    },
    exit(): void {
      el.remove();
    },
    frame(dtSeconds: number): void {
      // Once handing off, stop scrolling so the roll doesn't visibly fly away under the fade.
      if (done) return;
      for (const code of input.takeEvents()) {
        if (SKIP.has(code)) {
          finish();
          return;
        }
      }
      clock += dtSeconds;
      const y = startY - speed * clock;
      inner.style.transform = `translateY(${Math.max(y, endY)}px)`;
      if (y <= endY) finish();
    },
    render(): void {
      // Field stays empty (cleared by the shell); the roll is DOM.
    },
  };
}

/** Minimal HTML escape for author-supplied credit text placed via `innerHTML`. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
