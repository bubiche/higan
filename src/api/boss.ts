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
  /**
   * Endurance ("survival") spell: the boss cannot be damaged — player shots pass through,
   * homing ignores it, and a bomb dents nothing. The phase can only end by the timer, and
   * OUTLASTING it with no miss is the CAPTURE (the inverse of an ordinary phase, where a
   * timeout is a failed capture). Implies a spell card; pair with `isSpell: true` for the
   * spell HUD framing. Default false → an ordinary damageable phase. */
  readonly survival?: boolean;
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
  /** The run's difficulty rank, surfaced to the boss as `ctx.difficulty`. */
  readonly difficulty: number;
  /** The sim's single boss position — the boss root's `ctx.x/y` read/write it, and a
   *  phase body spawned via `spawnBody` shares it, so a moving boss's body, hit disc,
   *  and danmaku all track one point. Seeded to the boss origin at spawn. */
  readonly pos: Vec2;
  /** Spawn a phase BODY on the boss stream at (and sharing) `pos`, in `group`, resuming
   *  next tick — so if the body moves itself, `pos` (hence the body render + hit disc)
   *  moves with it and its danmaku originates from the live boss position. Distinct from
   *  the generic child spawn: only the phase body shares the boss position; the body's
   *  own `sub`-children remain independent. */
  spawnBody(script: EmitterScript, group: number): void;
  /** Allocate a fresh group id for the next phase's emitters. */
  nextGroup(): number;
  /** Activate a phase: publish name/hp/timer to the sim, reset capture tracking. */
  beginPhase(spec: PhaseSpec): void;
  /** End a phase: mark that group's emitters done and clear the field (bullets +
   *  beams), the genre-standard screen clear on capture/transition. `captured` (the
   *  no-miss-HP-drain outcome `runPhase` already computed) is threaded so the sim can
   *  award the spell-capture bonus — gameplay, so the sim owns it, not the script. */
  endPhase(group: number, captured: boolean): void;
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
  /** The run's difficulty rank (a 0-based index into the game's difficulties; higher
   *  = harder). Construction input the boss branches on to scale its own danmaku;
   *  not hashed (same rule as `EmitterContext.difficulty`). */
  readonly difficulty: number;
  /** Boss position — the live point the body renders at, the hit disc + homing track,
   *  and the current phase body fires from. Mutate it to move the boss: between phases
   *  in the boss root (over the auto-cleared field) to reposition, or inside a phase
   *  body to drift while firing (its danmaku originates from the moving point). Backed
   *  by the sim's single boss position, shared with the running phase body — but NOT
   *  with `sub`-spawned satellites, which snapshot it at spawn and don't follow. */
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
  spec: PhaseSpec,
  body: EmitterScript,
): Generator<number, PhaseResult, unknown> {
  const group = deps.nextGroup();
  deps.beginPhase(spec);
  // The phase body runs on the boss stream (protected from the player's clear-speed) and
  // SHARES the boss position — so if it moves itself, the boss body + hit disc move with
  // it and its danmaku fires from the live position (a boss that moves while firing).
  deps.spawnBody(body, group);
  // Poll once per tick. HP and the timer are evolved by the sim (it reads
  // input.shoot); here we only read them to decide the transition. Reading hp
  // BEFORE this tick's sim-side drain means a phase ends one tick after HP truly
  // hits 0 — an imperceptible, fully deterministic lag.
  while (true) {
    // HP-drain end. A survival phase never drains hp (the sim gates the damage on the same
    // flag), so this branch is unreachable for it — HP-capture is the ordinary path only.
    if (deps.hp() <= 0) {
      const captured = deps.captured();
      deps.endPhase(group, captured);
      return { captured, timedOut: false };
    }
    // Timeout end. For a SURVIVAL spell, outlasting the timer with no miss IS the capture
    // (endurance); for an ordinary phase, a timeout is a failed capture (the pre-existing
    // rule). `deps.captured()` is the no-miss tracker either way.
    if (deps.timeLeft() <= 0) {
      const captured = spec.survival === true && deps.captured();
      deps.endPhase(group, captured);
      return { captured, timedOut: true };
    }
    yield 1;
  }
}

/** Begin running `script` at (x, y) as the scheduler's group-0 root. The boss's x/y are
 *  backed by the shared `deps.pos` (seeded here), so the root moves the boss by mutating
 *  `ctx.x/y` and every consumer reads one point. */
export function startBoss(
  script: BossScript,
  x: number,
  y: number,
  startTick: number,
  deps: BossDeps,
): RunningEmitter {
  // Seed the shared boss position, then back the root's x/y with it (accessors), so the
  // root and the running phase body drive the same point — no snap when a phase ends and
  // the root resumes (they never run in the same tick, so one shared point is safe).
  deps.pos.x = x;
  deps.pos.y = y;
  const ctx: BossContext = {
    tick: 0,
    rng: deps.rng,
    difficulty: deps.difficulty,
    x,
    y,
    target: deps.target,
    phase(spec, body) {
      return runPhase(deps, spec, body);
    },
  };
  Object.defineProperty(ctx, "x", {
    get: () => deps.pos.x,
    set: (v: number) => {
      deps.pos.x = v;
    },
    enumerable: true,
    configurable: true,
  });
  Object.defineProperty(ctx, "y", {
    get: () => deps.pos.y,
    set: (v: number) => {
      deps.pos.y = v;
    },
    enumerable: true,
    configurable: true,
  });
  return { ctx, gen: script(ctx), resumeTick: startTick, done: false, group: 0 };
}
