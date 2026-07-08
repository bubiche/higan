// The Extra stage's scene script — a standalone post-campaign stage, authored in the exact
// idiom as the three campaign stages.
//
// A stage is the scene root: a coroutine that `yield`s to wait, `spawnEnemy`s waves over time,
// and `yield* ctx.boss(...)`s each encounter. This one runs denser opening waves → a midboss →
// more waves → the moving final boss, then RETURNS — the shell ends a standalone run "clear"
// (straight to results; the Extra stage has no staff-roll — it is one stage, not the campaign
// end). Its enemies + palette are crimson spider-lily (the far shore, the higanbana), a fifth
// distinct look after azure / ember / astral.

import { type StageScript, type StageContext, type EmitterScript, type Dialogue, curve, delay, Shape, PLAYFIELD_W } from "higan";
import { scale } from "../../difficulty";
import { SHOREKEEPER_MIDBOSS, SHOREKEEPER_MIDBOSS_VISUAL } from "./midboss";
import { SHOREKEEPER_BOSS_VISUAL } from "./boss";
import { demoSprites } from "../../sprites";
import { demoPortraits } from "../../portraits";

const CRIMSON: readonly [number, number, number] = [1.0, 0.25, 0.35];
const SCARLET: readonly [number, number, number] = [1.0, 0.45, 0.25];
const BONE: readonly [number, number, number] = [1.0, 0.9, 0.8];
const VIOLET: readonly [number, number, number] = [0.8, 0.4, 1.0];

// ── Enemy AI (each an emitter the sim binds to a hittable enemy slot) ───────────
// As in the campaign, an enemy's `ctx.x/y` IS its position and `ctx.aimed/ring` fire its
// danmaku on the enemy stream; all pure of (rng, tick, target).

/** Emberling: drifts down in an arc to a hover band, looses three aimed crimson darts, then
 *  sinks off the bottom (culled). Denser than the campaign's opener sweepers. */
const emberling: EmitterScript = function* (ctx) {
  for (let i = 0; i < 40; i++) {
    ctx.x += Math.cos(i * 0.13) * 1.6;
    ctx.y += 2.4;
    yield 1;
  }
  for (let i = 0; i < 3; i++) {
    ctx.aimed({ count: scale(ctx.difficulty, 3, 1), spread: 0.5, speed: 165, sprite: Shape.Rice, color: CRIMSON });
    yield 28;
  }
  for (let i = 0; i < 130; i++) {
    ctx.y += 3.8;
    yield 1;
  }
};

/** Driftflower: streaks across the upper band, trailing hanging (`delay`) petals that snap
 *  down behind it, and exits the far side (culled). `dir` +1 = left→right, -1 = reverse. */
const driftflower = (dir: number): EmitterScript =>
  function* (ctx) {
    for (let i = 0; i < 200; i++) {
      ctx.x += dir * 3.2;
      if (i % 38 === 20) {
        ctx.fire({ x: ctx.x, y: ctx.y, angle: Math.PI / 2, speed: 150, radius: 4, color: SCARLET, sprite: Shape.Star, behavior: delay(34) });
      }
      yield 1;
    }
  };

/** Warden's herald: a tanky turret — dives to a hover, looses a few slow curling rings, then
 *  retreats up off the top (culled). The stage's item anchor. */
const herald: EmitterScript = function* (ctx) {
  for (let i = 0; i < 34; i++) {
    ctx.y += 2.0;
    yield 1;
  }
  for (let i = 0; i < 4; i++) {
    ctx.ring({
      count: scale(ctx.difficulty, 15, 2),
      speed: 68,
      angle: ctx.rng.range(0, Math.PI * 2),
      radius: 4,
      color: VIOLET,
      sprite: Shape.Orb,
      behavior: curve(0.4),
    });
    yield 44;
  }
  for (let i = 0; i < 80; i++) {
    ctx.y -= 3;
    yield 1;
  }
};

/** Spawn `n` emberlings across the top on a lane stagger, `gap` ticks apart. */
function* emberlingLine(ctx: StageContext, n: number, gap: number): Generator<number, void, unknown> {
  for (let i = 0; i < n; i++) {
    const x = (PLAYFIELD_W * (i + 1)) / (n + 1);
    ctx.spawnEnemy(emberling, x, -12, {
      hp: 88,
      radius: 14,
      sprite: demoSprites.fairy,
      color: SCARLET,
      drops: { power: 1, point: 1 },
    });
    yield gap;
  }
}

// ── Dialogue (portraits + name labels, pre/post-boss) ──
const OPENING_DIALOGUE: Dialogue = [
  { name: "Heroine", portrait: demoPortraits.heroine, text: "Past the last gate, the river. And beyond it — the far shore, all in red bloom." },
];

const PRE_BOSS_DIALOGUE: Dialogue = [
  { name: "Heroine", portrait: demoPortraits.heroine, side: "left", text: "So this is the shore the spider lilies keep." },
  { name: "Crimson Shorekeeper", portrait: demoPortraits.shorekeeper, side: "right", text: "You crossed the river alive. Few do — and none uninvited." },
  { name: "Crimson Shorekeeper", portrait: demoPortraits.shorekeeper, side: "right", text: "Turn back, or bloom here with the rest. Show me which you'll choose!" },
];

const POST_BOSS_DIALOGUE: Dialogue = [
  { name: "Crimson Shorekeeper", portrait: demoPortraits.shorekeeper, side: "right", text: "...Heh. Then carry a lily back with you, to remember the far shore." },
  { text: "The red bloom stills. The way back across the river lies open." }, // narrator close
];

/** The Extra stage: denser opening waves → midboss → more waves → the moving Crimson
 *  Shorekeeper. Same structure as the campaign stages; it just never advances (a standalone
 *  single-stage run) and rolls no ending. */
export const shoreStage: StageScript = function* (ctx) {
  ctx.dialogue(OPENING_DIALOGUE);

  // ── Opening waves ── denser and faster than the campaign openers.
  yield* emberlingLine(ctx, scale(ctx.difficulty, 6, 1), 30);
  yield 60;
  ctx.spawnEnemy(driftflower(1), -12, 78, {
    hp: 116,
    radius: 14,
    sprite: demoSprites.fairy,
    color: BONE,
    drops: { power: 2, point: 2 },
  });
  ctx.spawnEnemy(driftflower(-1), PLAYFIELD_W + 12, 120, {
    hp: 116,
    radius: 14,
    sprite: demoSprites.fairy,
    color: BONE,
    drops: { power: 2, point: 2 },
  });
  yield 150;
  yield* emberlingLine(ctx, scale(ctx.difficulty, 5, 1), 26);
  yield 120;

  // ── Midboss ── awaited: the stage pauses here and the waves below resume when it falls.
  yield* ctx.boss(SHOREKEEPER_MIDBOSS, SHOREKEEPER_MIDBOSS_VISUAL);
  yield 80;

  // ── Post-midboss waves ── the heralds are the stage's item anchors: one drops a life, the
  // other a full-power, so a full clear shows every item type.
  ctx.spawnEnemy(herald, PLAYFIELD_W * 0.3, -12, {
    hp: 190,
    radius: 16,
    sprite: demoSprites.sentinel,
    color: VIOLET,
    drops: { power: 3, point: 4, bomb: 1, life: 1 },
  });
  ctx.spawnEnemy(herald, PLAYFIELD_W * 0.7, -12, {
    hp: 190,
    radius: 16,
    sprite: demoSprites.sentinel,
    color: VIOLET,
    drops: { power: 3, point: 4, fullPower: 1 },
  });
  yield 200;
  yield* emberlingLine(ctx, scale(ctx.difficulty, 7, 1), 22);
  yield 140;

  // ── Final boss ── the stage RETURNS when it falls → the standalone run ends "clear" (straight
  // to results, no staff-roll). No script (it runs `StageDef.boss`), so the body is the second
  // argument.
  ctx.dialogue(PRE_BOSS_DIALOGUE);
  yield* ctx.boss(undefined, SHOREKEEPER_BOSS_VISUAL);
  ctx.dialogue(POST_BOSS_DIALOGUE);
};
