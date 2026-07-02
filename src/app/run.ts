// Run controller — the run-scoped state that outlives any single stage sim.
//
// A run is more than one play of the simulation. A CONTINUE rebuilds a fresh sim
// (resetting score, restoring lives) but the run carries on; a later stage chains a new
// sim with the run's state handed across. So the in-game screen and its sim driver are
// rebuilt repeatedly within ONE run (continue, retry-into-fresh, hot-reload), and the
// state that must NOT reset with them lives here instead: the run's IDENTITY (seed,
// rank, character, the data fingerprint) and its accumulated continue history. One
// object, threaded through the screen constructors, that survives `router.replace` — a
// continue replaces the in-game screen but passes the SAME controller into the next one,
// which is exactly what lets a run span the rebuild.
//
// It is run-level META, entirely above the sim — nothing here enters the determinism
// hash. `continuesUsed` and the segment log are record-keeping; difficulty/character are
// construction inputs the content branches on, not gameplay outcomes. See replay-compat.
//
// The save/load buttons assemble the per-run replay from this. Each play the run moved
// PAST — by a continue (game-over → keep going) or a stage-advance (clear → next stage) —
// is a `priorSegment`; the live driver's recording is the current play; the saved blob is
// `[...priorSegments, currentPlay]`. A play becomes a prior segment exactly when the run
// carries on past it: on Continue or on advancing to the next stage — never at game-over
// itself, since a give-up play is not a prior segment of an ongoing run (the run ended).
// A continue repeats the current stage index (state reset); an advance is index +1 (state
// carried) — the delta between consecutive segments is what a loaded replay reads back to
// tell the two apart and reconstruct each stage's carry-in.

import type { GameDefinition } from "../api/game";
import type { CarryIn } from "../touhou/player";
import type { ReplaySegment, RunReplay } from "../touhou/replay";
import { computeConfigId } from "./replay-compat";

/** Default character index — the fallback `createRunController` uses when a caller
 *  doesn't pass one (a single-character game, where the select screen is skipped). The
 *  character screen passes a real chosen index; the replay blob captures whichever it is. */
export const CHARACTER_INDEX = 0;

export interface RunController {
  /** Run seed — the root the per-stage seeds derive from (the driver mixes it per
   *  stage). Shared by every segment of a run. */
  readonly runSeed: number;
  /** Current difficulty rank (a 0-based index into the game's difficulties). MUTABLE:
   *  loading a replay adopts its recorded rank so the rebuilt sim runs at it. */
  difficulty: number;
  /** Chosen character index (a 0-based index into the game's characters). MUTABLE:
   *  loading a replay adopts its recorded character so the rebuilt sim runs as it —
   *  exactly as `difficulty` adopts the recorded rank. */
  character: number;
  /** Fingerprint of the game DATA this run was created against — stamped into a save and
   *  checked on load (see replay-compat.ts). */
  readonly configId: number;
  /** Continues spent so far (0 on a fresh run). */
  readonly continuesUsed: number;
  /** Completed plays that were CONTINUED past OR ADVANCED past, in order — the run's
   *  pre-current history. A continue and a stage-advance both append here (they differ
   *  only in whether a continue is spent and whether run-state carries); the current live
   *  play is the driver's recording, appended only at save time. */
  readonly priorSegments: readonly ReplaySegment[];
  /** The stage index the next sim build runs (an index into `def.stages`). Live
   *  progression advances it via `advanceStage`; loading a replay sets it per segment IN
   *  PLACE — the same adopt-in-place pattern as `difficulty`/`character`. */
  currentStageIndex: number;
  /** Run-economy state handed into the next stage's sim, or null for a fresh full-resource
   *  start (stage 1, a continue-restart, a standalone Extra/practice run). Set by
   *  `advanceStage`; reset to null by `recordContinue`; set per segment during replay
   *  playback. The sim applies it right after building the player. Never hashed — it is a
   *  deterministic outcome of the prior stage, entering the next stage's hash as init state. */
  carryIn: CarryIn | null;
  /** True while the run has a stage after the current one — so a stage-clear ADVANCES
   *  (handing state forward) rather than ending the run. False on the final stage and on
   *  any standalone single-stage run (Extra/practice). */
  readonly hasNextStage: boolean;
  /** Record a continued play: append it as a prior segment AND spend a continue, then drop
   *  any carried-in run-state (a continue restarts the CURRENT stage from a fresh full-
   *  resource start). The append + the continue always happen together (a play becomes a
   *  prior segment exactly by being continued), so they are one operation and can't drift. */
  recordContinue(segment: ReplaySegment): void;
  /** Record a stage-advance on a clear: append the finished play as a prior segment
   *  (WITHOUT spending a continue — an advance is not a continue) and move to the next
   *  stage, stashing the run-economy state it starts from. The mirror of `recordContinue`:
   *  same append, but it progresses the stage and CARRIES state instead of resetting it. */
  advanceStage(segment: ReplaySegment, carryIn: CarryIn): void;
  /** Assemble the per-run replay blob: the prior (continued/advanced) segments followed by
   *  the current live play, stamped with the run's identity. */
  assembleReplay(currentPlay: ReplaySegment): RunReplay;
}

/** Start a fresh run at `difficulty` as `character`: the game's seed, the chosen
 *  character (defaulting to `CHARACTER_INDEX` when a caller omits it — a single-character
 *  game that skips the select screen), a data fingerprint, no continues spent, no prior
 *  segments. A continue REUSES the resulting controller (the run goes on); a retry / new
 *  run builds a fresh one (a clean run, no carried-over history) — see the pause/title/
 *  select screens. */
export function createRunController(
  def: GameDefinition,
  difficulty: number,
  character: number = CHARACTER_INDEX,
  stageSequence?: readonly number[],
): RunController {
  const runSeed = def.seed;
  const configId = computeConfigId(def);
  const priorSegments: ReplaySegment[] = [];
  let continuesUsed = 0;
  // The ordered stage indices this run plays. Default = the main campaign chain: the
  // non-`extra` stages in def order (a contiguous prefix — defineGame enforces extra
  // stages come last). A standalone run (Extra/practice) passes an explicit [k]. The
  // sequence is NOT stored in a replay blob — a loaded run's segment stage-indices ARE
  // its sequence (a continue repeats an index, an advance is +1), so playback drives
  // `currentStageIndex` per segment rather than walking this.
  const sequence: readonly number[] = stageSequence ?? def.stages.flatMap((s, i) => (s.extra ? [] : [i]));
  let cursor = 0;
  let currentStageIndex = sequence[cursor]!;
  let carryIn: CarryIn | null = null;

  return {
    runSeed,
    difficulty,
    character,
    configId,
    get continuesUsed(): number {
      return continuesUsed;
    },
    get priorSegments(): readonly ReplaySegment[] {
      return priorSegments;
    },
    get currentStageIndex(): number {
      return currentStageIndex;
    },
    set currentStageIndex(i: number) {
      currentStageIndex = i;
    },
    get carryIn(): CarryIn | null {
      return carryIn;
    },
    set carryIn(c: CarryIn | null) {
      carryIn = c;
    },
    get hasNextStage(): boolean {
      return cursor < sequence.length - 1;
    },
    recordContinue(segment: ReplaySegment): void {
      priorSegments.push(segment);
      continuesUsed++;
      // A continue restarts the CURRENT stage from a fresh full-resource start (today's
      // "reset score + restore lives" economy), so drop any carried-in state; the stage
      // index is unchanged (still the stage the player died on).
      carryIn = null;
    },
    advanceStage(segment: ReplaySegment, nextCarryIn: CarryIn): void {
      priorSegments.push(segment);
      cursor++;
      currentStageIndex = sequence[cursor]!;
      carryIn = nextCarryIn;
    },
    assembleReplay(currentPlay: ReplaySegment): RunReplay {
      return {
        runSeed,
        difficulty: this.difficulty,
        character: this.character,
        configId,
        segments: [...priorSegments, currentPlay],
      };
    },
  };
}
