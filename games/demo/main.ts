// The reference game's bootstrap.
//
// Runs the continuous determinism guard against this game's content, then hands the
// definition to the engine shell. The guard runs on every (re)load so any
// nondeterminism regression trips immediately (Hard Rule 2). Hot-reload swaps in
// edited boss code, re-checks determinism against it, and resyncs the running stage
// if one is in progress.

import { runGame, asInGame } from "../../src/app";
import { assertDeterministic } from "../../src/core/determinism";
import { PATTERN_TICKS } from "../../src/core/sim";
import { mixSeed } from "../../src/core/prng";
import { DT } from "../../src/core/playfield";
import { demoGame } from "./game";
import { showcaseStage } from "./patterns/stage";
import type { InputFrame } from "../../src/core/input";
import type { BossScript, StageDef } from "../../src/api";

const SEED = demoGame.seed;
// The slice runs stage 0; its seed is mixed from the run seed exactly as the in-game
// screen mixes it, so the guard exercises the seed the live scene actually runs on.
const STAGE_SEED = mixSeed(SEED, 0);
const stage = demoGame.stages[0]!;
const character = demoGame.characters[0]!;

// The determinism run holds shoot and weaves so player shots drain the boss's HP and
// the window spans all four phases — the opening plus the three spells, including the
// live-group-retarget (phase 2) and the beam-rake lasers (phase 3) — exercising the
// stage root + multi-emitter scheduler, child-spawn, retarget, lasers, the per-stream
// RNG, AND the player-shot pool + shot-vs-boss collision, the machinery the guard most
// needs to cover. (Shot-driven damage is slower than the old position-independent
// stub, so the window is longer.)
const scripted: InputFrame[] = [];
const GUARD_TICKS = 2600;
for (let i = 0; i < GUARD_TICKS; i++) {
  scripted.push({
    dx: (i >> 3) % 2 ? 1 : -1,
    dy: 0,
    shoot: true,
    focus: i % 120 < 30,
    bomb: false,
  });
}

// Continuous determinism guard: same stage + seed + scripted input + character,
// twice, must hash identically. The scripted input holds shoot, so player shots fire,
// damage the boss, and fold into the trajectory hash.
const det = assertDeterministic(stage, STAGE_SEED, scripted, DT, character);
console.info(
  `[higan] determinism OK (stage ${stage.id}) — hash 0x${det.hashA
    .toString(16)
    .padStart(8, "0")} over ${det.ticks} ticks`,
);

// The boss exercises linear/accelerate/home/curve/lasers but not wave, delay, or
// ramp's speed-change leg — so a second guard runs the full showcase pattern set
// (as a guard-only stage that subs every showcase emitter) to keep those update-loop
// branches under the continuous determinism net.
const showcaseStageDef: StageDef = { id: "showcase", script: showcaseStage };
const showcaseScript: InputFrame[] = [];
for (let i = 0; i < PATTERN_TICKS * 13; i++) {
  showcaseScript.push({
    dx: ((i >> 4) % 3) - 1,
    dy: ((i >> 5) % 3) - 1,
    shoot: (i & 8) !== 0,
    focus: i % 120 < 30,
    bomb: false,
  });
}
assertDeterministic(showcaseStageDef, STAGE_SEED, showcaseScript, DT, character);

const app = runGame(demoGame);

// Hot-reload: when the boss module is edited, re-check determinism against the new
// code (the purity invariant's edit-time tripwire), then resync the in-progress
// stage so the scene continues with the new code. (A run started later re-reads the
// definition's boss; this swaps the live one.) General stage-script HMR (hot-editing
// the wave script itself) lands with the enemy/wave content.
if (import.meta.hot) {
  import.meta.hot.accept("./patterns/boss", (mod) => {
    if (!mod) return;
    const newBoss = (mod as unknown as { DEMO_BOSS: BossScript }).DEMO_BOSS;
    assertDeterministic({ ...stage, boss: newBoss }, STAGE_SEED, scripted, DT, character);
    asInGame(app.router.top)?.hotReloadBoss(newBoss);
    console.info("[higan] boss hot-reloaded");
  });
}
