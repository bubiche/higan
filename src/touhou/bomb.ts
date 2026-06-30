// A character's bomb definition — the panic-clear, as authored content.
//
// A bomb is NOT a scripted coroutine: the player is a single O(1) entity, not an
// emitter (Hard Rule 1), so a bomb is declarative data that PARAMETERIZES the field
// clear the sim already runs — the same bullet-cancel transform a spell capture /
// phase transition fires (sim.ts `cancelBullets`). `BombConfig` says how much of the
// field a press clears, with how much boss damage, and whether it also nukes beams
// and vacuums items. (A scripted-timeline escape hatch — Master Spark, time-stop —
// is a deferred seam: BombConfig grows a `script?` when a real character needs one.)
//
// Like `ShotConfig`/`PlayerConfig` this is CONSTRUCTION input: the values feed
// deterministic sim state, but the object itself is NOT in the hash. The bomb's
// EFFECTS (bullets cancelled → point-items + score, boss damage, item vacuum,
// i-frames) ARE hashed — they mutate hashed sim state — so a different bomb yields a
// different, equally-reproducible trajectory. (The i-frame length lives in
// `PlayerConfig.bombInvuln`, a player timer beside `respawnInvuln`, not here.)

/**
 * A character's bomb definition — authored content, referenced by `CharacterDef`.
 * Defaults to `DEFAULT_BOMB_CONFIG` when a character omits one (a minimal game
 * needn't author a bomb).
 */
export interface BombConfig {
  /** Flat damage dealt to the active boss when the bomb fires (0 = pure defense, no
   *  boss dent). Lands only while a boss phase is live; a no-op during waves. */
  readonly bossDamage: number;
  /** Clear radius around the player, in sim units. `0` = the whole field (the
   *  full-screen defensive bomb); `>0` cancels only bullets within the circle. */
  readonly radius: number;
  /** Also clear every enemy laser (always global — `radius` is bullet-only). */
  readonly clearLasers: boolean;
  /** Pull every item on the field toward the player (always global). */
  readonly vacuumItems: boolean;
}

/** The engine's default bomb — the full-screen defensive clear with no boss damage.
 *  Exactly the behavior the sim ran before bombs became configurable, so a character
 *  that omits a bomb (or uses this) is byte-identical to the pre-bomb-config build. */
export const DEFAULT_BOMB_CONFIG: BombConfig = {
  bossDamage: 0,
  radius: 0,
  clearLasers: true,
  vacuumItems: true,
};
