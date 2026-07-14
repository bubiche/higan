// Cut-in / nameplate / banner overlay — the boss & spell-card chrome.
//
// This is the DOM half of the boss-presentation layer (the GL half — the spell-background
// tint + the declaration flash — lives in the render passes). It draws the crisp-text /
// portrait chrome a Touhou fight wants: the boss nameplate + appear splash, the spell-card
// name banner, the spell/bomb cut-in portraits, and the capture flourish. It is driven by
// the in-game screen exactly like the HUD — it reads sim STATE and consumes sim EVENTS, and
// keeps no gameplay state of its own, so nothing here can touch the sim or the hash.
//
// The event/state split mirrors audio + VFX (core/events.ts):
//   • PERSISTENT chrome (nameplate while a boss is present, banner while a spell is active)
//     is a per-frame STATE read in `reflect` — idempotent show/hide, so it follows a scrub /
//     replay-rebuild for free (the same reason BGM is a state read).
//   • The boss-appear SPLASH is a false→true presence EDGE, also detected in `reflect`.
//     `reflect` runs every rendered frame (even paused), so the edge is inherently
//     at-most-once-per-frame — a bulk re-step that jumps past the boss spawn in one frame
//     fires exactly one splash, and `prevPresent` never goes stale across a paused
//     scrub/rebuild (which a gated, per-TICK path would). State edges → `reflect`.
//   • The genuine transient cues (spell declaration, bomb, capture) are sim EVENTS consumed
//     in `trigger`, called ONLY on a real forward advance (the `driver.tick > t0` gate the
//     caller shares with audio/VFX) — so a scrub can't machine-gun them. Events → `trigger`.
//
// Animation is pure CSS (wall-clock keyframes), so there is no per-frame JS timer and it is
// automatically presentation-time, never the sim tick. DOM/`document` use is confined to the
// factory (import-safe headless). The engine ships its own styles (injected once) so the
// cut-in look travels with the engine, not the host page.

import type { BossState } from "../core/sim";
import { PLAYFIELD_W } from "../core/playfield";
import { SfxId, type SfxEvent } from "../core/events";
import type { SpriteHandle } from "../api/sprites";
import { createPortraitResolver } from "./portrait";

/** The presentation identity the shell reads from the game definition each frame (fresh, so
 *  a hot-reload of `bossInfo` / a character swap takes effect). All optional — a game with
 *  no names/portraits still gets the flash/shake/banner-less declaration. */
export interface CutinIdentity {
  /** The headline boss's display name (nameplate + appear splash). */
  readonly bossName?: string;
  /** The headline boss's spell cut-in portrait. */
  readonly bossPortrait?: SpriteHandle;
  /** The ACTIVE character's portrait (the bomb cut-in). */
  readonly playerPortrait?: SpriteHandle;
}

/** The cut-in overlay handle. Owned by the in-game screen (built into `shell.overlay`,
 *  destroyed on exit); presentation-only. */
export interface CutinLayer {
  /** Persistent chrome + the appear-edge splash, from sim STATE. Call EVERY rendered frame
   *  (even while paused) — it is idempotent and detects the boss-appear edge itself. `bossX`
   *  is the boss's live playfield x (`sim.bossBody.x`), used to place the position arrow;
   *  ignored while no boss is present. */
  reflect(boss: Readonly<BossState> | null, bossX: number, identity: CutinIdentity): void;
  /** Transient cut-ins from sim EVENTS. Call ONLY on a real forward advance (`driver.tick >
   *  t0`), mirroring the audio/VFX gate, so a scrub/replay-rebuild can't machine-gun them. */
  trigger(events: readonly SfxEvent[], identity: CutinIdentity): void;
  /** Clear all cut-in DOM and re-seed the appear tracker from the current presence (so
   *  loading a replay straight into a boss-present tick doesn't phantom-fire a splash). */
  reset(bossPresent: boolean): void;
  /** Remove the overlay DOM (screen exit). */
  destroy(): void;
}

const STYLE_ID = "higan-cutins-style";

/** Inject the cut-in stylesheet once (idempotent). Kept in the engine — the cut-in look
 *  ships with the engine rather than depending on the host page's CSS. */
function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.cutins { position:absolute; inset:0; overflow:hidden; pointer-events:none;
  font:600 15px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color:#eaf0ff; }
.cutin-nameplate { position:absolute; top:10px; left:0; padding:5px 14px 5px 12px;
  letter-spacing:2px; font-size:16px;
  background:linear-gradient(90deg, rgba(20,26,48,0.88), rgba(20,26,48,0));
  border-left:3px solid #6f8cff; text-shadow:0 0 12px #2a52d0, 0 1px 2px #000;
  opacity:0; transform:translateX(-14px); transition:opacity .5s ease, transform .5s ease; }
.cutin-nameplate.show { opacity:1; transform:none; }
.cutin-banner { position:absolute; top:40px; right:0; padding:5px 12px 5px 14px; max-width:78%;
  text-align:right; font-size:15px; letter-spacing:1px; color:#ffe6a2;
  background:linear-gradient(270deg, rgba(42,30,14,0.88), rgba(42,30,14,0));
  border-right:3px solid #ffcf6f; text-shadow:0 0 12px #b8791f, 0 1px 2px #000;
  opacity:0; transform:translateX(14px); transition:opacity .45s ease, transform .45s ease; }
.cutin-banner.show { opacity:1; transform:none; }
.cutin-splash { position:absolute; left:0; right:0; top:36%; text-align:center;
  font-size:33px; font-weight:800; letter-spacing:8px; color:#fff;
  text-shadow:0 0 30px #6f8cff, 0 2px 5px #000; animation:cutinSplash 1.7s ease-out forwards; }
@keyframes cutinSplash {
  0% { opacity:0; transform:scale(1.28); letter-spacing:22px; }
  18% { opacity:1; transform:scale(1); letter-spacing:8px; }
  70% { opacity:1; } 100% { opacity:0; transform:scale(1.05); } }
.cutin-portrait, .cutin-bomb { position:absolute; bottom:0; width:48%; height:76%;
  background-size:contain; background-repeat:no-repeat; }
.cutin-portrait { right:1%; background-position:bottom right;
  filter:drop-shadow(0 0 20px rgba(120,150,255,0.55));
  animation:cutinFromRight 1.55s ease-out forwards; }
.cutin-bomb { left:1%; background-position:bottom left;
  filter:drop-shadow(0 0 20px rgba(150,190,255,0.6));
  animation:cutinFromLeft 1.2s ease-out forwards; }
@keyframes cutinFromRight {
  0% { opacity:0; transform:translateX(42%); }
  15% { opacity:1; transform:translateX(0); }
  74% { opacity:1; transform:translateX(0); } 100% { opacity:0; transform:translateX(14%); } }
@keyframes cutinFromLeft {
  0% { opacity:0; transform:translateX(-42%); }
  17% { opacity:1; transform:translateX(0); }
  70% { opacity:1; transform:translateX(0); } 100% { opacity:0; transform:translateX(-14%); } }
.cutin-capture { position:absolute; left:0; right:0; top:29%; text-align:center;
  font-size:25px; font-weight:800; letter-spacing:4px; color:#fff3c4;
  text-shadow:0 0 26px #ffcf6f, 0 2px 4px #000; animation:cutinCapture 1.5s ease-out forwards; }
@keyframes cutinCapture {
  0% { opacity:0; transform:translateY(12px) scale(0.9); }
  20% { opacity:1; transform:translateY(0) scale(1); }
  68% { opacity:1; } 100% { opacity:0; transform:translateY(-8px); } }
/* Boss HP arc — a thin curved bar across the top for the current phase, draining left→right.
   Shown while a phase is ACTIVE; a survival phase locks it full with a distinct gold fill. */
.cutin-hp { position:absolute; top:4px; left:8%; right:8%; height:6px; border-radius:4px;
  background:rgba(10,14,28,0.7); box-shadow:0 0 0 1px rgba(140,160,255,0.25), 0 1px 3px #000;
  opacity:0; transition:opacity .3s ease; overflow:hidden; }
.cutin-hp.show { opacity:1; }
.cutin-hp-fill { height:100%; width:100%; border-radius:4px;
  background:linear-gradient(90deg,#ff6f8c,#ff3b57); box-shadow:0 0 8px #ff3b57;
  transition:width .12s linear; }
.cutin-hp-fill.survival { background:linear-gradient(90deg,#ffe6a2,#ffcf6f); box-shadow:0 0 10px #ffcf6f; }
/* Spell timer — the prominent countdown, top-right; reddens in the final seconds. */
.cutin-timer { position:absolute; top:12px; right:10px; font-variant-numeric:tabular-nums;
  font:800 22px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color:#eaf0ff;
  text-shadow:0 0 10px #2a52d0, 0 1px 2px #000; opacity:0; transition:opacity .3s ease; }
.cutin-timer.show { opacity:1; }
.cutin-timer.urgent { color:#ff6a6a; text-shadow:0 0 12px #ff2a2a, 0 1px 2px #000; }
/* Position arrow — an up-pointing marker at the bottom edge tracking the boss's x. Shown on
   boss PRESENCE (persists through the between-phase glide), so a drifted/off-top boss is findable. */
.cutin-arrow { position:absolute; bottom:3px; width:0; height:0;
  border-left:7px solid transparent; border-right:7px solid transparent;
  border-bottom:11px solid #ff5a6e; filter:drop-shadow(0 0 5px #ff3b57);
  transform:translateX(-50%); opacity:0; transition:opacity .3s ease, left .1s linear; }
.cutin-arrow.show { opacity:0.95; }`;
  document.head.appendChild(style);
}

export function createCutins(overlay: HTMLElement): CutinLayer {
  injectStyles();

  const root = document.createElement("div");
  root.className = "cutins";
  const nameplate = document.createElement("div");
  nameplate.className = "cutin-nameplate";
  const banner = document.createElement("div");
  banner.className = "cutin-banner";
  // Boss HUD chrome (state-driven, persistent): the HP arc (with its fill), the spell timer,
  // and the bottom-edge position arrow. Built once; shown/hidden + updated in `reflect`.
  const hpArc = document.createElement("div");
  hpArc.className = "cutin-hp";
  const hpFill = document.createElement("div");
  hpFill.className = "cutin-hp-fill";
  hpArc.appendChild(hpFill);
  const timer = document.createElement("div");
  timer.className = "cutin-timer";
  const arrow = document.createElement("div");
  arrow.className = "cutin-arrow";
  root.append(nameplate, banner, hpArc, timer, arrow);
  overlay.appendChild(root);

  // Resolved portrait URLs, cached by handle identity (a procedural source is painted once).
  const portraitUrl = createPortraitResolver();

  // Presence on the previous rendered frame — the appear-edge tracker (updated every frame,
  // so it can never go stale across a paused scrub/rebuild).
  let prevPresent = false;

  /** Append a one-shot animated element of class `cls`, removing any prior one of that class
   *  first (so a rapid re-fire restarts cleanly rather than stacking DOM). It removes itself
   *  when its CSS animation ends. */
  const oneShot = (cls: string, apply: (node: HTMLDivElement) => void): void => {
    root.querySelector(`.${cls}`)?.remove();
    const node = document.createElement("div");
    node.className = cls;
    apply(node);
    node.addEventListener("animationend", () => node.remove(), { once: true });
    root.appendChild(node);
  };

  return {
    reflect(boss, bossX, identity): void {
      const present = boss !== null;

      // HP arc + timer: shown while a phase is ACTIVE (a live phase), hidden during the
      // invulnerable between-phase glide so there's no stale bar. A survival phase locks the
      // arc full (its hp never drains) with the distinct gold fill; the timer is the read.
      if (present && boss.active) {
        const ratio = boss.survival ? 1 : boss.hpMax > 0 ? boss.hp / boss.hpMax : 0;
        hpFill.style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
        hpFill.classList.toggle("survival", boss.survival);
        hpArc.classList.add("show");
        const secs = Math.max(0, boss.timeLeft) / 60;
        timer.textContent = secs.toFixed(2);
        timer.classList.toggle("urgent", secs < 5);
        timer.classList.add("show");
      } else {
        hpArc.classList.remove("show");
        timer.classList.remove("show");
      }

      // Position arrow: on boss PRESENCE (like the nameplate), so it persists through the
      // between-phase glide and points at a boss that's drifted or gone off the top edge.
      if (present) {
        arrow.style.left = `${(bossX / PLAYFIELD_W) * 100}%`;
        arrow.classList.add("show");
      } else {
        arrow.classList.remove("show");
      }

      // Nameplate: shown whenever a (named) boss is on the field.
      if (present && identity.bossName) {
        if (nameplate.textContent !== identity.bossName) nameplate.textContent = identity.bossName;
        nameplate.classList.add("show");
      } else {
        nameplate.classList.remove("show");
      }

      // Spell banner: shown while an active phase is a spell card; text = the spell name.
      if (present && boss.active && boss.isSpell) {
        if (banner.textContent !== boss.name) banner.textContent = boss.name;
        banner.classList.add("show");
      } else {
        banner.classList.remove("show");
      }

      // Appear splash: a false→true presence edge. Per-frame, so at-most-once and never stale.
      if (present && !prevPresent && identity.bossName) {
        const name = identity.bossName;
        oneShot("cutin-splash", (n) => {
          n.textContent = name;
        });
      }
      prevPresent = present;
    },

    trigger(events, identity): void {
      for (const e of events) {
        switch (e.id) {
          case SfxId.SpellDeclare: {
            // Spell-card declaration: the boss portrait sweeps in. (The name banner is the
            // persistent state read; the flash is the GL VFX layer. No portrait → no cut-in,
            // so a portrait-less game still declares via banner + flash.)
            const url = portraitUrl(identity.bossPortrait);
            if (url) oneShot("cutin-portrait", (n) => (n.style.backgroundImage = `url("${url}")`));
            break;
          }
          case SfxId.Bomb:
          case SfxId.PlayerDeathBomb: {
            // Bomb: the active character's portrait sweeps in from the other side.
            const url = portraitUrl(identity.playerPortrait);
            if (url) oneShot("cutin-bomb", (n) => (n.style.backgroundImage = `url("${url}")`));
            break;
          }
          case SfxId.SpellCapture:
            oneShot("cutin-capture", (n) => (n.textContent = "Spell Card Get!"));
            break;
          default:
            break; // every other cue is audio/VFX only
        }
      }
    },

    reset(bossPresent): void {
      prevPresent = bossPresent;
      nameplate.classList.remove("show");
      banner.classList.remove("show");
      hpArc.classList.remove("show");
      timer.classList.remove("show");
      arrow.classList.remove("show");
      root.querySelectorAll(".cutin-splash, .cutin-portrait, .cutin-bomb, .cutin-capture").forEach((n) => n.remove());
    },

    destroy(): void {
      root.remove();
    },
  };
}
