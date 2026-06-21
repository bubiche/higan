// Player-vs-field collision, run inside the sim after the bullet/laser updates.
//
// This is a read-only pass over the bullet store: bullets do NOT despawn on graze
// (or, later, on hit) — Touhou bullets pass through the player — so there is no
// despawn-during-iteration hazard and no interaction with the free-list. The pass
// only writes the player's graze count and the per-bullet graze-once bit; the
// bullet data is otherwise untouched.
//
// Determinism (Hard Rule 2): the pass consumes ZERO randomness (so the emitter
// RNG stream is unaffected and every existing pattern replays byte-identically),
// iterates live slots in slot order (the existing deterministic order), and uses
// squared distance only (no sqrt). Its outputs — `player.graze` and the `grazed`
// bits — are folded into `sim.hash()`, so a divergence trips the determinism guard.
//
// SEAM (the player-lifecycle step builds on this): hit detection shares this exact
// loop — add `dist² <= (hitboxRadius + r)²` per bullet, plus a laser segment-vs-
// point test (a beam is the segment from its origin out to `length` along `angle`,
// with `width/2` as the half-thickness; only the fired phase collides) — and have
// the function return whether the player was hit. That response (deathbomb, lives,
// respawn, the bomb rising-edge) is a separate concern and lands with it.

import type { Player, PlayerConfig } from "./player";
import type { BulletSystem } from "../bullets/system";

/**
 * Graze pass: for every live bullet whose disc overlaps the player's graze radius
 * and has not yet been grazed, set its graze-once bit and increment `player.graze`.
 *
 * Once per bullet *lifetime* — the bit stays set, so a homing/waving bullet that
 * lingers in or re-enters graze range counts exactly once. Treating the bullet as
 * a disc of radius `radius[i]` (graze threshold = `grazeRadius + radius[i]`) means
 * a fat bullet grazes by its edge, not its centre — the physically sensible model
 * and still a pure squared-distance compare.
 */
export function stepCollision(player: Player, system: BulletSystem, config: PlayerConfig): void {
  const { x, y, radius, grazed } = system.store;
  const alive = system.alive;
  const hw = system.highWater;
  const px = player.x;
  const py = player.y;
  const grazeR = config.grazeRadius;

  for (let i = 0; i < hw; i++) {
    if (alive[i] === 0) continue;
    // Distance is computed for every live bullet (not skipped on the graze bit):
    // the hit test the player-lifecycle step adds here must still see a bullet that
    // grazed on an earlier tick and has since reached the hitbox. Only the graze
    // *write* is gated on the once-bit.
    const dx = x[i] - px;
    const dy = y[i] - py;
    const d2 = dx * dx + dy * dy;
    const gr = grazeR + radius[i];
    if (grazed[i] === 0 && d2 <= gr * gr) {
      grazed[i] = 1;
      player.graze++;
    }
  }
}
