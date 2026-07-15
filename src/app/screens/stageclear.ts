// Stage-clear beat — the brief "STAGE CLEAR / Bonus: N" hold shown when a stage is cleared.
//
// Pushed over the in-game screen the instant the stage completes, exactly like the continue
// prompt and the dialogue box: the router only frames the TOP screen, so the sim beneath
// freezes at the clear tick (no extra ticks, nothing enters the hash) while the beat holds
// the moment. When it elapses (or the player skips with confirm) it calls `onDone` — the
// caller's transition into the next stage / the ending / results — so the pacing lives here,
// off the sim.
//
// Pure presentation: it reads a pre-captured bonus number and mutates DOM. The bonus was
// captured at the sim's award site (`Simulation.stageClearBonus`) rather than recomputed,
// because the same-tick extend check mutates lives after the award.

import type { Screen, Shell } from "../screen";
import { classifyMenuKey } from "../menu";

/** How long the beat holds before auto-advancing (seconds). A felt pacing value — tune to
 *  taste; short enough not to drag, long enough to read the bonus. Confirm skips it. */
const HOLD_SECONDS = 2.2;
/** Confirm is ignored for this long after the beat opens, so a player still mashing the shoot
 *  key (Z, which classifies as `confirm`) at the clear moment can't instantly skip the beat
 *  down to nothing — the whole point is that it reads. */
const SKIP_LOCKOUT_SECONDS = 0.6;

const STYLE_ID = "higan-stageclear-style";

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.stage-clear { position:absolute; inset:0; display:flex; flex-direction:column;
  align-items:center; justify-content:center; text-align:center; pointer-events:none;
  background:rgba(4,6,12,0.5);
  font:600 14px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color:#eaf0ff;
  animation:stageClearIn .4s ease-out; }
.stage-clear .sc-head { font-size:30px; font-weight:800; letter-spacing:8px; color:#fff;
  text-shadow:0 0 28px #6f8cff, 0 2px 5px #000; }
.stage-clear .sc-bonus { margin-top:14px; font-size:17px; letter-spacing:2px; color:#ffe6a2;
  text-shadow:0 0 16px #b8791f, 0 1px 2px #000; }
.stage-clear .sc-bonus b { font-variant-numeric:tabular-nums; color:#fff3c4; }
.stage-clear .sc-hint { margin-top:20px; font-size:11px; letter-spacing:1px; color:#8d97ac; }
@keyframes stageClearIn { from { opacity:0; } to { opacity:1; } }`;
  document.head.appendChild(style);
}

/**
 * Build the stage-clear beat over `shell.overlay`. `bonus` is the awarded stage-clear bonus
 * (0 shows no bonus line). `onDone` runs once when the beat elapses or is skipped — the
 * caller's transition to whatever comes next.
 */
export function createStageClearScreen(shell: Shell, bonus: number, onDone: () => void): Screen {
  injectStyles();
  const { overlay, input } = shell;
  const root = document.createElement("div");
  root.className = "stage-clear";
  root.innerHTML = `
    <div class="sc-head">STAGE CLEAR</div>
    ${bonus > 0 ? `<div class="sc-bonus">Bonus  <b>${Math.floor(bonus).toLocaleString("en-US")}</b></div>` : ""}
    <div class="sc-hint">Z to continue</div>`;

  let elapsed = 0;
  let done = false;
  const finish = (): void => {
    if (done) return; // fire onDone exactly once (skip + timeout can't both land)
    done = true;
    onDone();
  };

  return {
    enter(): void {
      input.flush();
      overlay.appendChild(root);
    },
    exit(): void {
      root.remove();
    },
    frame(dtSeconds: number): void {
      if (done) return;
      elapsed += dtSeconds;
      // Drain input every frame (so presses DURING the lockout are consumed, not buffered to
      // replay the instant it lifts), but only skip on confirm once past the lockout — a
      // shoot-key mash at the clear moment then can't collapse the beat to nothing.
      const skippable = elapsed >= SKIP_LOCKOUT_SECONDS;
      for (const code of input.takeEvents()) {
        if (skippable && classifyMenuKey(code) === "confirm") {
          finish();
          return;
        }
      }
      if (elapsed >= HOLD_SECONDS) finish();
    },
    render(): void {
      // DOM-only; the frozen cleared field is drawn by the in-game screen beneath.
    },
  };
}
