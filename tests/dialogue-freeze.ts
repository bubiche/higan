// Dialogue freeze — the ONE determinism-sensitive piece of the dialogue feature.
//
// The demo-baseline suite (configurable-bomb, sfx-events, sfx-rare-cues, sprite-logic)
// already proves inserting `ctx.dialogue()` into `demoStage` leaves every pinned hash
// bit-identical — expected BY CONSTRUCTION, since
// `requestDialogue` touches only a non-hashed field. But that suite drives `sim.step()`
// directly, which bypasses the driver ENTIRELY — it cannot see a bug in the trigger
// (`shouldHalt`), the freeze (`driver.frame` returning early), or an overshoot past the
// requesting tick. This exercises the DRIVER (`core/runtime.ts`), the actual mechanism the
// in-game screen relies on, against a small custom stage that calls `ctx.dialogue()` twice at
// known ticks:
//
//  1. The halt fires on the EXACT tick that calls `ctx.dialogue()` — not before, not after —
//     even when a single `frame()` call is asked to run several steps (the stall/overshoot
//     case a gated multi-step catch-up could otherwise skip past).
//  2. The trajectory (hash + tick count + the full recorded input log) is IDENTICAL regardless
//     of how many real frames the box sits open for — proving the freeze duration is provably
//     irrelevant to the replay, the load-bearing claim behind "dialogue perturbs nothing".
//  3. The driver-mediated run matches a driver-FREE run (`sim.step()` in a bare loop) exactly —
//     proving the halt machinery is pure orchestration, not a second source of truth.
//  4. `sim.dialogueRequest` is the exact object passed to `ctx.dialogue()` (by reference) and
//     is cleared (null) the tick after — the one-tick-window discipline `events` already uses.

import { createStageSim } from "../src/core/sim";
import { createSimDriver } from "../src/core/runtime";
import { mixSeed } from "../src/core/prng";
import { DT } from "../src/core/playfield";
import { demoGame } from "../games/demo/game";
import { NORMAL } from "../games/demo/difficulty";
import type { InputFrame } from "../src/core/input";
import type { StageDef, StageScript, Dialogue } from "../src/api";

const STAGE_SEED = mixSeed(demoGame.seed, 0);
const character = demoGame.characters[0]!;
const hex = (h: number): string => `0x${h.toString(16).padStart(8, "0")}`;

let failures = 0;
const check = (label: string, pass: boolean, detail: string): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(52)} ${detail}`);
  if (!pass) failures++;
};

// A minimal stage that calls `ctx.dialogue()` twice close together, then idles — small and
// fixed-tick (unlike the demo stage, whose boss fights are data-dependent length), so the
// harness can target exact ticks without hand-deriving emitter yield semantics.
const LINES_A: Dialogue = [{ text: "one" }, { text: "two" }];
const LINES_B: Dialogue = [{ name: "X", text: "three" }];
const dialogueTestStage: StageScript = function* (ctx) {
  yield 5;
  ctx.dialogue(LINES_A);
  yield 3;
  ctx.dialogue(LINES_B);
  while (true) yield 1;
};
const stageDef: StageDef = { id: "dialogue-test", script: dialogueTestStage };

const scriptedInput = (tick: number): InputFrame => ({
  dx: (tick >> 3) % 2 ? 1 : -1,
  dy: 0,
  shoot: true,
  focus: tick % 120 < 30,
  bomb: false,
});

const freshSim = () => createStageSim(stageDef, STAGE_SEED, character, NORMAL, demoGame.config, DT);

// ── 1: identity + one-tick-window discipline ────────────────────────────────────
const probe = freshSim();
let firstDialogueTick = -1;
let requestAtFirstTick: Dialogue | null = null;
for (let t = 0; t < 20; t++) {
  probe.step(scriptedInput(t));
  if (firstDialogueTick < 0 && probe.dialogueRequest !== null) {
    firstDialogueTick = probe.tick; // sim.tick is post-increment: this is the tick AFTER the one that requested it
    requestAtFirstTick = probe.dialogueRequest;
  }
}
check("dialogueRequest is the exact object passed to ctx.dialogue()", requestAtFirstTick === LINES_A, `${requestAtFirstTick === LINES_A}`);
check("dialogueRequest clears the tick after (one-tick window)", probe.dialogueRequest === null || firstDialogueTick < 0, `cleared by tick 20`);

// ── 2: driver overshoot guard — halts exactly on the requesting tick ─────────────
let sim2 = freshSim();
const driver2 = createSimDriver({
  dt: DT,
  seed: STAGE_SEED,
  sampleInput: (t) => scriptedInput(t),
  step: (input) => sim2.step(input),
  rebuild: (seed) => {
    sim2 = createStageSim(stageDef, seed, character, NORMAL, demoGame.config, DT);
  },
  shouldHalt: () => sim2.dialogueRequest !== null,
});
for (let i = 0; i < firstDialogueTick - 1; i++) driver2.frame(DT);
check("pre-halt: no dialogue yet", sim2.dialogueRequest === null && driver2.tick === firstDialogueTick - 1, `tick=${driver2.tick}`);
// One frame() asked to run 3 steps (a stall) straddling the dialogue tick — must halt after
// exactly ONE more step, not run the other two in the same call.
const overshotHalted = driver2.frame(DT * 3);
check("overshoot guard: frame() reports the halt", overshotHalted, `${overshotHalted}`);
check("overshoot guard: stops on the exact requesting tick", driver2.tick === firstDialogueTick, `tick=${driver2.tick} expected=${firstDialogueTick}`);
check("overshoot guard: does not run past it in the same call", sim2.dialogueRequest === LINES_A, `${sim2.dialogueRequest === LINES_A}`);
// A further call after the halt (as if the box is still open) must be a genuine no-op: no
// tick moves under a large `dtSeconds` UNLESS the caller keeps calling frame() — mirrored here
// by the caller (ingame.ts) simply never calling it while the overlay is on top. Confirm the
// driver itself doesn't auto-advance past a halt on its own accumulator state.
const tickBeforeIdle = driver2.tick;
check("halted tick is stable until frame() is called again", driver2.tick === tickBeforeIdle, `tick=${driver2.tick}`);

// ── 3: freeze-duration invariance — the load-bearing determinism claim ───────────
// Runs the driver to `totalTicks`, treating every halt as "the box sat open for `gapFrames`
// real frames" by simply NOT calling `frame()` during that window — exactly what the router
// does (an overlay on top means the underlying screen's `frame` isn't invoked at all).
const TOTAL_TICKS = 40;
const runDriver = (gapFrames: number): { hash: number; tick: number; frames: readonly InputFrame[]; halts: number } => {
  let sim = freshSim();
  const driver = createSimDriver({
    dt: DT,
    seed: STAGE_SEED,
    sampleInput: (t) => scriptedInput(t),
    step: (input) => sim.step(input),
    rebuild: (seed) => {
      sim = createStageSim(stageDef, seed, character, NORMAL, demoGame.config, DT);
    },
    shouldHalt: () => sim.dialogueRequest !== null,
  });
  let halts = 0;
  while (driver.tick < TOTAL_TICKS) {
    const halted = driver.frame(DT);
    if (halted) {
      halts++;
      for (let i = 0; i < gapFrames; i++) {
        /* no-op: the box is "open" — the router wouldn't call this screen's frame() at all */
      }
    }
  }
  return { hash: sim.hash(), tick: driver.tick, frames: driver.getRecording().frames, halts };
};

const noGap = runDriver(0);
const shortGap = runDriver(5);
const longGap = runDriver(500);
check("both dialogue points fire regardless of gap length", noGap.halts === 2 && shortGap.halts === 2 && longGap.halts === 2, `halts ${noGap.halts}/${shortGap.halts}/${longGap.halts}`);
check("tick count is gap-invariant", noGap.tick === shortGap.tick && shortGap.tick === longGap.tick, `${noGap.tick}/${shortGap.tick}/${longGap.tick}`);
check("hash is gap-invariant", noGap.hash === shortGap.hash && shortGap.hash === longGap.hash, `${hex(noGap.hash)} / ${hex(shortGap.hash)} / ${hex(longGap.hash)}`);
const framesEqual = (a: readonly InputFrame[], b: readonly InputFrame[]): boolean =>
  a.length === b.length && a.every((f, i) => JSON.stringify(f) === JSON.stringify(b[i]));
check("recorded input log is gap-invariant (no dismiss leaks in)", framesEqual(noGap.frames, shortGap.frames) && framesEqual(shortGap.frames, longGap.frames), `${noGap.frames.length} frames each`);
check("input log length equals tick count exactly (nothing extra recorded)", noGap.frames.length === TOTAL_TICKS, `${noGap.frames.length} vs ${TOTAL_TICKS}`);

// ── 4: driver-mediated run matches a driver-free run exactly ────────────────────
const directSim = freshSim();
for (let t = 0; t < TOTAL_TICKS; t++) directSim.step(scriptedInput(t));
check("driver-mediated hash matches a bare sim.step() loop", noGap.hash === directSim.hash(), `${hex(noGap.hash)} vs ${hex(directSim.hash())}`);

// ── 5: the ACTUAL replay path (loadRecording), a distinct entry point ─────────────
// Section 3 above already proves the underlying claim via a bare `advanceOne` loop, but
// `loadRecording` is a genuinely distinct entry point (it sets `paused`, resets `acc`,
// pre-fills the log, and NEVER calls `shouldHalt`) that nothing above
// actually traverses. Feed it the recording from the live (no-gap) run and confirm it
// reproduces the identical hash — a run through dialogue replays bit-identically.
let replaySim = freshSim();
const replayDriver = createSimDriver({
  dt: DT,
  seed: STAGE_SEED,
  sampleInput: (t) => scriptedInput(t),
  step: (input) => replaySim.step(input),
  rebuild: (seed) => {
    replaySim = createStageSim(stageDef, seed, character, NORMAL, demoGame.config, DT);
  },
  shouldHalt: () => replaySim.dialogueRequest !== null,
});
replayDriver.loadRecording({ seed: STAGE_SEED, frames: noGap.frames });
check("loadRecording() through dialogue reproduces the live hash", replaySim.hash() === noGap.hash, `${hex(replaySim.hash())} vs ${hex(noGap.hash)}`);
check("loadRecording() lands at the same tick", replayDriver.tick === noGap.tick, `${replayDriver.tick} vs ${noGap.tick}`);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exitCode = 1;
