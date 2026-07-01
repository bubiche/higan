// Fixed-timestep driver + frame-step debugger.
//
// Sits between the app shell's single animation loop and the deterministic sim. It
// owns the time accumulator and decides how many fixed steps to run per rendered
// frame, and it implements the debugger controls the loop can't: pause, single-
// step, slow-motion, and backward-scrub.
//
// It is EXTERNALLY DRIVEN: it does not own an animation loop and it does not draw.
// The shell calls `frame(dtSeconds)` once per rendered frame (passing real elapsed
// time) to advance the sim, and renders separately. Keeping the driver loop-less is
// what lets one shell loop dispatch to whichever screen is active.
//
// Two invariants make this safe for determinism:
//   - The sim ALWAYS advances by exactly `dt`. Slow-motion scales the wall-clock
//     delta fed into the accumulator (so steps fire less often in real time), it
//     never scales `dt`. The tick *sequence* is identical at any speed.
//   - Every input the sim sees is recorded into a log keyed by tick. Live play
//     samples fresh input and appends; replay and backward-scrub re-feed the
//     recorded log. Backward-scrub rebuilds the sim from its seed and replays the
//     log up to the target tick — which only works because the sim is a pure
//     function of (seed, input log). Debugger controls never enter this log.

import type { InputFrame } from "./input";
import type { Replay } from "../touhou/replay";

export interface SimDriverOptions {
  readonly dt: number;
  /** Seed the run starts under. The driver owns it (alongside the input log) so a
   *  loaded replay can swap it; `rebuild` is handed the current seed to rebuild from. */
  readonly seed: number;
  /** Produce live input for a tick not yet in the log. Called at most once per tick. */
  sampleInput: (tick: number) => InputFrame;
  /** Advance the simulation by exactly one fixed step. */
  step: (input: InputFrame) => void;
  /** Reset the simulation to its initial (tick 0) state, built from `seed`. Needed
   *  for backward-scrub, resync, and replay load. */
  rebuild: (seed: number) => void;
  /** Cap on steps per rendered frame, to avoid a spiral of death after a stall. */
  readonly maxStepsPerFrame?: number;
  /** Optional per-step halt check, tested only in the LIVE `frame()` loop below —
   *  never in `stepBack`/`resync`/`loadRecording`, which must tick straight through
   *  to reproduce a recording exactly. When it returns true right after a step,
   *  `frame` stops immediately (even mid-catch-up, so a stall's multi-step frame
   *  can't overshoot) and reports the halt via its return value — used to freeze
   *  presentation (dialogue) on the exact tick that requested it. */
  shouldHalt?: () => boolean;
}

export interface SimDriver {
  readonly paused: boolean;
  readonly speed: number;
  readonly tick: number;
  /**
   * Advance the sim by the fixed-step accumulator for one rendered frame, given the
   * real wall-clock seconds elapsed. The shell's single animation loop calls this
   * once per frame; it draws separately, so this never renders. A no-op (returns
   * false) while paused. Returns true iff `shouldHalt` fired during this call — the
   * live loop just stopped on the tick that requested it.
   */
  frame(dtSeconds: number): boolean;
  pause(): void;
  play(): void;
  togglePause(): void;
  /** Advance exactly one tick (and pause). */
  singleStep(): void;
  /** Rewind one tick by replaying the recorded input from the seed (and pause). */
  stepBack(): void;
  /**
   * Rebuild from the seed and replay the recorded input back to the CURRENT tick,
   * preserving the play/pause state. Used after a hot-reload so edited code lands
   * at the same tick with the run intact (the replay is what re-executes the new
   * emitter generators deterministically).
   */
  resync(): void;
  /** Snapshot the current run as a replay (seed + the full recorded input log). */
  getRecording(): Replay;
  /** Load a replay: adopt its seed + frames, rebuild from the seed, and replay the
   *  frames so the sim lands at the end of the recording (paused). */
  loadRecording(replay: Replay): void;
  /** Set the slow-motion multiplier (1 = real time, 0.25 = quarter speed). */
  setSpeed(mult: number): void;
}

export function createSimDriver(opts: SimDriverOptions): SimDriver {
  const { dt, sampleInput, step, rebuild, shouldHalt } = opts;
  const maxSteps = opts.maxStepsPerFrame ?? 5;

  const inputLog: InputFrame[] = [];
  let seed = opts.seed;
  let tick = 0;
  let acc = 0;
  let paused = false;
  let speed = 1;

  // Advance one fixed step. The log fills densely from tick 0, so a tick below
  // the log length has been visited before (replay / post-scrub) and reuses its
  // recorded input; otherwise we sample live input and append it.
  const advanceOne = (): void => {
    let input: InputFrame;
    if (tick < inputLog.length) {
      input = inputLog[tick];
    } else {
      input = sampleInput(tick);
      inputLog.push(input);
    }
    step(input);
    tick++;
  };

  return {
    get paused() {
      return paused;
    },
    get speed() {
      return speed;
    },
    get tick() {
      return tick;
    },
    frame(dtSeconds: number): boolean {
      if (paused) return false;
      acc += dtSeconds * speed;
      let steps = 0;
      while (acc >= dt && steps < maxSteps) {
        advanceOne();
        acc -= dt;
        steps++;
        if (shouldHalt?.()) {
          acc = 0;
          return true;
        }
      }
      return false;
    },
    pause(): void {
      paused = true;
    },
    play(): void {
      paused = false;
    },
    togglePause(): void {
      paused = !paused;
    },
    singleStep(): void {
      paused = true;
      acc = 0;
      advanceOne();
    },
    stepBack(): void {
      if (tick === 0) return;
      paused = true;
      acc = 0;
      const target = tick - 1;
      rebuild(seed);
      tick = 0;
      while (tick < target) advanceOne();
    },
    resync(): void {
      acc = 0;
      const target = tick;
      rebuild(seed);
      tick = 0;
      while (tick < target) advanceOne();
    },
    getRecording(): Replay {
      // Copy so callers can't mutate the live log.
      return { seed, frames: inputLog.slice() };
    },
    loadRecording(replay: Replay): void {
      paused = true;
      acc = 0;
      seed = replay.seed;
      inputLog.length = 0;
      for (let i = 0; i < replay.frames.length; i++) inputLog.push(replay.frames[i]!);
      rebuild(seed);
      tick = 0;
      const target = inputLog.length;
      while (tick < target) advanceOne();
    },
    setSpeed(mult: number): void {
      speed = mult > 0 ? mult : 0;
    },
  };
}
