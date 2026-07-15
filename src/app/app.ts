// The app shell — the single entry the engine exposes for running a game.
//
// `runGame(def)` wires the browser surface the screens share: it creates the GL
// context and the two renderers ONCE (they are content-agnostic and fixed
// capacity, so a run can start and end and start again without churning GPU
// resources), the one keyboard source, the screen router, and the one animation
// loop. Each frame it advances the active screen, clears the canvas, and renders
// the screen stack. The simulation lives inside the in-game screen; this layer
// knows only screens.
//
// This is the engine side of the engine/game boundary: it takes a `GameDefinition`
// and never imports anything under `games/`.

import { startAnimationLoop } from "../core/loop";
import { createGL } from "../render/gl";
import { createBulletRenderer } from "../render/bullets";
import { createLaserRenderer } from "../render/lasers";
import { createSpriteRenderer } from "../render/atlas";
import { createBackgroundRenderer } from "../render/background";
import { createVfx } from "../render/vfx";
import { SIM_CAPACITY, LASER_CAPACITY, ENEMY_CAPACITY, ITEM_CAPACITY } from "../core/sim";
import { PLAYFIELD_W, PLAYFIELD_H } from "../core/playfield";
import { createShellInput, type ShellInput } from "./keyboard";
import { createRouter, type Router, type Shell } from "./screen";
import { createTitleScreen } from "./screens/title";
import { loadSave, persistSave, clampDisplayScale } from "./save";
import { createAudioEngine, createNullAudioEngine, type AudioEngine } from "../audio/engine";
import { createBgmToast } from "./toast";
import type { GameDefinition } from "../api/game";
import type { BackgroundLayer } from "../api/sprites";

/** Every background layer across all stages PLUS the game-level menu background — what the
 *  background pass preloads (one texture per distinct handle, deduped inside `load`). */
function collectBackgroundLayers(def: GameDefinition): readonly BackgroundLayer[] {
  return [...def.stages.flatMap((s) => s.background?.layers ?? []), ...(def.menuBackground?.layers ?? [])];
}

export interface AppHandle {
  readonly router: Router;
  readonly input: ShellInput;
  /** Replace the running game definition (dev HMR). Screens read `shell.def` fresh, so
   *  the next-built screen — and the live in-game screen on its next rebuild/resync —
   *  use the new content. A no-op to gameplay until something rebuilds. */
  reloadDef(def: GameDefinition): void;
  /** Stop the loop and release the keyboard source. */
  stop(): void;
}

export function runGame(def: GameDefinition): AppHandle {
  const canvas = document.getElementById("playfield") as HTMLCanvasElement;
  const overlay = document.getElementById("overlay") as HTMLElement;
  const sidebar = document.getElementById("sidebar") as HTMLElement;
  const gl = createGL(canvas);

  // The live game definition. Mutable so dev HMR can swap in freshly-imported content
  // (via the returned `reloadDef`); the shell exposes it as a getter so every screen
  // reads the current one. Stable in production (HMR is dev-only).
  let currentDef = def;

  // Load persisted settings BEFORE the first resize so the saved display scale is
  // applied on boot, not after a flash at the default.
  const save = loadSave();

  const resize = (): void => {
    const scale = clampDisplayScale(save.settings.displayScale);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = `${PLAYFIELD_W * scale}px`;
    canvas.style.height = `${PLAYFIELD_H * scale}px`;
    // Bullets are sized in sim units and projected through the GL viewport, so DPR
    // is handled entirely here — no per-instance pixel scaling.
    canvas.width = Math.round(PLAYFIELD_W * scale * dpr);
    canvas.height = Math.round(PLAYFIELD_H * scale * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  resize();
  window.addEventListener("resize", resize);

  // Full-viewport fade overlay for flow transitions (menu → stage, stage → results). A single
  // DOM element the shell owns; `shell.transition` drives its opacity. `pointer-events: none`
  // so it never eats a keypress, high z-index so it sits over the field and the sidebar.
  const screenFade = document.createElement("div");
  screenFade.id = "screen-fade";
  Object.assign(screenFade.style, {
    position: "fixed",
    inset: "0",
    background: "#04060c",
    opacity: "0",
    pointerEvents: "none",
    zIndex: "50",
    transition: "opacity 170ms ease",
  });
  document.body.appendChild(screenFade);

  const input = createShellInput(() => save.settings.keybinds);
  const bullets = createBulletRenderer(gl, PLAYFIELD_W, PLAYFIELD_H, SIM_CAPACITY);
  const lasers = createLaserRenderer(gl, PLAYFIELD_W, PLAYFIELD_H, LASER_CAPACITY);
  // The alpha sprite pass (enemies/items/player, and custom-image bullets/shots). Created
  // once, sized to the largest instance stream any single drawInstances call may pack. Custom
  // IMAGE bullets/shots route through this pass too, so it must cover the bullet/shot pools —
  // not just the enemy/item pools — or a large image-bullet wave would overflow its buffer.
  // Its atlas loads asynchronously below from the game's sprite manifest; drawing no-ops until it has.
  const sprites = createSpriteRenderer(
    gl,
    PLAYFIELD_W,
    PLAYFIELD_H,
    Math.max(ENEMY_CAPACITY, ITEM_CAPACITY, SIM_CAPACITY),
  );
  // Build the sprite atlas from the initial def (engine defaults are always included, so a
  // game with no sprite manifest still renders default enemy/item/player art). Fire-and-
  // forget like audio preload — non-throwing (a failed image logs + leaves a blank cell).
  void sprites.load(def.assets?.sprites);
  // The parallax background pass (full-field scenery behind the danmaku). Created once and
  // reused across runs; preloads every stage's background textures up front (fire-and-forget,
  // non-throwing). A game with no `background` on any stage simply draws nothing.
  const background = createBackgroundRenderer(gl, PLAYFIELD_W, PLAYFIELD_H);
  void background.load(collectBackgroundLayers(def));
  // The presentation VFX layer (sparks / flash / shake). Created once and reused across runs;
  // content-agnostic (it reacts to sim events, not to any game's data), so nothing to load.
  const vfx = createVfx(gl);

  // The sound system, created once (like the renderers) and reused across runs. A silent
  // game (no audio manifest) or a browser without Web Audio gets a no-op engine, so
  // screens call `shell.audio.*` unconditionally. Volumes are read fresh from the save so
  // Options can re-apply them live. Built from the INITIAL def's manifest — audio is not
  // re-preloaded on a content hot-reload (editing a boss pattern doesn't change sound).
  const audioManifest = def.assets?.audio;
  // Now-playing toast — shell-owned so it survives screen changes (BGM is a shell-level state).
  // Fed by the audio engine's on-track-start hook below; the display title comes from the BGM
  // manifest (a track's `id` → its authored `title`), falling back to the id if unnamed.
  const bgmToast = createBgmToast();
  const audio: AudioEngine =
    audioManifest && typeof AudioContext !== "undefined"
      ? createAudioEngine(
          new AudioContext(),
          () => ({ bgm: save.settings.bgmVolume, sfx: save.settings.sfxVolume }),
          // Fires the instant a track actually starts (see engine `onTrackStart`). Two
          // presentation consumers: the now-playing toast, and unlock-on-hear (the first time
          // a track plays it's recorded so the Music room can list it — deduped before
          // persisting, so a track writes to localStorage at most once, never per re-assertion).
          (trackId) => {
            bgmToast.show(audioManifest.bgm[trackId]?.title ?? trackId);
            if (!save.unlocks.musicRoom.includes(trackId)) {
              save.unlocks.musicRoom.push(trackId);
              persistSave(save);
            }
          },
        )
      : createNullAudioEngine();

  // `router` is filled in just below; the getter defers the read until a screen's
  // frame/enter runs (after assignment), breaking the shell↔screen construction cycle.
  let router!: Router;
  const shell: Shell = {
    gl,
    canvas,
    overlay,
    sidebar,
    input,
    bullets,
    lasers,
    sprites,
    background,
    vfx,
    audio,
    get def(): GameDefinition {
      return currentDef;
    },
    save,
    get router(): Router {
      return router;
    },
    persist(): void {
      persistSave(save);
    },
    applyDisplayScale(): void {
      resize();
    },
    transition(swap: () => void): void {
      // Fade to black → swap while hidden → fade back in. A timer (not `transitionend`) sequences
      // it so a re-entrant call during a fade can never leave the overlay stuck opaque; the
      // delay just outlasts the CSS transition so the swap lands at (near) full black.
      screenFade.style.opacity = "1";
      window.setTimeout(() => {
        swap();
        screenFade.style.opacity = "0";
      }, 180);
    },
  };
  router = createRouter(createTitleScreen(shell));

  // Browsers suspend an AudioContext until a user gesture; resume on the first key/click
  // (one-shot, then unbind). Any BGM a screen requested before then (the title theme)
  // starts the moment the context resumes. Both no-ops for the null engine.
  const kickAudio = (): void => {
    audio.resume();
    window.removeEventListener("keydown", kickAudio);
    window.removeEventListener("pointerdown", kickAudio);
  };
  window.addEventListener("keydown", kickAudio);
  window.addEventListener("pointerdown", kickAudio);
  // Resolve every sound to a buffer up front (async, non-throwing). No-op if silent.
  if (audioManifest) audio.preload(audioManifest);

  const loop = startAnimationLoop((dtSeconds) => {
    router.frame(dtSeconds);
    // Decay the VFX layer on wall time, every frame — sparks fade and the shake settles
    // regardless of the sim's timestep (the in-game screen SPAWNS them, gated on a forward
    // advance; the shell DECAYS them here). Screens that don't use VFX just tick a settled
    // layer, a no-op.
    vfx.update(dtSeconds);
    // One clear per frame, then the stack draws over it (an overlay renders above
    // the frozen screen beneath). The driver advanced the sim in `frame`; drawing
    // is unconditional so a paused/stepped sim still shows on the next frame.
    gl.clearColor(0.008, 0.012, 0.04, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // Screen shake: offset the whole field by nudging the GL viewport (in device pixels) so
    // every pass — background, beams, sprites, bullets, flash — shifts together as one image
    // (a per-layer uniform would tear them apart). The clear ignores the viewport, so it still
    // fills the canvas; only the draws shift. `shakeOffset` returns `[0, 0]` once settled, which
    // is exactly the resize default — so this self-resets with no cleanup.
    const [sx, sy] = vfx.shakeOffset();
    if (sx !== 0 || sy !== 0) {
      const ppx = canvas.width / PLAYFIELD_W;
      const ppy = canvas.height / PLAYFIELD_H;
      gl.viewport(Math.round(sx * ppx), Math.round(sy * ppy), canvas.width, canvas.height);
    } else {
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    router.render();
  });

  return {
    router,
    input,
    reloadDef(next: GameDefinition): void {
      currentDef = next;
      // Sprite hot-reload: re-resolve + re-upload the atlas from the freshly-imported def,
      // re-stamping its handles. Layer assignment is stable (defaults, then library in source
      // order), so a live enemy's stored base layer still points at the same sprite id — an
      // edited drawer / swapped url just repaints that layer. (Audio is NOT re-preloaded on
      // HMR — editing a pattern doesn't change sound — but art edits are a core authoring loop.)
      void sprites.load(next.assets?.sprites);
      // Background hot-reload: re-resolve + re-upload every stage's background textures from
      // the freshly-imported def (it deletes the old textures wholesale), so editing a
      // background drawer / swapping a url shows live.
      void background.load(collectBackgroundLayers(next));
    },
    stop(): void {
      loop.stop();
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", kickAudio);
      window.removeEventListener("pointerdown", kickAudio);
      input.dispose();
    },
  };
}
