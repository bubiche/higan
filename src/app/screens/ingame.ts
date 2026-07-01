// In-game screen — the simulation's home in the shell.
//
// It builds a fresh run on entry (sim + driver) from the game definition, forwards
// real-time frames into the driver, draws the playfield + side HUD, and hands the
// debugger keys (pause/step/scrub/slow-mo) and the replay save/load controls to the
// driver. When the run ends — boss defeated or player out of lives — it transitions
// to the results screen. It reads the boss/character/seed from the injected
// `GameDefinition`; it never imports a specific game's content (the engine/game line).
//
// The renderers are owned by the shell and reused; this screen only drives them.

import type { Screen, Shell } from "../screen";
import type { RunController } from "../run";
import { createResultsScreen, type RunOutcome } from "./results";
import { createPauseScreen } from "./pause";
import { createDialogueScreen } from "./dialogue";
import { createContinueScreen } from "./continue";
import { createHud, type Hud } from "../hud";
import { createCutins, type CutinLayer, type CutinIdentity } from "../cutins";
import { createStageSim, type Simulation, SHOT_CAPACITY, ENEMY_CAPACITY, ITEM_CAPACITY } from "../../core/sim";
import { SfxId } from "../../core/events";
import { mixSeed } from "../../core/prng";
import { createSimDriver, type SimDriver } from "../../core/runtime";
import { DT } from "../../core/playfield";
import { PlayerState } from "../../touhou/player";
import { serializeRunReplay, deserializeRunReplay, type RunReplay } from "../../touhou/replay";
import { computeConfigId } from "../replay-compat";
import { Shape } from "../../render/shapes";
import { INSTANCE_FLOATS, type Overlay } from "../../render/bullets";
import { marshalShots } from "../../render/shots";
import { marshalEnemies } from "../../render/enemies";
import { marshalItems } from "../../render/items";
import { ItemType } from "../../touhou/item";

/** Speeds the number keys cycle through (debugger slow-mo). */
const SPEEDS: Record<string, number> = { Digit1: 0.25, Digit2: 0.5, Digit3: 1 };

/** Draw radius (sim units) of the player-craft sprite — larger than the old 7px marker dot
 *  so a real craft reads at a sensible size on the 384-wide field. */
const PLAYER_SPRITE_RADIUS = 16;

/** The spell-card background swap: a deep-violet wash faded in over the scenery while a
 *  spell phase is active. Colour + peak alpha are a slice stand-in for per-spell art; the
 *  rate lerps it in/out over ~0.3s so a phase transition shifts mood smoothly (wall-clock,
 *  never the sim tick). */
const SPELL_TINT: readonly [number, number, number] = [0.3, 0.16, 0.44];
const SPELL_TINT_MAX = 0.42;
const SPELL_TINT_RATE = 3.5;

/** The in-game screen exposes a hot-reload hook for dev HMR. */
export interface InGameScreen extends Screen {
  /** Rebuild the live run from the (already-swapped) `shell.def` and replay to the
   *  current tick (HMR). The bootstrap swaps `shell.def` for the freshly-imported game
   *  first, then calls this so the in-progress scene picks up the new content. */
  hotReloadStage(): void;
}

/** Narrow a screen to the in-game screen if it is one (used by dev HMR). */
export function asInGame(screen: Screen): InGameScreen | null {
  return typeof (screen as Partial<InGameScreen>).hotReloadStage === "function"
    ? (screen as InGameScreen)
    : null;
}

/**
 * Build the in-game screen over a `RunController` — the run-scoped state that outlives
 * this screen's sim (run seed, rank, character, the data fingerprint, the continue
 * count, and the pre-continue segment log). Each stage sim is a fresh rebuild within the
 * run, so a continue / retry / hot-reload replaces this screen, but a continue passes the
 * SAME controller into the next one (a retry/new run builds a fresh controller); that is
 * how a run spans the rebuild. The controller resets nothing on a continue's fresh sim —
 * score/lives restore from `createPlayer` defaults for free.
 *
 * The run's CURRENT rank is `run.difficulty`, read fresh on every `buildSim` (not
 * captured) so loading a saved replay can adopt the recorded rank in place and have the
 * next rebuild run at it — which is how a replay reproduces at its own difficulty without
 * swapping screens.
 */
export function createInGameScreen(shell: Shell, run: RunController): InGameScreen {
  const { sidebar, input, bullets, lasers, def } = shell;
  // The character the controller chose. Captured (not read fresh per build) so a content
  // hot-reload doesn't hot-swap the player config mid-run — only content scripts do. It is
  // a `let`, not a `const`, for ONE case: loading a replay adopts the recorded character in
  // place (re-captured below in `loadReplayFile`, mirroring the difficulty adopt), so the
  // next rebuild runs as it.
  let character = def.characters[run.character]!;
  // The slice runs the first stage as stage 0 of the run. The driver is seeded with
  // the RUN seed (what a replay captures); the per-stage seed is mixed from it, so
  // chaining more stages later only changes the index. `buildSim` reads the stage from
  // `shell.def` FRESH each time (not a captured binding) so a hot-reload — which swaps
  // `shell.def` for the freshly-imported game and then resyncs — rebuilds with the new
  // code, AND a brand-new run (retry / return-to-title → start) picks it up too; it
  // reads `run.difficulty` fresh too, so an adopted replay rank lands on the next
  // rebuild. The sim is reassignable so backward-scrub / hot-reload / a new run / a
  // loaded replay can rebuild. (The character is captured in the `character` binding:
  // editing the player config takes effect on the next fresh run, not the live one —
  // content scripts hot-reload. Loading a replay re-captures it, so the rebuild runs as
  // the recorded character.)
  const STAGE_INDEX = 0;
  const buildSim = (runSeed: number): Simulation =>
    createStageSim(
      shell.def.stages[STAGE_INDEX]!,
      mixSeed(runSeed, STAGE_INDEX),
      character,
      run.difficulty,
      shell.def.config,
      DT,
    );
  let sim: Simulation = buildSim(run.runSeed);

  const driver: SimDriver = createSimDriver({
    dt: DT,
    seed: run.runSeed,
    sampleInput: (tick) => input.sample(tick),
    step: (frame) => sim.step(frame),
    rebuild: (seed) => {
      sim = buildSim(seed);
    },
    // Checked only in the LIVE frame loop (never stepBack/resync/loadRecording, which must
    // tick straight through to reproduce a recording) — halts the instant a `ctx.dialogue()`
    // tick lands, even mid-catch-up, so the freeze can't overshoot past the requesting tick.
    shouldHalt: () => sim.dialogueRequest !== null,
  });

  // Reused scratch for the player-shot instance stream (the placeholder shot layer
  // reuses the bullet renderer's program — no separate shot shader). Sized to the
  // pool cap × the bullet instance stride.
  const shotInstances = new Float32Array(SHOT_CAPACITY * INSTANCE_FLOATS);
  // Reused scratch for the enemy instance stream (enemies reuse the bullet program
  // too — Option B, no separate shader). Sized to the pool cap × the instance stride.
  const enemyInstances = new Float32Array(ENEMY_CAPACITY * INSTANCE_FLOATS);
  // Reused scratch for the item instance stream (items draw on the alpha sprite pass).
  const itemInstances = new Float32Array(ITEM_CAPACITY * INSTANCE_FLOATS);
  // Reused scratch for the single-instance player-craft sprite draw.
  const playerInstance = new Float32Array(INSTANCE_FLOATS);
  // Presentation clock (seconds), accumulated from real frame dt — drives sprite-sheet
  // animation. Purely presentation: never the sim tick, never hashed. Freezes while paused
  // (this screen's `frame` doesn't run under an overlay), which pauses animation too.
  let presentationClock = 0;
  // Spell-card background wash intensity (0..SPELL_TINT_MAX), lerped toward its target on wall
  // time each frame — presentation-only, never the sim tick.
  let spellTint = 0;

  // The boss/character presentation identity (nameplate name + cut-in portraits), read FRESH
  // from `shell.def` + the current character each frame so a content hot-reload / the loaded
  // replay's character take effect. Presentation-only — the sim never sees any of it.
  const currentIdentity = (): CutinIdentity => {
    const info = shell.def.stages[STAGE_INDEX]?.bossInfo;
    return { bossName: info?.name, bossPortrait: info?.portrait, playerPortrait: character.portrait };
  };

  // Bound to its DOM element in `buildDom` (the element doesn't exist until enter,
  // which always runs before the first frame/render).
  let hud!: Hud;
  // The boss/spell cut-in overlay (nameplate, appear splash, spell banner, cut-in portraits,
  // capture flourish). Built into `shell.overlay` in `buildDom`, destroyed on exit.
  let cutins!: CutinLayer;
  // Last replay save/load outcome, shown in the HUD. Screen-local — never enters
  // the sim or the recorded input log.
  let replayStatus = "";
  // Set once the run ends so we transition exactly once.
  let ended = false;
  // Multi-segment replay playback (screen-local, out of the sim). A loaded blob's
  // segments are each a separate play of a stage (a continue = another segment), so they
  // can't share one sim — playback loads them one at a time, landing at the first, and
  // the "next segment" button advances through the rest. Null = not in replay playback.
  let loadedReplay: RunReplay | null = null;
  let replayIndex = 0;

  // Cosmetic overlays (out of the sim/hash): the player marker and the focus hitbox
  // dot. They read player state each frame; the sim is the source of truth.
  const playerMarker: Overlay = { x: 0, y: 0, radius: 7, color: [0.85, 0.95, 1.0], sprite: Shape.BigOrb };
  const hitboxMarker: Overlay = {
    x: 0,
    y: 0,
    radius: character.config.hitboxRadius,
    color: [1.0, 0.3, 0.3],
    sprite: Shape.Orb,
  };

  // ── Replay save/load (engine primitive; the buttons are shell UI) ─────────────
  let saveBtn: HTMLButtonElement;
  let loadBtn: HTMLButtonElement;
  let nextSegBtn: HTMLButtonElement;
  let replayFile: HTMLInputElement;

  const downloadReplay = (): void => {
    // In playback (a replay is loaded), re-export the LOADED blob verbatim — its priors +
    // the live driver are hybrid state (the controller's pre-load priors plus only the
    // viewed segment), so assembling from them would silently drop the other segments.
    // Re-serializing the loaded run is a lossless round-trip; assembling the LIVE run from
    // the controller (priors + the current play) is the normal save. (Resuming a live run
    // out of a loaded replay is the run-state handoff story, deferred.)
    const recording = driver.getRecording();
    const replay = loadedReplay ?? run.assembleReplay({ stageIndex: STAGE_INDEX, frames: recording.frames });
    const blob = serializeRunReplay(replay);
    // `as BlobPart`: the Uint8Array is a valid blob part at runtime; the cast
    // bridges TS's typed-array buffer generic to the DOM's ArrayBuffer.
    const file = new Blob([blob as BlobPart], { type: "application/octet-stream" });
    const url = URL.createObjectURL(file);
    // Firefox won't fire a programmatic click on a detached anchor, and revoking
    // the URL synchronously can truncate the download — attach, click, defer revoke.
    const a = document.createElement("a");
    a.href = url;
    const segCount = replay.segments.length;
    const liveFrames = replay.segments[segCount - 1]!.frames.length;
    a.download = `higan-replay-${segCount}seg-${liveFrames}f.hreplay`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    replayStatus = loadedReplay
      ? `re-saved loaded replay (${segCount} segment${segCount > 1 ? "s" : ""})`
      : segCount > 1
        ? `saved ${segCount} segments (${liveFrames}f live)`
        : `saved ${liveFrames} frames`;
  };

  // Load segment `i` of the currently-loaded replay into the live driver: rebuild at the
  // adopted rank (via `buildSim`, reading `run.difficulty`) seeded with the RUN seed —
  // NOT a per-stage seed; `buildSim` mixes the stage index in itself, so passing a mixed
  // seed here would double-mix and reproduce the WRONG trajectory — then replay the
  // segment's frames to the end, paused. The button advances `i` through the segments.
  const loadSegment = (i: number): void => {
    const blob = loadedReplay!;
    const seg = blob.segments[i]!;
    replayIndex = i;
    driver.loadRecording({ seed: blob.runSeed, frames: seg.frames });
    const total = blob.segments.length;
    replayStatus =
      total > 1
        ? `replay segment ${i + 1}/${total} (${seg.frames.length}f) — paused at end`
        : `loaded ${seg.frames.length} frames — paused at end`;
    refreshReplayControls();
  };

  // Show the "next segment" button only while a multi-segment replay has a segment after
  // the one on screen; its label names the segment it advances TO.
  const refreshReplayControls = (): void => {
    const more = loadedReplay !== null && replayIndex < loadedReplay.segments.length - 1;
    nextSegBtn.hidden = !more;
    if (more) nextSegBtn.textContent = `⏭ Segment ${replayIndex + 2}/${loadedReplay!.segments.length}`;
  };

  const loadReplayFile = async (file: File): Promise<void> => {
    let replay: RunReplay;
    try {
      replay = deserializeRunReplay(new Uint8Array(await file.arrayBuffer()));
    } catch (err) {
      // Parse failures stay on THIS screen (no replace yet), so the message shows here.
      replayStatus = `load failed: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }
    // Compatibility gates — refuse cleanly rather than replay into divergence. All set
    // the status on the current (still-live) screen and return.
    if (replay.configId !== computeConfigId(def)) {
      replayStatus = "load failed: replay was recorded against different game data";
      return;
    }
    // No character reject: the matching configId already guarantees the same character set
    // (it folds in every character's config/shot/bomb), so the recorded index is in range —
    // we ADOPT it in place below, exactly like the rank.
    if (replay.segments.length === 0) {
      replayStatus = "load failed: replay has no segments";
      return;
    }
    // The slice runs only stage 0, so every segment must be a stage-0 play (a continue).
    // The format supports per-stage indices for multi-stage runs, but `buildSim` can only
    // build stage 0 until then — reject a genuine multi-stage blob rather than mis-seed it.
    if (replay.segments.some((s) => s.stageIndex !== STAGE_INDEX)) {
      replayStatus = "load failed: multi-stage replay not yet supported";
      return;
    }
    // Adopt the recorded rank AND character IN PLACE on the controller, then play the
    // segments. Done in place rather than by swapping to a fresh screen: the Save/Load
    // buttons live in the sidebar and stay clickable while an overlay (e.g. the pause menu)
    // sits on top, so a `router.replace` here would pop the OVERLAY and orphan the in-game
    // screen beneath — which keeps rendering its now-frozen player marker (a "phantom"
    // second player). Rebuilding this screen's own sim can't orphan anything. Each segment
    // is a separate play (a continue), so they load one at a time: land at the first,
    // advance with the button — each advance is a real replay that reproduces that segment
    // at the adopted rank + character, so the multi-segment run is demonstrably bit-
    // identical across all of them.
    loadedReplay = replay;
    run.difficulty = replay.difficulty;
    // Re-capture the character binding (and the cosmetic hitbox dot it sizes) BEFORE
    // loadSegment → buildSim reads it, so the rebuild runs as the recorded character.
    run.character = replay.character;
    character = shell.def.characters[run.character]!;
    hitboxMarker.radius = character.config.hitboxRadius;
    ended = false;
    loadSegment(0);
  };

  const buildDom = (): void => {
    sidebar.innerHTML = `
      <div id="hud"></div>
      <div id="replay-controls">
        <button id="save-replay" type="button">⬇ Save replay</button>
        <button id="load-replay" type="button">⬆ Load replay…</button>
        <button id="next-segment" type="button" hidden></button>
        <input id="replay-file" type="file" accept=".hreplay,application/octet-stream" hidden />
      </div>`;
    saveBtn = sidebar.querySelector("#save-replay")!;
    loadBtn = sidebar.querySelector("#load-replay")!;
    nextSegBtn = sidebar.querySelector("#next-segment")!;
    replayFile = sidebar.querySelector("#replay-file")!;
    // The HUD reads sim state every frame and keeps no counters of its own.
    hud = createHud(sidebar.querySelector("#hud")!);
    // The cut-in overlay draws over the playfield (not the sidebar), so it lives in the
    // shell's per-screen overlay layer. Reads sim state/events; keeps no counters.
    cutins = createCutins(shell.overlay);

    saveBtn.addEventListener("click", () => {
      downloadReplay();
      saveBtn.blur(); // so Space toggles pause again, not the button
    });
    loadBtn.addEventListener("click", () => {
      replayFile.click();
      loadBtn.blur();
    });
    nextSegBtn.addEventListener("click", () => {
      if (loadedReplay && replayIndex < loadedReplay.segments.length - 1) loadSegment(replayIndex + 1);
      nextSegBtn.blur();
    });
    replayFile.addEventListener("change", () => {
      const file = replayFile.files?.[0];
      if (file) void loadReplayFile(file);
      replayFile.value = ""; // reset so re-picking the same file fires `change` again
    });
    refreshReplayControls();
  };

  const end = (outcome: RunOutcome): void => {
    ended = true;
    if (outcome === "gameover") {
      // Push (not replace) so the frozen death moment shows behind the prompt; the
      // continue choice rebuilds the run from the SAME controller (carrying its rank +
      // continue count) or falls through to results. Hand the just-finished play's
      // recording to the prompt: on Continue it becomes a prior segment of the ongoing
      // run; on give-up it's dropped (the run ended). The driver hasn't advanced since
      // game-over fired, so its recording is final at the death tick.
      shell.router.push(
        createContinueScreen(shell, run, { stageIndex: STAGE_INDEX, frames: driver.getRecording().frames }),
      );
    } else {
      // Clear: hand the final score (read off the sim) to results, fading through black. The
      // game-over path instead PUSHES the continue prompt (no fade — it keeps the frozen death
      // moment visible behind the prompt).
      shell.transition(() => shell.router.replace(createResultsScreen(shell, outcome, sim.player.score)));
    }
  };

  return {
    enter(): void {
      input.flush();
      buildDom();
      // A fresh run shouldn't inherit the previous run's sparks / flash / shake.
      shell.vfx.reset();
      // Seed the cut-in appear tracker from the current boss presence (normally none at the
      // start of a run — but loading a replay into a boss-present tick must not phantom-splash).
      cutins.reset(sim.boss !== null);
      spellTint = 0;
    },
    exit(): void {
      sidebar.innerHTML = "";
      cutins.destroy();
    },
    frame(dtSeconds: number): void {
      // Advance the presentation clock (animation) by real elapsed time. Presentation-only;
      // unrelated to the sim's fixed timestep and never hashed.
      presentationClock += dtSeconds;

      // Capture the tick at the TOP, before the debugger-key loop can single-step or
      // step back: SFX play iff the sim actually advanced FORWARD this frame (below).
      const t0 = driver.tick;

      // Debugger controls drive the LOOP, not the sim — kept out of the input log
      // so they can never poison a replay.
      for (const code of input.takeEvents()) {
        if (code === "Escape") {
          // Flow-pause: hand control to the pause overlay. Return BEFORE advancing
          // the sim so no extra tick runs this frame and end-detection can't fire
          // into the just-pushed pause screen (which would corrupt the stack). The
          // controller goes too, so Retry can start a fresh run at the same rank.
          shell.audio.play(SfxId.Pause);
          shell.router.push(createPauseScreen(shell, run));
          return;
        }
        if (code === "Space") driver.togglePause();
        else if (code === "Period") driver.singleStep();
        else if (code === "Comma") driver.stepBack();
        else if (code in SPEEDS) driver.setSpeed(SPEEDS[code]!);
      }

      const haltedForDialogue = driver.frame(dtSeconds);

      // SFX follow the sim's EVENTS, gated on a real forward advance: `sim.events` holds
      // only the last stepped tick's sounds (cleared at each step start), so play them
      // iff the tick moved forward this frame. Strictly `>`, which collapses every case:
      //   • live play / single-step forward → tick rose → play that tick's SFX
      //   • step-back → tick fell → skip (this is why it's `>`, not `!==`)
      //   • paused / a 0-step frame (acc < dt, common at 144Hz) → tick unchanged → skip,
      //     so idle frames don't re-fire the previous tick's stale events (a machine-gun)
      //   • resync / loadRecording → run outside frame() and leave us paused → never play
      // Both presentation consumers of the post-step event list read it here, under the SAME
      // forward-advance gate: audio plays the sounds, VFX spawns the sparks/flash/shake. The
      // gate is what makes a scrub / replay-rebuild fire at most one burst, never a machine-gun.
      if (driver.tick > t0) {
        shell.audio.playEvents(sim.events);
        shell.vfx.consume(sim.events);
        // Transient cut-ins (spell declaration portrait, bomb portrait, capture flourish) ride
        // the SAME forward-advance gate so a scrub/replay-rebuild can't machine-gun them. The
        // persistent chrome + the appear splash are state reads, done in `render` (see below).
        cutins.trigger(sim.events, currentIdentity());
      }

      // A live step just landed on a `ctx.dialogue()` tick — the driver halted before running
      // any further steps this frame (the `shouldHalt` hook above). Freeze by pushing the
      // overlay, exactly like Escape → the pause menu: this screen stops receiving `frame`
      // while it's on top, so no further tick runs until the player dismisses it. Return
      // before the spell-tint/BGM/end-of-run checks below — they're all state reads that pick
      // straight back up once this screen is `frame()`'d again after the box pops.
      // `?.length` (not a bare non-null check): an author who passes an EMPTY dialogue array
      // gets a graceful no-op — the halted latch clears on the very next step regardless of
      // whether an overlay ever showed, so falling through here just lets play continue.
      const dialogue = sim.dialogueRequest;
      if (haltedForDialogue && dialogue?.length) {
        shell.router.push(createDialogueScreen(shell, dialogue));
        return;
      }

      // Spell-card background wash: ramp the tint toward full while an active phase is a spell,
      // toward zero otherwise. Wall-clock lerp (dt), so it never touches the sim/hash and it
      // follows scrub for free (the target is a pure state read).
      const spellActive = sim.boss !== null && sim.boss.active && sim.boss.isSpell;
      spellTint += ((spellActive ? SPELL_TINT_MAX : 0) - spellTint) * Math.min(1, dtSeconds * SPELL_TINT_RATE);

      // BGM follows sim STATE, not events: assert the wanted theme every frame (playBgm
      // is idempotent — a no-op unless it actually changed). Keyed on boss PRESENCE
      // (`sim.boss` non-null for the whole encounter), NOT `.active` (which drops during
      // inter-phase gaps and would churn stage↔boss on every phase transition). Because
      // it is a state read, it follows scrub / step-back for free. Read `music` fresh
      // from `shell.def` so a hot-reload that adds/edits it takes effect. Omitted → the
      // screen leaves whatever's playing (a silent stage doesn't force silence).
      const music = shell.def.stages[STAGE_INDEX]?.music;
      if (music) shell.audio.playBgm(sim.boss ? (music.boss ?? music.stage) : music.stage);

      // Transition only during live play — never while paused/stepping/scrubbing or
      // sitting at the end of a loaded replay, so the debugger can inspect an ended
      // run without being bounced to results. Game-over wins ties: a dead player ends
      // the run even if a boss happens to time out its last phase the same tick.
      if (!ended && !driver.paused) {
        if (sim.player.state === PlayerState.GameOver) end("gameover");
        else if (sim.stageComplete) end("clear");
      }
    },
    render(): void {
      const { system, player } = sim;
      const sprites = shell.sprites;
      const clock = presentationClock;
      hitboxMarker.x = player.x;
      hitboxMarker.y = player.y;

      // Parallax background FIRST, behind everything, over the shell's clear. Read the
      // stage's layers fresh from `shell.def` so a hot-reload picks up edits; scroll runs off
      // the presentation clock (wall time), never the sim — so it's replay-irrelevant.
      const backgroundLayers = shell.def.stages[STAGE_INDEX]?.background?.layers;
      if (backgroundLayers) shell.background.draw(backgroundLayers, clock);
      // Spell-card background swap: wash the scenery (over the background, under the danmaku)
      // while a spell is active. Independent of any background layers — a bare field still
      // tints. A no-op at zero alpha (no spell).
      shell.background.drawTint(SPELL_TINT[0], SPELL_TINT[1], SPELL_TINT[2], spellTint);

      // Player: an alpha sprite (the character's craft, or the engine default) drawn under
      // the bullets; blinked off on alternate windows while invulnerable. Falls back to the
      // glow marker if no sprite is available yet (atlas still loading). The hitbox dot draws
      // only while focus is held. All cosmetic (out of sim/hash).
      const invulnBlink = player.invulnTicks > 0 && Math.floor(driver.tick / 4) % 2 === 1;
      const playerBase = character.sprite ? character.sprite.layer : sprites.defaultPlayerLayer;
      const playerLayer = sprites.layerForBase(playerBase, clock);
      const drawPlayerSprite = !invulnBlink && playerLayer >= 0;

      const overlays: Overlay[] = [];
      if (!invulnBlink && !drawPlayerSprite) {
        playerMarker.x = player.x;
        playerMarker.y = player.y;
        overlays.push(playerMarker); // glow fallback until the sprite atlas is ready
      }
      if (player.focused) overlays.push(hitboxMarker);

      // Draw order: beams (behind), then player shots (glow, under everything for
      // readability), then enemies and items and the player craft on the ALPHA sprite pass,
      // then the danmaku glow + hitbox overlay on top. The glow layers (shots, bullets) and
      // the sprite layers each assert their own blend mode per draw, so interleaving the two
      // passes is order-safe. Each `drawInstances` is issued before the next overwrites its
      // renderer's shared instance buffer. The canvas is cleared by the shell first.
      const beams = lasers.draw(sim.lasers.lasers);
      const shotCount = marshalShots(sim.shots.shots, shotInstances);
      bullets.drawInstances(shotInstances, shotCount);
      const enemyCount = marshalEnemies(sim.enemies.enemies, enemyInstances, (base) =>
        sprites.layerForBase(base < 0 ? sprites.defaultEnemyLayer : base, clock),
      );
      sprites.drawInstances(enemyInstances, enemyCount);
      const itemCount = marshalItems(sim.items.items, itemInstances, (type: ItemType) =>
        sprites.layerForBase(sprites.itemBaseLayer(type), clock),
      );
      sprites.drawInstances(itemInstances, itemCount);
      if (drawPlayerSprite) {
        playerInstance[0] = player.x;
        playerInstance[1] = player.y;
        playerInstance[2] = PLAYER_SPRITE_RADIUS;
        playerInstance[3] = 0; // upright — the craft doesn't rotate
        playerInstance[4] = 0.85;
        playerInstance[5] = 0.95;
        playerInstance[6] = 1.0;
        playerInstance[7] = playerLayer;
        sprites.drawInstances(playerInstance, 1);
      }
      const drawn = bullets.draw(system.store, system.alive, system.highWater, overlays);
      // VFX on top of the danmaku: additive glow sparks (reusing the bullet program), then the
      // full-field flash last of all. Both are no-ops when nothing is live. The shake is applied
      // by the shell as a viewport offset (it must move every layer, not just this screen).
      shell.vfx.drawParticles(bullets);
      shell.vfx.drawFlash();
      hud.update(sim, driver, { beams, drawn, replayStatus });
      // Persistent cut-in chrome (nameplate, spell banner) + the boss-appear splash edge, from
      // sim STATE. Runs every rendered frame (even paused) so the appear edge is at-most-once
      // and never stale across a scrub — see cutins.ts. Transient cues went through the gate.
      cutins.reflect(sim.boss, currentIdentity());
    },
    hotReloadStage(): void {
      driver.resync();
    },
  };
}
