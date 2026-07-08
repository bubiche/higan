// The Extra stage's headline boss — the Crimson Shorekeeper, warden of the far shore.
//
// The post-campaign challenge: authored in the exact same boss/emitter API as the three
// campaign finals, but denser and faster, and it MOVES like the Nocturne Sovereign (gliding
// between stations over the cleared field, drifting while firing so its danmaku streams from
// the live point). Four ordered phases — an opening plus three spell cards — leaning on the
// full behaviour vocabulary (curve / delay / ramp / home / accelerate) the campaign spread
// across its stages, now stacked into one fight. Pure of (rng, tick, target) like every
// script here, so it stays deterministic, replayable, and hot-reloadable — movement included.

import {
  type BossContext,
  type BossScript,
  type BossVisual,
  type EmitterScript,
  accelerate,
  curve,
  delay,
  home,
  ramp,
  wave,
  Shape,
} from "higan";
import { scale } from "../../difficulty";
import { demoSprites } from "../../sprites";

// The far-shore palette — crimson + scarlet + violet + bone, the most saturated of the game.
const CRIMSON: readonly [number, number, number] = [1.0, 0.2, 0.3];
const SCARLET: readonly [number, number, number] = [1.0, 0.42, 0.2];
const VIOLET: readonly [number, number, number] = [0.78, 0.35, 1.0];
const BONE: readonly [number, number, number] = [1.0, 0.92, 0.82];
const GOLD: readonly [number, number, number] = [1.0, 0.85, 0.4];

/** Reposition the boss to `(toX, toY)` over `ticks` ticks by lerping the shared boss position
 *  in the ROOT (between phases). The field is cleared and the boss invulnerable during a
 *  transition, so this is the genre-standard "glide to the next station" — reading the live
 *  `b.x/b.y` as the start means no snap from wherever the prior phase's drift left it. */
function* glideTo(b: BossContext, toX: number, toY: number, ticks: number): Generator<number, void, unknown> {
  const fromX = b.x;
  const fromY = b.y;
  for (let i = 1; i <= ticks; i++) {
    b.x = fromX + (toX - fromX) * (i / ticks);
    b.y = fromY + (toY - fromY) * (i / ticks);
    yield 1;
  }
}

/** Phase 0 — "Threshold Bloom": a non-spell warm-up already denser than a campaign opener.
 *  Twin counter-rotating rings of scarlet orbs over an aimed crimson volley, while the boss
 *  sways wide (its danmaku streams from the moving centre). */
const thresholdBloom: EmitterScript = function* (ctx) {
  const baseX = ctx.x;
  let a = 0;
  let t = 0;
  while (true) {
    ctx.x = baseX + Math.sin(t * 0.05) * 44; // wide sway — bullets fire from here
    ctx.ring({ count: scale(ctx.difficulty, 16, 2), speed: 82, angle: a + ctx.rng.range(-0.05, 0.05), radius: 4, color: SCARLET, sprite: Shape.Orb });
    ctx.ring({ count: scale(ctx.difficulty, 14, 2), speed: 64, angle: -a * 1.2, radius: 4, color: CRIMSON, sprite: Shape.Orb });
    ctx.aimed({ count: scale(ctx.difficulty, 3, 1), spread: 0.42, speed: 180, radius: 4, color: BONE, sprite: Shape.Kunai });
    a += 0.18;
    t++;
    yield 22;
  }
};

/** Phase 1 — "Lily Sign 「Spider Lily Bloom」": rings of petals fired outward and given a hard
 *  curl (`curve`) so successive rings shear into overlapping blooms — the spider-lily fan —
 *  with a hanging (`delay`) crimson curtain that snaps down between blooms. */
const spiderLilyBloom: EmitterScript = function* (ctx) {
  let arm = 0;
  let beat = 0;
  while (true) {
    ctx.ring({ count: scale(ctx.difficulty, 13, 2), speed: 150, angle: arm, radius: 4, color: CRIMSON, sprite: Shape.Star, behavior: curve(0.8) });
    ctx.ring({ count: scale(ctx.difficulty, 13, 2), speed: 150, angle: -arm, radius: 4, color: VIOLET, sprite: Shape.Star, behavior: curve(-0.8) });
    // Every third beat, a wide fan of petals hangs then drops (the delay behaviour).
    if (beat % 3 === 0) {
      const n = scale(ctx.difficulty, 11, 1);
      for (let i = 0; i < n; i++) {
        const frac = n === 1 ? 0.5 : i / (n - 1);
        ctx.fire({ x: ctx.x + (frac - 0.5) * 320, y: ctx.y, angle: Math.PI / 2, speed: 200, radius: 5, color: SCARLET, sprite: Shape.Star, behavior: delay(42) });
      }
    }
    arm += 0.4;
    beat++;
    yield 28;
  }
};

/** Phase 2 — "Shore Sign 「Sanzu Crossing」": three rotating beams a third-circle apart (the
 *  river of the dead), with a snaking `wave` fill weaving between them and a homing spark on
 *  the off-beat — a laser+wave+home lattice the player crosses. The boss holds still (the
 *  densest lattice gets a clean, stationary origin). */
const sanzuCrossing: EmitterScript = function* (ctx) {
  const cols = [CRIMSON, VIOLET, SCARLET];
  let base = 0.5;
  while (true) {
    for (let i = 0; i < 3; i++) {
      ctx.laser({ angle: base + (i / 3) * Math.PI * 2, length: 640, width: 13, color: cols[i]!, telegraph: 44, duration: 104, spin: 0.2 });
    }
    base += (Math.PI * 2) / 9; // a faster curtain rotation than the campaign's
    for (let k = 0; k < 6; k++) {
      ctx.fire({ speed: 116, angle: base + k * 1.05, radius: 4, color: BONE, sprite: Shape.Oval, behavior: wave(24, 4) });
      if (k % 2 === 0) ctx.aimed({ count: 1, speed: 160, radius: 4, color: GOLD, sprite: Shape.Heart, behavior: home(1.3) });
      yield scale(ctx.difficulty, 19, -3);
    }
  }
};

/** Phase 3 — "Higan 「Equinox of the Departed」": the climax. An expanding spiral bloom (rings
 *  curled into a galaxy) layered over an aimed accelerating punctuation and a slow bone backing
 *  ring, while the boss drifts. The densest pattern in the game — the far shore's farewell. */
const equinoxOfTheDeparted: EmitterScript = function* (ctx) {
  const baseX = ctx.x;
  let arm = 0;
  let t = 0;
  while (true) {
    ctx.x = baseX + Math.sin(t * 0.055) * 30;
    ctx.ring({ count: scale(ctx.difficulty, 12, 2), speed: 158, angle: arm, radius: 4, color: CRIMSON, sprite: Shape.Star, behavior: curve(0.75) });
    ctx.ring({ count: scale(ctx.difficulty, 12, 2), speed: 158, angle: -arm * 1.3, radius: 4, color: VIOLET, sprite: Shape.Star, behavior: curve(-0.75) });
    ctx.ring({ count: scale(ctx.difficulty, 20, 3), speed: 58, angle: arm * 0.5, radius: 4, color: SCARLET, sprite: Shape.Orb });
    ctx.aimed({ count: scale(ctx.difficulty, 3, 1), spread: 0.32, speed: 150, radius: 4, color: BONE, sprite: Shape.Kunai, behavior: accelerate(96) });
    arm += 0.44;
    t++;
    yield 18;
  }
};

/** The Crimson Shorekeeper: four ordered phases (an opening + three spell cards), gliding to a
 *  new station between each — the Extra stage's moving boss. Denser and faster than the
 *  campaign finals; the post-clear challenge. */
export const SHOREKEEPER_BOSS: BossScript = function* (b) {
  // Stations relative to the spawn origin (b.x/b.y are seeded there), so the boss paces its
  // arena without the script importing playfield constants.
  const homeX = b.x;
  const homeY = b.y;

  yield* b.phase({ name: "Threshold Bloom", hp: 900, timeLimit: 1080 }, thresholdBloom);
  yield* glideTo(b, homeX - 64, homeY + 8, 30);
  yield* b.phase({ name: "Lily Sign 「Spider Lily Bloom」", hp: 1120, timeLimit: 1440, isSpell: true }, spiderLilyBloom);
  yield* glideTo(b, homeX + 56, homeY, 28);
  yield* b.phase({ name: "Shore Sign 「Sanzu Crossing」", hp: 1160, timeLimit: 1500, isSpell: true }, sanzuCrossing);
  yield* glideTo(b, homeX, homeY - 8, 26);
  yield* b.phase({ name: "Higan 「Equinox of the Departed」", hp: 1320, timeLimit: 1680, isSpell: true }, equinoxOfTheDeparted);
};

/** The Crimson Shorekeeper's on-field body — the spider-lily bloom, drawn at the (moving) boss
 *  position during the encounter. Passed as the second `ctx.boss` argument (the headline boss
 *  takes no script). */
export const SHOREKEEPER_BOSS_VISUAL: BossVisual = {
  sprite: demoSprites.shorekeeperBody,
  color: [1.0, 0.32, 0.4], // saturated crimson, echoing her portrait
  radius: 30,
};
