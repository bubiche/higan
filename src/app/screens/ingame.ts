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
import { createResultsScreen, type RunOutcome } from "./results";
import { createPauseScreen } from "./pause";
import { createContinueScreen } from "./continue";
import { createHud, type Hud } from "../hud";
import { createStageSim, type Simulation, SHOT_CAPACITY, ENEMY_CAPACITY, ITEM_CAPACITY } from "../../core/sim";
import { mixSeed } from "../../core/prng";
import { createSimDriver, type SimDriver } from "../../core/runtime";
import { DT } from "../../core/playfield";
import { PlayerState } from "../../touhou/player";
import { serializeRunReplay, deserializeRunReplay } from "../../touhou/replay";
import { computeConfigId } from "../replay-compat";
import { Shape } from "../../render/shapes";
import { INSTANCE_FLOATS, type Overlay } from "../../render/bullets";
import { marshalShots } from "../../render/shots";
import { marshalEnemies } from "../../render/enemies";
import { marshalItems } from "../../render/items";

/** Speeds the number keys cycle through (debugger slow-mo). */
const SPEEDS: Record<string, number> = { Digit1: 0.25, Digit2: 0.5, Digit3: 1 };

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
 * Build the in-game screen. `continuesUsed` is run-level meta carried ABOVE the sim
 * (each stage sim is a fresh rebuild): a fresh run (title Start / pause Retry) passes 0;
 * a continue passes the prior count + 1, so the continue prompt can bound the choice and
 * a continue's fresh sim already resets score/lives (createPlayer defaults). It lives
 * here — threaded through the screen constructors — rather than in a RunController/
 * RunState; that struct is born at the cross-stage pass, where it also absorbs this field.
 *
 * `difficulty` is the chosen run rank (a 0-based index into the game's difficulties):
 * the difficulty-select screen supplies it, a continue carries it unchanged (a continue
 * keeps the run's rank), and it feeds the sim as construction input that content
 * branches on. Defaults to rank 0 (the game's first difficulty) for a direct
 * construction without going through the select screen. It is the run's CURRENT rank
 * and so is mutable: loading a saved replay adopts the recorded rank in place (see the
 * load handler) and rebuilds the sim at it, which is how a replay reproduces at its own
 * difficulty without swapping screens.
 */
export function createInGameScreen(shell: Shell, continuesUsed = 0, difficulty = 0): InGameScreen {
  const { sidebar, input, bullets, lasers, def } = shell;
  // The slice runs the default character; character-select (and a real chosen index)
  // arrives later. The replay blob captures this index and a load rejects any other.
  const CHARACTER_INDEX = 0;
  const character = def.characters[CHARACTER_INDEX]!;
  // The slice runs the first stage as stage 0 of the run. The driver is seeded with
  // the RUN seed (what a replay captures); the per-stage seed is mixed from it, so
  // chaining more stages later only changes the index. `buildSim` reads the stage from
  // `shell.def` FRESH each time (not a captured binding) so a hot-reload — which swaps
  // `shell.def` for the freshly-imported game and then resyncs — rebuilds with the new
  // code, AND a brand-new run (retry / return-to-title → start) picks it up too. The
  // sim is reassignable so backward-scrub / hot-reload / a new run can rebuild. (The
  // character is captured: editing the player config takes effect on the next fresh
  // run, not the live one — content scripts are what hot-reload live.)
  const STAGE_INDEX = 0;
  const buildSim = (runSeed: number): Simulation =>
    createStageSim(
      shell.def.stages[STAGE_INDEX]!,
      mixSeed(runSeed, STAGE_INDEX),
      character,
      difficulty,
      shell.def.config,
      DT,
    );
  let sim: Simulation = buildSim(def.seed);

  const driver: SimDriver = createSimDriver({
    dt: DT,
    seed: def.seed,
    sampleInput: (tick) => input.sample(tick),
    step: (frame) => sim.step(frame),
    rebuild: (seed) => {
      sim = buildSim(seed);
    },
  });

  // Reused scratch for the player-shot instance stream (the placeholder shot layer
  // reuses the bullet renderer's program — no separate shot shader). Sized to the
  // pool cap × the bullet instance stride.
  const shotInstances = new Float32Array(SHOT_CAPACITY * INSTANCE_FLOATS);
  // Reused scratch for the enemy instance stream (enemies reuse the bullet program
  // too — Option B, no separate shader). Sized to the pool cap × the instance stride.
  const enemyInstances = new Float32Array(ENEMY_CAPACITY * INSTANCE_FLOATS);
  // Reused scratch for the item instance stream (items reuse the bullet program too).
  const itemInstances = new Float32Array(ITEM_CAPACITY * INSTANCE_FLOATS);

  // Bound to its DOM element in `buildDom` (the element doesn't exist until enter,
  // which always runs before the first frame/render).
  let hud!: Hud;
  // Last replay save/load outcome, shown in the HUD. Screen-local — never enters
  // the sim or the recorded input log.
  let replayStatus = "";
  // Set once the run ends so we transition exactly once.
  let ended = false;

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
  let replayFile: HTMLInputElement;

  const downloadReplay = (): void => {
    const recording = driver.getRecording();
    // Wrap the current sim's recording as a one-segment per-run blob, stamped with the
    // run-parameters the sim was built at (rank + character) and a fingerprint of the
    // game's data, so a load can rebuild at the right rank and reject a stale build.
    const replay = serializeRunReplay({
      runSeed: recording.seed,
      difficulty,
      character: CHARACTER_INDEX,
      configId: computeConfigId(def),
      segments: [{ stageIndex: STAGE_INDEX, frames: recording.frames }],
    });
    // `as BlobPart`: the Uint8Array is a valid blob part at runtime; the cast
    // bridges TS's typed-array buffer generic to the DOM's ArrayBuffer.
    const blob = new Blob([replay as BlobPart], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    // Firefox won't fire a programmatic click on a detached anchor, and revoking
    // the URL synchronously can truncate the download — attach, click, defer revoke.
    const a = document.createElement("a");
    a.href = url;
    a.download = `higan-replay-${recording.frames.length}f.hreplay`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    replayStatus = `saved ${recording.frames.length} frames`;
  };

  const loadReplayFile = async (file: File): Promise<void> => {
    let replay;
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
    if (replay.character !== CHARACTER_INDEX) {
      replayStatus = `load failed: unsupported character ${replay.character}`;
      return;
    }
    if (replay.segments.length !== 1) {
      // Run-spanning (multi-segment) playback arrives with the RunController.
      replayStatus = `load failed: multi-segment replay (${replay.segments.length}) not yet supported`;
      return;
    }
    // Adopt the recorded rank IN PLACE: reassign the run's current rank, then load into
    // the existing driver — `loadRecording` rebuilds the sim (via `buildSim`, which reads
    // `difficulty`) at that rank and replays the segment to the end, paused. Done in place
    // rather than by swapping to a fresh screen: the Save/Load buttons live in the sidebar
    // and stay clickable while an overlay (e.g. the pause menu) sits on top of the in-game
    // screen, so a `router.replace` here would pop the OVERLAY and orphan the in-game
    // screen beneath — which keeps rendering its now-frozen player marker (a "phantom"
    // second player). Rebuilding this screen's own sim can't orphan anything.
    const seg = replay.segments[0]!;
    difficulty = replay.difficulty;
    driver.loadRecording({ seed: replay.runSeed, frames: seg.frames });
    replayStatus = `loaded ${seg.frames.length} frames — paused at end`;
  };

  const buildDom = (): void => {
    sidebar.innerHTML = `
      <div id="hud"></div>
      <div id="replay-controls">
        <button id="save-replay" type="button">⬇ Save replay</button>
        <button id="load-replay" type="button">⬆ Load replay…</button>
        <input id="replay-file" type="file" accept=".hreplay,application/octet-stream" hidden />
      </div>`;
    saveBtn = sidebar.querySelector("#save-replay")!;
    loadBtn = sidebar.querySelector("#load-replay")!;
    replayFile = sidebar.querySelector("#replay-file")!;
    // The HUD reads sim state every frame and keeps no counters of its own.
    hud = createHud(sidebar.querySelector("#hud")!);

    saveBtn.addEventListener("click", () => {
      downloadReplay();
      saveBtn.blur(); // so Space toggles pause again, not the button
    });
    loadBtn.addEventListener("click", () => {
      replayFile.click();
      loadBtn.blur();
    });
    replayFile.addEventListener("change", () => {
      const file = replayFile.files?.[0];
      if (file) void loadReplayFile(file);
      replayFile.value = ""; // reset so re-picking the same file fires `change` again
    });
  };

  const end = (outcome: RunOutcome): void => {
    ended = true;
    if (outcome === "gameover") {
      // Push (not replace) so the frozen death moment shows behind the prompt; the
      // continue choice then either rebuilds the run (carrying the continue count AND the
      // chosen difficulty — a continue keeps the run's rank) or falls through to results.
      shell.router.push(createContinueScreen(shell, continuesUsed, difficulty));
    } else {
      // Clear: hand the final score (read off the sim) to results. The game-over path
      // goes through the continue prompt instead and carries no score.
      shell.router.replace(createResultsScreen(shell, outcome, sim.player.score));
    }
  };

  return {
    enter(): void {
      input.flush();
      buildDom();
    },
    exit(): void {
      sidebar.innerHTML = "";
    },
    frame(dtSeconds: number): void {
      // Debugger controls drive the LOOP, not the sim — kept out of the input log
      // so they can never poison a replay.
      for (const code of input.takeEvents()) {
        if (code === "Escape") {
          // Flow-pause: hand control to the pause overlay. Return BEFORE advancing
          // the sim so no extra tick runs this frame and end-detection can't fire
          // into the just-pushed pause screen (which would corrupt the stack).
          shell.router.push(createPauseScreen(shell));
          return;
        }
        if (code === "Space") driver.togglePause();
        else if (code === "Period") driver.singleStep();
        else if (code === "Comma") driver.stepBack();
        else if (code in SPEEDS) driver.setSpeed(SPEEDS[code]!);
      }

      driver.frame(dtSeconds);

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
      playerMarker.x = player.x;
      playerMarker.y = player.y;
      hitboxMarker.x = player.x;
      hitboxMarker.y = player.y;

      // Player marker, blinked off on alternate windows while invulnerable; the
      // hitbox dot only while focus is held. Both cosmetic (out of sim/hash).
      const overlays: Overlay[] = [];
      const invulnBlink = player.invulnTicks > 0 && Math.floor(driver.tick / 4) % 2 === 1;
      if (!invulnBlink) overlays.push(playerMarker);
      if (player.focused) overlays.push(hitboxMarker);

      // Beams first (behind the bullet glow), then player shots (under everything for
      // readability), then enemies (the foes that fire the danmaku), then items (the
      // pickups they drop), then the bullets + overlays on top. All draw additively;
      // shots, enemies, and items reuse the bullet program via `drawInstances`, each
      // issued BEFORE the next draw overwrites the shared instance buffer. The canvas
      // is cleared by the shell before the stack renders.
      const beams = lasers.draw(sim.lasers.lasers);
      const shotCount = marshalShots(sim.shots.shots, shotInstances);
      bullets.drawInstances(shotInstances, shotCount);
      const enemyCount = marshalEnemies(sim.enemies.enemies, enemyInstances);
      bullets.drawInstances(enemyInstances, enemyCount);
      const itemCount = marshalItems(sim.items.items, itemInstances);
      bullets.drawInstances(itemInstances, itemCount);
      const drawn = bullets.draw(system.store, system.alive, system.highWater, overlays);
      hud.update(sim, driver, { beams, drawn, replayStatus });
    },
    hotReloadStage(): void {
      driver.resync();
    },
  };
}
