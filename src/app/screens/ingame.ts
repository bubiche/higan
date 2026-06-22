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
import { createHud, type Hud } from "../hud";
import { createSimulation, type Simulation } from "../../core/sim";
import { createSimDriver, type SimDriver } from "../../core/runtime";
import { DT } from "../../core/playfield";
import { PlayerState } from "../../touhou/player";
import { serializeReplay, deserializeReplay } from "../../touhou/replay";
import { Shape } from "../../render/shapes";
import type { Overlay } from "../../render/bullets";
import type { BossScript } from "../../api/boss";

/** Speeds the number keys cycle through (debugger slow-mo). */
const SPEEDS: Record<string, number> = { Digit1: 0.25, Digit2: 0.5, Digit3: 1 };

/** The in-game screen exposes a boss hot-reload hook for dev HMR. */
export interface InGameScreen extends Screen {
  /** Swap the running boss script and replay to the current tick (HMR). */
  hotReloadBoss(boss: BossScript): void;
}

/** Narrow a screen to the in-game screen if it is one (used by dev HMR). */
export function asInGame(screen: Screen): InGameScreen | null {
  return typeof (screen as Partial<InGameScreen>).hotReloadBoss === "function"
    ? (screen as InGameScreen)
    : null;
}

export function createInGameScreen(shell: Shell): InGameScreen {
  const { sidebar, input, bullets, lasers, def } = shell;
  const stage = def.stages[0]!;
  const character = def.characters[0]!;
  const patterns = stage.patterns ?? [];
  // Reassignable so a backward-scrub / hot-reload can rebuild from the seed; the
  // driver's `step`/`rebuild` close over these bindings.
  let boss = stage.boss;
  let sim: Simulation = createSimulation(def.seed, DT, patterns, character.config, boss);

  const driver: SimDriver = createSimDriver({
    dt: DT,
    seed: def.seed,
    sampleInput: (tick) => input.sample(tick),
    step: (frame) => sim.step(frame),
    rebuild: (seed) => {
      sim = createSimulation(seed, DT, patterns, character.config, boss);
    },
  });

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
    const replay = driver.getRecording();
    // `as BlobPart`: the Uint8Array is a valid blob part at runtime; the cast
    // bridges TS's typed-array buffer generic to the DOM's ArrayBuffer.
    const blob = new Blob([serializeReplay(replay) as BlobPart], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    // Firefox won't fire a programmatic click on a detached anchor, and revoking
    // the URL synchronously can truncate the download — attach, click, defer revoke.
    const a = document.createElement("a");
    a.href = url;
    a.download = `higan-replay-${replay.frames.length}f.hreplay`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    replayStatus = `saved ${replay.frames.length} frames`;
  };

  const loadReplayFile = async (file: File): Promise<void> => {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const replay = deserializeReplay(bytes);
      driver.loadRecording(replay);
      replayStatus = `loaded ${replay.frames.length} frames — paused at end`;
    } catch (err) {
      replayStatus = `load failed: ${err instanceof Error ? err.message : String(err)}`;
    }
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
    shell.router.replace(createResultsScreen(shell, outcome));
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
        if (code === "Space") driver.togglePause();
        else if (code === "Period") driver.singleStep();
        else if (code === "Comma") driver.stepBack();
        else if (code in SPEEDS) driver.setSpeed(SPEEDS[code]!);
      }

      driver.frame(dtSeconds);

      // Transition only during live play — never while paused/stepping/scrubbing or
      // sitting at the end of a loaded replay, so the debugger can inspect an ended
      // run without being bounced to results.
      if (!ended && !driver.paused) {
        if (sim.boss?.defeated) end("clear");
        else if (sim.player.state === PlayerState.GameOver) end("gameover");
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

      // Beams first (behind the bullet glow); both draw additively. The canvas is
      // cleared by the shell before the stack renders.
      const beams = lasers.draw(sim.lasers.lasers);
      const drawn = bullets.draw(system.store, system.alive, system.highWater, overlays);
      hud.update(sim, driver, { beams, drawn, replayStatus });
    },
    hotReloadBoss(newBoss: BossScript): void {
      boss = newBoss;
      driver.resync();
    },
  };
}
