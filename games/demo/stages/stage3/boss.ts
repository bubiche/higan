// Stage 3's headline boss — the Nocturne Sovereign, the campaign's final boss.
//
// Same public boss/emitter API as Stages 1–2, but two things make it the finale rather
// than a third recolour: it MOVES (it glides to a new station between phases over the
// auto-cleared field, and drifts gently while firing so its danmaku streams from the live
// point — the first moving boss in the demo), and it leans on `delay` (bullets that hang
// then snap), the one per-bullet behaviour the earlier bosses never used. Five ordered
// phases: an opening plus four spell cards, climbing to a denser lament. Pure of
// (rng, tick, target) like every script here, so it stays deterministic, replayable,
// hot-reloadable — movement included (the boss position is re-run, never serialized).

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

// The stage's astral/midnight palette — cool indigo + silver, distinct from Stage 1's
// azure and Stage 2's ember.
const INDIGO: readonly [number, number, number] = [0.5, 0.45, 1.0];
const SILVER: readonly [number, number, number] = [0.82, 0.88, 1.0];
const CYAN: readonly [number, number, number] = [0.5, 0.9, 1.0];
const STAR: readonly [number, number, number] = [1.0, 0.9, 0.55];
const MAUVE: readonly [number, number, number] = [0.85, 0.55, 1.0];

/** Reposition the boss to `(toX, toY)` over `ticks` ticks by lerping the shared boss
 *  position in the ROOT (between phases). The field is cleared and the boss is
 *  invulnerable during a transition, so this is the genre-standard "glide to the next
 *  station" — reading the live `b.x/b.y` as the start means no snap from wherever the
 *  prior phase's drift left it. */
function* glideTo(b: BossContext, toX: number, toY: number, ticks: number): Generator<number, void, unknown> {
  const fromX = b.x;
  const fromY = b.y;
  for (let i = 1; i <= ticks; i++) {
    b.x = fromX + (toX - fromX) * (i / ticks);
    b.y = fromY + (toY - fromY) * (i / ticks);
    yield 1;
  }
}

/** Phase 0 — "Prelude of Stars": a non-spell warm-up. Twin counter-rotating rings of
 *  silver orbs over a slow aimed cyan volley, while the boss sways gently (its danmaku
 *  streams from the moving centre). The rng jitter keeps the seeded path under the net. */
const preludeOfStars: EmitterScript = function* (ctx) {
  const baseX = ctx.x;
  let a = 0;
  let t = 0;
  while (true) {
    ctx.x = baseX + Math.sin(t * 0.045) * 30; // gentle sway — bullets fire from here
    ctx.ring({ count: scale(ctx.difficulty, 12, 2), speed: 74, angle: a + ctx.rng.range(-0.05, 0.05), radius: 4, color: SILVER, sprite: Shape.Orb });
    ctx.ring({ count: scale(ctx.difficulty, 12, 2), speed: 60, angle: -a, radius: 4, color: INDIGO, sprite: Shape.Orb });
    ctx.aimed({ count: scale(ctx.difficulty, 3, 1), spread: 0.4, speed: 165, radius: 4, color: CYAN, sprite: Shape.Kunai });
    a += 0.16;
    t++;
    yield 26;
  }
};

/** Phase 1 — "Star Sign 「Meteor Cascade」": a wide fan of stars that HANG in place (the
 *  `delay` behaviour — new to the campaign) then snap downward together like a meteor
 *  shower, staggered so a fresh curtain drops as the last one falls; a steady aimed spark
 *  keeps the player moving between curtains. */
const meteorCascade: EmitterScript = function* (ctx) {
  while (true) {
    const n = scale(ctx.difficulty, 9, 1);
    for (let i = 0; i < n; i++) {
      const frac = n === 1 ? 0.5 : i / (n - 1);
      // Fan them across the top, aimed downward, each hanging a beat then dropping.
      ctx.fire({
        x: ctx.x + (frac - 0.5) * 300,
        y: ctx.y,
        angle: Math.PI / 2, // straight down
        speed: 210,
        radius: 5,
        color: STAR,
        sprite: Shape.Star,
        behavior: delay(46),
      });
    }
    ctx.aimed({ count: scale(ctx.difficulty, 2, 1), spread: 0.24, speed: 175, radius: 4, color: MAUVE, sprite: Shape.Crystal });
    yield 40;
  }
};

/** Phase 2 — "Void Sign 「Gravity Well」": rings fired outward fast, then RAMPED to
 *  decelerate hard while curling (negative `dSpeed` + a turn), so the wall drifts out, slows,
 *  and wheels — a collapsing "well" that closes the gaps late. An aimed cross forces motion.
 *  The boss holds still here (the densest read gets a clean, stationary origin). */
const gravityWell: EmitterScript = function* (ctx) {
  let spin = 0;
  while (true) {
    ctx.ring({
      count: scale(ctx.difficulty, 15, 2),
      speed: 190,
      angle: spin,
      radius: 4,
      color: MAUVE,
      sprite: Shape.Bubble,
      behavior: ramp(-150, 0.9), // brake hard + wheel → a collapsing well
    });
    spin += 0.37;
    ctx.aimed({ count: 2, spread: 0.9, speed: 235, radius: 4, color: CYAN, sprite: Shape.Crystal });
    yield 30;
  }
};

/** Phase 3 — "Aurora Sign 「Prismatic Veil」": a rotating aurora curtain — three sweeping
 *  beams a third-circle apart, stepping a slow rotation, with snaking `wave` fill weaving
 *  between them and a homing spark on the off-beat. A laser+wave+home mix, but rotating as
 *  a curtain rather than Stage 1's rake or Stage 2's waltz. */
const prismaticVeil: EmitterScript = function* (ctx) {
  const cols = [CYAN, MAUVE, SILVER];
  let base = 0.4;
  while (true) {
    for (let i = 0; i < 3; i++) {
      ctx.laser({
        angle: base + (i / 3) * Math.PI * 2,
        length: 640,
        width: 12,
        color: cols[i]!,
        telegraph: 46,
        duration: 100,
        spin: 0.18,
      });
    }
    base += (Math.PI * 2) / 11; // a slow curtain rotation
    for (let k = 0; k < 5; k++) {
      ctx.fire({ speed: 108, angle: base + k * 1.27, radius: 4, color: SILVER, sprite: Shape.Oval, behavior: wave(22, 4) });
      if (k % 2 === 0) ctx.aimed({ count: 1, speed: 150, radius: 4, color: STAR, sprite: Shape.Heart, behavior: home(1.1) });
      yield scale(ctx.difficulty, 22, -3);
    }
  }
};

/** Phase 4 — "Nocturne 「Sovereign's Lament」": the climax. An expanding spiral bloom (a
 *  ring given a slow curl so successive rings shear into a galaxy) layered over an aimed
 *  accelerating punctuation and a slow silver backing ring, while the boss drifts gently.
 *  Denser than any earlier spell — the finale, not another opener. */
const sovereignsLament: EmitterScript = function* (ctx) {
  const baseX = ctx.x;
  let arm = 0;
  let t = 0;
  while (true) {
    ctx.x = baseX + Math.sin(t * 0.05) * 24;
    ctx.ring({ count: scale(ctx.difficulty, 10, 2), speed: 150, angle: arm, radius: 4, color: MAUVE, sprite: Shape.Star, behavior: curve(0.7) });
    ctx.ring({ count: scale(ctx.difficulty, 10, 2), speed: 150, angle: -arm * 1.3, radius: 4, color: CYAN, sprite: Shape.Star, behavior: curve(-0.7) });
    ctx.ring({ count: scale(ctx.difficulty, 18, 2), speed: 56, angle: arm * 0.5, radius: 4, color: INDIGO, sprite: Shape.Orb });
    ctx.aimed({ count: scale(ctx.difficulty, 2, 1), spread: 0.3, speed: 150, radius: 4, color: STAR, sprite: Shape.Kunai, behavior: accelerate(90) });
    arm += 0.42;
    t++;
    yield 20;
  }
};

/** The Nocturne Sovereign: five ordered phases (an opening + four spell cards), gliding to a
 *  new station between each — the campaign's moving final boss. */
export const NOCTURNE_BOSS: BossScript = function* (b) {
  // Stations are relative to the spawn origin (b.x/b.y are seeded there), so the boss reads
  // as pacing its arena without the script importing playfield constants.
  const homeX = b.x;
  const homeY = b.y;

  yield* b.phase({ name: "Prelude of Stars", hp: 820, timeLimit: 1000 }, preludeOfStars);
  yield* glideTo(b, homeX - 58, homeY, 30);
  yield* b.phase({ name: "Star Sign 「Meteor Cascade」", hp: 1020, timeLimit: 1320, isSpell: true }, meteorCascade);
  yield* glideTo(b, homeX, homeY, 26);
  yield* b.phase({ name: "Void Sign 「Gravity Well」", hp: 1020, timeLimit: 1320, isSpell: true }, gravityWell);
  yield* glideTo(b, homeX + 48, homeY - 10, 30);
  yield* b.phase({ name: "Aurora Sign 「Prismatic Veil」", hp: 1080, timeLimit: 1440, isSpell: true }, prismaticVeil);
  yield* glideTo(b, homeX, homeY - 6, 26);
  yield* b.phase({ name: "Nocturne 「Sovereign's Lament」", hp: 1200, timeLimit: 1560, isSpell: true }, sovereignsLament);
};

/** The Nocturne Sovereign's on-field body, drawn at the (moving) boss position during the
 *  encounter. Passed as the second `ctx.boss` argument (the headline boss takes no script). */
export const NOCTURNE_BOSS_VISUAL: BossVisual = {
  sprite: demoSprites.sovereignBody,
  color: [0.66, 0.62, 1.0], // indigo-silver, echoing her portrait
  radius: 30,
};
