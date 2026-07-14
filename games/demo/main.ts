// The reference game's bootstrap.
//
// In development it runs the continuous determinism guard against this game's content,
// then hands the definition to the engine shell. The guard runs on every dev (re)load
// so any nondeterminism regression trips immediately (Hard Rule 2). Hot-reload swaps in
// edited boss code, re-checks determinism against it, and resyncs the running stage if
// one is in progress. The guard + self-tests are DEV-only (`import.meta.env.DEV`): they
// dead-strip from the production bundle, where a player can't introduce nondeterminism
// and the double-sim would only stall boot — so the deployed demo opens straight into
// the title screen.
//
// Imports go through the public `higan*` package surface (the same names an external
// game would use once the engine is published), never deep `../../src/...` paths:
//   higan          — authoring API + core constants/types
//   higan/app      — the app shell this bootstrap runs over
//   higan/testing  — the determinism self-test harness (dev-only here)

import { runGame, wireContentHMR } from "higan/app";
import { assertDeterministic, assertStreamIsolation, PATTERN_TICKS, mixSeed } from "higan/testing";
import { DT, PLAYFIELD_H } from "higan";
import { demoGame } from "./game";
import { NORMAL } from "./difficulty";
import { showcaseStage, stagedPattern } from "./showcase";
import type { InputFrame, GameDefinition, StageDef } from "higan";

const SEED = demoGame.seed;
// The slice runs stage 0; its seed is mixed from the run seed exactly as the in-game
// screen mixes it, so the guard exercises the seed the live scene actually runs on.
const STAGE_SEED = mixSeed(SEED, 0);
const character = demoGame.characters[0]!;

// Scripted input shared by the determinism guard and the HMR re-verify below. Populated
// only in DEV (both are dev-only); stays empty in the production bundle.
const scripted: InputFrame[] = [];

// Continuous determinism guard + engine self-tests — DEV only (dead-stripped from
// production). Same stage + seed + scripted input + character + rank, twice, must hash
// identically. The scripted input holds shoot, so player shots fire, damage the boss,
// and fold into the trajectory hash. The guard runs at NORMAL — the rank whose content
// evaluates to the baseline counts — so its hash is the unchanged reference (a different
// rank shapes a different, equally-reproducible trajectory).
if (import.meta.env.DEV) {
  const stage = demoGame.stages[0]!;

  // The determinism run holds shoot and weaves, so it exercises the WHOLE live scene
  // end to end: the opening enemy WAVES (spawn → bound enemy emitters → shot-vs-enemy
  // collision → death/cull), the MIDBOSS (both phases), the stage RESUMING when the
  // midboss falls + the post-midboss waves, then the final boss's four phases — opening
  // plus the three spells, including the live-group-retarget and the beam-rake lasers —
  // and finally the stage RETURNING (`stageComplete`). So the window covers the stage
  // root + multi-emitter scheduler, child-spawn, retarget, lasers, the per-stream RNG,
  // the player-shot pool + shot-vs-enemy/boss collision, AND the sequential-boss
  // machinery (the awaited `ctx.boss()`, the midboss→final-boss handoff, the
  // encounter-end nulling, the stage-complete signal). NOTE: the weave doesn't centre on
  // the bosses, so every phase TIMES OUT here rather than being HP-captured — fine, the
  // determinism coverage of each is identical either way (both runPhase exits are
  // deterministic), and the DEFEAT-then-continue path (killing a boss to resume) is
  // proven separately. The scene spans ~8370 ticks (midboss + waves precede the boss, and
  // the boss now includes a 600-tick endurance/survival phase that always runs full), so the
  // window is sized past it to keep the stage-RETURN (`stageComplete`) tail under the net.
  const GUARD_TICKS = 8600;
  for (let i = 0; i < GUARD_TICKS; i++) {
    scripted.push({
      dx: (i >> 3) % 2 ? 1 : -1,
      dy: 0,
      shoot: true,
      focus: i % 120 < 30,
      bomb: false,
    });
  }
  const det = assertDeterministic(stage, STAGE_SEED, scripted, DT, character, NORMAL, demoGame.config);
  console.info(
    `[higan] determinism OK (stage ${stage.id}) — hash 0x${det.hashA
      .toString(16)
      .padStart(8, "0")} over ${det.ticks} ticks`,
  );

  // A reference game keeps EVERY campaign stage under the continuous net, not just the
  // first — so Stage 2's scene (its own waves, midboss, boss, and the new ramp/wave
  // behaviours it uses) is guarded too. The same scripted input serves: it need only run
  // deterministically, not clear anything. The per-stage seed mixes in the stage index,
  // exactly as the in-game screen derives it (`mixSeed(runSeed, stageIndex)`).
  const stage2 = demoGame.stages[1]!;
  const STAGE2_SEED = mixSeed(SEED, 1);
  const det2 = assertDeterministic(stage2, STAGE2_SEED, scripted, DT, character, NORMAL, demoGame.config);
  console.info(
    `[higan] determinism OK (stage ${stage2.id}) — hash 0x${det2.hashA
      .toString(16)
      .padStart(8, "0")} over ${det2.ticks} ticks`,
  );

  // Stage 3 (the final stage) joins the continuous net too — its own waves, its two-phase
  // midboss, and the MOVING Nocturne Sovereign (which uses `delay` and glides between phases,
  // branches the earlier stages don't). The 8000-tick window times phases out rather than
  // capturing (the weave doesn't centre on the boss), but it reaches through the prelude, the
  // `delay` meteor curtain, and the `ramp` gravity-well — enough to guard the novel branches;
  // the run-twice hash covers the whole window regardless of how far into the scene it gets.
  // (Boot/HMR now run three full-scene legs; revisit if the chain grows much longer.)
  const stage3 = demoGame.stages[2]!;
  const STAGE3_SEED = mixSeed(SEED, 2);
  const det3 = assertDeterministic(stage3, STAGE3_SEED, scripted, DT, character, NORMAL, demoGame.config);
  console.info(
    `[higan] determinism OK (stage ${stage3.id}) — hash 0x${det3.hashA
      .toString(16)
      .padStart(8, "0")} over ${det3.ticks} ticks`,
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

  // Every window above holds `bomb:false`, so the bomb path — the configurable field clear
  // (radial bullet-cancel, laser nuke, item vacuum, boss damage) and the rising-edge bomb
  // detect — would otherwise be unhashed-untested. A short window over the SECOND character
  // (whose bomb is the offensive radial one) presses bomb on a rising edge every 300 ticks so
  // those branches run under the continuous determinism net (A==B trips on any nondeterminism
  // the moment it creeps in). It fires during the opening waves — enough to cover the radial
  // cancel + laser-clear + item-vacuum + the boss-damage branch CONDITION; the boss-damage
  // actually LANDING and the exact-hash baseline are left to the headless verify, which can
  // afford the long boss-reaching window. Kept short so boot/HMR stays cheap.
  const bombChar = demoGame.characters[1]!;
  const bombScripted: InputFrame[] = [];
  for (let i = 0; i < 1500; i++) {
    bombScripted.push({
      dx: (i >> 4) % 2 ? 1 : -1,
      dy: (i >> 5) % 2 ? 1 : -1,
      shoot: true,
      focus: i % 90 < 40,
      bomb: i % 300 < 8, // held 8 ticks every 300 → a rising edge each window, so bombs deploy
    });
  }
  const bombDet = assertDeterministic(stage, STAGE_SEED, bombScripted, DT, bombChar, NORMAL, demoGame.config);
  console.info(
    `[higan] bomb-path determinism OK (${bombChar.id}) — hash 0x${bombDet.hashA
      .toString(16)
      .padStart(8, "0")} over ${bombDet.ticks} ticks`,
  );

  // Every window above runs the FIRST or SECOND character, so the homing shot stream
  // (the THIRD character's distinguishing behaviour — tracking amulets mixed with a
  // straight needle, nearest-target steering toward live enemies/boss) would otherwise
  // be unhashed-untested. A short window toggling focus exercises both branches: unfocus
  // (amulets + weak needle, the new steering math) and focus (amulets drop out, the
  // needle switches to `focusDamage`) — under the continuous determinism net, same as
  // the bomb path above.
  const homingChar = demoGame.characters[2]!;
  const homingScripted: InputFrame[] = [];
  for (let i = 0; i < 1500; i++) {
    homingScripted.push({
      dx: (i >> 5) % 2 ? 1 : -1,
      dy: (i >> 6) % 2 ? 1 : -1,
      shoot: true,
      focus: i % 100 < 50,
      bomb: false,
    });
  }
  const homingDet = assertDeterministic(stage, STAGE_SEED, homingScripted, DT, homingChar, NORMAL, demoGame.config);
  console.info(
    `[higan] homing-shot determinism OK (${homingChar.id}) — hash 0x${homingDet.hashA
      .toString(16)
      .padStart(8, "0")} over ${homingDet.ticks} ticks`,
  );

  // Engine-seam self-test: the boss's danmaku stream is isolated from the play-dependent
  // enemy stream (F4). Distinct from the determinism guards above — those prove THIS
  // game's scene reproduces; this proves a structural engine property with its own
  // minimal fixtures, by running two input streams that kill different enemy counts and
  // asserting the boss danmaku is bit-identical anyway. So an edit that crosses the
  // boss/enemy RNG streams trips here during development.
  const iso = assertStreamIsolation(STAGE_SEED, DT);
  console.info(
    `[higan] stream isolation OK — boss danmaku stable over ${iso.ticks} ticks while ` +
      `enemy-kill counts diverge (${iso.finalEnemiesShoot} vs ${iso.finalEnemiesQuiet})`,
  );
}

// DEV-only pattern preview. The showcase guard stage overflows the store by design and
// never renders, so normal play offers no way to *see* an individual pattern. With
// `?preview=staged` in the URL, run a store-safe solo scene of the staged combinator
// (fired from the upper field so the full ring reads) — the live eyeball for the staged
// combinator. Throwaway and DEV-gated (dead-stripped from production); it touches neither
// the playable stage nor any determinism baseline.
const previewMode =
  import.meta.env.DEV && new URLSearchParams(location.search).get("preview") === "staged";
const previewGame: GameDefinition = {
  ...demoGame,
  stages: [
    {
      id: "staged-preview",
      script: function* (ctx) {
        ctx.y = PLAYFIELD_H * 0.28; // fire from upper-center, not the very top edge
        ctx.sub(stagedPattern);
        yield 1_000_000;
      },
    },
  ],
};

const app = runGame(previewMode ? previewGame : demoGame);

// Hot-reload: accept the GAME ROOT (`./game`), not the individual pattern modules.
// Every piece of stage content — the stage/wave script, the boss, the midboss, the
// enemy AIs — is imported (directly or transitively) by `game.ts`, which is imported
// only here, so accepting `./game` bounds the single path and editing ANY content
// module hot-swaps; accepting a leaf module would leave the `game.ts` import path
// unbounded and force a full page reload (the engine's `wireContentHMR` header explains
// why). `wireContentHMR` packages the swap+resync; `verify` keeps the determinism
// tripwire (the game owns the seed/input/character it needs). The `accept(...)` literal
// stays here because Vite resolves the dep string from THIS module's source. DEV-only by
// construction — `import.meta.hot` is undefined in the production build.
if (!previewMode && import.meta.hot) {
  import.meta.hot.accept(
    "./game",
    wireContentHMR({
      app,
      getDef: (mod) => (mod as { demoGame: GameDefinition }).demoGame,
      verify: (def) => {
        // Re-verify EVERY main-campaign stage on each hot-edit, so a nondeterminism slip in
        // any stage's content trips before the swap commits — not just Stage 1's.
        assertDeterministic(def.stages[0]!, STAGE_SEED, scripted, DT, character, NORMAL, def.config);
        assertDeterministic(def.stages[1]!, mixSeed(SEED, 1), scripted, DT, character, NORMAL, def.config);
        assertDeterministic(def.stages[2]!, mixSeed(SEED, 2), scripted, DT, character, NORMAL, def.config);
      },
    }),
  );
}
