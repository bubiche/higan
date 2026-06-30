// Replay recording format.
//
// A replay is the minimal pure-data record needed to reproduce a run: the seed(s)
// plus the per-tick input stream. The sim is a deterministic function of
// (seed, input stream) given the same construction context, so re-feeding these
// frames into a fresh sim reproduces the run bit-for-bit. This is the regression
// harness the rest of the engine leans on — record a run, replay it, assert the
// trajectory hash is identical.
//
// Two shapes live here:
//   - `Replay` — one SIM's recording: a seed + its per-tick input log. This is the
//     driver's currency (`SimDriver.getRecording`/`loadRecording`); it knows nothing
//     about runs, difficulty, or stages.
//   - `RunReplay` — the persisted per-RUN container the save/load buttons write: the
//     run-parameters (run seed, chosen difficulty rank, chosen character index, a
//     config fingerprint) plus an ordered list of stage segments. A continue replays
//     the same stage from a fresh sim, so each segment is one play of one stage; the
//     segment list is the run's structure (multi-stage and continue-spanning both
//     reduce to "more segments"). The single slice produces exactly one segment.
//
// CONTRACT — a blob reproduces bit-identically only against the SAME construction
// context it was recorded under: the same pattern/boss code, the same `dt`, and the
// same run-rules config. The blob captures the inputs that, if they silently differed,
// would yield a plausible-but-wrong run — the seed (the randomness source) and the
// difficulty rank + character (construction inputs the content branches on). The
// `configId` fingerprints the game's tunable DATA (not its scripts, which are live
// code under the same-machine replay contract); a load whose configId doesn't match
// the current build is rejected rather than replayed into divergence. See
// `src/app/replay-compat.ts` for what configId covers.

import type { InputFrame } from "../core/input";

/** One sim's recording — the driver's currency (seed + per-tick input log). */
export interface Replay {
  /** Seed the sim was recorded under — the randomness source. */
  readonly seed: number;
  /** One InputFrame per tick, in order from tick 0. */
  readonly frames: readonly InputFrame[];
}

/** One stage play within a run: which stage it was, and its full input log. A
 *  continue produces another segment of the same stage from a fresh sim; a later
 *  stage produces a segment with the next `stageIndex`. */
export interface ReplaySegment {
  /** Index of the stage this segment played (0 for the single-stage slice). */
  readonly stageIndex: number;
  /** The segment's per-tick input log, from its sim's tick 0. */
  readonly frames: readonly InputFrame[];
}

/** The persisted per-run container — run-parameters + ordered stage segments. */
export interface RunReplay {
  /** Run seed — the root the per-stage seeds derive from (each segment's sim is built
   *  from `mixSeed(runSeed, stageIndex)`). */
  readonly runSeed: number;
  /** Chosen difficulty rank (index into the game's difficulties). Construction input
   *  the content branches on — adopted on load so the replay is self-contained. */
  readonly difficulty: number;
  /** Chosen character index. Captured for forward-compatibility; the slice only runs
   *  character 0, so a load of any other index is rejected. */
  readonly character: number;
  /** Fingerprint of the game's tunable DATA at record time (see replay-compat.ts).
   *  A load whose configId differs from the current build's is rejected. */
  readonly configId: number;
  /** Ordered stage segments. The slice produces exactly one (stage 0). */
  readonly segments: readonly ReplaySegment[];
}

// One byte per frame. dx/dy are tri-state (-1/0/+1) → 2 bits each (value + 1);
// shoot/focus/bomb → 1 bit each; bit 7 is unused.
const DX_SHIFT = 0;
const DY_SHIFT = 2;
const SHOOT_BIT = 1 << 4;
const FOCUS_BIT = 1 << 5;
const BOMB_BIT = 1 << 6;

function packFrame(f: InputFrame): number {
  // Math.sign maps the documented -1/0/+1 to itself and clamps any stray
  // magnitude, so a malformed dx/dy can never overflow its 2-bit field.
  let b = (Math.sign(f.dx) + 1) << DX_SHIFT;
  b |= (Math.sign(f.dy) + 1) << DY_SHIFT;
  if (f.shoot) b |= SHOOT_BIT;
  if (f.focus) b |= FOCUS_BIT;
  if (f.bomb) b |= BOMB_BIT;
  return b;
}

function unpackFrame(b: number): InputFrame {
  return {
    dx: ((b >> DX_SHIFT) & 0b11) - 1,
    dy: ((b >> DY_SHIFT) & 0b11) - 1,
    shoot: (b & SHOOT_BIT) !== 0,
    focus: (b & FOCUS_BIT) !== 0,
    bomb: (b & BOMB_BIT) !== 0,
  };
}

// ── Container framing ────────────────────────────────────────────────────────────
// Sentinel + version so a malformed or stale blob is rejected, not misparsed. The
// fixed header is `{magic:u32, version:u16, difficulty:u16, character:u16, runSeed:u32,
// configId:u32, segmentCount:u16}` (20 bytes, little-endian); then each segment is
// `{stageIndex:u16, frameCount:u32}` followed by its `frameCount` packed frame bytes.
const MAGIC = 0x48494741; // "HIGA"
const VERSION = 2; // container format (v1 was the flat {seed, frames} header)
const HEADER_BYTES = 20;
const SEGMENT_HEADER_BYTES = 6;

/**
 * Serialize a run replay to a compact byte blob (see the framing note above).
 */
export function serializeRunReplay(replay: RunReplay): Uint8Array {
  let total = HEADER_BYTES;
  for (const seg of replay.segments) total += SEGMENT_HEADER_BYTES + seg.frames.length;

  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint16(4, VERSION, true);
  view.setUint16(6, replay.difficulty & 0xffff, true);
  view.setUint16(8, replay.character & 0xffff, true);
  view.setUint32(10, replay.runSeed >>> 0, true);
  view.setUint32(14, replay.configId >>> 0, true);
  view.setUint16(18, replay.segments.length, true);

  let off = HEADER_BYTES;
  for (const seg of replay.segments) {
    view.setUint16(off, seg.stageIndex & 0xffff, true);
    view.setUint32(off + 2, seg.frames.length, true);
    off += SEGMENT_HEADER_BYTES;
    for (let i = 0; i < seg.frames.length; i++) bytes[off + i] = packFrame(seg.frames[i]!);
    off += seg.frames.length;
  }
  return bytes;
}

/**
 * Parse a byte blob produced by `serializeRunReplay`. Throws on a bad magic, an
 * unsupported version, or a length that doesn't match the blob's own declared
 * segment/frame counts — so a stale or corrupt file fails loudly rather than
 * replaying into garbage.
 */
export function deserializeRunReplay(bytes: Uint8Array): RunReplay {
  if (bytes.length < HEADER_BYTES) {
    throw new Error(`Replay blob too short: ${bytes.length} < ${HEADER_BYTES} header bytes.`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== MAGIC) {
    throw new Error(`Not a Higan replay (bad magic 0x${magic.toString(16)}).`);
  }
  const version = view.getUint16(4, true);
  if (version !== VERSION) {
    throw new Error(`Unsupported replay version ${version} (expected ${VERSION}).`);
  }
  const difficulty = view.getUint16(6, true);
  const character = view.getUint16(8, true);
  const runSeed = view.getUint32(10, true);
  const configId = view.getUint32(14, true);
  const segmentCount = view.getUint16(18, true);

  const segments: ReplaySegment[] = new Array<ReplaySegment>(segmentCount);
  let off = HEADER_BYTES;
  for (let s = 0; s < segmentCount; s++) {
    if (off + SEGMENT_HEADER_BYTES > bytes.length) {
      throw new Error(`Replay blob truncated: segment ${s} header runs past end.`);
    }
    const stageIndex = view.getUint16(off, true);
    const frameCount = view.getUint32(off + 2, true);
    off += SEGMENT_HEADER_BYTES;
    if (off + frameCount > bytes.length) {
      throw new Error(`Replay blob truncated: segment ${s} wants ${frameCount} frames past end.`);
    }
    const frames: InputFrame[] = new Array<InputFrame>(frameCount);
    for (let i = 0; i < frameCount; i++) frames[i] = unpackFrame(bytes[off + i]!);
    off += frameCount;
    segments[s] = { stageIndex, frames };
  }
  if (off !== bytes.length) {
    throw new Error(`Replay blob has ${bytes.length - off} trailing bytes after ${segmentCount} segments.`);
  }
  return { runSeed, difficulty, character, configId, segments };
}
