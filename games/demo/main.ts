// The reference game's bootstrap.
//
// Runs the continuous determinism guard against this game's content, then hands the
// definition to the engine shell. The guard runs on every (re)load so any
// nondeterminism regression trips immediately (Hard Rule 2). Hot-reload swaps in
// edited boss code, re-checks determinism against it, and resyncs the running stage
// if one is in progress.

import { runGame, wireContentHMR } from "../../src/app";
import { assertDeterministic } from "../../src/core/determinism";
import { assertStreamIsolation } from "../../src/core/isolation";
import { PATTERN_TICKS } from "../../src/core/sim";
import { mixSeed } from "../../src/core/prng";
import { DT } from "../../src/core/playfield";
import { demoGame } from "./game";
import { NORMAL } from "./difficulty";
import { showcaseStage } from "./patterns/showcase";
import type { InputFrame } from "../../src/core/input";
import type { GameDefinition, StageDef } from "../../src/api";

const SEED = demoGame.seed;
// The slice runs stage 0; its seed is mixed from the run seed exactly as the in-game
// screen mixes it, so the guard exercises the seed the live scene actually runs on.
const STAGE_SEED = mixSeed(SEED, 0);
const stage = demoGame.stages[0]!;
const character = demoGame.characters[0]!;

// The determinism run holds shoot and weaves, so it exercises the WHOLE live scene
// end to end: the opening enemy WAVES (spawn → bound enemy emitters → shot-vs-enemy
// collision → death/cull), the MIDBOSS (both phases), the stage RESUMING when the
// midboss falls + the post-midboss waves, then the final boss's four phases — opening
// plus the three spells, including the live-group-retarget and the beam-rake lasers —
// and finally the stage RETURNING (`stageComplete`). So the window covers the stage
// root + multi-emitter scheduler, child-spawn, retarget, lasers, the per-stream RNG,
// the player-shot pool + shot-vs-enemy/boss collision, AND the new sequential-boss
// machinery (the awaited `ctx.boss()`, the midboss→final-boss handoff, the
// encounter-end nulling, the stage-complete signal). NOTE: the weave doesn't centre on
// the bosses, so every phase TIMES OUT here rather than being HP-captured — fine, the
// determinism coverage of each is identical either way (both runPhase exits are
// deterministic), and the DEFEAT-then-continue path (killing a boss to resume) is
// proven separately. The scene now spans ~7770 ticks (midboss + waves precede the
// boss), so the window is sized past it. If boot/HMR feels slow, sample every Nth tick
// in the guard — coverage holds, cost drops.
const scripted: InputFrame[] = [];
const GUARD_TICKS = 8000;
for (let i = 0; i < GUARD_TICKS; i++) {
  scripted.push({
    dx: (i >> 3) % 2 ? 1 : -1,
    dy: 0,
    shoot: true,
    focus: i % 120 < 30,
    bomb: false,
  });
}

// Continuous determinism guard: same stage + seed + scripted input + character + rank,
// twice, must hash identically. The scripted input holds shoot, so player shots fire,
// damage the boss, and fold into the trajectory hash. The guard runs at NORMAL — the
// rank whose content evaluates to the baseline counts — so its hash is the unchanged
// reference (a different rank shapes a different, equally-reproducible trajectory).
const det = assertDeterministic(stage, STAGE_SEED, scripted, DT, character, NORMAL, demoGame.config);
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
assertDeterministic(showcaseStageDef, STAGE_SEED, showcaseScript, DT, character, NORMAL, demoGame.config);

// Engine-seam self-test (DEV only — dead-stripped from the production bundle, where
// a player can't introduce a stream-crossing bug): the boss's danmaku stream is
// isolated from the play-dependent enemy stream (F4). Distinct from the determinism
// guards above — those prove THIS game's scene reproduces; this proves a structural
// engine property with its own minimal fixtures, by running two input streams that
// kill different enemy counts and asserting the boss danmaku is bit-identical anyway.
// So an edit that crosses the boss/enemy RNG streams trips here during development.
if (import.meta.env.DEV) {
  const iso = assertStreamIsolation(STAGE_SEED, DT);
  console.info(
    `[higan] stream isolation OK — boss danmaku stable over ${iso.ticks} ticks while ` +
      `enemy-kill counts diverge (${iso.finalEnemiesShoot} vs ${iso.finalEnemiesQuiet})`,
  );
}

const app = runGame(demoGame);

// Hot-reload: accept the GAME ROOT (`./game`), not the individual pattern modules.
// Every piece of stage content — the stage/wave script, the boss, the midboss, the
// enemy AIs — is imported (directly or transitively) by `game.ts`, which is imported
// only here, so accepting `./game` bounds the single path and editing ANY content
// module hot-swaps; accepting a leaf module would leave the `game.ts` import path
// unbounded and force a full page reload (the engine's `wireContentHMR` header explains
// why). `wireContentHMR` packages the swap+resync; `verify` keeps the determinism
// tripwire (the game owns the seed/input/character it needs). The `accept(...)` literal
// stays here because Vite resolves the dep string from THIS module's source.
if (import.meta.hot) {
  import.meta.hot.accept(
    "./game",
    wireContentHMR({
      app,
      getDef: (mod) => (mod as { demoGame: GameDefinition }).demoGame,
      verify: (def) => assertDeterministic(def.stages[0]!, STAGE_SEED, scripted, DT, character, NORMAL, def.config),
    }),
  );
}
