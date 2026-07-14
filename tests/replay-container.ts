// Per-run replay container + adopt-on-load desync fix — verification.
//
// Headless coverage (the adopt-on-load router.replace wiring is the only live-only
// piece — file-change handler → screen teardown → fresh preloaded screen):
//  1. Container round-trips, including the MULTI-segment path. The live save path writes
//     one segment, but the reader parses N, so a hand-built 2-segment blob is round-
//     tripped here to exercise that path now (not only once the RunController emits it).
//  2. A malformed blob is rejected loudly: bad magic, wrong version, truncated frames,
//     and trailing bytes each throw — never misparse.
//  3. The cross-rank desync the run-parameter capture exists to close. A Lunatic run's
//     frames replayed under the WRONG rank (Normal) diverge; the SAME frames replayed
//     under the rank the blob captured (adopt-on-load) reproduce bit-identically.
//  4. configId fingerprints the game's DATA: a scoring edit changes it (→ reject), while
//     title/seed/continues/difficulty-label edits don't (excluded), and a difficulty-id
//     edit does (structural guard).

import { computeConfigId } from "../src/app/replay-compat";
import {
  serializeRunReplay,
  deserializeRunReplay,
  type RunReplay,
  type ReplaySegment,
} from "../src/touhou/replay";
import { createStageSim } from "../src/core/sim";
import { mixSeed } from "../src/core/prng";
import { DT } from "../src/core/playfield";
import { demoGame } from "../games/demo/game";
import { Rank } from "../games/demo/difficulty";
import type { InputFrame } from "../src/core/input";
import type { GameDefinition } from "../src/api";

const STAGE_SEED = mixSeed(demoGame.seed, 0);
const stage = demoGame.stages[0]!;
const character = demoGame.characters[0]!;
const hex = (h: number): string => `0x${h.toString(16).padStart(8, "0")}`;

let failures = 0;
const check = (label: string, pass: boolean, detail: string): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(34)} ${detail}`);
  if (!pass) failures++;
};

// A deterministic, slightly varied input frame stream of length `n` (the `salt` shifts
// the pattern so two segments differ).
function mkFrames(n: number, salt: number): InputFrame[] {
  const f: InputFrame[] = [];
  for (let i = 0; i < n; i++) {
    f.push({
      dx: (((i + salt) >> 2) % 3) - 1,
      dy: ((i + salt) % 3) - 1,
      shoot: ((i + salt) & 1) !== 0,
      focus: (i + salt) % 50 < 12,
      bomb: (i + salt) % 311 === 0,
    });
  }
  return f;
}

function framesEqual(a: readonly InputFrame[], b: readonly InputFrame[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.dx !== y.dx || x.dy !== y.dy || x.shoot !== y.shoot || x.focus !== y.focus || x.bomb !== y.bomb) {
      return false;
    }
  }
  return true;
}

function throws(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

// Fold a run's per-tick trajectory hash exactly as the determinism guard does, so the
// numbers here are comparable to it: build a fresh sim at `difficulty` and feed `frames`.
function runHash(difficulty: number, frames: readonly InputFrame[]): number {
  const sim = createStageSim(stage, STAGE_SEED, character, difficulty, demoGame.config, DT);
  let acc = 0x811c9dc5;
  for (let i = 0; i < frames.length; i++) {
    sim.step(frames[i]!);
    acc = Math.imul(acc ^ sim.hash(), 0x01000193) >>> 0;
  }
  return acc >>> 0;
}

// ── 1: container round-trip (one segment, then the multi-segment path) ──────────
{
  const seg: ReplaySegment = { stageIndex: 0, frames: mkFrames(1000, 7) };
  const blob: RunReplay = {
    runSeed: demoGame.seed,
    difficulty: Rank.Hard,
    character: 0,
    configId: computeConfigId(demoGame),
    segments: [seg],
  };
  const back = deserializeRunReplay(serializeRunReplay(blob));
  const ok =
    back.runSeed === blob.runSeed &&
    back.difficulty === blob.difficulty &&
    back.character === blob.character &&
    back.configId === blob.configId &&
    back.segments.length === 1 &&
    back.segments[0]!.stageIndex === 0 &&
    framesEqual(back.segments[0]!.frames, seg.frames);
  check("1-segment round-trip", ok, `${back.segments[0]!.frames.length}f rank ${back.difficulty} cfg ${hex(back.configId)}`);
}
{
  // Hand-built two-segment blob (distinct stageIndex + frame counts) — exercises the
  // reader's N-segment loop that the live one-segment writer never reaches.
  const segs: ReplaySegment[] = [
    { stageIndex: 0, frames: mkFrames(640, 3) },
    { stageIndex: 1, frames: mkFrames(913, 29) },
  ];
  const blob: RunReplay = {
    runSeed: 0xdead_beef,
    difficulty: Rank.Lunatic,
    character: 0,
    configId: 0x1234_5678,
    segments: segs,
  };
  const back = deserializeRunReplay(serializeRunReplay(blob));
  const ok =
    back.runSeed === (0xdead_beef >>> 0) &&
    back.difficulty === Rank.Lunatic &&
    back.configId === 0x1234_5678 &&
    back.segments.length === 2 &&
    back.segments[0]!.stageIndex === 0 &&
    back.segments[1]!.stageIndex === 1 &&
    framesEqual(back.segments[0]!.frames, segs[0]!.frames) &&
    framesEqual(back.segments[1]!.frames, segs[1]!.frames);
  check("2-segment round-trip", ok, `${back.segments.map((s) => `${s.frames.length}f@${s.stageIndex}`).join(" + ")}`);
}

// ── 2: malformed blobs are rejected, not misparsed ──────────────────────────────
{
  const good = serializeRunReplay({
    runSeed: 1,
    difficulty: 0,
    character: 0,
    configId: 0,
    segments: [{ stageIndex: 0, frames: mkFrames(64, 1) }],
  });
  const badMagic = good.slice();
  badMagic[0] = (badMagic[0]! ^ 0xff) & 0xff;
  const badVersion = good.slice();
  new DataView(badVersion.buffer).setUint16(4, 99, true);
  const truncated = good.slice(0, good.length - 10); // drop frame bytes (count stays)
  const trailing = new Uint8Array(good.length + 4);
  trailing.set(good);
  check("bad magic throws", throws(() => deserializeRunReplay(badMagic)), "magic byte flipped");
  check("bad version throws", throws(() => deserializeRunReplay(badVersion)), "version → 99");
  check("truncated throws", throws(() => deserializeRunReplay(truncated)), "10 frame bytes dropped");
  check("trailing bytes throw", throws(() => deserializeRunReplay(trailing)), "+4 bytes");
}

// ── 3: cross-rank desync — the whole reason run-parameters are captured ─────────
{
  // The scripted window mirrors the determinism guard so the trajectories are real.
  const frames: InputFrame[] = [];
  for (let i = 0; i < 8000; i++) {
    frames.push({ dx: (i >> 3) % 2 ? 1 : -1, dy: 0, shoot: true, focus: i % 120 < 30, bomb: false });
  }
  const trueLunatic = runHash(Rank.Lunatic, frames);

  // The blob a Lunatic run would save, round-tripped through the wire format.
  const loaded = deserializeRunReplay(
    serializeRunReplay({
      runSeed: demoGame.seed,
      difficulty: Rank.Lunatic,
      character: 0,
      configId: computeConfigId(demoGame),
      segments: [{ stageIndex: 0, frames }],
    }),
  );
  const loadedFrames = loaded.segments[0]!.frames;

  // WRONG (the pre-fix bug): replay Lunatic frames under whatever rank the live run
  // happens to be at (Normal). The blob carried no rank, so the sim was built at the
  // wrong difficulty → a different, wrong trajectory.
  const wrong = runHash(Rank.Normal, loadedFrames);
  check("wrong rank desyncs", wrong !== trueLunatic, `${hex(wrong)} != ${hex(trueLunatic)}`);

  // ADOPT (the fix): the blob captured difficulty=Lunatic; the load rebuilds at that
  // rank, so the same frames reproduce the recorded run bit-for-bit.
  const adopted = runHash(loaded.difficulty, loadedFrames);
  check("adopt-on-load reproduces", adopted === trueLunatic, `${hex(adopted)} == ${hex(trueLunatic)}`);
}

// ── 4: configId fingerprints DATA — sensitive to it, blind to the rest ──────────
{
  const base = computeConfigId(demoGame);
  check("configId stable", computeConfigId(demoGame) === base, hex(base));

  const scoringEdit: GameDefinition = {
    ...demoGame,
    config: { ...demoGame.config, scoring: { ...demoGame.config.scoring, grazeScore: demoGame.config.scoring.grazeScore + 1 } },
  };
  check("scoring edit → new id", computeConfigId(scoringEdit) !== base, `${hex(computeConfigId(scoringEdit))}`);

  // A character-config edit must also gate (the chosen character's config IS a
  // reproduction input — this covers the `characters` branch of the hashed data).
  const charEdit: GameDefinition = {
    ...demoGame,
    characters: demoGame.characters.map((c, i) =>
      i === 0 ? { ...c, config: { ...c.config, hitboxRadius: c.config.hitboxRadius + 1 } } : c,
    ),
  };
  check("character config edit → new id", computeConfigId(charEdit) !== base, hex(computeConfigId(charEdit)));

  // Excluded inputs: title, seed, continues, and difficulty display text don't gate.
  const cosmeticEdit: GameDefinition = {
    ...demoGame,
    title: "DIFFERENT",
    seed: demoGame.seed ^ 0x5555,
    config: { ...demoGame.config, continues: demoGame.config.continues + 2 },
    difficulties: (demoGame.difficulties ?? []).map((d) => ({ ...d, label: `${d.label}!`, description: "x" })),
  };
  check("title/seed/continues/labels excluded", computeConfigId(cosmeticEdit) === base, hex(computeConfigId(cosmeticEdit)));

  // Structural guard: a difficulty ID change does gate (the build's rank list changed).
  const idEdit: GameDefinition = {
    ...demoGame,
    difficulties: (demoGame.difficulties ?? []).map((d, i) => (i === 0 ? { ...d, id: "beginner" } : d)),
  };
  check("difficulty id edit → new id", computeConfigId(idEdit) !== base, hex(computeConfigId(idEdit)));
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exitCode = 1;
