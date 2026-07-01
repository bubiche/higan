// SFX event vocabulary — the shared language between the sim (which produces events)
// and the audio layer (which consumes them). A LEAF: no imports, so both `src/core`
// and `src/audio` can depend on it without a cycle, and `src/api` re-exports it as the
// author-facing SFX id set.
//
// These events are PRESENTATION. The sim accumulates a per-tick list during `step`, but
// the list is never hashed, never fed back into sim logic, and pushing to it consumes
// zero randomness — so it cannot affect a replay. Audio reads the list AFTER the step
// (see the driver↔SFX routing in the in-game screen); the sim never plays a sound. This
// is the same discipline that keeps the HUD a read-only view of sim state: producing a
// sound is a side effect of what already happened, not a thing the deterministic core does.

/**
 * A gameplay/UI sound the engine knows how to trigger. Gameplay ids (top group) are
 * emitted by the sim at fixed moments; UI ids (bottom group) are fired directly by the
 * shell screens (no sim runs on a menu). An author never plays these imperatively — they
 * only supply the SOUND for an id (the manifest's `sfx` map); the engine owns the WHEN.
 *
 * Plain `enum` (not `const enum`): under this project's `isolatedModules` +
 * `verbatimModuleSyntax` tsconfig, esbuild will not inline a `const enum`, and
 * re-exporting one through the `src/api` barrel is a known footgun. The runtime object
 * is negligible.
 */
export enum SfxId {
  // Gameplay — emitted by the sim (see sim.ts emission sites).
  Shoot,
  Graze,
  EnemyHit,
  EnemyDeath,
  Bomb,
  SpellDeclare,
  SpellCapture,
  ItemCollect,
  Extend,
  Pichuun,
  Cancel,
  PlayerDeathBomb,
  // UI — fired directly by screens, never by the sim.
  MenuMove,
  MenuConfirm,
  MenuCancel,
  Pause,
}

/**
 * One presentation cue, with optional presentation-only hints. `x`/`y`/`n` carry data the
 * sim already computed; they are NEVER read back into sim logic. The audio layer reads `x`
 * (pan) and `n` (intensity); the VFX layer additionally reads `y` to place sparks at the
 * event's playfield point. Both consume the SAME list after the step — see `render/vfx.ts`
 * and `audio/engine.ts`. Every field is optional so the sim's emit sites stay terse.
 */
export interface SfxEvent {
  readonly id: SfxId;
  /** Playfield x of the source, for stereo pan (audio) and spark origin (VFX). Omit → centre. */
  readonly x?: number;
  /** Playfield y of the source, for the spark origin (VFX). Omit → the field centre height.
   *  Audio ignores it. Added for M8 VFX; kept optional so the M7 emit sites didn't churn. */
  readonly y?: number;
  /** Batched count (e.g. bullets cancelled, items collected) for optional intensity
   *  scaling (louder SFX / a bigger spark burst). Presentation-only. */
  readonly n?: number;
}
