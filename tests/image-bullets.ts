// Custom-image ENEMY BULLETS verification (headless; the full-colour look is
// the live-only piece). Proves:
//   1. marshalBullets partitions the SoA into glow vs image in one sweep, and falls back
//      to a glow Orb when an image's atlas layer isn't ready.
//   2. Determinism / render-only: a stage whose emitter fires a ring of custom-IMAGE
//      bullets hashes identically to the same emitter firing a glow SHAPE ring — AND to an
//      ANIMATED image ring (frames/fps) — i.e. the bullet look (including animation) is
//      resolved at the render byte, never folded into sim.hash().
//   3. Hot-reload safety: a re-imported sprites module (new handle objects) keeps each
//      bullet image on the same atlas layer, so a bullet in flight keeps its sprite.
//
// Run: pnpm test image-bullets

import { marshalBullets, INSTANCE_FLOATS, FLARE } from "../src/render/bullets";
import { createBulletStore } from "../src/bullets/store";
import { createBulletImageTable, IMAGE_FLAG, IMAGE_INDEX_MASK } from "../src/bullets/sprite-table";
import { planSpriteLayout } from "../src/render/atlas";
import { Shape } from "../src/render/shapes";
import { defineSprites } from "../src/api/sprites";
import { checkDeterministic } from "../src/core/determinism";
import { mixSeed } from "../src/core/prng";
import { DT } from "../src/core/playfield";
import { demoGame } from "../games/demo/game";
import { NORMAL } from "../games/demo/difficulty";
import type { StageDef } from "../src/api/game";
import type { EmitterScript } from "../src/api/emitter";
import type { StageScript } from "../src/api/stage";
import type { InputFrame } from "../src/core/input";

let failures = 0;
const check = (label: string, pass: boolean, detail = ""): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(48)} ${detail}`);
  if (!pass) failures++;
};
const hex = (h: number): string => `0x${h.toString(16).padStart(8, "0")}`;

// ── 1: marshalBullets partitions + falls back ──────────────────────────────────────
const store = createBulletStore(8);
const alive = new Uint8Array(8);
// slot 0: glow Kunai · 1: image idx 0 (ready→layer 7) · 2: image idx 1 (NOT ready→orb) ·
// 3: dead (skipped).
const set = (i: number, spriteByte: number, live: number): void => {
  store.x[i] = 10 + i;
  store.y[i] = 20 + i;
  store.radius[i] = 5;
  store.angle[i] = 0;
  store.r[i] = 1;
  store.g[i] = 1;
  store.b[i] = 1;
  store.sprite[i] = spriteByte;
  // Aged well past the spawn flash so this partition test sees only the bullet instances,
  // not the extra flare a young bullet would stack in (covered separately below).
  store.age[i] = FLARE.ticks;
  alive[i] = live;
};
set(0, Shape.Kunai, 1);
set(1, IMAGE_FLAG | 0, 1);
set(2, IMAGE_FLAG | 1, 1);
set(3, Shape.Orb, 0);
const glowOut = new Float32Array(8 * INSTANCE_FLOATS);
const imageOut = new Float32Array(8 * INSTANCE_FLOATS);
const res = marshalBullets(store, alive, 4, glowOut, imageOut, (id) => (id === 0 ? 7 : -1));
check("glow count = 2 (shape + fallback)", res.glow === 2, `${res.glow}`);
check("image count = 1", res.image === 1, `${res.image}`);
check("image slot resolved to layer 7", imageOut[7] === 7, `${imageOut[7]}`);
check("image slot kept its position", imageOut[0] === 11 && imageOut[1] === 21);
check("kunai wrote its layer to glow", glowOut[7] === Shape.Kunai, `${glowOut[7]}`);
check("not-ready image fell back to glow Orb", glowOut[INSTANCE_FLOATS + 7] === Shape.Orb, `${glowOut[INSTANCE_FLOATS + 7]}`);
check("dead slot skipped (only 2 glow written)", glowOut[2 * INSTANCE_FLOATS + 2] === 0);

// ── 1b: spawn flash — a young bullet stacks an extra Flare bloom into the glow stream ───
// Three live glow orbs at three ages: fresh (full flare), half-flash (dimmed/smaller flare),
// and exactly at the cutoff (no flare — the test is `age < ticks`). Radius 5, white.
const fstore = createBulletStore(4);
const falive = new Uint8Array(4);
const fset = (i: number, ageTicks: number): void => {
  fstore.x[i] = i;
  fstore.y[i] = i;
  fstore.radius[i] = 5;
  fstore.r[i] = 1;
  fstore.g[i] = 1;
  fstore.b[i] = 1;
  fstore.sprite[i] = Shape.Orb;
  fstore.age[i] = ageTicks;
  falive[i] = 1;
};
const half = Math.floor(FLARE.ticks / 2);
fset(0, 0); // fresh → full-strength flare
fset(1, half); // mid → faded, smaller flare
fset(2, FLARE.ticks); // at cutoff → NO flare
const fglow = new Float32Array(4 * 2 * INSTANCE_FLOATS); // 2× headroom for the flares
const fimg = new Float32Array(4 * INSTANCE_FLOATS);
const fres = marshalBullets(fstore, falive, 3, fglow, fimg, () => -1);
// 3 bullets + 2 flares (fresh + mid; the cutoff bullet emits none).
check("young bullets add flares to glow count", fres.glow === 5, `${fres.glow}`);
// Instance order per young slot is [bullet, flare]; the cutoff slot is [bullet] only.
const flareAt = INSTANCE_FLOATS; // the fresh bullet's flare (instance 1)
check("flare layer is Shape.Flare", fglow[flareAt + 7] === Shape.Flare, `${fglow[flareAt + 7]}`);
check(
  "fresh flare is maxScale× the bullet radius",
  Math.abs(fglow[flareAt + 2] - 5 * FLARE.maxScale) < 1e-4,
  `${fglow[flareAt + 2]} vs ${5 * FLARE.maxScale}`,
);
check("fresh flare tint undimmed", fglow[flareAt + 4] === 1, `${fglow[flareAt + 4]}`);
const midFlare = 3 * INSTANCE_FLOATS; // bullet(0), flare(1), bullet(2)=mid bullet, flare(3)=mid flare
const midFade = 1 - half / FLARE.ticks;
check("mid flare tint fades with age", Math.abs(fglow[midFlare + 4] - midFade) < 1e-4, `${fglow[midFlare + 4]} vs ${midFade}`);
check(
  "mid flare smaller than fresh flare",
  fglow[midFlare + 2] < fglow[flareAt + 2] && fglow[midFlare + 2] > 5,
  `${fglow[midFlare + 2]}`,
);
check("cutoff bullet emits its bullet, not a flare", fglow[4 * INSTANCE_FLOATS + 7] === Shape.Orb, `${fglow[4 * INSTANCE_FLOATS + 7]}`);

// ── 2: an image-bullet emitter hashes identically to a glow-bullet emitter ──────────
// A tiny stage that subs one emitter firing a repeating ring; the ONLY difference between
// the two builds is the ring's `sprite` (glow Shape vs a custom image handle).
const imgSprites = defineSprites({
  bullet: { source: { kind: "url", src: "/art/bullet.png" } },
  anim: { source: { kind: "url", src: "/art/anim.png" }, frames: 6, fps: 12 },
});
const ringEmitter = (sprite: number | typeof imgSprites.bullet): EmitterScript =>
  function* (ctx) {
    ctx.x = 192;
    ctx.y = 90;
    for (;;) {
      ctx.ring({ count: 20, speed: 130, radius: 4, sprite });
      yield 8;
    }
  };
const stageWith = (sprite: number | typeof imgSprites.bullet): StageScript =>
  function* (ctx) {
    ctx.sub(ringEmitter(sprite));
    for (;;) yield 120;
  };
const glowStage: StageDef = { id: "verify-glow", script: stageWith(Shape.Orb) };
const imageStage: StageDef = { id: "verify-image", script: stageWith(imgSprites.bullet) };
// An ANIMATED handle (frames>1, fps>0): frames/fps are presentation-clock only (resolved in
// animatedLayer at draw), never folded into sim.hash — so an animated image ring must hash
// identically to the static and glow rings too.
const animStage: StageDef = { id: "verify-anim", script: stageWith(imgSprites.anim) };

const STAGE_SEED = mixSeed(demoGame.seed, 0);
const char = demoGame.characters[0]!;
const input: InputFrame[] = [];
for (let i = 0; i < 1800; i++) input.push({ dx: (i >> 4) % 2 ? 1 : -1, dy: 0, shoot: true, focus: false, bomb: false });

const glowRun = checkDeterministic(glowStage, STAGE_SEED, input, DT, char, NORMAL, demoGame.config);
const imageRun = checkDeterministic(imageStage, STAGE_SEED, input, DT, char, NORMAL, demoGame.config);
const animRun = checkDeterministic(animStage, STAGE_SEED, input, DT, char, NORMAL, demoGame.config);
check("glow-bullet stage reproducible", glowRun.ok, `${hex(glowRun.hashA)} (${glowRun.ticks}t)`);
check("image-bullet stage reproducible", imageRun.ok, hex(imageRun.hashA));
check("animated-image stage reproducible", animRun.ok, hex(animRun.hashA));
check("image ring == glow ring hash (render-only)", glowRun.hashA === imageRun.hashA, `${hex(glowRun.hashA)} vs ${hex(imageRun.hashA)}`);
check("animated ring == glow ring hash (frames/fps out of hash)", glowRun.hashA === animRun.hashA, `${hex(glowRun.hashA)} vs ${hex(animRun.hashA)}`);

// ── 3: hot-reload keeps a bullet image's atlas layer stable ─────────────────────────
// Editing a bullet's drawer re-imports the sprites module → NEW SpriteHandle objects and a
// fresh atlas load. The layout is stable (defaults, then library in declaration order), so
// the re-imported handle lands on the SAME layer — which is why a bullet already in flight
// (its `sprite` byte → table id → handle → layer chain) keeps showing the right sprite, now
// repainted. Prove the layer is stable across an independent re-plan, and that the table
// resolves the byte back to the handle.
const build = () =>
  defineSprites({
    a: { source: { kind: "url", src: "/art/a.png" } },
    bullet: { source: { kind: "url", src: "/art/bullet.png" }, frames: 3, fps: 8 },
  });
const before = build();
const after = build(); // a "re-imported" module: distinct handle objects, same declarations
planSpriteLayout({ library: before });
planSpriteLayout({ library: after });
check("distinct handles across reload (identity changed)", before.bullet !== after.bullet);
check(
  "reloaded bullet handle keeps its atlas layer",
  before.bullet.layer >= 0 && before.bullet.layer === after.bullet.layer,
  `${before.bullet.layer} == ${after.bullet.layer}`,
);
const table = createBulletImageTable();
const byte = table.resolve(before.bullet);
check("table interns image handle behind the flag", (byte & IMAGE_FLAG) !== 0);
check(
  "byte resolves back to the same handle (byte→layer chain intact)",
  table.handles[byte & IMAGE_INDEX_MASK] === before.bullet,
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exitCode = 1;
