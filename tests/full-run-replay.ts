// ⟐ FULL-RUN GATE — the headless acceptance harness.
//
// Assembles ONE full per-run recording that genuinely exercises the whole sim-extending
// bucket together — items, player-shots, enemies, scoring, bullet-cancel, a spell
// capture, a death, AND a continue (two segments) — then proves it replays bit-identical
// through the real per-run blob. That integrated replay is the one thing the narrower
// per-feature harnesses never tested TOGETHER.
//
// Why a reactive bot: the replay claim is a false pass if the run captured nothing — a
// hash-identical replay of an empty run proves only plumbing. So a bot reads sim state
// each tick and PLAYS (melees the midboss spell down, then bleeds its lives); the frames
// it produces are a fixed stream, captured and replayed. The harness asserts the replay
// RE-FIRES the named events, not just that a number matches.
//
// The blob is assembled through the REAL run controller (createRunController →
// recordContinue → assembleReplay) — the DOM-free seam the screens use for a continue —
// so this exercises the actual continue-recording path, not a hand-built literal.
//
// Proves: the per-run bit-identical replay; determinism with all sim-extending state
// folded (same fixture, folded twice); and — the headlessly checkable half — that the
// fold reads only sim.hash(): events are read-only post-step and never fold in.

import { createStageSim, type Simulation } from "../src/core/sim";
import { mixSeed } from "../src/core/prng";
import { DT } from "../src/core/playfield";
import { SfxId } from "../src/core/events";
import { PlayerState, createPlayer, DEFAULT_PLAYER_CONFIG } from "../src/touhou/player";
import { applyExtends, DEFAULT_SCORING } from "../src/touhou/score";
import { createRunController } from "../src/app/run";
import {
  serializeRunReplay,
  deserializeRunReplay,
  type RunReplay,
  type ReplaySegment,
} from "../src/touhou/replay";
import { demoGame } from "../games/demo/game";
import { Rank } from "../games/demo/difficulty";
import type { InputFrame } from "../src/core/input";

const def = demoGame;
const RANK = Rank.Easy; // thinner waves — a legit run-parameter so the bot reaches the midboss alive
const CHAR = 1; // "Focus" — high single-target DPS to melee the spell down fast

let failures = 0;
const check = (label: string, pass: boolean, detail = ""): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(56)} ${detail}`);
  if (!pass) failures++;
};
const hex = (h: number): string => `0x${h.toString(16).padStart(8, "0")}`;
const SFX_NAME: Record<number, string> = {};
for (const [k, v] of Object.entries(SfxId)) if (typeof v === "number") SFX_NAME[v] = k;

// Build a stage sim exactly as the in-game screen does: RUN seed mixed per stage index,
// the chosen character + difficulty, the game's run config.
const buildSim = (runSeed: number, stageIndex: number, difficulty: number, character: number): Simulation =>
  createStageSim(def.stages[stageIndex]!, mixSeed(runSeed, stageIndex), def.characters[character]!, difficulty, def.config, DT);

// ── Reactive bot ────────────────────────────────────────────────────────────────
// Melee the centred boss while streaming aimed shots (ping-pong around centre, focus on
// for DPS); once the midboss spell is captured, stop shooting and sit still to bleed the
// remaining lives to game-over. Returns the captured frame stream + what it observed.
interface SegmentRun {
  frames: InputFrame[];
  events: Set<number>;
  gameOver: boolean;
  cleared: boolean;
  finalScore: number;
}
function playSegment(runSeed: number, stageIndex: number, maxTicks: number, dieAfterCapture: boolean): SegmentRun {
  const sim = buildSim(runSeed, stageIndex, RANK, CHAR);
  const frames: InputFrame[] = [];
  const events = new Set<number>();
  let dieMode = false;
  for (let t = 0; t < maxTicks; t++) {
    const f: InputFrame = dieMode
      ? { dx: 0, dy: 0, shoot: false, focus: false, bomb: false }
      : { dx: Math.floor(t / 16) % 2 === 0 ? 1 : -1, dy: 0, shoot: true, focus: true, bomb: false };
    frames.push(f);
    sim.step(f);
    for (const e of sim.events) {
      events.add(e.id);
      if (e.id === SfxId.SpellCapture && dieAfterCapture) dieMode = true;
    }
    if (sim.player.state === PlayerState.GameOver || sim.stageComplete) break;
  }
  return {
    frames,
    events,
    gameOver: sim.player.state === PlayerState.GameOver,
    cleared: sim.stageComplete,
    finalScore: sim.player.score,
  };
}

// Fold the whole multi-segment run's per-tick trajectory hash — the genuinely new logic
// (checkDeterministic only spans ONE stage sim; a run with a continue is TWO). Optionally
// collect the events each segment re-fires, to prove the replay reproduces the RUN, not
// just a matching number. Rebuilds each segment from the blob's adopted run-params.
function foldRun(blob: RunReplay, collect: boolean): { hash: number; events: Set<number>; seg0GameOver: boolean } {
  let acc = 0x811c9dc5 >>> 0;
  const events = new Set<number>();
  let seg0GameOver = false;
  blob.segments.forEach((seg, si) => {
    const sim = buildSim(blob.runSeed, seg.stageIndex, blob.difficulty, blob.character);
    for (const f of seg.frames) {
      sim.step(f);
      if (collect) for (const e of sim.events) events.add(e.id);
      acc = Math.imul(acc ^ sim.hash(), 0x01000193) >>> 0;
    }
    if (si === 0) seg0GameOver = sim.player.state === PlayerState.GameOver;
  });
  return { hash: acc >>> 0, events, seg0GameOver };
}

const framesEqual = (a: readonly InputFrame[], b: readonly InputFrame[]): boolean =>
  a.length === b.length &&
  a.every((f, i) => {
    const g = b[i]!;
    return f.dx === g.dx && f.dy === g.dy && f.shoot === g.shoot && f.focus === g.focus && f.bomb === g.bomb;
  });

// ═══ Assemble the run through the REAL controller ═══════════════════════════════
console.log(`\n⟐ FULL-RUN GATE — per-run acceptance (character=${def.characters[CHAR]!.id}, rank=Easy)\n`);

const run = createRunController(def, RANK, CHAR);

// Segment 1: play to game-over, capturing the midboss spell on the way.
const seg1 = playSegment(run.runSeed, 0, 8000, true);
console.log(
  `segment 1: ${seg1.frames.length} frames, score=${seg1.finalScore.toLocaleString("en-US")}, ` +
    `events={${[...seg1.events].map((id) => SFX_NAME[id]).join(",")}}`,
);

// The continue: promote the just-finished play into the run's history (exactly what the
// continue screen does on "Continue"), then play a fresh segment 2 (a continued run:
// same stage, same seed, score/lives reset — a distinct, shorter play).
run.recordContinue({ stageIndex: 0, frames: seg1.frames } satisfies ReplaySegment);
const seg2 = playSegment(run.runSeed, 0, 600, false);
console.log(`segment 2: ${seg2.frames.length} frames, score=${seg2.finalScore.toLocaleString("en-US")} (continued play)\n`);

const replay: RunReplay = run.assembleReplay({ stageIndex: 0, frames: seg2.frames });

// ═══ CHECK A — the fixture genuinely contains every event named above ═══════════
check("segment 1 captured a spell", seg1.events.has(SfxId.SpellCapture));
check("segment 1 collected items", seg1.events.has(SfxId.ItemCollect));
check("segment 1 cancelled bullets", seg1.events.has(SfxId.Cancel));
check("segment 1 ended in a death (game-over)", seg1.gameOver);
check("run has 2 segments (a continue)", replay.segments.length === 2, `${replay.segments.length} segments`);
check("continue was recorded on the controller", run.continuesUsed === 1, `continuesUsed=${run.continuesUsed}`);

// ═══ CHECK B — the per-run blob survives a serialize round-trip byte-for-byte ════
const bytes = serializeRunReplay(replay);
const loaded = deserializeRunReplay(bytes);
check(
  "blob round-trips (run-params)",
  loaded.runSeed === replay.runSeed &&
    loaded.difficulty === replay.difficulty &&
    loaded.character === replay.character &&
    loaded.configId === replay.configId,
  `seed=${hex(loaded.runSeed)} rank=${loaded.difficulty} char=${loaded.character} cfg=${hex(loaded.configId)}`,
);
check(
  "blob round-trips (segments + frames)",
  loaded.segments.length === replay.segments.length &&
    loaded.segments.every(
      (s, i) => s.stageIndex === replay.segments[i]!.stageIndex && framesEqual(s.frames, replay.segments[i]!.frames),
    ),
  `${bytes.length} bytes`,
);

// ═══ CHECK C — bit-identical per-run replay (the spine) ══════════════════════════
// Fold the in-memory assembled run, the deserialized run, and the deserialized run AGAIN.
// All three equal ⇒ the whole multi-segment run replays bit-identically, survives the
// blob round-trip, and is deterministic (run-twice-same-hash) — over EVERY sim-extending
// field, since sim.hash() folds shots/enemies/items/score/power/cancel/continues.
const hAssembled = foldRun(replay, false).hash;
const dLoaded = foldRun(loaded, true);
const hLoadedAgain = foldRun(loaded, false).hash;
check("per-run replay is bit-identical (assembled == blob)", hAssembled === dLoaded.hash, `${hex(hAssembled)} vs ${hex(dLoaded.hash)}`);
check("determinism holds (blob replayed twice, same hash)", dLoaded.hash === hLoadedAgain, hex(dLoaded.hash));

// ═══ CHECK D — the replay REPRODUCES the run, not just a matching number ═════════
check("replay re-fires the spell capture", dLoaded.events.has(SfxId.SpellCapture));
check("replay re-fires item collection", dLoaded.events.has(SfxId.ItemCollect));
check("replay re-fires the bullet-cancel", dLoaded.events.has(SfxId.Cancel));
check("replay reproduces the death (segment 1 → game-over)", dLoaded.seg0GameOver);

// ═══ CHECK E — continue economy: a continued segment starts fresh ════════════════
// The fresh segment-2 sim (before any input) resets score to 0 and restores full lives —
// the "continue resets score + restores lives" economy claim, exercised through the real
// per-stage rebuild the controller drives.
const startLives = def.characters[CHAR]!.config.lives;
const freshSim = buildSim(run.runSeed, 0, RANK, CHAR);
check("continue resets score to 0", freshSim.player.score === 0, `score=${freshSim.player.score}`);
check(
  "continue restores full lives",
  freshSim.player.lives === startLives,
  `lives=${freshSim.player.lives}/${startLives}`,
);

// ═══ CHECK F — the score-threshold extend fires at the threshold ═════════════════
// The integrated fixture peaks at ~2.2M (one midboss capture), far below the first
// reference threshold [10M,30M,60M] — so NO extend is owed there (correct, not a miss).
// Prove the mechanism the sim runs every tick (sim.ts step 9 → `emit(SfxId.Extend)` when
// `applyExtends` grants > 0): a life is granted exactly when a threshold is crossed, once
// per threshold, and never past the last. (A full natural 10M run firing it live is the
// owner's browser check — reaching 10M no-miss headlessly isn't practical.)
const th = DEFAULT_SCORING.extendThresholds;
const ep = createPlayer(DEFAULT_PLAYER_CONFIG, 0, 0, DEFAULT_SCORING.pivBase);
const baseLives = ep.lives;
ep.score = th[0]! - 1;
check("extend: below the first threshold grants nothing", applyExtends(ep, DEFAULT_SCORING) === 0 && ep.lives === baseLives);
ep.score = th[0]!;
check(
  "extend: crossing a threshold grants a life",
  applyExtends(ep, DEFAULT_SCORING) === 1 && ep.lives === baseLives + 1 && ep.nextExtendIndex === 1,
  `lives=${ep.lives} idx=${ep.nextExtendIndex}`,
);
check("extend: the same threshold never re-fires", applyExtends(ep, DEFAULT_SCORING) === 0 && ep.lives === baseLives + 1);
ep.score = th[th.length - 1]!;
check(
  "extend: a big jump grants each remaining threshold once",
  applyExtends(ep, DEFAULT_SCORING) === th.length - 1 && ep.nextExtendIndex === th.length,
  `grantedTo idx=${ep.nextExtendIndex}/${th.length}`,
);
check("extend: past the last threshold, no more extends", applyExtends(ep, DEFAULT_SCORING) === 0);

console.log(
  failures === 0
    ? `\n✓ FULL-RUN GATE PASS — per-run replay bit-identical + extend thresholds, run hash ${hex(hAssembled)}\n`
    : `\n✗ ${failures} FAILURE(S)\n`,
);
if (failures > 0) process.exitCode = 1;
