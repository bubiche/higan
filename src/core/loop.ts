// Fixed-timestep simulation loop, decoupled from rendering.
//
// Real elapsed time is accumulated and the simulation is advanced in fixed `dt`
// increments (0..n steps per rendered frame). Each step advances by exactly
// `dt`, independent of the display's refresh rate or frame jitter — the basis
// for determinism (Hard Rule 2). The simulation step receives no wall-clock
// time; only this decoupling layer reads the real clock, to decide how many
// fixed steps to run. Rendering happens once per animation frame, after that
// frame's steps.
//
// This is the timing skeleton; input recording, the state-hash check, and the
// frame-step debugger are layered on later.

export interface LoopOptions {
  /** Fixed simulation timestep, in seconds (e.g. 1 / 60). */
  readonly dt: number;
  /** Advance the simulation by exactly `dt` seconds. */
  step: () => void;
  /** Draw the current state. Called once per rendered frame. */
  render: () => void;
  /** Cap on sim steps per rendered frame, to avoid a spiral of death after a stall. */
  readonly maxStepsPerFrame?: number;
}

export interface LoopHandle {
  stop: () => void;
}

export function startFixedTimestepLoop(opts: LoopOptions): LoopHandle {
  const { dt, step, render } = opts;
  const maxSteps = opts.maxStepsPerFrame ?? 5;

  let acc = 0;
  let prev = performance.now();
  let running = true;
  let rafId = 0;

  const frame = (now: number): void => {
    if (!running) return;
    rafId = requestAnimationFrame(frame);

    const elapsed = (now - prev) / 1000;
    prev = now;

    // A huge delta means a backgrounded tab, a breakpoint, or the first frame
    // after resume. Don't flood the accumulator and fast-forward through many
    // steps — skip simulation time for this frame instead.
    const frameDt = elapsed > 0.1 ? 0 : elapsed;

    acc += frameDt;
    let steps = 0;
    while (acc >= dt && steps < maxSteps) {
      step();
      acc -= dt;
      steps++;
    }
    render();
  };

  const onVisibility = (): void => {
    if (!document.hidden) prev = performance.now();
  };
  document.addEventListener("visibilitychange", onVisibility);

  rafId = requestAnimationFrame(frame);

  return {
    stop(): void {
      running = false;
      cancelAnimationFrame(rafId);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
