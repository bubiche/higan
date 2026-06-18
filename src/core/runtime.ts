// Fixed-timestep driver + frame-step debugger.
//
// Sits between the raw animation ticker (loop.ts) and the deterministic sim. It
// owns the time accumulator and decides how many fixed steps to run per rendered
// frame, and it implements the debugger controls the loop can't: pause, single-
// step, slow-motion, and backward-scrub.
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

import { startAnimationLoop, type LoopHandle } from "./loop";
import type { InputFrame } from "./input";

export interface SimDriverOptions {
  readonly dt: number;
  /** Produce live input for a tick not yet in the log. Called at most once per tick. */
  sampleInput: (tick: number) => InputFrame;
  /** Advance the simulation by exactly one fixed step. */
  step: (input: InputFrame) => void;
  /** Reset the simulation to its initial (tick 0) state. Needed for backward-scrub. */
  rebuild: () => void;
  /** Draw the current state. Called once per rendered frame, including while paused. */
  render: () => void;
  /** Cap on steps per rendered frame, to avoid a spiral of death after a stall. */
  readonly maxStepsPerFrame?: number;
}

export interface SimDriver {
  readonly paused: boolean;
  readonly speed: number;
  readonly tick: number;
  pause(): void;
  play(): void;
  togglePause(): void;
  /** Advance exactly one tick (and pause). */
  singleStep(): void;
  /** Rewind one tick by replaying the recorded input from the seed (and pause). */
  stepBack(): void;
  /** Set the slow-motion multiplier (1 = real time, 0.25 = quarter speed). */
  setSpeed(mult: number): void;
  stop(): void;
}

export function createSimDriver(opts: SimDriverOptions): SimDriver {
  const { dt, sampleInput, step, rebuild, render } = opts;
  const maxSteps = opts.maxStepsPerFrame ?? 5;

  const inputLog: InputFrame[] = [];
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

  const loop: LoopHandle = startAnimationLoop((dtSeconds) => {
    if (!paused) {
      acc += dtSeconds * speed;
      let steps = 0;
      while (acc >= dt && steps < maxSteps) {
        advanceOne();
        acc -= dt;
        steps++;
      }
    }
    render();
  });

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
      render();
    },
    stepBack(): void {
      if (tick === 0) return;
      paused = true;
      acc = 0;
      const target = tick - 1;
      rebuild();
      tick = 0;
      while (tick < target) advanceOne();
      render();
    },
    setSpeed(mult: number): void {
      speed = mult > 0 ? mult : 0;
    },
    stop(): void {
      loop.stop();
    },
  };
}
