// Boss / spell-card authoring surface.
//
// A boss is an emitter-OF-emitters: a single coroutine (O(1)) that drives ordered
// phases, each of which spawns child emitters (O(hundreds)) that fire dumb-data
// bullets (O(10k)). So Hard Rule 1 holds at every level — the boss runs script,
// the bullets never do. The coroutine-purity invariant (api/index.ts) extends
// unchanged: a boss script must be a pure function of (rng, tick, target) and the
// sim-maintained phase state it reads.
//
// The split that matters: phase STATE (HP drained by the player shooting, the
// countdown timer) evolves in the sim, because `input.shoot` lives in the sim and
// the boss context deliberately has no input access. The coroutine only ORCHESTRATES
// — it reads hp/timer to decide when a phase ends, and never sees raw input. This
// keeps damage independent of how often the coroutine happens to resume.

import type { Rng } from "../core/prng";
import type { EmitterScript, RunningEmitter, Vec2 } from "./emitter";

export interface PhaseSpec {
  /** Display name (a spell-card title for spell phases). */
  readonly name: string;
  /** Hit points; drained by the player shooting (sim-side). The phase ends when
   *  this reaches 0 — a capture if no death/bomb happened during it. */
  readonly hp: number;
  /** Time limit in ticks; the phase ends (timeout) when it elapses unbeaten. */
  readonly timeLimit: number;
  /** Spell card vs ordinary phase — affects HUD framing and the capture framing. */
  readonly isSpell?: boolean;
}

export interface PhaseResult {
  /** Ended by HP-drain with no miss (no death and no bomb) during the phase. */
  readonly captured: boolean;
  /** Ended by the timer expiring rather than by HP-drain. */
  readonly timedOut: boolean;
}

/**
 * The hooks the sim provides so the boss coroutine can drive phases against the
 * sim-owned phase state. The sim implements these (it owns the scheduler array and
 * the boss state); the coroutine only calls them.
 */
export interface BossDeps {
  readonly rng: Rng;
  readonly target: Readonly<Vec2>;
  spawnChild(script: EmitterScript, x: number, y: number, group: number): void;
  /** Allocate a fresh group id for the next phase's emitters. */
  nextGroup(): number;
  /** Activate a phase: publish name/hp/timer to the sim, reset capture tracking. */
  beginPhase(spec: PhaseSpec): void;
  /** End a phase: mark that group's emitters done and clear the field (bullets +
   *  beams), the genre-standard screen clear on capture/transition. */
  endPhase(group: number): void;
  /** Current phase HP remaining (the sim drains it as the player shoots). */
  hp(): number;
  /** Current phase ticks remaining. */
  timeLeft(): number;
  /** Whether the current phase has been survived with no miss so far. */
  captured(): boolean;
}

export interface BossContext {
  /** Current sim tick. */
  readonly tick: number;
  /** The sim's seeded RNG — the only randomness source (same rule as emitters). */
  readonly rng: Rng;
  /** Boss position; children spawn here. (Static for the demo; a moving boss would
   *  need children to track it — a documented extension, not built.) */
  x: number;
  y: number;
  /** The shared aim target (the player). */
  readonly target: Readonly<Vec2>;
  /**
   * Run one phase: publish its metadata + HP/timer, spawn `body` (and any emitters
   * it `sub`-spawns) in a fresh group, then drive it until HP hits 0 (captured if
   * no miss) or the timer expires — clearing the group + field on the way out.
   * `yield*` it from the boss coroutine; it resolves to the outcome.
   */
  phase(spec: PhaseSpec, body: EmitterScript): Generator<number, PhaseResult, unknown>;
}

/** A boss: `ctx => function*`. `yield n` waits n ticks; `yield* ctx.phase(...)`
 *  runs a phase to its end. */
export type BossScript = (b: BossContext) => Generator<number, void, unknown>;

function* runPhase(
  deps: BossDeps,
  ctx: BossContext,
  spec: PhaseSpec,
  body: EmitterScript,
): Generator<number, PhaseResult, unknown> {
  const group = deps.nextGroup();
  deps.beginPhase(spec);
  deps.spawnChild(body, ctx.x, ctx.y, group);
  // Poll once per tick. HP and the timer are evolved by the sim (it reads
  // input.shoot); here we only read them to decide the transition. Reading hp
  // BEFORE this tick's sim-side drain means a phase ends one tick after HP truly
  // hits 0 — an imperceptible, fully deterministic lag.
  while (true) {
    if (deps.hp() <= 0) {
      const captured = deps.captured();
      deps.endPhase(group);
      return { captured, timedOut: false };
    }
    if (deps.timeLeft() <= 0) {
      deps.endPhase(group);
      return { captured: false, timedOut: true };
    }
    yield 1;
  }
}

/** Begin running `script` at (x, y) as the scheduler's group-0 root. */
export function startBoss(
  script: BossScript,
  x: number,
  y: number,
  startTick: number,
  deps: BossDeps,
): RunningEmitter {
  const ctx: BossContext = {
    tick: 0,
    rng: deps.rng,
    x,
    y,
    target: deps.target,
    phase(spec, body) {
      return runPhase(deps, ctx, spec, body);
    },
  };
  return { ctx, gen: script(ctx), resumeTick: startTick, done: false, group: 0 };
}
