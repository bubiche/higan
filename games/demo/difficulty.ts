// The reference game's difficulty ranks — authored content, not engine.
//
// A rank is the INDEX into the game's `difficulties[]` list, surfaced to content as
// `ctx.difficulty`. Content reads that index and scales its OWN density/HP; the engine
// holds no multiplier table (a different game defines its own ranks, labels, and
// scaling with zero change under `src/` — the maker thesis). The select screen lists
// `difficulties[i].label`/`.description`; choosing entry `i` runs the stage at rank `i`.
//
// NORMAL is the anchor. `scale(...)` is the identity at NORMAL, so at Normal every
// wave/boss count is its base literal and the reference trajectory — hence the
// determinism guard's hash — is the unchanged baseline. Easy thins it, Hard/Lunatic
// thicken it. Keeping the anchor at the baseline is what proves adding difficulty was a
// no-op for the reference rank rather than a silent retuning.

/** The reference game's four ranks; the value is the index into `difficulties[]`. */
export const Rank = { Easy: 0, Normal: 1, Hard: 2, Lunatic: 3 } as const;

/** The anchor rank — `scale` returns its base unchanged here. */
export const NORMAL: number = Rank.Normal;

/**
 * Linear density/HP scale centred on NORMAL: returns `base` exactly at NORMAL and
 * steps `perRank` for each rank away from it (Easy thins, Lunatic thickens). Integer
 * in → integer out, so it is safe for bullet/enemy counts; keep `perRank < base` so
 * the thinned Easy value never drops below 1.
 */
export function scale(difficulty: number, base: number, perRank: number): number {
  return base + (difficulty - NORMAL) * perRank;
}
