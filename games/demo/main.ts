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
import { DT } from "../../src/core/playfield";
import { demoGame } from "./game";
import { SHOWCASE } from "./patterns/showcase";
import type { InputFrame } from "../../src/core/input";
import type { BossScript } from "../../src/api";

const SEED = demoGame.seed;
const boss = demoGame.stages[0]!.boss!;

// The determinism run holds shoot and weaves so it drains HP and spans the boss's
// phases (including the retarget spell) — exercising the multi-emitter scheduler,
// child-spawn, and retarget, the machinery the guard most needs to cover.
const scripted: InputFrame[] = [];
const GUARD_TICKS = 1300;
for (let i = 0; i < GUARD_TICKS; i++) {
  scripted.push({
    dx: (i >> 3) % 2 ? 1 : -1,
    dy: 0,
    shoot: true,
    focus: i % 120 < 30,
    bomb: false,
  });
}

// Continuous determinism guard: same seed + scripted input + boss, twice, must hash
// identically.
const det = assertDeterministic(SEED, scripted, DT, [], boss);
console.info(
  `[higan] determinism OK (boss) — hash 0x${det.hashA.toString(16).padStart(8, "0")} over ${det.ticks} ticks`,
);

// The boss exercises linear/accelerate/home/curve/lasers but not wave, delay, or
// ramp's speed-change leg — so a second guard runs the full showcase pattern set to
// keep those update-loop branches under the continuous determinism net.
const showcaseScript: InputFrame[] = [];
for (let i = 0; i < PATTERN_TICKS * (SHOWCASE.length + 2); i++) {
  showcaseScript.push({
    dx: ((i >> 4) % 3) - 1,
    dy: ((i >> 5) % 3) - 1,
    shoot: (i & 8) !== 0,
    focus: i % 120 < 30,
    bomb: false,
  });
}
assertDeterministic(SEED, showcaseScript, DT, SHOWCASE);

const app = runGame(demoGame);

// Hot-reload: when the boss module is edited, re-check determinism against the new
// code (the purity invariant's edit-time tripwire), then resync the in-progress
// stage so the scene continues with the new code. (A run started later re-reads the
// definition's boss; this swaps the live one.)
if (import.meta.hot) {
  import.meta.hot.accept("./patterns/boss", (mod) => {
    if (!mod) return;
    const newBoss = (mod as unknown as { DEMO_BOSS: BossScript }).DEMO_BOSS;
    assertDeterministic(SEED, scripted, DT, [], newBoss);
    asInGame(app.router.top)?.hotReloadBoss(newBoss);
    console.info("[higan] boss hot-reloaded");
  });
}
