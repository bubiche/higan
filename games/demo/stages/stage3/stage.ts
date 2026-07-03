// Stage 3's scene script — the final stage, authored in the same idiom as Stages 1–2.
//
// A stage is the scene root: a coroutine that `yield`s to wait, `spawnEnemy`s waves over
// time, and `yield* ctx.boss(...)`s each encounter. Stage 3 runs opening waves → a midboss →
// more waves → the final boss, then RETURNS. Like every stage it never needs to know it is
// the LAST one — it returns when its boss falls, exactly like Stages 1–2; the shell decides
// that this final-stage clear rolls the ending rather than advancing. Its enemies + palette
// are cool astral (indigo/silver, a starlit night) — a third distinct look, not a recolour of
// the azure or ember waves.

import { type StageScript, type StageContext, type EmitterScript, type Dialogue, curve, Shape, PLAYFIELD_W } from "higan";
import { scale } from "../../difficulty";
import { NOCTURNE_MIDBOSS, NOCTURNE_MIDBOSS_VISUAL } from "./midboss";
import { NOCTURNE_BOSS_VISUAL } from "./boss";
import { demoSprites } from "../../sprites";
import { demoPortraits } from "../../portraits";

const INDIGO: readonly [number, number, number] = [0.55, 0.5, 1.0];
const SILVER: readonly [number, number, number] = [0.82, 0.88, 1.0];
const CYAN: readonly [number, number, number] = [0.5, 0.9, 1.0];
const STAR: readonly [number, number, number] = [1.0, 0.9, 0.55];

// ── Enemy AI (each an emitter the sim binds to a hittable enemy slot) ───────────
// As in Stages 1–2, an enemy's `ctx.x/y` IS its position and `ctx.aimed/ring` fire its
// danmaku on the enemy stream; all pure of (rng, tick, target). They end by returning,
// dying, or off-field cull.

/** Wisp: drifts down in a slow arc to a hover band, looses two aimed silver darts, then
 *  sinks off the bottom (the field cull frees it). */
const wisp: EmitterScript = function* (ctx) {
  for (let i = 0; i < 44; i++) {
    ctx.x += Math.cos(i * 0.12) * 1.4;
    ctx.y += 2.2;
    yield 1;
  }
  for (let i = 0; i < 2; i++) {
    ctx.aimed({ count: scale(ctx.difficulty, 3, 1), spread: 0.46, speed: 150, sprite: Shape.Rice, color: SILVER });
    yield 32;
  }
  for (let i = 0; i < 130; i++) {
    ctx.y += 3.6;
    yield 1;
  }
};

/** Comet: streaks across the upper band at speed, trailing small curved rings, and exits the
 *  far side (culled). `dir` +1 = left→right, -1 = the reverse. */
const comet = (dir: number): EmitterScript =>
  function* (ctx) {
    for (let i = 0; i < 210; i++) {
      ctx.x += dir * 3.0;
      if (i % 44 === 24) {
        ctx.ring({ count: scale(ctx.difficulty, 6, 1), speed: 84, angle: ctx.rng.range(0, Math.PI * 2), radius: 4, color: STAR, sprite: Shape.Orb, behavior: curve(0.5) });
      }
      yield 1;
    }
  };

/** Monolith: a tanky turret — dives to a hover, looses a few slow spreading rings, then
 *  retreats up off the top (culled). The stage's item anchor, like the earlier stages' turrets. */
const monolith: EmitterScript = function* (ctx) {
  for (let i = 0; i < 34; i++) {
    ctx.y += 2.0;
    yield 1;
  }
  for (let i = 0; i < 4; i++) {
    ctx.ring({
      count: scale(ctx.difficulty, 13, 2),
      speed: 66,
      angle: ctx.rng.range(0, Math.PI * 2),
      radius: 4,
      color: INDIGO,
      sprite: Shape.Orb,
      behavior: curve(0.35),
    });
    yield 46;
  }
  for (let i = 0; i < 80; i++) {
    ctx.y -= 3;
    yield 1;
  }
};

/** Spawn `n` wisps across the top on a lane stagger, `gap` ticks apart. */
function* wispLine(ctx: StageContext, n: number, gap: number): Generator<number, void, unknown> {
  for (let i = 0; i < n; i++) {
    const x = (PLAYFIELD_W * (i + 1)) / (n + 1);
    ctx.spawnEnemy(wisp, x, -12, {
      hp: 78,
      radius: 14,
      sprite: demoSprites.fairy,
      color: CYAN,
      drops: { power: 1, point: 1 },
    });
    yield gap;
  }
}

// ── Dialogue (portraits + name labels, multi-speaker, pre/post-boss) ──
// `ctx.dialogue()` is a zero-tick call, so a line placed directly before `yield* ctx.boss()`
// costs no ticks: the boss appears the same tick the box opens (frozen behind it).

const OPENING_DIALOGUE: Dialogue = [
  { name: "Heroine", portrait: demoPortraits.heroine, text: "Past the dusk, only stars remain. The last gate is near." },
];

const PRE_BOSS_DIALOGUE: Dialogue = [
  { name: "Heroine", portrait: demoPortraits.heroine, side: "left", text: "So you're what waits at the end of the night." },
  { name: "Nocturne Sovereign", portrait: demoPortraits.nocturne, side: "right", text: "I am the quiet the stars keep. Few come this far." },
  { name: "Nocturne Sovereign", portrait: demoPortraits.nocturne, side: "right", text: "Show me the light you carried through the dark!" },
];

const POST_BOSS_DIALOGUE: Dialogue = [
  { name: "Nocturne Sovereign", portrait: demoPortraits.nocturne, side: "right", text: "...Ah. The night gives way to a gentler dawn." },
  { text: "The last gate opens. The long night is over — and the way home lies clear." }, // narrator close
];

/** Stage 3 (final): opening waves → midboss → more waves → final boss. Same structure as
 *  the earlier stages; cool astral enemies and the moving Nocturne Sovereign as the finale. */
export const nocturneStage: StageScript = function* (ctx) {
  ctx.dialogue(OPENING_DIALOGUE);

  // ── Opening waves ──
  yield* wispLine(ctx, scale(ctx.difficulty, 5, 1), 36);
  yield 70;
  ctx.spawnEnemy(comet(1), -12, 80, {
    hp: 104,
    radius: 14,
    sprite: demoSprites.fairy,
    color: STAR,
    drops: { power: 2, point: 2 },
  });
  ctx.spawnEnemy(comet(-1), PLAYFIELD_W + 12, 126, {
    hp: 104,
    radius: 14,
    sprite: demoSprites.fairy,
    color: STAR,
    drops: { power: 2, point: 2 },
  });
  yield 170;
  yield* wispLine(ctx, scale(ctx.difficulty, 4, 1), 32);
  yield 130;

  // ── Midboss ── awaited: the stage pauses here and the waves below resume when it falls.
  // Second argument = its on-field body (the shared familiar, tinted for this stage).
  yield* ctx.boss(NOCTURNE_MIDBOSS, NOCTURNE_MIDBOSS_VISUAL);
  yield 90;

  // ── Post-midboss waves ── the monoliths are the stage's item anchors: one drops a life,
  // the other a full-power, so a full clear shows every item type.
  ctx.spawnEnemy(monolith, PLAYFIELD_W * 0.3, -12, {
    hp: 175,
    radius: 16,
    sprite: demoSprites.sentinel,
    color: INDIGO,
    drops: { power: 3, point: 4, bomb: 1, life: 1 },
  });
  ctx.spawnEnemy(monolith, PLAYFIELD_W * 0.7, -12, {
    hp: 175,
    radius: 16,
    sprite: demoSprites.sentinel,
    color: INDIGO,
    drops: { power: 3, point: 4, fullPower: 1 },
  });
  yield 210;
  yield* wispLine(ctx, scale(ctx.difficulty, 6, 1), 26);
  yield 150;

  // ── Final boss ── the stage RETURNS when it falls → the run ends "clear" (and, as the final
  // main stage, rolls the ending). No script (it runs `StageDef.boss`), so the body is the
  // second argument.
  ctx.dialogue(PRE_BOSS_DIALOGUE);
  yield* ctx.boss(undefined, NOCTURNE_BOSS_VISUAL);
  ctx.dialogue(POST_BOSS_DIALOGUE);
};
