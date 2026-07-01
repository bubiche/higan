// The engine's determinism self-test harness — what a game's bootstrap imports to
// guard its OWN content. This is deliberately NOT part of the authoring surface
// (`higan`): a shipped game dead-strips it under `import.meta.env.DEV`, and keeping it
// on its own subpath means the authoring API stays the runtime vocabulary while this
// stays the dev-time tripwire.
//
//   - `assertDeterministic` runs a stage twice and asserts a bit-identical trajectory
//     hash (the continuous nondeterminism guard — Hard Rule 2).
//   - `assertStreamIsolation` proves the boss danmaku RNG stream is independent of how
//     much the player kills (the per-stream-RNG invariant).
//   - `mixSeed` reproduces the engine's run-seed → stage-seed mixing, so a guard
//     exercises the exact seed the live in-game scene runs on.
//   - `PATTERN_TICKS` is the per-pattern tick budget guards size their windows against.

export { assertDeterministic } from "../core/determinism";
export { assertStreamIsolation } from "../core/isolation";
export { mixSeed } from "../core/prng";
export { PATTERN_TICKS } from "../core/sim";
