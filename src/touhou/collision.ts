// Player-vs-field collision, run inside the sim after the bullet/laser updates.
//
// This is a read-only pass over the bullet store and the laser pool: nothing
// despawns on graze or hit — Touhou bullets and beams pass through the player —
// so there is no despawn-during-iteration hazard and no interaction with the
// free-list. The pass writes only the player's graze count and the per-bullet
// graze-once bit, and REPORTS whether the player was hit; the death/bomb response
// (the consumer) lives in the player lifecycle step, not here.
//
// Determinism (Hard Rule 2): the pass consumes ZERO randomness (so the emitter
// RNG stream is unaffected and every existing pattern replays byte-identically),
// iterates live slots in slot order (the existing deterministic order), and uses
// squared distance only (no sqrt) for the disc tests. The graze outputs fold into
// `sim.hash()`; the hit drives player state, which is also hashed — so a
// divergence in either trips the determinism guard.

import { PlayerState, type Player, type PlayerConfig } from "./player";
import type { BulletSystem } from "../bullets/system";
import type { LaserSystem } from "./laser";

/**
 * One collision pass: graze (a write) for every live bullet whose disc overlaps
 * the player's graze radius and has not yet been grazed, and hit detection (a
 * read) against bullets and live laser beams. Returns whether the player was hit.
 *
 * Graze is once per bullet *lifetime* — the bit stays set, so a homing/waving
 * bullet that lingers in or re-enters graze range counts exactly once. Treating
 * the bullet as a disc of radius `radius[i]` (threshold = `grazeRadius + radius[i]`)
 * means a fat bullet grazes by its edge, not its centre.
 *
 * Hit detection runs only while the player is vulnerable (`hittable`): Alive and
 * not in i-frames. Graze is NOT gated on that — grazing while invulnerable is fine.
 * The hitbox is the tiny `hitboxRadius` pinprick (vs the much larger graze radius),
 * so a near-miss grazes without killing. Distance is computed for every live bullet
 * regardless of the graze bit, because a bullet that grazed on an earlier tick can
 * still reach the hitbox later — only the graze *write* is gated on the once-bit.
 */
export function stepCollision(
  player: Player,
  system: BulletSystem,
  lasers: LaserSystem,
  config: PlayerConfig,
): { hit: boolean } {
  const { x, y, radius, grazed } = system.store;
  const alive = system.alive;
  const hw = system.highWater;
  const px = player.x;
  const py = player.y;
  const grazeR = config.grazeRadius;
  const hitR = config.hitboxRadius;
  // Vulnerable only while alive and out of i-frames. Gates BOTH hit loops below
  // (bullets and lasers) — leaving lasers ungated would let a beam kill through
  // i-frames / a respawn / an open deathbomb window.
  const hittable = player.state === PlayerState.Alive && player.invulnTicks === 0;
  let hit = false;

  for (let i = 0; i < hw; i++) {
    if (alive[i] === 0) continue;
    const dx = x[i] - px;
    const dy = y[i] - py;
    const d2 = dx * dx + dy * dy;
    // Graze: once per lifetime, regardless of hittability.
    if (grazed[i] === 0) {
      const gr = grazeR + radius[i];
      if (d2 <= gr * gr) {
        grazed[i] = 1;
        player.graze++;
      }
    }
    // Hit: only while vulnerable. `hit` is an OR over a deterministic slot order,
    // so the short-circuit is order-deterministic (determinism trap #2).
    if (hittable && !hit) {
      const hr = hitR + radius[i];
      if (d2 <= hr * hr) hit = true;
    }
  }

  // Laser segment-vs-point: a beam is the segment from its origin out to `length`
  // along its (already-swept) `angle`, with `width/2` as the half-thickness. Only
  // the FIRED phase collides — the telegraph is a warning, and the fade is cosmetic
  // (full width stays lethal through it). Player hit when the disc of radius
  // `hitboxRadius` reaches within `hitboxRadius + width/2` of the segment.
  if (hittable && !hit) {
    const pool = lasers.lasers;
    for (let i = 0; i < pool.length; i++) {
      const l = pool[i];
      if (!l.alive) continue;
      if (l.age < l.telegraph || l.age >= l.telegraph + l.duration) continue;
      const dxs = Math.cos(l.angle);
      const dys = Math.sin(l.angle);
      const wx = px - l.x;
      const wy = py - l.y;
      // Project the player onto the beam, clamped to the segment [0, length].
      let t = wx * dxs + wy * dys;
      if (t < 0) t = 0;
      else if (t > l.length) t = l.length;
      const ex = px - (l.x + dxs * t);
      const ey = py - (l.y + dys * t);
      const thr = hitR + l.width * 0.5;
      if (ex * ex + ey * ey <= thr * thr) {
        hit = true;
        break;
      }
    }
  }

  return { hit };
}
