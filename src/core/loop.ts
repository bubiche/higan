// Raw animation-frame ticker.
//
// This is purely "when to draw": it schedules `requestAnimationFrame` and hands
// the caller the real elapsed wall-clock time since the previous frame. It does
// NOT decide how much simulation to advance — that (the fixed-timestep
// accumulator, pausing, slow-motion, stepping) lives in the driver above it, so
// the debugger can control stepping without this layer knowing about it.
//
// Two deliberate behaviors live here because they are about the real clock:
//   - A frame whose delta exceeds the anomaly threshold (a backgrounded tab, a
//     breakpoint, the first frame after resume) reports 0 elapsed instead of a
//     huge spike, so the driver never fast-forwards through a burst of steps.
//   - When the tab becomes visible again, the clock baseline is reset so the
//     first visible frame doesn't report the whole hidden interval.

/** Deltas larger than this (seconds) are treated as anomalies and reported as 0. */
const ANOMALY_THRESHOLD = 0.1;

export interface LoopHandle {
  stop: () => void;
}

/**
 * Drive `onFrame` once per animation frame, passing the (anomaly-clamped) real
 * elapsed seconds since the previous frame.
 */
export function startAnimationLoop(onFrame: (dtSeconds: number) => void): LoopHandle {
  let prev = performance.now();
  let running = true;
  let rafId = 0;

  const frame = (now: number): void => {
    if (!running) return;
    rafId = requestAnimationFrame(frame);

    const elapsed = (now - prev) / 1000;
    prev = now;

    onFrame(elapsed > ANOMALY_THRESHOLD ? 0 : elapsed);
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
