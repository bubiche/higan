// Replay recording format.
//
// A replay is the minimal pure-data record needed to reproduce a run: the seed
// plus the per-tick input stream. The sim is a deterministic function of
// (seed, input stream) given the same construction context, so re-feeding these
// frames into a fresh sim reproduces the run bit-for-bit. This is the regression
// harness the rest of the engine leans on — record a run, replay it, assert the
// trajectory hash is identical.
//
// CONTRACT — a blob reproduces bit-identically only against the SAME construction
// context it was recorded under: the same pattern/boss code, the same `dt`, and
// the same run-rules config (PlayerConfig). Those are construction inputs, not
// part of the recording — `dt` is fixed, patterns are live code, and the config
// feeds deterministic state but is the build's choice (the same category as
// `dt`). The SEED is captured because it is the randomness source and the one
// runtime input that, if it silently differed, would yield a plausible-but-wrong
// run. Consequence for the regression use: a changed config or pattern
// legitimately changes the hash and wants a re-baseline; only a changed update
// path on identical inputs is a real nondeterminism regression.

import type { InputFrame } from "../core/input";

export interface Replay {
  /** Seed the run was recorded under — the randomness source. */
  readonly seed: number;
  /** One InputFrame per tick, in order from tick 0. */
  readonly frames: readonly InputFrame[];
}

/** {seed:u32, tickCount:u32}, little-endian. */
const HEADER_BYTES = 8;

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

/**
 * Serialize a replay to a compact byte blob: an 8-byte header
 * ({seed:u32, tickCount:u32}, little-endian) followed by one byte per frame.
 */
export function serializeReplay(replay: Replay): Uint8Array {
  const count = replay.frames.length;
  const bytes = new Uint8Array(HEADER_BYTES + count);
  const header = new DataView(bytes.buffer);
  header.setUint32(0, replay.seed >>> 0, true);
  header.setUint32(4, count, true);
  for (let i = 0; i < count; i++) {
    bytes[HEADER_BYTES + i] = packFrame(replay.frames[i]!);
  }
  return bytes;
}

/**
 * Parse a byte blob produced by `serializeReplay` back into a Replay. Throws if
 * the blob is too short for its header or its own declared frame count.
 */
export function deserializeReplay(bytes: Uint8Array): Replay {
  if (bytes.length < HEADER_BYTES) {
    throw new Error(`Replay blob too short: ${bytes.length} < ${HEADER_BYTES} header bytes.`);
  }
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const seed = header.getUint32(0, true);
  const count = header.getUint32(4, true);
  if (bytes.length !== HEADER_BYTES + count) {
    throw new Error(
      `Replay blob length ${bytes.length} != header + frames (${HEADER_BYTES} + ${count}).`,
    );
  }
  const frames: InputFrame[] = new Array<InputFrame>(count);
  for (let i = 0; i < count; i++) {
    frames[i] = unpackFrame(bytes[HEADER_BYTES + i]!);
  }
  return { seed, frames };
}
