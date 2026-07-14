// Custom-image PLAYER SHOTS verification (headless; the full-colour look is
// the live-only piece). Proves:
//   1. The bullet-image table encodes correctly (number passthrough, handle interning →
//      IMAGE_FLAG, range + capacity guards).
//   2. marshalShots partitions glow vs image, and falls back to a glow Orb when the atlas
//      layer isn't ready.
//   3. Determinism: a character whose shot uses a custom IMAGE hashes identically to the
//      same character using a glow SHAPE — i.e. the shot look is render-only, not hashed.
//
// Run: pnpm test image-shots

import { createBulletImageTable, IMAGE_FLAG, IMAGE_INDEX_MASK, MAX_BULLET_IMAGES } from "../src/bullets/sprite-table";
import { marshalShots } from "../src/render/shots";
import { INSTANCE_FLOATS } from "../src/render/bullets";
import { Shape } from "../src/render/shapes";
import { defineSprites } from "../src/api/sprites";
import { checkDeterministic } from "../src/core/determinism";
import { mixSeed } from "../src/core/prng";
import { DT } from "../src/core/playfield";
import { DEFAULT_SHOT_CONFIG } from "../src/touhou/shot";
import { demoGame } from "../games/demo/game";
import { NORMAL } from "../games/demo/difficulty";
import type { Shot } from "../src/touhou/shot";
import type { CharacterDef } from "../src/api";
import type { InputFrame } from "../src/core/input";

let failures = 0;
const check = (label: string, pass: boolean, detail = ""): void => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label.padEnd(46)} ${detail}`);
  if (!pass) failures++;
};
const hex = (h: number): string => `0x${h.toString(16).padStart(8, "0")}`;

// ── 1: the table encodes ─────────────────────────────────────────────────────────
const sprites = defineSprites({
  needle: { source: { kind: "procedural", draw: () => {} } },
  amulet: { source: { kind: "procedural", draw: () => {} } },
});
const table = createBulletImageTable();
check("glow shape passes through", table.resolve(Shape.Kunai) === Shape.Kunai, `${table.resolve(Shape.Kunai)}`);
const nb = table.resolve(sprites.needle);
check("handle → IMAGE_FLAG set", (nb & IMAGE_FLAG) !== 0, hex(nb));
check("handle → table index 0", (nb & IMAGE_INDEX_MASK) === 0);
check("same handle re-interns to same byte", table.resolve(sprites.needle) === nb);
const ab = table.resolve(sprites.amulet);
check("second handle → index 1", (ab & IMAGE_INDEX_MASK) === 1);
check("table exposes both handles", table.handles.length === 2 && table.handles[0] === sprites.needle);
let threw = false;
try { table.resolve(200); } catch { threw = true; }
check("out-of-range shape throws", threw);
threw = false;
try {
  const t2 = createBulletImageTable();
  const many = defineSprites(Object.fromEntries(Array.from({ length: MAX_BULLET_IMAGES + 1 }, (_, i) => [`s${i}`, { source: { kind: "procedural", draw: () => {} } }])) as Record<string, { source: { kind: "procedural"; draw: () => void } }>);
  for (const k in many) t2.resolve(many[k]!);
} catch { threw = true; }
check(`> ${MAX_BULLET_IMAGES} images throws`, threw);

// ── 2: marshalShots partitions + falls back ────────────────────────────────────────
const mkShot = (spriteByte: number): Shot => ({
  alive: true, x: 10, y: 20, vx: 0, vy: -100, age: 0, damage: 1, radius: 5,
  homing: 0, sprite: spriteByte, r: 1, g: 1, b: 1,
});
const glowOut = new Float32Array(8 * INSTANCE_FLOATS);
const imageOut = new Float32Array(8 * INSTANCE_FLOATS);
const shotList: Shot[] = [
  mkShot(Shape.Kunai),          // glow
  mkShot(IMAGE_FLAG | 0),       // image, layer ready
  mkShot(IMAGE_FLAG | 1),       // image, NOT ready → glow-orb fallback
  { ...mkShot(0), alive: false }, // skipped
];
// image 0 resolves to atlas layer 7; image 1 not ready (-1).
const res = marshalShots(shotList, glowOut, imageOut, (id) => (id === 0 ? 7 : -1));
check("glow count = 2 (shape + fallback)", res.glow === 2, `${res.glow}`);
check("image count = 1", res.image === 1, `${res.image}`);
check("image layer resolved to 7", imageOut[7] === 7, `${imageOut[7]}`);
check("fallback slot is a glow Orb", glowOut[INSTANCE_FLOATS + 7] === Shape.Orb, `${glowOut[INSTANCE_FLOATS + 7]}`);
check("kunai kept its layer", glowOut[7] === Shape.Kunai, `${glowOut[7]}`);

// ── 3: an image shot hashes identically to a glow shot (render-only) ───────────────
const stage = demoGame.stages[0]!;
const STAGE_SEED = mixSeed(demoGame.seed, 0);
const base = demoGame.characters[0]!;
const imgSprites = defineSprites({ shot: { source: { kind: "url", src: "/art/shot.png" } } });
const glowChar: CharacterDef = { ...base, shot: { ...DEFAULT_SHOT_CONFIG, sprite: Shape.Kunai } };
const imageChar: CharacterDef = { ...base, shot: { ...DEFAULT_SHOT_CONFIG, sprite: imgSprites.shot } };
const input: InputFrame[] = [];
for (let i = 0; i < 4000; i++) input.push({ dx: (i >> 3) % 2 ? 1 : -1, dy: 0, shoot: true, focus: i % 120 < 30, bomb: false });
const glowRun = checkDeterministic(stage, STAGE_SEED, input, DT, glowChar, NORMAL, demoGame.config);
const imageRun = checkDeterministic(stage, STAGE_SEED, input, DT, imageChar, NORMAL, demoGame.config);
check("glow-shot char reproducible", glowRun.ok, `${hex(glowRun.hashA)} (${glowRun.ticks}t)`);
check("image-shot char reproducible", imageRun.ok, hex(imageRun.hashA));
check("image shot == glow shot hash (render-only)", glowRun.hashA === imageRun.hashA, `${hex(glowRun.hashA)} vs ${hex(imageRun.hashA)}`);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
if (failures > 0) process.exitCode = 1;
