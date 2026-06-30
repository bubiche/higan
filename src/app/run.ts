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
// The save/load buttons assemble the per-run replay from this. Each COMPLETED-and-
// continued play is a `priorSegment`; the live driver's recording is the current play;
// the saved blob is `[...priorSegments, currentPlay]`. A play becomes a prior segment
// exactly when the player chooses Continue — never at game-over itself, since a give-up
// play is not a prior segment of an ongoing run (the run ended).

import type { GameDefinition } from "../api/game";
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
  /** Completed plays that were CONTINUED past, in order — the run's pre-continue history.
   *  The current live play is the driver's recording, appended only at save time. */
  readonly priorSegments: readonly ReplaySegment[];
  /** Record a continued play: append it as a prior segment AND spend a continue. The two
   *  always happen together (a play becomes a prior segment exactly by being continued),
   *  so they are one operation and can't drift apart. */
  recordContinue(segment: ReplaySegment): void;
  /** Assemble the per-run replay blob: the prior (continued) segments followed by the
   *  current live play, stamped with the run's identity. */
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
): RunController {
  const runSeed = def.seed;
  const configId = computeConfigId(def);
  const priorSegments: ReplaySegment[] = [];
  let continuesUsed = 0;

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
    recordContinue(segment: ReplaySegment): void {
      priorSegments.push(segment);
      continuesUsed++;
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
