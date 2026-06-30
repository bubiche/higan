// Replay compatibility gating — app policy, not engine surface.
//
// A run replay reproduces bit-identically only against the same game DATA it was
// recorded under. `computeConfigId` fingerprints that data so a load can reject a blob
// recorded against a different build instead of replaying it into silent divergence.
// It lives in `app` (not `api`) on purpose: it is a policy the shell applies to its own
// save/load, and `api` may not import `core` (the layering runs core → api/touhou), so
// keeping the fingerprint here avoids pulling a hash helper the wrong way across the
// boundary. The shell stamps the id on save and checks it on load.
//
// What it covers, and why:
//   - Reproduction inputs — the data the sim reads for a given (seed, rank, input):
//     every character's movement/shot/bomb config, and the run economy (`scoring` + `item`).
//     The CHOSEN character feeds the trajectory; the others are folded in too as a
//     conservative over-reject (cheaper than tracking which index a blob used).
//   - Structural guards — the stage ids (which stages, in order) and the difficulty
//     ids. These don't themselves feed the trajectory (the rank is a captured NUMBER
//     the content scales on; the stage SCRIPT is what behaves), but a change to either
//     means the build the blob targeted is gone, so rejecting is the safe call.
// What it deliberately EXCLUDES:
//   - Scripts (stage/boss/emitter functions) — live code under the same-machine replay
//     contract; a script edit legitimately re-baselines, exactly as it does for the
//     determinism guard. (They aren't stably hashable anyway.)
//   - `title` and `seed` — cosmetic / captured separately (the blob carries its own
//     runSeed and replays from it).
//   - `config.continues` — bounds whether a continue is OFFERED live; it never enters a
//     recorded segment's trajectory, so it isn't a reproduction input.
// The cost of the over-rejects (extra characters, difficulty/stage ids): editing or
// adding such data re-baselines old replays. That is the safe failure direction — a
// rejected replay is visible, a mis-replayed one is not.

import type { GameDefinition } from "../api/game";
import { DEFAULT_DIFFICULTIES } from "../api/game";

/** FNV-1a over a UTF-16 code-unit stream, returned as an unsigned 32-bit int. */
function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Fingerprint the game's tunable data (see the module note for the boundary). Returns
 * a u32 stamped into a saved replay and compared on load; a mismatch means the blob was
 * recorded against different data and is rejected rather than replayed into divergence.
 * Stable across calls on the same definition and independent of the script functions.
 */
export function computeConfigId(def: GameDefinition): number {
  const data = {
    stages: def.stages.map((s) => s.id),
    characters: def.characters.map((c) => ({ config: c.config, shot: c.shot ?? null, bomb: c.bomb ?? null })),
    difficulties: (def.difficulties ?? DEFAULT_DIFFICULTIES).map((d) => d.id),
    scoring: def.config.scoring,
    item: def.config.item,
  };
  return fnv1a(JSON.stringify(data));
}
