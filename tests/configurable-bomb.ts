// Configurable-bomb verification — bomb as an author-configurable primitive (+ a second character).
//
// Proves headlessly (the char-select screen + the in-game look are the live-only pieces):
//  1. Char 0 is byte-identical: the demo stage hash at NORMAL still equals the pre-feature
//     baseline (0x456669b5), and the showcase still equals 0xb8ed8a1d — so adding the
//     configurable bomb + a second character was a no-op for the existing character (its
//     bomb defaults to the old full-screen clear, radius 0 → the unchanged bulk path).
//  2. The bomb path is deterministic: each character is independently reproducible (A==B)
//     under a bomb-PRESSING window (every prior guard held bomb:false, so the field-clear +
//     boss-damage + edge-detect branches were unhashed-untested before this), and the
//     offensive-bomb character's bomb-window hash is pinned to a baseline.
//  3. THE LITMUS — the bomb's marginal effect is real AND differs by character. Measured by
//     ISOLATING the bomb: for each character, bomb-pressed minus bomb-not-pressed (same
//     seed/input/position) cancels the shot's contribution, leaving only the bomb. Run in a
//     controlled fixture (a parked player, a high-HP boss firing a steady ring) so no death
//     cascade muddies the delta — exactly why a green "char0 vs char1 differ" on the real
//     stage would be MEANINGLESS (their shots already diverge the hash without any bomb).
//       - Spread (char 0): full-screen clear, 0 boss damage → ΔbossHP == 0, clears EVERY bullet.
//       - Focus  (char 1): radial clear + boss damage → ΔbossHP < 0, clears only a radial subset.

import { assertDeterministic, checkDeterministic } from "../src/core/determinism";
import { createStageSim } from "../src/core/sim";
import { mixSeed } from "../src/core/prng";
import { DT } from "../src/core/playfield";
import { PlayerState } from "../src/touhou/player";
import { serializeRunReplay, deserializeRunReplay, type RunReplay } from "../src/touhou/replay";
import { computeConfigId } from "../src/app/replay-compat";
import { demoGame } from "../games/demo/game";
import { NORMAL } from "../games/demo/difficulty";
import { showcaseStage } from "../games/demo/showcase";
import { Shape } from "../src/api";
import type { InputFrame } from "../src/core/input";
import type { StageDef, StageScript, BossScript, EmitterScript } from "../src/api";

// Baselines bumped for the homing player-shot feature (see difficulty-scaling.ts for why).
const BASELINE_STAGE = 0x3dcb45ae; // re-pinned 2026-07-14: stage-1 boss gained the survival phase after the prior pin
const BASELINE_SHOWCASE = 0x59525dd8; // re-pinned 2026-07-14: showcase gained the ember pattern after the prior pin
const BASELINE_BOMB = 0x7af9c296; // char-1 bomb-pressing window over the demo stage (re-pinned 2026-07-14: stage-1 survival phase)

const STAGE_SEED = mixSeed(demoGame.seed, 0);
const stage = demoGame.stages[0]!;
const charSpread = demoGame.characters[0]!; // default defensive bomb (omitted → DEFAULT_BOMB_CONFIG)
const charFocus = demoGame.characters[1]!; // explicit offensive radial bomb
const hex = (h: number): string => `0x${h.toString(16).padStart(8, "0")}`;

let failures = 0;
const check = (label: string, pass: boolean, detail: string): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(38)} ${detail}`);
  if (!pass) failures++;
};

// ── 1: char 0 byte-identical (the no-bomb baselines hold) ───────────────────────
// The exact windows main.ts / difficulty-scaling run, so the hashes are directly comparable.
const noBomb: InputFrame[] = [];
for (let i = 0; i < 8000; i++) {
  noBomb.push({ dx: (i >> 3) % 2 ? 1 : -1, dy: 0, shoot: true, focus: i % 120 < 30, bomb: false });
}
const spreadStage = checkDeterministic(stage, STAGE_SEED, noBomb, DT, charSpread, NORMAL, demoGame.config);
check("char 0 reproducible (no bomb)", spreadStage.ok, `${hex(spreadStage.hashA)} (${spreadStage.ticks}t)`);
check("char 0 anchors to stage baseline", spreadStage.hashA === BASELINE_STAGE, `${hex(spreadStage.hashA)} vs ${hex(BASELINE_STAGE)}`);

const showcaseStageDef: StageDef = { id: "showcase", script: showcaseStage };
const showcaseScript: InputFrame[] = [];
for (let i = 0; i < 150 * 13; i++) {
  showcaseScript.push({ dx: ((i >> 4) % 3) - 1, dy: ((i >> 5) % 3) - 1, shoot: (i & 8) !== 0, focus: i % 120 < 30, bomb: false });
}
const showcase = assertDeterministic(showcaseStageDef, STAGE_SEED, showcaseScript, DT, charSpread, NORMAL, demoGame.config);
check("showcase anchors to baseline", showcase.hashA === BASELINE_SHOWCASE, `${hex(showcase.hashA)} vs ${hex(BASELINE_SHOWCASE)}`);

// ── 2: the bomb path is deterministic (A==B), and the offensive bomb's hash is pinned ──
// A long window that holds shoot + moves + presses bomb on a rising edge every 400 ticks,
// so it reaches the real boss and the bomb LANDS (boss damage applies to a live phase).
const bombLong: InputFrame[] = [];
for (let i = 0; i < 8000; i++) {
  bombLong.push({ dx: (i >> 3) % 2 ? 1 : -1, dy: (i >> 6) % 2 ? 1 : -1, shoot: true, focus: i % 120 < 30, bomb: i % 400 < 6 });
}
const spreadBomb = checkDeterministic(stage, STAGE_SEED, bombLong, DT, charSpread, NORMAL, demoGame.config);
const focusBomb = checkDeterministic(stage, STAGE_SEED, bombLong, DT, charFocus, NORMAL, demoGame.config);
check("char 0 reproducible (bomb pressed)", spreadBomb.ok, `${hex(spreadBomb.hashA)} (${spreadBomb.ticks}t)`);
check("char 1 reproducible (bomb pressed)", focusBomb.ok, `${hex(focusBomb.hashA)} (${focusBomb.ticks}t)`);
check("char 1 bomb-window anchors to baseline", focusBomb.hashA === BASELINE_BOMB, `${hex(focusBomb.hashA)} vs ${hex(BASELINE_BOMB)}`);
// A bomb-pressing window must differ from the same window with bombs withheld — else the
// bomb path isn't actually being exercised (a tripwire against a no-op press).
const focusNoBomb = checkDeterministic(stage, STAGE_SEED, noBomb, DT, charFocus, NORMAL, demoGame.config).hashA;
check("bomb presses change the trajectory", focusBomb.hashA !== focusNoBomb, `${hex(focusBomb.hashA)} != ${hex(focusNoBomb)}`);

// ── 2b: replay round-trips + adopts the recorded character ──────────────────────
// The adopt-on-load path (ingame.ts) replaced a safety REJECT with adopt-in-place, so a bug
// there is now SILENT wrong-character playback — worse than the old reject. This gives it
// headless teeth short of the DOM: build a char-1 run replay, round-trip it through the binary
// format, and confirm (a) the character survives the round-trip, (b) its configId matches the
// current build — so a load WON'T reject (the old character-reject is correctly gone, since
// configId already guards the character set), and (c) rebuilding as the RECORDED character
// reproduces the char-1 bomb-window trajectory EXACTLY. The only bit left to the live check is
// the 3-line `run.character = replay.character` mutation that drives this rebuild in the screen.
const recorded: RunReplay = {
  runSeed: demoGame.seed,
  difficulty: NORMAL,
  character: 1,
  configId: computeConfigId(demoGame),
  segments: [{ stageIndex: 0, frames: bombLong }],
};
const roundTrip = deserializeRunReplay(serializeRunReplay(recorded));
check("replay round-trips character", roundTrip.character === 1, `character ${roundTrip.character}`);
check("replay configId matches build (no reject)", roundTrip.configId === computeConfigId(demoGame), `${hex(roundTrip.configId)} vs ${hex(computeConfigId(demoGame))}`);
const adopted = checkDeterministic(
  stage,
  mixSeed(roundTrip.runSeed, roundTrip.segments[0]!.stageIndex),
  roundTrip.segments[0]!.frames,
  DT,
  demoGame.characters[roundTrip.character]!,
  roundTrip.difficulty,
  demoGame.config,
);
check("rebuild as recorded character reproduces", adopted.hashA === BASELINE_BOMB, `${hex(adopted.hashA)} vs ${hex(BASELINE_BOMB)}`);

// ── 3: THE LITMUS — isolate the bomb's marginal effect, per character ────────────
// Controlled fixture: a parked player (the bottom-centre start) and a high-HP boss firing a
// steady ring from the top. No shooting (so boss HP moves ONLY by the bomb), and the sample
// tick is early enough that no bullet has reached the parked player — so neither run dies and
// the pressed−unpressed delta is purely the bomb's doing.
const litmusBody: EmitterScript = function* (ctx) {
  while (true) {
    ctx.ring({ count: 32, speed: 95, angle: ctx.tick * 0.07, radius: 4, color: [1, 1, 1], sprite: Shape.Orb });
    yield 4;
  }
};
const litmusBoss: BossScript = function* (b) {
  // HP + time limit far past the sample window, so the phase never ends (no end-of-phase
  // clear) and the bomb's 300 damage is a clean, readable dent.
  yield* b.phase({ name: "litmus", hp: 1_000_000, timeLimit: 1_000_000 }, litmusBody);
};
const litmusStageScript: StageScript = function* (ctx) {
  yield* ctx.boss(litmusBoss);
};
const litmusStage: StageDef = { id: "litmus", script: litmusStageScript };

const BOMB_TICK = 120; // press well before any bullet reaches the parked player
const SAMPLE_TICK = 130;
interface LitmusSample {
  bossHP: number;
  liveBullets: number;
  alive: boolean;
}
const litmusRun = (character: typeof charSpread, pressBomb: boolean): LitmusSample => {
  const sim = createStageSim(litmusStage, STAGE_SEED, character, NORMAL, demoGame.config, DT);
  for (let i = 0; i <= SAMPLE_TICK; i++) {
    const bomb = pressBomb && i >= BOMB_TICK && i < BOMB_TICK + 5; // one rising edge at BOMB_TICK
    sim.step({ dx: 0, dy: 0, shoot: false, focus: false, bomb });
  }
  return {
    bossHP: sim.boss?.hp ?? -1,
    liveBullets: sim.system.liveCount,
    alive: sim.player.state !== PlayerState.GameOver,
  };
};

const sp0 = litmusRun(charSpread, false);
const sp1 = litmusRun(charSpread, true);
const fo0 = litmusRun(charFocus, false);
const fo1 = litmusRun(charFocus, true);

// The deltas must be clean: every run survived to the sample tick (no death cascade).
check("litmus runs all survive", sp0.alive && sp1.alive && fo0.alive && fo1.alive, `spread ${sp0.alive}/${sp1.alive} focus ${fo0.alive}/${fo1.alive}`);

const dSpreadHP = sp1.bossHP - sp0.bossHP;
const dFocusHP = fo1.bossHP - fo0.bossHP;
const dSpreadBul = sp1.liveBullets - sp0.liveBullets; // negative = bomb removed bullets
const dFocusBul = fo1.liveBullets - fo0.liveBullets;
console.log(`      boss HP  Δspread ${dSpreadHP}  Δfocus ${dFocusHP}   (baseline HP ${sp0.bossHP})`);
console.log(`      bullets  Δspread ${dSpreadBul}  Δfocus ${dFocusBul}   (baseline ${sp0.liveBullets} live)`);

// (a) The two bombs differ on boss damage: Spread dents the boss not at all; Focus lurches it.
check("Spread bomb deals no boss damage", dSpreadHP === 0, `ΔHP ${dSpreadHP}`);
check("Focus bomb dents the boss (300)", dFocusHP === -300, `ΔHP ${dFocusHP}`);
// (b) The two bombs differ on clear footprint: Spread clears the WHOLE field, Focus a radial
//     subset — so Spread removes strictly more bullets, and Focus removes a non-zero few.
check("Focus bomb clears some bullets", dFocusBul < 0, `Δbullets ${dFocusBul}`);
check("Spread clear-footprint > Focus", Math.abs(dSpreadBul) > Math.abs(dFocusBul), `|${dSpreadBul}| > |${dFocusBul}|`);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exitCode = 1;
