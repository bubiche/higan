// Per-tick input record — the seam between "how input was produced" and "what
// the simulation sees".
//
// The simulation only ever receives an InputFrame per tick; it never reads the
// keyboard, the clock, or anything live. That is what makes replay possible: an
// InputFrame stream produced live can be recorded and later replayed byte-for-
// byte, and the sim cannot tell the difference. Debugger controls
// (pause/step/slow-mo/scrub) are NOT part of this record — they drive the loop,
// never the simulation.

export interface InputFrame {
  /** Horizontal intent: -1 (left), 0, or +1 (right). */
  readonly dx: number;
  /** Vertical intent: -1 (up), 0, or +1 (down). */
  readonly dy: number;
  /** Fire held. */
  readonly shoot: boolean;
  /** Focus (precise/slow) held. */
  readonly focus: boolean;
  /** Bomb pressed. */
  readonly bomb: boolean;
}

export const NEUTRAL_INPUT: InputFrame = {
  dx: 0,
  dy: 0,
  shoot: false,
  focus: false,
  bomb: false,
};

/** Something that produces one InputFrame per simulation tick. */
export interface InputSource {
  sample(tick: number): InputFrame;
}
