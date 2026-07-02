// Stage 2's scene script — authored against the public stage API, same idiom as Stage 1.
//
// A stage is the scene root: a coroutine that `yield`s to wait, `spawnEnemy`s waves over
// time, and `yield* ctx.boss(...)`s each encounter. Stage 2 runs opening waves → a midboss
// → more waves → the final boss, then RETURNS (the run ends). It never needs to know it is
// the last stage — it returns when its boss falls, exactly like Stage 1; the shell decides
// whether that advances to a next stage or ends the run. Its enemies + palette are warm
// (dusk/ember) to contrast Stage 1's cool azure — new content, not a recolour of the same waves.

import { type StageScript, type StageContext, type EmitterScript, type Dialogue, accelerate, Shape, PLAYFIELD_W } from "higan";
import { scale } from "../../difficulty";
import { EMBER_MIDBOSS, EMBER_MIDBOSS_VISUAL } from "./midboss";
import { EMBER_BOSS_VISUAL } from "./boss";
import { demoSprites } from "../../sprites";
import { demoPortraits } from "../../portraits";

const EMBER: readonly [number, number, number] = [1.0, 0.5, 0.2];
const ROSE: readonly [number, number, number] = [1.0, 0.45, 0.55];
const GOLD: readonly [number, number, number] = [1.0, 0.82, 0.4];

// ── Enemy AI (each an emitter the sim binds to a hittable enemy slot) ───────────
// As in Stage 1, an enemy's `ctx.x/y` IS its position and `ctx.aimed/ring` fire its danmaku
// on the enemy stream; all pure of (rng, tick, target). They end by returning, dying, or
// off-field cull.

/** Moth: drifts down in a shallow weave to a hover band, looses two aimed ember fans, then
 *  flutters off the bottom (the field cull frees it). */
const moth: EmitterScript = function* (ctx) {
  for (let i = 0; i < 40; i++) {
    ctx.x += Math.sin(i * 0.18) * 1.6;
    ctx.y += 2.3;
    yield 1;
  }
  for (let i = 0; i < 2; i++) {
    ctx.aimed({ count: scale(ctx.difficulty, 3, 1), spread: 0.5, speed: 145, sprite: Shape.Rice, color: EMBER });
    yield 34;
  }
  for (let i = 0; i < 130; i++) {
    ctx.x += Math.sin(i * 0.18) * 1.6;
    ctx.y += 3.6;
    yield 1;
  }
};

/** Glider: enters from one edge at a fixed height, slides across the upper band lobbing
 *  small jittered rings, and exits the far side (culled). `dir` +1 = left→right, -1 = the
 *  reverse. */
const glider = (dir: number): EmitterScript =>
  function* (ctx) {
    for (let i = 0; i < 230; i++) {
      ctx.x += dir * 2.5;
      if (i % 50 === 30) {
        ctx.ring({ count: scale(ctx.difficulty, 6, 1), speed: 90, angle: ctx.rng.range(0, Math.PI * 2), radius: 4, color: GOLD, sprite: Shape.Orb });
      }
      yield 1;
    }
  };

/** Brazier: a tankier turret — dives to a hover, looses a few slow ACCELERATING ring bursts
 *  (the ring drifts out then quickens), then retreats up off the top (culled). The stage's
 *  item anchor, like Stage 1's turrets. */
const brazier: EmitterScript = function* (ctx) {
  for (let i = 0; i < 32; i++) {
    ctx.y += 2.1;
    yield 1;
  }
  for (let i = 0; i < 4; i++) {
    ctx.ring({
      count: scale(ctx.difficulty, 12, 2),
      speed: 60,
      angle: ctx.rng.range(0, Math.PI * 2),
      radius: 4,
      color: ROSE,
      sprite: Shape.Orb,
      behavior: accelerate(40),
    });
    yield 44;
  }
  for (let i = 0; i < 80; i++) {
    ctx.y -= 3;
    yield 1;
  }
};

/** Spawn `n` moths across the top on a lane stagger, `gap` ticks apart. */
function* mothLine(ctx: StageContext, n: number, gap: number): Generator<number, void, unknown> {
  for (let i = 0; i < n; i++) {
    const x = (PLAYFIELD_W * (i + 1)) / (n + 1);
    ctx.spawnEnemy(moth, x, -12, {
      hp: 70,
      radius: 14,
      sprite: demoSprites.fairy,
      color: EMBER,
      drops: { power: 1, point: 1 },
    });
    yield gap;
  }
}

// ── Dialogue (portraits + name labels, multi-speaker, pre/post-boss) ──
// `ctx.dialogue()` is a zero-tick call, so a line placed directly before `yield* ctx.boss()`
// costs no ticks: the boss appears the same tick the box opens (frozen behind it).

const OPENING_DIALOGUE: Dialogue = [
  { name: "Heroine", portrait: demoPortraits.heroine, text: "The sky's gone to embers. We must be close now." },
];

const PRE_BOSS_DIALOGUE: Dialogue = [
  { name: "Heroine", portrait: demoPortraits.heroine, side: "left", text: "You're the one setting the whole dusk alight?" },
  { name: "Ember Songstress", portrait: demoPortraits.songstress, side: "right", text: "Every spark out here dances to my song." },
  { name: "Ember Songstress", portrait: demoPortraits.songstress, side: "right", text: "Stay a while — and hear its final verse!" },
];

const POST_BOSS_DIALOGUE: Dialogue = [
  { name: "Ember Songstress", portrait: demoPortraits.songstress, side: "right", text: "...The last ember dims. You heard me out after all." },
  { text: "The dusk settles into quiet. The journey reaches its end." }, // unattributed narrator line
];

/** Stage 2: opening waves → midboss → more waves → final boss. Same structure as Stage 1;
 *  warm dusk enemies and the Ember Songstress in place of the Gatekeeper. */
export const emberStage: StageScript = function* (ctx) {
  ctx.dialogue(OPENING_DIALOGUE);

  // ── Opening waves ──
  yield* mothLine(ctx, scale(ctx.difficulty, 5, 1), 38);
  yield 70;
  ctx.spawnEnemy(glider(1), -12, 84, {
    hp: 100,
    radius: 14,
    sprite: demoSprites.fairy,
    color: GOLD,
    drops: { power: 2, point: 2 },
  });
  ctx.spawnEnemy(glider(-1), PLAYFIELD_W + 12, 130, {
    hp: 100,
    radius: 14,
    sprite: demoSprites.fairy,
    color: GOLD,
    drops: { power: 2, point: 2 },
  });
  yield 170;
  yield* mothLine(ctx, scale(ctx.difficulty, 4, 1), 34);
  yield 130;

  // ── Midboss ── awaited: the stage pauses here and the waves below resume when it falls.
  // Second argument = its on-field body (the shared familiar, tinted for this stage).
  yield* ctx.boss(EMBER_MIDBOSS, EMBER_MIDBOSS_VISUAL);
  yield 90;

  // ── Post-midboss waves ── the braziers are the stage's item anchors: one drops a life,
  // the other a full-power, so a full clear shows every item type.
  ctx.spawnEnemy(brazier, PLAYFIELD_W * 0.3, -12, {
    hp: 165,
    radius: 16,
    sprite: demoSprites.sentinel,
    color: ROSE,
    drops: { power: 3, point: 4, bomb: 1, life: 1 },
  });
  ctx.spawnEnemy(brazier, PLAYFIELD_W * 0.7, -12, {
    hp: 165,
    radius: 16,
    sprite: demoSprites.sentinel,
    color: ROSE,
    drops: { power: 3, point: 4, fullPower: 1 },
  });
  yield 210;
  yield* mothLine(ctx, scale(ctx.difficulty, 6, 1), 28);
  yield 150;

  // ── Final boss ── the stage RETURNS when it falls → the run ends "clear". No script (it
  // runs `StageDef.boss`), so the body is the second argument.
  ctx.dialogue(PRE_BOSS_DIALOGUE);
  yield* ctx.boss(undefined, EMBER_BOSS_VISUAL);
  ctx.dialogue(POST_BOSS_DIALOGUE);
};
